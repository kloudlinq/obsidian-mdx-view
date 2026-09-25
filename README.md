# MDX View (Obsidian plugin)

Create, edit, and preview `.mdx` files in Obsidian.

## Architecture (and why)

Obsidian's plugin API turned out to have a real constraint that shapes this
whole design: subclassing `MarkdownView` to get a custom `.mdx` editor is
documented as unreliable (`getLeavesOfType()` returns nothing for it — see
the Obsidian forum thread on this). The supported pattern is to map an
extension directly onto the **existing** `"markdown"` view type:

```ts
this.registerExtensions(["mdx"], "markdown");
```

That's what `src/main.ts` does. It gets you the real CodeMirror 6 editor,
live preview, and default Reading Mode for `.mdx` — for free, with full
parity to `.md`. The trade-off: Obsidian's built-in Reading Mode doesn't
know what JSX is, so it won't render components. This plugin adds a
**separate** view (`MdxPreviewView`, opened via the ribbon eye icon or the
"Open MDX preview" command) that compiles and renders real JSX in a
sandboxed iframe, split alongside the editor.

### Sandboxed rendering, verified against the real compiler output

MDX is executable JavaScript, so the preview iframe uses
`sandbox="allow-scripts"` with **no** `allow-same-origin` — a null origin
with zero access to your vault or Obsidian's API. Compiled code is written
into the iframe's `srcdoc` as the literal text of a real `<script>` tag —
this plugin never calls `eval()` or `new Function()`.

`@mdx-js/mdx`'s `outputFormat: "function-body"` was inspected directly
(not assumed from docs) to get the exact runtime contract:

```js
const {Fragment, jsx, jsxs} = arguments[0];
// ...
function MDXContent(props = {}) { /* uses props.components */ }
return {default: MDXContent};
```

Two things fall out of that:

1. It's callable as a plain function body — `function __mdxModule(){ ...body... }.call(null, runtime)` — with no `eval`/`Function` constructor needed.
2. **Undeclared, capitalized JSX tags resolve through `props.components`** — e.g. `<MyChart/>` with no `import` in the file compiles to reading `MyChart` off `_components`, and throws a clear "you forgot to provide it" error only at render time if it's missing.

That second point is why `import`/`export` statements are **intentionally
rejected** at compile time (`src/mdx/compileMdx.ts`): supporting them would
require `@mdx-js/mdx`'s dynamic `import()` fallback, which needs network or
blob-URL resolution — not available (by design) in a null-origin sandboxed
iframe. Custom components are supplied via the `components` prop instead,
with no import statement required in the `.mdx` file itself. YAML
frontmatter IS supported (via `remark-frontmatter` +
`remark-mdx-frontmatter`) and becomes a plain local `frontmatter` object —
`{frontmatter.title}` works — confirmed by inspecting real compiled output;
its raw source text is stripped before the import/export guard runs, so a
frontmatter key like `export: true` can't be mistaken for JS syntax.

### Obsidian-specific syntax

`.mdx` files can use Obsidian's `[[wikilink]]` and `![[embed]]` syntax
(`src/mdx/obsidianWikilinks.ts`), even though MDX/remark has no native
notion of it:

- **Image embeds** (`![[pic.png]]`) resolve via `metadataCache` and become
  a standard `<img>` element, which then goes through the same vault image
  resolver as ordinary markdown images (see below) — one code path handles
  both syntaxes.
- **Other embeds/links** (`![[Some Note]]`, `[[Some Note|alias]]`) become
  an anchor tagged `data-wikilink="<vault path>"`. Non-image embeds render
  as a clickable reference, not full note transclusion — that's a real,
  deliberate scope cut, not an oversight.
