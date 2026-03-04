# Token Connector

A Figma plugin that finds remote variable references and connects them to local variables with matching names.

## What it does

When you copy components from external libraries or work with files that reference external tokens, all those variables show up as "remote" - meaning they're pointing to a different library.

**Token Connector** scans your file, finds all remote token references, and reconnects them to your local tokens that have the same name.

### Supported token types

- Color tokens (fills, strokes, gradient stops)
- Spacing tokens (padding, gap, item spacing)
- Border tokens (radius, stroke weight)
- Sizing tokens (width, height, min/max values)

### Important

This only works when your local token names **exactly match** the remote token names (including collection names).

**Example:**
- Remote: `Colors/Fill/Primary/default`
- Local: `Colors/Fill/Primary/default`
- ✅ Match - will be connected

## Installation

### 1. Clone or download the repository

```bash
git clone https://github.com/selfishprimate/token-connector.git
```

Or download as ZIP and extract.

### 2. Install dependencies

```bash
npm install
```

### 3. Build the plugin

```bash
npm run build
```

This compiles `code.ts` to `code.js`.

### 4. Import into Figma

1. Open Figma Desktop
2. Go to **Plugins** → **Development** → **Import plugin from manifest...**
3. Select the `manifest.json` file from this repository
4. The plugin is now available under **Plugins** → **Development** → **Token Connector**

## Usage

1. Open a Figma file with remote variable references
2. Run the plugin: **Plugins** → **Development** → **Token Connector**
3. Click **Scan Page** (or **Scan All Pages** for the entire file)
4. Review the found remote references
5. Click **Connect All** to reconnect them to local variables

## Development

Watch mode for development:

```bash
npm run watch
```

This will automatically recompile when you make changes to `code.ts`.

## Project Structure

```
token-connector/
├── manifest.json    # Figma plugin manifest
├── code.ts          # Plugin logic (TypeScript)
├── code.js          # Compiled plugin code
├── ui.html          # Plugin UI
├── package.json     # Dependencies
└── tsconfig.json    # TypeScript config
```

## License

MIT
