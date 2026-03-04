"use strict";
// VarFixer - Figma Plugin
// Kırık variable referanslarını tespit edip düzelten ve token export eden araç
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// Taranan boundVariable alanları
const PAINT_FIELDS = ['fills', 'strokes'];
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
];
let brokenReferences = [];
let localVariableMap = null;
let totalNodesToScan = 0;
let scannedNodes = 0;
// Plugin UI'ı göster
figma.showUI(__html__, { width: 400, height: 500 });
// Progress güncelle
function updateProgress(current, total, message) {
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
function buildLocalVariableMap() {
    return __awaiter(this, void 0, void 0, function* () {
        const variables = yield figma.variables.getLocalVariablesAsync();
        const byFullPath = new Map();
        const byName = new Map();
        // Local variable ID'lerini cache'le
        localVariableIds = new Set();
        for (const variable of variables) {
            localVariableIds.add(variable.id);
            const collection = yield figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
            const collectionName = collection ? collection.name : 'Unknown';
            const fullPath = `${collectionName}/${variable.name}`;
            byFullPath.set(fullPath, variable);
            const existing = byName.get(variable.name) || [];
            existing.push(variable);
            byName.set(variable.name, existing);
        }
        // Debug: Local collection isimlerini ve tüm variable'ları logla
        const collectionVars = {};
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
    });
}
// Local variable ID'lerini cache'le
let localVariableIds = new Set();
// Tek bir node'u tara
function scanNode(node) {
    return __awaiter(this, void 0, void 0, function* () {
        const issues = [];
        if (!('boundVariables' in node) || !node.boundVariables) {
            return issues;
        }
        const boundVars = node.boundVariables;
        // Paint alanlarını kontrol et (fills, strokes - array olabilir)
        for (const field of PAINT_FIELDS) {
            const bindings = boundVars[field];
            if (bindings && Array.isArray(bindings)) {
                for (let i = 0; i < bindings.length; i++) {
                    const binding = bindings[i];
                    if (binding && binding.id) {
                        const issue = yield checkVariableBinding(node, `${field}[${i}]`, binding.id);
                        if (issue)
                            issues.push(issue);
                    }
                }
            }
        }
        // Numeric alanları kontrol et
        for (const field of NUMERIC_FIELDS) {
            const binding = boundVars[field];
            if (binding && binding.id) {
                const issue = yield checkVariableBinding(node, field, binding.id);
                if (issue)
                    issues.push(issue);
            }
        }
        return issues;
    });
}
// Variable binding'i kontrol et - kırık mı yoksa remote mu?
function checkVariableBinding(node, field, variableId) {
    return __awaiter(this, void 0, void 0, function* () {
        const variable = yield figma.variables.getVariableByIdAsync(variableId);
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
            const collection = yield figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
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
    });
}
// Variable ID'den isim ve collection bilgisi çıkarmaya çalış
function extractVariableInfo(variableId) {
    return __awaiter(this, void 0, void 0, function* () {
        // Figma variable ID'leri genellikle "VariableID:xxx:yyy" formatında
        // Kırık referanslarda orijinal ismi almak zor, null dönebilir
        return { name: null, collectionName: null };
    });
}
// Recursive olarak tüm node'ları tara
function scanNodesRecursively(nodes) {
    return __awaiter(this, void 0, void 0, function* () {
        let allBroken = [];
        for (const node of nodes) {
            scannedNodes++;
            // Her 20 node'da bir progress güncelle ve UI'ın nefes almasını sağla
            if (scannedNodes % 20 === 0) {
                updateProgress(scannedNodes, totalNodesToScan, `Taranıyor: ${node.name.substring(0, 30)}...`);
                // UI thread'inin güncellenmesi için kısa bekle
                yield new Promise(resolve => setTimeout(resolve, 0));
            }
            const nodeBroken = yield scanNode(node);
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
                const childBroken = yield scanNodesRecursively(node.children);
                // Sadece allBroken'a ekle, scan-item zaten gönderildi
                allBroken = allBroken.concat(childBroken);
            }
        }
        return allBroken;
    });
}
// Aktif sayfayı tara
function scanCurrentPage() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // UI'a tarama başladığını bildir (listeyi temizle ve progress göster)
            figma.ui.postMessage({ type: 'scan-start', message: 'Node\'lar sayılıyor...' });
            // Kısa gecikme ile UI'ın güncellenmesini sağla
            yield new Promise(resolve => setTimeout(resolve, 10));
            // Önce toplam node sayısını hesapla
            totalNodesToScan = countNodes(figma.currentPage.children);
            scannedNodes = 0;
            console.log('Total nodes to scan:', totalNodesToScan);
            updateProgress(0, totalNodesToScan, `${totalNodesToScan} node bulundu. Variable'lar indexleniyor...`);
            // UI güncellemesi için bekle
            yield new Promise(resolve => setTimeout(resolve, 10));
            localVariableMap = yield buildLocalVariableMap();
            const varCount = localVariableMap.byFullPath.size;
            updateProgress(0, totalNodesToScan, `${varCount} variable bulundu. Tarama başlıyor...`);
            brokenReferences = yield scanNodesRecursively(figma.currentPage.children);
            // Debug: Collection bazlı variable örnekleri topla
            const collectionSamples = {};
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
        }
        catch (error) {
            figma.ui.postMessage({ type: 'error', message: `Tarama hatası: ${error}` });
        }
    });
}
// Tüm sayfaları tara
function scanAllPages() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // UI'a tarama başladığını bildir (listeyi temizle ve progress göster)
            figma.ui.postMessage({ type: 'scan-start', message: 'Hazırlanıyor...' });
            // Kısa gecikme ile UI'ın güncellenmesini sağla
            yield new Promise(resolve => setTimeout(resolve, 10));
            // Tüm sayfalardaki toplam node sayısını hesapla
            totalNodesToScan = 0;
            for (const page of figma.root.children) {
                totalNodesToScan += countNodes(page.children);
            }
            scannedNodes = 0;
            updateProgress(0, totalNodesToScan, 'Variable\'lar indexleniyor...');
            localVariableMap = yield buildLocalVariableMap();
            const varCount = localVariableMap.byFullPath.size;
            brokenReferences = [];
            updateProgress(0, totalNodesToScan, `${varCount} variable bulundu. ${figma.root.children.length} sayfa taranacak...`);
            for (let i = 0; i < figma.root.children.length; i++) {
                const page = figma.root.children[i];
                updateProgress(scannedNodes, totalNodesToScan, `Sayfa ${i + 1}/${figma.root.children.length}: ${page.name}`);
                const pageBroken = yield scanNodesRecursively(page.children);
                brokenReferences = brokenReferences.concat(pageBroken);
            }
            figma.ui.postMessage({
                type: 'scan-result',
                data: brokenReferences,
                totalPages: figma.root.children.length,
                totalNodes: totalNodesToScan,
                localVariableCount: varCount
            });
        }
        catch (error) {
            figma.ui.postMessage({ type: 'error', message: `Tarama hatası: ${error}` });
        }
    });
}
// Node sayısını hesapla
function countNodes(nodes) {
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
function fixBrokenReferences() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
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
        yield new Promise(resolve => setTimeout(resolve, 10));
        updateProgress(0, total, 'Düzeltme başlıyor...');
        let fixedCount = 0;
        let failedCount = 0;
        let processed = 0;
        for (let i = 0; i < brokenReferences.length; i++) {
            const ref = brokenReferences[i];
            // Hem kırık hem remote referansları düzelt
            if (ref.status !== 'broken' && ref.status !== 'remote')
                continue;
            processed++;
            // Her item'da progress güncelle
            updateProgress(processed, total, `Düzeltiliyor: ${ref.nodeName.substring(0, 30)}...`);
            const node = yield figma.getNodeByIdAsync(ref.nodeId);
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
            let matchedVariable = null;
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
                        if (count > 20)
                            break;
                    }
                }
            }
            // Öncelik 2: Sadece variable adı
            if (!matchedVariable && ref.variableName) {
                const candidates = localVariableMap.byName.get(ref.variableName);
                if (candidates && candidates.length === 1) {
                    matchedVariable = candidates[0];
                }
                else if (candidates && candidates.length > 1) {
                    // Birden fazla eşleşme var, collection adına göre en iyi eşleşmeyi bul
                    for (const candidate of candidates) {
                        const col = yield figma.variables.getVariableCollectionByIdAsync(candidate.variableCollectionId);
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
                    new RegExp(`^${ref.collectionName.toLowerCase()}-`, 'i'), // "spacing-" gibi
                    new RegExp(`^${ref.collectionName.toLowerCase()}_`, 'i'), // "spacing_" gibi
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
                                const col = yield figma.variables.getVariableCollectionByIdAsync(candidate.variableCollectionId);
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
                            const paints = node[fieldName];
                            if (Array.isArray(paints) && paints[paintIndex]) {
                                console.log('=== BEFORE FIX ===');
                                console.log('Node:', node.name, 'Field:', fieldName, 'Index:', paintIndex);
                                console.log('Old paint boundVariables:', JSON.stringify((_a = paints[paintIndex]) === null || _a === void 0 ? void 0 : _a.boundVariables));
                                // Paint'i klonla ve variable binding ekle
                                const newPaints = [...paints];
                                const paint = Object.assign({}, newPaints[paintIndex]);
                                // Variable binding'i figma.variables.setBoundVariableForPaint ile yap
                                const newPaint = figma.variables.setBoundVariableForPaint(paint, 'color', matchedVariable);
                                newPaints[paintIndex] = newPaint;
                                node[fieldName] = newPaints;
                                // Verify: Değişiklik uygulandı mı?
                                const verifyPaints = node[fieldName];
                                console.log('=== AFTER FIX ===');
                                console.log('New paint boundVariables:', JSON.stringify((_b = verifyPaints[paintIndex]) === null || _b === void 0 ? void 0 : _b.boundVariables));
                                console.log('Expected variable ID:', matchedVariable.id);
                                console.log('Actual bound ID:', (_e = (_d = (_c = verifyPaints[paintIndex]) === null || _c === void 0 ? void 0 : _c.boundVariables) === null || _d === void 0 ? void 0 : _d.color) === null || _e === void 0 ? void 0 : _e.id);
                                if (((_h = (_g = (_f = verifyPaints[paintIndex]) === null || _f === void 0 ? void 0 : _f.boundVariables) === null || _g === void 0 ? void 0 : _g.color) === null || _h === void 0 ? void 0 : _h.id) === matchedVariable.id) {
                                    ref.status = 'fixed';
                                    fixedCount++;
                                }
                                else {
                                    console.log('WARNING: Variable binding did not apply!');
                                    ref.status = 'no-match';
                                    failedCount++;
                                }
                            }
                            else {
                                console.log('Paint not found at index:', paintIndex);
                                ref.status = 'no-match';
                                failedCount++;
                            }
                        }
                        else if ('setBoundVariable' in node) {
                            try {
                                // Önce mevcut binding'i kaldır
                                node.setBoundVariable(fieldName, null);
                                // Sonra yeni binding'i ekle
                                node.setBoundVariable(fieldName, matchedVariable);
                                // Verify
                                const afterBinding = (_j = node.boundVariables) === null || _j === void 0 ? void 0 : _j[fieldName];
                                if ((afterBinding === null || afterBinding === void 0 ? void 0 : afterBinding.id) === matchedVariable.id) {
                                    console.log('Fixed:', node.name, fieldName, '->', matchedVariable.name);
                                    ref.status = 'fixed';
                                    fixedCount++;
                                }
                                else {
                                    // Binding değişmedi - muhtemelen instance içinde veya kilitli
                                    console.log('Cannot modify binding (instance or locked?):', node.name, fieldName);
                                    ref.status = 'no-match';
                                    failedCount++;
                                }
                            }
                            catch (err) {
                                console.log('setBoundVariable error:', err);
                                ref.status = 'no-match';
                                failedCount++;
                            }
                        }
                        else {
                            ref.status = 'no-match';
                            failedCount++;
                        }
                    }
                }
                catch (error) {
                    console.log('setBoundVariable error:', error);
                    ref.status = 'no-match';
                    failedCount++;
                }
            }
            else {
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
    });
}
// Token'ları export et
function exportTokens() {
    return __awaiter(this, void 0, void 0, function* () {
        figma.ui.postMessage({ type: 'status', message: 'Token\'lar toplanıyor...' });
        try {
            const variables = yield figma.variables.getLocalVariablesAsync();
            const collections = yield figma.variables.getLocalVariableCollectionsAsync();
            const collectionMap = new Map();
            for (const collection of collections) {
                collectionMap.set(collection.id, collection);
            }
            // Collection bazlı grupla
            const collectionGroups = new Map();
            for (const variable of variables) {
                const collection = collectionMap.get(variable.variableCollectionId);
                if (collection) {
                    if (!collectionGroups.has(collection.id)) {
                        collectionGroups.set(collection.id, { collection, variables: [] });
                    }
                    collectionGroups.get(collection.id).variables.push(variable);
                }
            }
            const exportData = {
                exportDate: new Date().toISOString(),
                fileName: figma.root.name,
                collections: []
            };
            for (const [, group] of collectionGroups) {
                const modeNames = group.collection.modes.map(m => m.name);
                const exportedVars = [];
                for (const variable of group.variables) {
                    const valuesByMode = {};
                    for (const mode of group.collection.modes) {
                        const value = variable.valuesByMode[mode.modeId];
                        if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS') {
                            // Alias referansı
                            const aliasVar = yield figma.variables.getVariableByIdAsync(value.id);
                            if (aliasVar) {
                                const aliasCollection = collectionMap.get(aliasVar.variableCollectionId);
                                valuesByMode[mode.name] = {
                                    alias: {
                                        collection: aliasCollection ? aliasCollection.name : 'Unknown',
                                        variable: aliasVar.name
                                    },
                                    resolved: yield resolveVariableValue(variable, mode.modeId)
                                };
                            }
                        }
                        else {
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
        }
        catch (error) {
            figma.ui.postMessage({ type: 'error', message: `Export hatası: ${error}` });
        }
    });
}
// Variable değerini resolve et (alias zincirini çöz)
function resolveVariableValue(variable, modeId) {
    return __awaiter(this, void 0, void 0, function* () {
        let value = variable.valuesByMode[modeId];
        while (typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS') {
            const aliasVar = yield figma.variables.getVariableByIdAsync(value.id);
            if (!aliasVar)
                break;
            value = aliasVar.valuesByMode[modeId];
        }
        return value;
    });
}
// UI'dan gelen mesajları dinle
figma.ui.onmessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    switch (msg.type) {
        case 'scan':
            yield scanCurrentPage();
            break;
        case 'scan-all-pages':
            yield scanAllPages();
            break;
        case 'fix':
            yield fixBrokenReferences();
            break;
        case 'export-tokens':
            yield exportTokens();
            break;
        case 'close':
            figma.closePlugin();
            break;
    }
});
