// VarFixer - Figma Plugin
// Kırık variable referanslarını tespit edip düzelten ve token export eden araç

interface BrokenReference {
  nodeId: string;
  nodeName: string;
  field: string;
  variableId: string;
  variableName: string | null;
  collectionName: string | null;
  status: 'broken' | 'remote' | 'fixed' | 'no-match';
  isRemote: boolean;
}

interface LocalVariableMap {
  byFullPath: Map<string, Variable>; // "CollectionName/VariableName" -> Variable
  byName: Map<string, Variable[]>;   // "VariableName" -> Variable[] (birden fazla olabilir)
}

// Taranan boundVariable alanları
const PAINT_FIELDS = ['fills', 'strokes'] as const;
const NUMERIC_FIELDS = [
  'opacity',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'itemSpacing',
  'counterAxisSpacing',
  'strokeWeight',
  'strokeTopWeight',
  'strokeRightWeight',
  'strokeBottomWeight',
  'strokeLeftWeight',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight'
] as const;

let brokenReferences: BrokenReference[] = [];
let localVariableMap: LocalVariableMap | null = null;
let totalNodesToScan = 0;
let scannedNodes = 0;

// Plugin UI'ı göster
figma.showUI(__html__, { width: 400, height: 500 });

// Progress güncelle
function updateProgress(current: number, total: number, message: string): void {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  figma.ui.postMessage({
    type: 'progress',
    current,
    total,
    percent,
    message
  });
}

// Local variable'ları indexle
async function buildLocalVariableMap(): Promise<LocalVariableMap> {
  const variables = await figma.variables.getLocalVariablesAsync();
  const byFullPath = new Map<string, Variable>();
  const byName = new Map<string, Variable[]>();

  // Local variable ID'lerini cache'le
  localVariableIds = new Set();

  for (const variable of variables) {
    localVariableIds.add(variable.id);

    const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
    const collectionName = collection ? collection.name : 'Unknown';
    const fullPath = `${collectionName}/${variable.name}`;

    byFullPath.set(fullPath, variable);

    const existing = byName.get(variable.name) || [];
    existing.push(variable);
    byName.set(variable.name, existing);
  }

  // Debug: Local collection isimlerini ve tüm variable'ları logla
  const collectionVars: Record<string, string[]> = {};
  for (const [path] of byFullPath) {
    const col = path.split('/')[0];
    if (!collectionVars[col]) {
      collectionVars[col] = [];
    }
    collectionVars[col].push(path);
  }
  console.log('=== LOCAL COLLECTIONS (ALL VARIABLES) ===');
  for (const col of Object.keys(collectionVars)) {
    console.log('Collection:', JSON.stringify(col), '- Total:', collectionVars[col].length);
    // Tüm variable'ları göster
    collectionVars[col].forEach(v => console.log('  ', v));
  }

  return { byFullPath, byName };
}

// Local variable ID'lerini cache'le
let localVariableIds: Set<string> = new Set();

// Tek bir node'u tara
async function scanNode(node: SceneNode): Promise<BrokenReference[]> {
  const issues: BrokenReference[] = [];

  if (!('boundVariables' in node) || !node.boundVariables) {
    return issues;
  }

  const boundVars = node.boundVariables as Record<string, VariableAlias | VariableAlias[]>;

  // Paint alanlarını kontrol et (fills, strokes - array olabilir)
  for (const field of PAINT_FIELDS) {
    const bindings = boundVars[field];
    if (bindings && Array.isArray(bindings)) {
      for (let i = 0; i < bindings.length; i++) {
        const binding = bindings[i];
        if (binding && binding.id) {
          const issue = await checkVariableBinding(node, `${field}[${i}]`, binding.id);
          if (issue) issues.push(issue);
        }
      }
    }
  }

  // Numeric alanları kontrol et
  for (const field of NUMERIC_FIELDS) {
    const binding = boundVars[field] as VariableAlias | undefined;
    if (binding && binding.id) {
      const issue = await checkVariableBinding(node, field, binding.id);
      if (issue) issues.push(issue);
    }
  }

  return issues;
}

