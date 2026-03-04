// VarFixer - Figma Plugin
// Kırık variable referanslarını tespit edip düzelten ve token export eden araç

interface BrokenReference {
  nodeId: string;
  nodeName: string;
  field: string;
  variableId: string;
  variableName: string | null;
  collectionName: string | null;
  status: 'broken' | 'fixed' | 'no-match';
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

// Plugin UI'ı göster
figma.showUI(__html__, { width: 400, height: 500 });

// Local variable'ları indexle
async function buildLocalVariableMap(): Promise<LocalVariableMap> {
  const variables = await figma.variables.getLocalVariablesAsync();
  const byFullPath = new Map<string, Variable>();
  const byName = new Map<string, Variable[]>();

  for (const variable of variables) {
    const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
    const collectionName = collection ? collection.name : 'Unknown';
    const fullPath = `${collectionName}/${variable.name}`;

    byFullPath.set(fullPath, variable);

    const existing = byName.get(variable.name) || [];
    existing.push(variable);
    byName.set(variable.name, existing);
  }

  return { byFullPath, byName };
}

// Tek bir node'u tara
async function scanNode(node: SceneNode): Promise<BrokenReference[]> {
  const broken: BrokenReference[] = [];

  if (!('boundVariables' in node) || !node.boundVariables) {
    return broken;
  }

  const boundVars = node.boundVariables as Record<string, VariableAlias | VariableAlias[]>;

  // Paint alanlarını kontrol et (fills, strokes - array olabilir)
  for (const field of PAINT_FIELDS) {
    const bindings = boundVars[field];
    if (bindings && Array.isArray(bindings)) {
      for (let i = 0; i < bindings.length; i++) {
        const binding = bindings[i];
        if (binding && binding.id) {
          const variable = await figma.variables.getVariableByIdAsync(binding.id);
          if (!variable) {
            // Kırık referans bulundu
            const info = await extractVariableInfo(binding.id);
            broken.push({
              nodeId: node.id,
              nodeName: node.name,
              field: `${field}[${i}]`,
              variableId: binding.id,
              variableName: info.name,
              collectionName: info.collectionName,
              status: 'broken'
            });
          }
        }
      }
    }
  }

  // Numeric alanları kontrol et
  for (const field of NUMERIC_FIELDS) {
    const binding = boundVars[field] as VariableAlias | undefined;
    if (binding && binding.id) {
      const variable = await figma.variables.getVariableByIdAsync(binding.id);
      if (!variable) {
        const info = await extractVariableInfo(binding.id);
        broken.push({
          nodeId: node.id,
          nodeName: node.name,
          field: field,
          variableId: binding.id,
          variableName: info.name,
          collectionName: info.collectionName,
          status: 'broken'
        });
      }
    }
  }

  return broken;
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
    const nodeBroken = await scanNode(node);
    allBroken = allBroken.concat(nodeBroken);

    // Çocuk node'ları tara
    if ('children' in node) {
      const childBroken = await scanNodesRecursively(node.children);
      allBroken = allBroken.concat(childBroken);
    }
  }

  return allBroken;
}

// Aktif sayfayı tara
async function scanCurrentPage(): Promise<void> {
  figma.ui.postMessage({ type: 'status', message: 'Sayfa taranıyor...' });

  try {
    localVariableMap = await buildLocalVariableMap();
    brokenReferences = await scanNodesRecursively(figma.currentPage.children);

    figma.ui.postMessage({
      type: 'scan-result',
      data: brokenReferences,
      totalNodes: countNodes(figma.currentPage.children),
      localVariableCount: localVariableMap.byFullPath.size
    });
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: `Tarama hatası: ${error}` });
  }
}

// Tüm sayfaları tara
async function scanAllPages(): Promise<void> {
  figma.ui.postMessage({ type: 'status', message: 'Tüm sayfalar taranıyor...' });

  try {
    localVariableMap = await buildLocalVariableMap();
    brokenReferences = [];

    for (const page of figma.root.children) {
      figma.ui.postMessage({ type: 'status', message: `Taranıyor: ${page.name}` });
      const pageBroken = await scanNodesRecursively(page.children);
      brokenReferences = brokenReferences.concat(pageBroken);
    }

    figma.ui.postMessage({
      type: 'scan-result',
      data: brokenReferences,
      totalPages: figma.root.children.length,
      localVariableCount: localVariableMap.byFullPath.size
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

// Kırık referansları düzelt
async function fixBrokenReferences(): Promise<void> {
  if (!localVariableMap) {
    figma.ui.postMessage({ type: 'error', message: 'Önce tarama yapın' });
    return;
  }

  figma.ui.postMessage({ type: 'status', message: 'Düzeltiliyor...' });

  let fixedCount = 0;
  let failedCount = 0;

  for (const ref of brokenReferences) {
    if (ref.status !== 'broken') continue;

    const node = await figma.getNodeByIdAsync(ref.nodeId) as SceneNode;
    if (!node) {
      ref.status = 'no-match';
      failedCount++;
      continue;
    }

    // Eşleşen variable'ı bul
    let matchedVariable: Variable | null = null;

    // Öncelik 1: Collection + Variable adı
    if (ref.collectionName && ref.variableName) {
      const fullPath = `${ref.collectionName}/${ref.variableName}`;
      matchedVariable = localVariableMap.byFullPath.get(fullPath) || null;
    }

    // Öncelik 2: Sadece variable adı
    if (!matchedVariable && ref.variableName) {
      const candidates = localVariableMap.byName.get(ref.variableName);
      if (candidates && candidates.length === 1) {
        matchedVariable = candidates[0];
      }
    }

    if (matchedVariable && 'setBoundVariable' in node) {
      try {
        // Field adından index'i çıkar (örn: "fills[0]" -> "fills", 0)
        const fieldMatch = ref.field.match(/^(\w+)(?:\[(\d+)\])?$/);
        if (fieldMatch) {
          const fieldName = fieldMatch[1] as VariableBindableNodeField;
          const index = fieldMatch[2] ? parseInt(fieldMatch[2]) : undefined;

          if (index !== undefined && PAINT_FIELDS.includes(fieldName as any)) {
            // Paint array'i için özel işlem
            (node as any).setBoundVariable(fieldName, matchedVariable.id);
          } else {
            (node as any).setBoundVariable(fieldName, matchedVariable.id);
          }

          ref.status = 'fixed';
          fixedCount++;
        }
      } catch (error) {
        ref.status = 'no-match';
        failedCount++;
      }
    } else {
      ref.status = 'no-match';
      failedCount++;
    }
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
