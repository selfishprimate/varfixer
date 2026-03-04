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
// Plugin UI'ı göster
figma.showUI(__html__, { width: 400, height: 500 });
// Local variable'ları indexle
function buildLocalVariableMap() {
    return __awaiter(this, void 0, void 0, function* () {
        const variables = yield figma.variables.getLocalVariablesAsync();
        const byFullPath = new Map();
        const byName = new Map();
        for (const variable of variables) {
            const collection = yield figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
            const collectionName = collection ? collection.name : 'Unknown';
            const fullPath = `${collectionName}/${variable.name}`;
            byFullPath.set(fullPath, variable);
            const existing = byName.get(variable.name) || [];
            existing.push(variable);
            byName.set(variable.name, existing);
        }
        return { byFullPath, byName };
    });
}
// Tek bir node'u tara
function scanNode(node) {
    return __awaiter(this, void 0, void 0, function* () {
        const broken = [];
        if (!('boundVariables' in node) || !node.boundVariables) {
            return broken;
        }
        const boundVars = node.boundVariables;
        // Paint alanlarını kontrol et (fills, strokes - array olabilir)
        for (const field of PAINT_FIELDS) {
            const bindings = boundVars[field];
            if (bindings && Array.isArray(bindings)) {
                for (let i = 0; i < bindings.length; i++) {
                    const binding = bindings[i];
                    if (binding && binding.id) {
                        const variable = yield figma.variables.getVariableByIdAsync(binding.id);
                        if (!variable) {
                            // Kırık referans bulundu
                            const info = yield extractVariableInfo(binding.id);
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
            const binding = boundVars[field];
            if (binding && binding.id) {
                const variable = yield figma.variables.getVariableByIdAsync(binding.id);
                if (!variable) {
                    const info = yield extractVariableInfo(binding.id);
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
            const nodeBroken = yield scanNode(node);
            allBroken = allBroken.concat(nodeBroken);
            // Çocuk node'ları tara
            if ('children' in node) {
                const childBroken = yield scanNodesRecursively(node.children);
                allBroken = allBroken.concat(childBroken);
            }
        }
        return allBroken;
    });
}
// Aktif sayfayı tara
function scanCurrentPage() {
    return __awaiter(this, void 0, void 0, function* () {
        figma.ui.postMessage({ type: 'status', message: 'Sayfa taranıyor...' });
        try {
            localVariableMap = yield buildLocalVariableMap();
            brokenReferences = yield scanNodesRecursively(figma.currentPage.children);
            figma.ui.postMessage({
                type: 'scan-result',
                data: brokenReferences,
                totalNodes: countNodes(figma.currentPage.children),
                localVariableCount: localVariableMap.byFullPath.size
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
        figma.ui.postMessage({ type: 'status', message: 'Tüm sayfalar taranıyor...' });
        try {
            localVariableMap = yield buildLocalVariableMap();
            brokenReferences = [];
            for (const page of figma.root.children) {
                figma.ui.postMessage({ type: 'status', message: `Taranıyor: ${page.name}` });
                const pageBroken = yield scanNodesRecursively(page.children);
                brokenReferences = brokenReferences.concat(pageBroken);
            }
            figma.ui.postMessage({
                type: 'scan-result',
                data: brokenReferences,
                totalPages: figma.root.children.length,
                localVariableCount: localVariableMap.byFullPath.size
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
// Kırık referansları düzelt
function fixBrokenReferences() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!localVariableMap) {
            figma.ui.postMessage({ type: 'error', message: 'Önce tarama yapın' });
            return;
        }
        figma.ui.postMessage({ type: 'status', message: 'Düzeltiliyor...' });
        let fixedCount = 0;
        let failedCount = 0;
        for (const ref of brokenReferences) {
            if (ref.status !== 'broken')
                continue;
            const node = yield figma.getNodeByIdAsync(ref.nodeId);
            if (!node) {
                ref.status = 'no-match';
                failedCount++;
                continue;
            }
            // Eşleşen variable'ı bul
            let matchedVariable = null;
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
                        const fieldName = fieldMatch[1];
                        const index = fieldMatch[2] ? parseInt(fieldMatch[2]) : undefined;
                        if (index !== undefined && PAINT_FIELDS.includes(fieldName)) {
                            // Paint array'i için özel işlem
                            node.setBoundVariable(fieldName, matchedVariable.id);
                        }
                        else {
                            node.setBoundVariable(fieldName, matchedVariable.id);
                        }
                        ref.status = 'fixed';
                        fixedCount++;
                    }
                }
                catch (error) {
                    ref.status = 'no-match';
                    failedCount++;
                }
            }
            else {
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
