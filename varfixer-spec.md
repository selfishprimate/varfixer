# VarFixer — Proje Kapsamı ve Teknik Spesifikasyon

> Figma plugin: Kırık variable referanslarını tespit edip otomatik düzelten ve tüm variable'ları Figma'nın native yapısını koruyarak JSON export eden araç.

---

## 1. Problem Tanımı

Figma'da bir tasarım sistemi dosyası parçalara bölündüğünde, component'lere bağlı variable (renk token) referansları kopar. Bunun sebebi her variable'ın dosyaya özgü bir unique ID'ye sahip olmasıdır. Dosya bölündüğünde ID'ler değişir, ancak component'ler hala eski ID'lere referans vermeye devam eder.

```
Orijinal Dosya → Dosya Bölünür → ID'ler Değişir → Linkler Kopar
```

---

## 2. Çözüm Yaklaşımı

Figma Plugin API kullanılarak yazılacak bir plugin, dosyadaki tüm node'ları tarar, kırık variable referanslarını tespit eder ve aynı isimli mevcut local variable'larla otomatik olarak yeniden eşleştirir.

1. **Tara** — Tüm node'ları recursive gez, `boundVariables` property'si olan her node'u kontrol et
2. **Tespit Et** — Variable ID'si `getVariableById()` ile resolve edilemiyorsa, referans kırık demektir
3. **Eşleştir** — Kırık variable'ın adını + collection adını kullanarak mevcut local variable'lar arasında eşleşme bul
4. **Bağla** — `setBoundVariable()` ile yeni variable'ı node'a bağla

---

## 3. Teknik Detaylar

### 3.1 Proje Yapısı

| Dosya | Açıklama |
|-------|----------|
| `manifest.json` | Figma plugin manifest dosyası. editorType: figma, API v1.0.0 |
| `code.ts` | Ana plugin mantığı. Tarama, tespit, eşleştirme ve düzeltme işlemleri |
| `ui.html` | Plugin UI paneli. Butonlar, sonuç listesi, durum göstergeleri |
| `tsconfig.json` | TypeScript konfigürasyonu. Target: ES2020, figma plugin typings |
| `package.json` | Proje bağımlılıkları: typescript, @figma/plugin-typings |

### 3.2 Taranan boundVariable Alanları

**Paint Alanları:** `fills`, `strokes`

**Numeric Alanlar:** `opacity`, `cornerRadius`, `topLeftRadius`, `topRightRadius`, `bottomLeftRadius`, `bottomRightRadius`, `paddingLeft`, `paddingRight`, `paddingTop`, `paddingBottom`, `itemSpacing`, `counterAxisSpacing`, `strokeWeight` (+ per-side variants), `minWidth`, `maxWidth`, `minHeight`, `maxHeight`

### 3.3 Eşleştirme Stratejisi

| Öncelik | Yöntem | Anahtar |
|---------|--------|---------|
| 1 (Birincil) | Collection + Variable adı eşleşmesi | `collectionName/variableName` |
| 2 (Fallback) | Sadece variable adı eşleşmesi | `variableName` |

### 3.4 Figma Plugin API Kullanımı

- `figma.variables.getLocalVariablesAsync()` — Dosyadaki tüm local variable'ları listeler
- `figma.variables.getVariableByIdAsync(id)` — ID ile variable'ı resolve eder (null = kırık)
- `figma.variables.getVariableCollectionByIdAsync(id)` — Collection bilgisini alır
- `node.boundVariables` — Node'a bağlı variable referanslarını okur
- `node.setBoundVariable(field, variableId)` — Variable'ı node'a yeniden bağlar
- `figma.getNodeByIdAsync(id)` — ID ile node'u getirir

---

## 4. Plugin UI

Plugin basit bir UI paneline sahiptir. Üç ana buton ve bir sonuç listesi içerir:

