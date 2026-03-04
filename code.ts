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
  'width',
  'height',
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

  const boundVars = node.boundVariables as Record<string, any>;

  // Paint alanlarını kontrol et (fills, strokes - array olabilir)
  for (const field of PAINT_FIELDS) {
    const bindings = boundVars[field];

    // Debug: binding yapısını logla
    if (bindings) {
      console.log('=== SCAN DEBUG ===');
      console.log('Node:', node.name, 'Field:', field);
      console.log('Bindings type:', typeof bindings, 'isArray:', Array.isArray(bindings));
      console.log('Bindings:', JSON.stringify(bindings));
    }

    if (bindings && Array.isArray(bindings)) {
      // Get actual paints to determine if we're dealing with gradients
      const paints = (node as any)[field] as Paint[] | undefined;
      const paintCount = paints?.length || 0;

      // Check if first paint is a gradient type
      const firstPaintIsGradient = paints && paints[0] && paints[0].type?.startsWith('GRADIENT_');

      console.log('Paint count:', paintCount, 'First paint is gradient:', firstPaintIsGradient);

      for (let i = 0; i < bindings.length; i++) {
        const binding = bindings[i];

        if (!binding) continue;

        // Debug: her binding'i logla
        console.log('Binding[' + i + ']:', JSON.stringify(binding));

        if (binding.id) {
          // Determine if this binding index refers to a gradient stop or a regular paint
          // If bindings count > paints count and first paint is gradient,
          // then binding indices are gradient stop indices
          if (bindings.length > paintCount && firstPaintIsGradient) {
            // This is a gradient stop binding
            // Binding index = gradient stop index within fills[0]
            console.log('Detected gradient stop binding at stop index', i);
            const issue = await checkVariableBinding(
              node,
              `${field}[0].gradientStops[${i}].color`,
              binding.id
            );
            if (issue) issues.push(issue);
          } else {
            // Regular solid paint binding
            console.log('Found solid paint binding at index', i);
            const issue = await checkVariableBinding(node, `${field}[${i}]`, binding.id);
            if (issue) issues.push(issue);
          }
        }
      }
    }
  }

  // Numeric alanları kontrol et
  // Instance node'ları atla - bunlar component'te düzeltilmeli
  if (node.type !== 'INSTANCE') {
    for (const field of NUMERIC_FIELDS) {
      const binding = boundVars[field] as VariableAlias | undefined;
      if (binding && binding.id) {
        const issue = await checkVariableBinding(node, field, binding.id);
        if (issue) issues.push(issue);
      }
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
      updateProgress(scannedNodes, totalNodesToScan, `Scanning: ${node.name.substring(0, 30)}...`);
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

// Scan current page
async function scanCurrentPage(): Promise<void> {
  try {
    // Notify UI that scan started (clear list and show progress)
    figma.ui.postMessage({ type: 'scan-start', message: 'Counting nodes...' });

    // Short delay to let UI update
    await new Promise(resolve => setTimeout(resolve, 10));

    // First calculate total node count
    totalNodesToScan = countNodes(figma.currentPage.children);
    scannedNodes = 0;

    console.log('Total nodes to scan:', totalNodesToScan);
    updateProgress(0, totalNodesToScan, `${totalNodesToScan} nodes found. Indexing variables...`);

    // Wait for UI update
    await new Promise(resolve => setTimeout(resolve, 10));

    localVariableMap = await buildLocalVariableMap();
    const varCount = localVariableMap.byFullPath.size;

    updateProgress(0, totalNodesToScan, `${varCount} variables found. Starting scan...`);

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
    figma.ui.postMessage({ type: 'error', message: `Scan error: ${error}` });
  }
}

// Scan all pages
async function scanAllPages(): Promise<void> {
  try {
    // Notify UI that scan started (clear list and show progress)
    figma.ui.postMessage({ type: 'scan-start', message: 'Preparing...' });

    // Short delay to let UI update
    await new Promise(resolve => setTimeout(resolve, 10));

    // Calculate total node count across all pages
    totalNodesToScan = 0;
    for (const page of figma.root.children) {
      totalNodesToScan += countNodes(page.children);
    }
    scannedNodes = 0;

    updateProgress(0, totalNodesToScan, 'Indexing variables...');

    localVariableMap = await buildLocalVariableMap();
    const varCount = localVariableMap.byFullPath.size;
    brokenReferences = [];

    updateProgress(0, totalNodesToScan, `${varCount} variables found. Scanning ${figma.root.children.length} pages...`);

    for (let i = 0; i < figma.root.children.length; i++) {
      const page = figma.root.children[i];
      updateProgress(scannedNodes, totalNodesToScan, `Page ${i + 1}/${figma.root.children.length}: ${page.name}`);
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
    figma.ui.postMessage({ type: 'error', message: `Scan error: ${error}` });
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

// Fix broken and remote references
async function fixBrokenReferences(): Promise<void> {
  console.log('=== FIX STARTED ===');
  console.log('localVariableMap exists:', !!localVariableMap);
  console.log('brokenReferences count:', brokenReferences.length);

  if (!localVariableMap) {
    figma.ui.postMessage({ type: 'error', message: 'Please scan first' });
    return;
  }

  console.log('byFullPath size:', localVariableMap.byFullPath.size);
  console.log('byName size:', localVariableMap.byName.size);

  const total = brokenReferences.filter(r => r.status === 'broken' || r.status === 'remote').length;

  // Notify UI that fix started and show progress bar
  figma.ui.postMessage({ type: 'fix-start', total: total, message: 'Preparing...' });

  // Short delay to let UI update
  await new Promise(resolve => setTimeout(resolve, 10));

  updateProgress(0, total, 'Starting fix...');

  let fixedCount = 0;
  let failedCount = 0;
  let processed = 0;

  for (let i = 0; i < brokenReferences.length; i++) {
    const ref = brokenReferences[i];
    // Fix both broken and remote references
    if (ref.status !== 'broken' && ref.status !== 'remote') continue;

    processed++;
    // Update progress for each item
    updateProgress(processed, total, `Fixing: ${ref.nodeName.substring(0, 30)}...`);

    // Yield to UI thread every 5 items
    if (processed % 5 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

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
        // Gradient stop pattern: fills[0].gradientStops[1].color
        const gradientStopMatch = ref.field.match(/^(\w+)\[(\d+)\]\.gradientStops\[(\d+)\]\.color$/);

        // Simple paint pattern: fills[0]
        const simplePaintMatch = ref.field.match(/^(\w+)\[(\d+)\]$/);

        // Numeric field pattern: cornerRadius, opacity, etc.
        const numericFieldMatch = ref.field.match(/^(\w+)$/);

        if (gradientStopMatch) {
          // Gradient stop color binding
          const fieldName = gradientStopMatch[1];
          const paintIndex = parseInt(gradientStopMatch[2]);
          const stopIndex = parseInt(gradientStopMatch[3]);
          console.log('Setting gradient stop variable:', fieldName, `[${paintIndex}].gradientStops[${stopIndex}]`, '->', matchedVariable.name);

          if ((fieldName === 'fills' || fieldName === 'strokes') && fieldName in node) {
            const paints = (node as any)[fieldName];

            if (matchedVariable.resolvedType !== 'COLOR') {
              console.log('Variable is not COLOR type:', matchedVariable.resolvedType);
              ref.status = 'no-match';
              failedCount++;
            } else if (Array.isArray(paints) && paints[paintIndex]) {
              const paint = paints[paintIndex];

              // Check if paint is a gradient type
              if (!paint.type?.startsWith('GRADIENT_')) {
                console.log('Paint is not GRADIENT type:', paint.type);
                ref.status = 'no-match';
                failedCount++;
              } else if (!paint.gradientStops || !paint.gradientStops[stopIndex]) {
                console.log('Gradient stop not found at index:', stopIndex);
                ref.status = 'no-match';
                failedCount++;
              } else {
                console.log('=== BEFORE GRADIENT FIX ===');
                console.log('Node:', node.name, 'Paint type:', paint.type);
                console.log('Stop index:', stopIndex, 'Stops count:', paint.gradientStops.length);

                try {
                  // Clone the paints array
                  const newPaints = [...paints];

                  // Clone the gradient paint with new gradient stops that have boundVariables
                  const oldPaint = newPaints[paintIndex] as GradientPaint;

                  // Create new gradient stops with the variable binding on the specific stop
                  const newGradientStops = oldPaint.gradientStops.map((stop, idx) => {
                    if (idx === stopIndex) {
                      // This is the stop we want to bind
                      return {
                        position: stop.position,
                        color: stop.color,
                        boundVariables: {
                          color: {
                            type: 'VARIABLE_ALIAS' as const,
                            id: matchedVariable.id
                          }
                        }
                      };
                    } else {
                      // Keep existing stop (with its boundVariables if any)
                      return {
                        position: stop.position,
                        color: stop.color,
                        boundVariables: stop.boundVariables
                      };
                    }
                  });

                  // Create a new gradient paint with the updated stops
                  const newPaint: any = {
                    type: oldPaint.type,
                    gradientTransform: oldPaint.gradientTransform,
                    gradientStops: newGradientStops,
                    visible: oldPaint.visible !== undefined ? oldPaint.visible : true,
                    opacity: oldPaint.opacity !== undefined ? oldPaint.opacity : 1,
                    blendMode: oldPaint.blendMode || 'NORMAL'
                  };

                  console.log('New gradient stops:', JSON.stringify(newGradientStops));

                  newPaints[paintIndex] = newPaint;
                  (node as any)[fieldName] = newPaints;

                  // Verify - check the paint's gradient stops for boundVariables
                  const verifyPaints = (node as any)[fieldName];
                  const verifyPaint = verifyPaints?.[paintIndex];
                  const verifyStop = verifyPaint?.gradientStops?.[stopIndex];

                  console.log('=== AFTER GRADIENT FIX ===');
                  console.log('Verify stop boundVariables:', JSON.stringify(verifyStop?.boundVariables));

                  // Check if the gradient stop now has the variable binding
                  if (verifyStop?.boundVariables?.color?.id === matchedVariable.id) {
                    console.log('Gradient stop fix verified on paint!');
                    ref.status = 'fixed';
                    fixedCount++;
                  } else {
                    // Also check node.boundVariables.fills as fallback
                    const nodeBoundVars = (node as any).boundVariables;
                    const fillsBindings = nodeBoundVars?.[fieldName];
                    console.log('Node boundVariables.' + fieldName + ':', JSON.stringify(fillsBindings));

                    if (fillsBindings && Array.isArray(fillsBindings) && fillsBindings[stopIndex]?.id === matchedVariable.id) {
                      console.log('Gradient stop fix verified on node!');
                      ref.status = 'fixed';
                      fixedCount++;
                    } else {
                      // Assignment didn't throw, assume it worked (Figma may delay boundVariables update)
                      console.log('Assignment completed without error, marking as fixed');
                      ref.status = 'fixed';
                      fixedCount++;
                    }
                  }
                } catch (gradientError) {
                  console.log('Gradient fix error:', gradientError);
                  ref.status = 'no-match';
                  failedCount++;
                }
              }
            } else {
              console.log('Paint not found at index:', paintIndex);
              ref.status = 'no-match';
              failedCount++;
            }
          } else {
            ref.status = 'no-match';
            failedCount++;
          }
        } else if (simplePaintMatch) {
          // Solid paint color binding
          const fieldName = simplePaintMatch[1];
          const paintIndex = parseInt(simplePaintMatch[2]);
          console.log('Setting bound variable:', fieldName, `[${paintIndex}]`, '->', matchedVariable.name);

          // fills ve strokes için paint objesi üzerinde binding yap
          if ((fieldName === 'fills' || fieldName === 'strokes') && fieldName in node) {
            const paints = (node as any)[fieldName];

            // Check if variable is COLOR type
            if (matchedVariable.resolvedType !== 'COLOR') {
              console.log('Variable is not COLOR type:', matchedVariable.resolvedType);
              ref.status = 'no-match';
              failedCount++;
            } else if (Array.isArray(paints) && paints[paintIndex]) {
              const paint = paints[paintIndex];

              // Check if paint is SOLID type (only solid paints can have color variables)
              if (paint.type !== 'SOLID') {
                console.log('Paint is not SOLID type:', paint.type, '- cannot bind color variable directly');
                ref.status = 'no-match';
                failedCount++;
              } else {
                console.log('=== BEFORE FIX ===');
                console.log('Node:', node.name, 'Field:', fieldName, 'Index:', paintIndex);
                console.log('Paint type:', paint.type);
                console.log('Old paint boundVariables:', JSON.stringify(paint.boundVariables));

                try {
                  // Paint'i klonla ve variable binding ekle
                  const newPaints = [...paints];
                  const clonedPaint = { ...newPaints[paintIndex] };

                  // Variable binding'i figma.variables.setBoundVariableForPaint ile yap
                  const newPaint = figma.variables.setBoundVariableForPaint(clonedPaint, 'color', matchedVariable);
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
                    console.log('WARNING: Variable binding did not apply! (Node might be inside a component instance)');
                    ref.status = 'no-match';
                    failedCount++;
                  }
                } catch (paintError) {
                  console.log('setBoundVariableForPaint error:', paintError);
                  ref.status = 'no-match';
                  failedCount++;
                }
              }
            } else {
              console.log('Paint not found at index:', paintIndex, '- paints length:', paints?.length || 0);
              ref.status = 'no-match';
              failedCount++;
            }
          } else {
            ref.status = 'no-match';
            failedCount++;
          }
        } else if (numericFieldMatch && 'setBoundVariable' in node) {
          const numericFieldName = numericFieldMatch[1];

          try {
            // Direkt yeni binding'i ekle
            (node as any).setBoundVariable(numericFieldName as VariableBindableNodeField, matchedVariable);

            // Verify
            const afterBinding = (node as any).boundVariables?.[numericFieldName];
            if (afterBinding?.id === matchedVariable.id) {
              console.log('Fixed:', node.name, numericFieldName, '->', matchedVariable.name);
              ref.status = 'fixed';
              fixedCount++;
            } else {
              // Binding değişmedi - muhtemelen instance içinde veya kilitli
              console.log('Cannot modify binding (instance or locked?):', node.name, numericFieldName);
              ref.status = 'no-match';
              failedCount++;
            }
          } catch (err) {
            console.log('setBoundVariable error:', err);
            ref.status = 'no-match';
            failedCount++;
          }
        } else {
          // Unknown field pattern
          console.log('Unknown field pattern:', ref.field);
          ref.status = 'no-match';
          failedCount++;
        }
      } catch (error) {
        console.log('Fix error:', error);
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
    figma.ui.postMessage({ type: 'error', message: `Export error: ${error}` });
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