// Variable binding'i kontrol et - kırık mı yoksa remote mu?
async function checkVariableBinding(node: SceneNode, field: string, variableId: string): Promise<BrokenReference | null> {
  const variable = await figma.variables.getVariableByIdAsync(variableId);

  if (!variable) {
    // Variable resolve edilemedi = kırık
    return {
      nodeId: node.id,
      nodeName: node.name,
      field: field,
      variableId: variableId,
      variableName: null,
      collectionName: null,
      status: 'broken',
      isRemote: false
    };
  }

  // Variable resolve edildi ama local mı kontrol et
  const isLocal = localVariableIds.has(variableId);

  if (!isLocal) {
    // Remote variable - local'e çevrilmeli
    const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
    const colName = collection ? collection.name : null;

    // Debug: Remote variable bilgilerini logla (ilk 10 tane)
    console.log('Remote var:', JSON.stringify(colName), '/', JSON.stringify(variable.name));

    return {
      nodeId: node.id,
      nodeName: node.name,
      field: field,
      variableId: variableId,
      variableName: variable.name,
      collectionName: colName,
      status: 'remote',
      isRemote: true
    };
  }

  // Local variable - sorun yok
  return null;
}

// Variable ID'den isim ve collection bilgisi çıkarmaya çalış
async function extractVariableInfo(variableId: string): Promise<{ name: string | null; collectionName: string | null }> {
  // Figma variable ID'leri genellikle "VariableID:xxx:yyy" formatında
  // Kırık referanslarda orijinal ismi almak zor, null dönebilir
  return { name: null, collectionName: null };
}

// Recursive olarak tüm node'ları tara
async function scanNodesRecursively(nodes: readonly SceneNode[]): Promise<BrokenReference[]> {
  let allBroken: BrokenReference[] = [];

  for (const node of nodes) {
    scannedNodes++;

    // Her 20 node'da bir progress güncelle ve UI'ın nefes almasını sağla
    if (scannedNodes % 20 === 0) {
      updateProgress(scannedNodes, totalNodesToScan, `Taranıyor: ${node.name.substring(0, 30)}...`);
      // UI thread'inin güncellenmesi için kısa bekle
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const nodeBroken = await scanNode(node);

    // Bulunan her sorunu anında UI'a gönder (streaming)
    for (const item of nodeBroken) {
      allBroken.push(item);
      figma.ui.postMessage({
        type: 'scan-item',
        item: item
      });
    }

    // Çocuk node'ları tara (recursive call zaten kendi item'larını gönderir)
    if ('children' in node) {
      const childBroken = await scanNodesRecursively(node.children);
      // Sadece allBroken'a ekle, scan-item zaten gönderildi
      allBroken = allBroken.concat(childBroken);
    }
  }

  return allBroken;
}

// Aktif sayfayı tara
async function scanCurrentPage(): Promise<void> {
  try {
    // UI'a tarama başladığını bildir (listeyi temizle ve progress göster)
    figma.ui.postMessage({ type: 'scan-start', message: 'Node\'lar sayılıyor...' });

    // Kısa gecikme ile UI'ın güncellenmesini sağla
    await new Promise(resolve => setTimeout(resolve, 10));

    // Önce toplam node sayısını hesapla
    totalNodesToScan = countNodes(figma.currentPage.children);
    scannedNodes = 0;

    console.log('Total nodes to scan:', totalNodesToScan);
    updateProgress(0, totalNodesToScan, `${totalNodesToScan} node bulundu. Variable'lar indexleniyor...`);

    // UI güncellemesi için bekle
    await new Promise(resolve => setTimeout(resolve, 10));

    localVariableMap = await buildLocalVariableMap();
    const varCount = localVariableMap.byFullPath.size;

    updateProgress(0, totalNodesToScan, `${varCount} variable bulundu. Tarama başlıyor...`);

    brokenReferences = await scanNodesRecursively(figma.currentPage.children);

    // Debug: Collection bazlı variable örnekleri topla
    const collectionSamples: Record<string, string[]> = {};
    if (localVariableMap) {
      for (const [path] of localVariableMap.byFullPath) {
        const collectionName = path.split('/')[0];
        if (!collectionSamples[collectionName]) {
          collectionSamples[collectionName] = [];
        }
        if (collectionSamples[collectionName].length < 5) {
          collectionSamples[collectionName].push(path);
        }
      }
    }

    figma.ui.postMessage({
      type: 'scan-result',
      data: brokenReferences,
      totalNodes: totalNodesToScan,
      localVariableCount: varCount,
      collectionSamples: collectionSamples
    });
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: `Tarama hatası: ${error}` });
  }
}