| Buton | İşlev |
|-------|-------|
| Sayfayı Tara | Aktif sayfadaki tüm node'ları tarar, kırık referansları listeler |
| Tüm Sayfaları Tara | Dosyadaki tüm sayfaları tek seferde tarar |
| Düzelt | Bulunan kırık referansları eşleştirip yeniden bağlar. Sonucu raporlar |

Sonuç listesinde her kırık referans node adı, alan adı, variable adı ve durumu (kırık / düzeltildi / eşleşmedi) ile birlikte gösterilir.

---

## 5. UI ↔ Plugin Mesaj Protokolü

| Mesaj | Yön | Açıklama |
|-------|-----|----------|
| `scan` | UI → Plugin | Aktif sayfayı tara |
| `scan-all-pages` | UI → Plugin | Tüm sayfaları tara |
| `fix` | UI → Plugin | Kırık referansları düzelt |
| `scan-result` | Plugin → UI | Tarama sonuçları (kırık referans listesi) |
| `fix-result` | Plugin → UI | Düzeltme sonuçları (fixedCount, failedCount, details) |
| `status` | Plugin → UI | Durum mesajı (taranıyor, düzeltiliyor...) |
| `error` | Plugin → UI | Hata mesajı |

---

## 6. Kurulum ve Kullanım

### 6.1 Build

```bash
npm install && npm run build
```

### 6.2 Figma'ya Ekleme

1. Figma Desktop uygulamasını aç
2. Plugins → Development → Import plugin from manifest...
3. Proje klasöründeki `manifest.json` dosyasını seç

### 6.3 Çalıştırma

1. Kırık token'ları olan Figma dosyasını aç
2. Plugins → Development → VarFixer
3. "Sayfayı Tara" veya "Tüm Sayfaları Tara" butonuna tıkla
4. Kırık referansları incele
5. "Düzelt" butonuna bas

---

## 7. Bilinen Kısıtlamalar ve Edge Case'ler

- **Variable adı değişmişse:** Eşleştirme ad bazlı yapıldığı için, orijinal adı değiştirilmiş variable'lar otomatik eşleşmez. Bu durumda manuel müdahale gerekir.
- **Farklı collection'larda aynı isim:** Plugin önce collection+ad kombinasyonuyla, sonra sadece adla eşleştirir. Aynı isimde birden fazla variable varsa yanlış eşleşme riski vardır.
- **Remote variable'lar:** Plugin sadece local variable'larla eşleştirir. Eğer kırık referanslar başka bir dosyadan publish edilmiş remote variable'lara aitse, önce o variable'ların local olarak import edilmesi gerekir.
- **Performans:** Çok büyük dosyalarda (10.000+ node) tarama süresi uzayabilir. Sayfa bazlı tarama tercih edilmelidir.

---

## 8. Token Export Özelliği

### 8.1 Amaç

Figma dosyasındaki tüm variable'ları (renkler, spacing, radius, opacity vb.) Figma'nın native yapısını koruyarak JSON formatında export etmek. Kullanıcı dosyayı indirip başka araçlarda kullanabilir, versiyon takibi yapabilir veya dosyalar arası karşılaştırma için referans olarak saklayabilir.

### 8.2 Export Yapısı

JSON çıktısı Figma'nın kendi hiyerarşisini birebir yansıtır:

```json
{
  "exportDate": "2026-03-04T14:30:00Z",
  "fileName": "Design System v2",
  "collections": [
    {
      "name": "Colors",
      "modes": ["Light", "Dark"],
      "variables": [
        {
          "name": "primary/500",
          "type": "COLOR",
          "resolvedType": "COLOR",
          "valuesByMode": {
            "Light": { "r": 0.05, "g": 0.6, "b": 1, "a": 1 },
            "Dark": { "r": 0.2, "g": 0.7, "b": 1, "a": 1 }
          },
          "scopes": ["FRAME_FILL", "SHAPE_FILL"],
          "description": "Primary brand color"
        }
      ]
    },
    {
      "name": "Spacing",
      "modes": ["Default"],
      "variables": [
        {
          "name": "space/sm",
          "type": "FLOAT",
          "resolvedType": "FLOAT",
          "valuesByMode": {
            "Default": 8
          },
          "scopes": ["GAP", "WIDTH_HEIGHT"],
          "description": ""
        }
      ]
    }
  ]
}
```