- Everything is applied to a code-fence/inline-code-aware split of the
  source, so `[[1, 2]]` inside a ```js fence is never touched. Verified
  with an integration probe against real fake-Obsidian mocks, including
  duplicate wikilinks and adjacent code fences.
- Clicking a `data-wikilink` anchor inside the sandboxed iframe posts a
  message to the parent view (`postMessage` isn't blocked by the sandbox),
  which calls `app.workspace.openLinkText()` — this is how navigation works
  without punching a hole in the sandbox.

### Vault images → data URIs

`src/mdx/remarkResolveVaultImages.ts` is a remark plugin that walks the
compiled tree for both mdast `image` nodes (`![]()`) and JSX `<img src>`
elements, and rewrites any non-absolute, non-`data:` URL to a `data:` URI
by reading the file from the vault (`MdxPreviewView.resolveImage`). It
tries the path as vault-root-relative first (covers wikilink-resolved
paths), then relative to the source file's folder (covers ordinary
relative markdown image paths). Unresolvable images are left as-is — a
broken image, not a crash.

### Syntax highlighting & Mermaid

Code fences are highlighted at compile time via `rehype-highlight`
(confirmed output: `<code class="hljs language-js">` with `hljs-*`
token spans), styled with a small hand-written GitHub-Dark-flavored CSS
theme embedded directly in `buildSrcdoc.ts` (no CDN, no extra asset
pipeline).

Mermaid is different: `rehype-highlight` doesn't recognize `mermaid` as a
language, so a ```mermaid fence compiles to a plain
`<pre><code class="language-mermaid">`. The iframe runtime
(`src/runtime/iframe-entry.tsx`) post-processes the rendered DOM after
every React commit (via a small wrapper component's `useEffect`), finds
those blocks, and replaces them with SVG from the bundled `mermaid`
library — entirely offline, no network calls. This has been confirmed
working live in a real Obsidian vault (SVG rendered with correct node
labels, verified via the accessibility tree during manual testing).

### Custom components

In Settings → MDX View, point "Components bundle" at a vault-relative path
to a JS file that assigns `window.__mdxComponents = { MyChart, ... }`. Two
ways to produce it:

1. **Your own bundler.** Build with `external: ["react", "react-dom"]` (or
   equivalent) — the preview iframe exposes a single React instance as
   `window.__React` / `window.__ReactDOM.createRoot`, and your bundle
   should reference those rather than including its own copy of React.

2. **In-app, via esbuild-wasm** (`src/mdx/bundleComponents.ts`). Set
   "Components source" to a vault-relative entry file (e.g.
   `_components/index.tsx`) with named exports —
   `export function MyChart() {...}` — and click "Rebuild" (also available
   as the command "Rebuild MDX components bundle", or the hammer icon on
   an open preview). This:
   - Loads `esbuild.wasm` from the plugin's own folder via the vault
     adapter (`app.vault.adapter.readBinary`), using esbuild-wasm's
     `wasmModule` init option — its own docs describe this as "for
     environments where it's not possible to download the WebAssembly
     module," which is exactly this offline, cross-platform case.
   - Resolves the entry file's relative imports straight from the vault
     via a small esbuild plugin (`onResolve`/`onLoad`), with extension
     probing (`.tsx`/`.ts`/`.jsx`/`.js`) for extensionless imports.
   - Redirects `react`/`react-dom`/`react/jsx-runtime` imports to
     `window.__React`/`window.__ReactDOM`/`window.__mdxRuntime` via tiny
     virtual shim modules, so the bundle shares this plugin's one React
     instance instead of bundling its own.
   - Sets `globalName: "__MdxComponentsExport"` so esbuild auto-assigns the
     entry's named exports to that global, then writes
     `window.__mdxComponents = window.__MdxComponentsExport;` and saves the
     result to the components-bundle path.

   Confirmed working end-to-end in a live Obsidian vault: a vault-authored
   `.tsx` component was bundled via esbuild-wasm and rendered correctly
   inside the sandboxed preview with no errors.

   Note: the bundle must be read via `app.vault.adapter.read()`, not the
   indexed Vault API (`getAbstractFileByPath`/`cachedRead`) — files written
   via `adapter.write()` (as this bundler does) don't update Obsidian's
   file index immediately, so an indexed lookup can miss a file that
   genuinely exists on disk. This was a real bug found during testing and
   is now fixed in `MdxPreviewView.compileAndMount()`.

### Print / Save as PDF

The preview's printer action asks the sandboxed iframe for a snapshot
(`document.getElementById('mdx-root').outerHTML` via `postMessage`),
sanitizes it in the main Obsidian context (strips `<script>` tags and
`on*`/`javascript:` attributes via `DOMParser`), loads the sanitized markup
into a second, completely script-less iframe (`sandbox=""` — not even
`allow-scripts`), and calls `print()` on that. Desktop-only; the action
shows a notice on mobile (`Platform.isMobileApp`).

## What's implemented

**Confirmed working live in a real Obsidian vault** (not just compiled or
unit-probed — verified via manual testing with accessibility-tree
inspection of the actual rendered output):

- `.mdx` create/edit/view via Obsidian's native CM6 editor
- Frontmatter interpolation (`{frontmatter.title}`)
- GFM tables and strikethrough
- Syntax highlighting (rehype-highlight token spans)
- Mermaid diagram rendering (SVG with correct node labels)
- Wikilink/embed preprocessing, code-fence-safe
- Vault image → data URI resolution (both markdown and JSX `<img>` syntax)
- Sandboxed iframe render with a session-scoped consent gate
- Debounced live reload on file save
- The missing-component error path (`_missingMdxReference`)
- The non-fatal-warnings panel (e.g. "Cannot highlight as `mermaid`")
- The in-app esbuild-wasm component bundler, including the react/jsx-runtime
  shimming and named-export collection
- Settings tab (components bundle/source paths, debounce) persists correctly
- Preview-leaf reuse (repeated "Open MDX preview" invocations reveal the
  existing pane instead of accumulating duplicates)
- Full production build succeeds (`npm run typecheck`, `npm run build`),
  and the bundle contains no leaked Node built-ins (checked via a real
  regex scan of the output) — relevant since the manifest claims mobile
  support

**Not run in a live Obsidian instance:**

- The wikilink-click → `openLinkText()` postMessage bridge (implemented,
  not manually clicked through)
- Print/PDF snapshot → sanitize → print flow (implemented, not manually
  triggered)

**Not implemented — real gaps, not oversights:**

- Full transclusion of embedded notes (`![[Note]]` renders as a clickable
  reference, not the note's rendered content)
- Code Hike-style annotations (focus lines, diffs, scrollycoding)
- A dedicated Reading Mode integration (the native Reading Mode still
  shows unrendered JSX; use the separate preview pane instead)

## Known dependency advisories

`npm audit` flags two things worth knowing about rather than silently
carrying:
- `esbuild`'s dev-server CORS issue — dev-only, doesn't affect the shipped
  plugin.
- `remark-mdx-frontmatter`'s optional TOML parser (`toml` package) has
  known vulnerabilities. This plugin only configures YAML frontmatter, but
  the TOML code path is still reachable if a `.mdx` file uses `+++...+++`
  TOML frontmatter — low severity here since the whole point of the
  session consent gate is "don't preview files you don't trust," but worth
  knowing rather than silently carrying.

## Build

```bash
npm install
npm run build     # or `npm run dev` to watch
```

Three-stage build:

1. `scripts/build-runtime.mjs` bundles `src/runtime/iframe-entry.tsx`
   (React + ReactDOM + jsx-runtime + mermaid) into a single IIFE and writes
   it as a TypeScript string constant
   (`src/runtime/iframeRuntimeSource.generated.ts`). This is what gets
   embedded into the preview iframe at render time — no network fetch,
   ever. Minified in production builds (`NODE_ENV=production`, ~3.5 MB;
   mermaid accounts for most of that).
2. `esbuild.wasm` is copied from `node_modules/esbuild-wasm/` to the
   project root, alongside `main.js`, so the in-app component bundler can
   load it via the vault adapter at runtime.
3. `esbuild.config.mjs` bundles the plugin itself into `main.js` (~4.5 MB,
   dominated by the embedded iframe runtime string from step 1) with
   `platform: "browser"` so packages with a `"browser"` field (like
   esbuild-wasm) get their browser-safe build rather than a Node-only one.

To test in a vault: symlink or copy `manifest.json`, `main.js`,
`styles.css`, and `esbuild.wasm` into
`<vault>/.obsidian/plugins/mdx-view/`, then reload Obsidian and enable the
plugin.