// Tüm sayfaları tara
async function scanAllPages(): Promise<void> {
  try {
    // UI'a tarama başladığını bildir (listeyi temizle ve progress göster)
    figma.ui.postMessage({ type: 'scan-start', message: 'Hazırlanıyor...' });

    // Kısa gecikme ile UI'ın güncellenmesini sağla
    await new Promise(resolve => setTimeout(resolve, 10));

    // Tüm sayfalardaki toplam node sayısını hesapla
    totalNodesToScan = 0;
    for (const page of figma.root.children) {
      totalNodesToScan += countNodes(page.children);
    }
    scannedNodes = 0;

    updateProgress(0, totalNodesToScan, 'Variable\'lar indexleniyor...');

    localVariableMap = await buildLocalVariableMap();
    const varCount = localVariableMap.byFullPath.size;
    brokenReferences = [];

    updateProgress(0, totalNodesToScan, `${varCount} variable bulundu. ${figma.root.children.length} sayfa taranacak...`);

    for (let i = 0; i < figma.root.children.length; i++) {
      const page = figma.root.children[i];
      updateProgress(scannedNodes, totalNodesToScan, `Sayfa ${i + 1}/${figma.root.children.length}: ${page.name}`);
      const pageBroken = await scanNodesRecursively(page.children);
      brokenReferences = brokenReferences.concat(pageBroken);
    }

    figma.ui.postMessage({
      type: 'scan-result',
      data: brokenReferences,
      totalPages: figma.root.children.length,
      totalNodes: totalNodesToScan,
      localVariableCount: varCount
    });
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: `Tarama hatası: ${error}` });
  }
}

// Node sayısını hesapla
function countNodes(nodes: readonly SceneNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count++;
    if ('children' in node) {
      count += countNodes(node.children);
    }
  }
  return count;
}