### 8.3 Export Kapsamı

Tüm variable tipleri export edilir:

| Tip | Açıklama | Örnek |
|-----|----------|-------|
| `COLOR` | Renk değerleri (RGBA) | `primary/500`, `neutral/100` |
| `FLOAT` | Sayısal değerler | `space/sm`, `radius/md` |
| `STRING` | Metin değerleri | `font/family/heading` |
| `BOOLEAN` | Boolean değerler | `feature/darkMode` |

### 8.4 Dahil Edilen Metadata

Her variable için Figma'nın native olarak tuttuğu tüm bilgiler korunur:

- **name** — Tam yol dahil variable adı (ör. `primary/500`)
- **type** ve **resolvedType** — Variable tipi
- **valuesByMode** — Her mode için ayrı değer (Light/Dark vb.)
- **scopes** — Variable'ın uygulanabilir olduğu alanlar
- **description** — Varsa açıklama metni
- **Alias referansları** — Eğer bir variable başka bir variable'a alias ise, hedef variable'ın adı ve collection'ı belirtilir

### 8.5 Alias Handling

Eğer bir variable'ın değeri başka bir variable'a referans (alias) ise, hem alias bilgisi hem resolved (çözümlenmiş) değer export edilir:

```json
{
  "name": "semantic/error",
  "type": "COLOR",
  "valuesByMode": {
    "Light": {
      "alias": {
        "collection": "Primitives",
        "variable": "red/500"
      },
      "resolved": { "r": 0.9, "g": 0.2, "b": 0.2, "a": 1 }
    }
  }
}
```

### 8.6 UI Entegrasyonu

Plugin UI'a dördüncü bir buton eklenir:

| Buton | İşlev |
|-------|-------|
| Token'ları Export Et | Dosyadaki tüm variable'ları JSON olarak indirir |

Kullanıcı butona bastığında plugin JSON'u oluşturur ve tarayıcı üzerinden dosya indirmesi tetiklenir. Dosya adı `{figma-dosya-adı}-tokens-{tarih}.json` formatında olur.

### 8.7 Mesaj Protokolü (Ek)

| Mesaj | Yön | Açıklama |
|-------|-----|----------|
| `export-tokens` | UI → Plugin | Tüm variable'ları topla |
| `export-result` | Plugin → UI | JSON string olarak token verisi (UI dosya indirmesini tetikler) |

### 8.8 Kullanılan Ek API'ler

- `figma.variables.getLocalVariablesAsync()` — Tüm variable'ları çeker
- `figma.variables.getVariableCollectionByIdAsync(id)` — Collection ve mode bilgilerini alır
- `variable.valuesByMode` — Her mode için değerleri okur
- `variable.scopes` — Uygulama kapsamlarını okur
- `figma.root.name` — Dosya adını alır

---

## 9. Gelecek İyileştirme Önerileri

- **Fuzzy matching:** Variable adları hafif değişmişse (ör. "primary-blue" → "Primary Blue") Levenshtein distance ile yaklaşık eşleştirme yapılabilir.
- **Dry-run modu:** Gerçekte değişiklik yapmadan önce neyin değişeceğini gösteren bir preview modu eklenebilir.
- **Seçili frame tarama:** Tüm sayfa yerine sadece seçili frame/group'u tarama seçeneği.
- **Remote variable desteği:** Diğer dosyalardan publish edilmiş variable'larla da eşleştirme yapabilme.

---

*Bu doküman Claude Code'a verilmek üzere hazırlanmıştır. Plugin codebase'i ile birlikte kullanılmalıdır.*