// Kırık ve remote referansları düzelt
async function fixBrokenReferences(): Promise<void> {
  console.log('=== FIX STARTED ===');
  console.log('localVariableMap exists:', !!localVariableMap);
  console.log('brokenReferences count:', brokenReferences.length);

  if (!localVariableMap) {
    figma.ui.postMessage({ type: 'error', message: 'Önce tarama yapın' });
    return;
  }

  console.log('byFullPath size:', localVariableMap.byFullPath.size);
  console.log('byName size:', localVariableMap.byName.size);

  const total = brokenReferences.filter(r => r.status === 'broken' || r.status === 'remote').length;

  // UI'a düzeltme başladığını bildir ve progress bar'ı hemen göster
  figma.ui.postMessage({ type: 'fix-start', total: total, message: 'Hazırlanıyor...' });

  // Kısa gecikme ile UI'ın güncellenmesini sağla
  await new Promise(resolve => setTimeout(resolve, 10));

  updateProgress(0, total, 'Düzeltme başlıyor...');

  let fixedCount = 0;
  let failedCount = 0;
  let processed = 0;

  for (let i = 0; i < brokenReferences.length; i++) {
    const ref = brokenReferences[i];
    // Hem kırık hem remote referansları düzelt
    if (ref.status !== 'broken' && ref.status !== 'remote') continue;

    processed++;
    // Her item'da progress güncelle
    updateProgress(processed, total, `Düzeltiliyor: ${ref.nodeName.substring(0, 30)}...`);

    const node = await figma.getNodeByIdAsync(ref.nodeId) as SceneNode;
    if (!node) {
      ref.status = 'no-match';
      failedCount++;
      // Streaming: başarısız item'ı bildir
      figma.ui.postMessage({
        type: 'fix-item',
        index: i,
        status: 'no-match',
        fixedCount,
        failedCount
      });
      continue;
    }

    // Eşleşen local variable'ı bul
    let matchedVariable: Variable | null = null;

    // Öncelik 1: Collection + Variable adı
    if (ref.collectionName && ref.variableName) {
      const fullPath = `${ref.collectionName}/${ref.variableName}`;
      matchedVariable = localVariableMap.byFullPath.get(fullPath) || null;

      // Debug: Eşleşme kontrolü
      if (!matchedVariable) {
        console.log('=== MATCH FAILED ===');
        console.log('Looking for:', fullPath);
        console.log('Collection:', ref.collectionName);
        console.log('Variable:', ref.variableName);
        // İlk 5 local path'i göster
        let count = 0;
        for (const [path] of localVariableMap.byFullPath) {
          if (count < 5 || path.toLowerCase().includes(ref.variableName.toLowerCase().split('/')[0])) {
            console.log('Local path:', path);
          }
          count++;
          if (count > 20) break;
        }
      }
    }

    // Öncelik 2: Sadece variable adı
    if (!matchedVariable && ref.variableName) {
      const candidates = localVariableMap.byName.get(ref.variableName);
      if (candidates && candidates.length === 1) {
        matchedVariable = candidates[0];
      } else if (candidates && candidates.length > 1) {
        // Birden fazla eşleşme var, collection adına göre en iyi eşleşmeyi bul
        for (const candidate of candidates) {
          const col = await figma.variables.getVariableCollectionByIdAsync(candidate.variableCollectionId);
          if (col && ref.collectionName && col.name.toLowerCase().includes(ref.collectionName.toLowerCase())) {
            matchedVariable = candidate;
            break;
          }
        }
        // Hala bulamadıysak ilkini al
        if (!matchedVariable) {
          matchedVariable = candidates[0];
        }
      }
    }

    // Öncelik 3: Prefix kaldırarak eşleştirme (örn: "spacing-1" -> "1")
    if (!matchedVariable && ref.variableName && ref.collectionName) {
      // Yaygın prefix'leri kaldır
      const prefixPatterns = [
        new RegExp(`^${ref.collectionName.toLowerCase()}-`, 'i'),  // "spacing-" gibi
        new RegExp(`^${ref.collectionName.toLowerCase()}_`, 'i'),  // "spacing_" gibi
        /^color-/i, /^spacing-/i, /^sizing-/i, /^border-/i, /^radius-/i
      ];

      let cleanedName = ref.variableName;
      for (const pattern of prefixPatterns) {
        cleanedName = cleanedName.replace(pattern, '');
      }

      if (cleanedName !== ref.variableName) {
        // Prefix kaldırıldı, tekrar dene
        const cleanedPath = `${ref.collectionName}/${cleanedName}`;
        matchedVariable = localVariableMap.byFullPath.get(cleanedPath) || null;

        if (!matchedVariable) {
          // byName ile de dene
          const candidates = localVariableMap.byName.get(cleanedName);
          if (candidates) {
            for (const candidate of candidates) {
              const col = await figma.variables.getVariableCollectionByIdAsync(candidate.variableCollectionId);
              if (col && col.name.toLowerCase() === ref.collectionName.toLowerCase()) {
                matchedVariable = candidate;
                console.log('Matched with prefix removal:', ref.variableName, '->', cleanedName);
                break;
              }
            }
          }
        }
      }
    }

    // Debug: Her ref için eşleşme durumunu logla
    console.log('Processing ref:', ref.collectionName, '/', ref.variableName, '-> matched:', !!matchedVariable);

    if (matchedVariable) {
      try {
        // Field adından index'i çıkar (örn: "fills[0]" -> "fills", 0)
        const fieldMatch = ref.field.match(/^(\w+)(?:\[(\d+)\])?$/);
        if (fieldMatch) {
          const fieldName = fieldMatch[1];
          const paintIndex = fieldMatch[2] ? parseInt(fieldMatch[2]) : 0;
          console.log('Setting bound variable:', fieldName, `[${paintIndex}]`, '->', matchedVariable.name);

          // fills ve strokes için paint objesi üzerinde binding yap
          if ((fieldName === 'fills' || fieldName === 'strokes') && fieldName in node) {
            const paints = (node as any)[fieldName];
            if (Array.isArray(paints) && paints[paintIndex]) {
              console.log('=== BEFORE FIX ===');
              console.log('Node:', node.name, 'Field:', fieldName, 'Index:', paintIndex);
              console.log('Old paint boundVariables:', JSON.stringify(paints[paintIndex]?.boundVariables));

              // Paint'i klonla ve variable binding ekle
              const newPaints = [...paints];
              const paint = { ...newPaints[paintIndex] };

              // Variable binding'i figma.variables.setBoundVariableForPaint ile yap
              const newPaint = figma.variables.setBoundVariableForPaint(paint, 'color', matchedVariable);
              newPaints[paintIndex] = newPaint;
              (node as any)[fieldName] = newPaints;

              // Verify: Değişiklik uygulandı mı?
              const verifyPaints = (node as any)[fieldName];
              console.log('=== AFTER FIX ===');
              console.log('New paint boundVariables:', JSON.stringify(verifyPaints[paintIndex]?.boundVariables));
              console.log('Expected variable ID:', matchedVariable.id);
              console.log('Actual bound ID:', verifyPaints[paintIndex]?.boundVariables?.color?.id);

              if (verifyPaints[paintIndex]?.boundVariables?.color?.id === matchedVariable.id) {
                ref.status = 'fixed';
                fixedCount++;
              } else {
                console.log('WARNING: Variable binding did not apply!');
                ref.status = 'no-match';
                failedCount++;
              }
            } else {
              console.log('Paint not found at index:', paintIndex);
              ref.status = 'no-match';
              failedCount++;
            }
          } else if ('setBoundVariable' in node) {
            try {
              // Önce mevcut binding'i kaldır
              (node as any).setBoundVariable(fieldName as VariableBindableNodeField, null);

              // Sonra yeni binding'i ekle
              (node as any).setBoundVariable(fieldName as VariableBindableNodeField, matchedVariable);

              // Verify
              const afterBinding = (node as any).boundVariables?.[fieldName];
              if (afterBinding?.id === matchedVariable.id) {
                console.log('Fixed:', node.name, fieldName, '->', matchedVariable.name);
                ref.status = 'fixed';
                fixedCount++;
              } else {
                // Binding değişmedi - muhtemelen instance içinde veya kilitli
                console.log('Cannot modify binding (instance or locked?):', node.name, fieldName);
                ref.status = 'no-match';
                failedCount++;
              }
            } catch (err) {
              console.log('setBoundVariable error:', err);
              ref.status = 'no-match';
              failedCount++;
            }
          } else {
            ref.status = 'no-match';
            failedCount++;
          }
        }
      } catch (error) {
        console.log('setBoundVariable error:', error);
        ref.status = 'no-match';
        failedCount++;
      }
    } else {
      console.log('No match or no setBoundVariable for:', ref.nodeName, ref.field);
      ref.status = 'no-match';
      failedCount++;
    }

    // Streaming: Her item işlendikten sonra UI'a bildir
    figma.ui.postMessage({
      type: 'fix-item',
      index: i,
      status: ref.status,
      fixedCount,
      failedCount
    });
  }

  figma.ui.postMessage({
    type: 'fix-result',
    fixedCount,
    failedCount,
    data: brokenReferences
  });
}

// Token'ları export et
async function exportTokens(): Promise<void> {
  figma.ui.postMessage({ type: 'status', message: 'Token\'lar toplanıyor...' });

  try {
    const variables = await figma.variables.getLocalVariablesAsync();
    const collections = await figma.variables.getLocalVariableCollectionsAsync();

    const collectionMap = new Map<string, VariableCollection>();
    for (const collection of collections) {
      collectionMap.set(collection.id, collection);
    }

    interface ExportedVariable {
      name: string;
      type: string;
      resolvedType: string;
      valuesByMode: Record<string, any>;
      scopes: string[];
      description: string;
    }

    interface ExportedCollection {
      name: string;
      modes: string[];
      variables: ExportedVariable[];
    }

    interface ExportData {
      exportDate: string;
      fileName: string;
      collections: ExportedCollection[];
    }

    // Collection bazlı grupla
    const collectionGroups = new Map<string, { collection: VariableCollection; variables: Variable[] }>();

    for (const variable of variables) {
      const collection = collectionMap.get(variable.variableCollectionId);
      if (collection) {
        if (!collectionGroups.has(collection.id)) {
          collectionGroups.set(collection.id, { collection, variables: [] });
        }
        collectionGroups.get(collection.id)!.variables.push(variable);
      }
    }

    const exportData: ExportData = {
      exportDate: new Date().toISOString(),
      fileName: figma.root.name,
      collections: []
    };

    for (const [, group] of collectionGroups) {
      const modeNames = group.collection.modes.map(m => m.name);

      const exportedVars: ExportedVariable[] = [];

      for (const variable of group.variables) {
        const valuesByMode: Record<string, any> = {};

        for (const mode of group.collection.modes) {
          const value = variable.valuesByMode[mode.modeId];

          if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS') {
            // Alias referansı
            const aliasVar = await figma.variables.getVariableByIdAsync((value as VariableAlias).id);
            if (aliasVar) {
              const aliasCollection = collectionMap.get(aliasVar.variableCollectionId);
              valuesByMode[mode.name] = {
                alias: {
                  collection: aliasCollection ? aliasCollection.name : 'Unknown',
                  variable: aliasVar.name
                },
                resolved: await resolveVariableValue(variable, mode.modeId)
              };
            }
          } else {
            valuesByMode[mode.name] = value;
          }
        }

        exportedVars.push({
          name: variable.name,
          type: variable.resolvedType,
          resolvedType: variable.resolvedType,
          valuesByMode,
          scopes: [...variable.scopes],
          description: variable.description || ''
        });
      }

      exportData.collections.push({
        name: group.collection.name,
        modes: modeNames,
        variables: exportedVars
      });
    }

    figma.ui.postMessage({
      type: 'export-result',
      data: JSON.stringify(exportData, null, 2),
      fileName: `${figma.root.name}-tokens-${new Date().toISOString().split('T')[0]}.json`
    });
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: `Export hatası: ${error}` });
  }
}

// Variable değerini resolve et (alias zincirini çöz)
async function resolveVariableValue(variable: Variable, modeId: string): Promise<any> {
  let value = variable.valuesByMode[modeId];

  while (typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS') {
    const aliasVar = await figma.variables.getVariableByIdAsync((value as VariableAlias).id);
    if (!aliasVar) break;
    value = aliasVar.valuesByMode[modeId];
  }

  return value;
}

// UI'dan gelen mesajları dinle
figma.ui.onmessage = async (msg: { type: string }) => {
  switch (msg.type) {
    case 'scan':
      await scanCurrentPage();
      break;
    case 'scan-all-pages':
      await scanAllPages();
      break;
    case 'fix':
      await fixBrokenReferences();
      break;
    case 'export-tokens':
      await exportTokens();
      break;
    case 'close':
      figma.closePlugin();
      break;
  }
};
