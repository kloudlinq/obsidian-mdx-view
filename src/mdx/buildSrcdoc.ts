import { IFRAME_RUNTIME_JS } from "../runtime/iframeRuntimeSource.generated";

/** Prevents any embedded string from prematurely closing a <script> tag. */
function escapeScriptClose(js: string): string {
	return js.replace(/<\/script/gi, "<\\/script");
}

export interface SrcdocOptions {
	/** `function-body` output from compileMdxSource(). */
	compiledFunctionBody: string;
	/**
	 * Raw JS text of a user-supplied, pre-bundled components file. Must be
	 * built with `external: ['react', 'react-dom']` (or equivalent) and
	 * assign `window.__mdxComponents = { ... }`. Optional.
	 */
	componentsBundleJs?: string;
}

const BASE_CSS = `
  :root { color-scheme: light dark; }
  html, body { margin: 0; padding: 12px 16px; font-family: var(--font-interface, sans-serif); }
  .mdx-error { color: #c0392b; white-space: pre-wrap; font-family: var(--font-monospace, monospace); font-size: 0.85em; }
  .mdx-error pre { white-space: pre-wrap; word-break: break-word; }
  img { max-width: 100%; }
  pre { padding: 10px 12px; border-radius: 6px; background: #0d1117; overflow-x: auto; }
  code { font-family: var(--font-monospace, monospace); font-size: 0.85em; }
  :not(pre) > code { background: rgba(127,127,127,0.15); padding: 0.1em 0.35em; border-radius: 4px; }
  .mdx-mermaid { display: flex; justify-content: center; margin: 12px 0; }
  .mdx-mermaid svg { max-width: 100%; height: auto; }
  a.mdx-wikilink { color: #7aa2f7; text-decoration: none; cursor: pointer; }
  a.mdx-wikilink:hover { text-decoration: underline; }
  .mdx-wikilink-unresolved { color: #9aa0a6; border-bottom: 1px dashed currentColor; }
`;

/** Minimal, embedded (no CDN) GitHub-Dark-flavored highlight.js theme —
 * matches the class names rehype-highlight emits (hljs-keyword, etc.). */
const HLJS_THEME_CSS = `
  .hljs { color: #c9d1d9; background: transparent; }
  .hljs-comment, .hljs-quote { color: #8b949e; font-style: italic; }
  .hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-type { color: #ff7b72; }
  .hljs-string, .hljs-addition, .hljs-attr, .hljs-meta-string { color: #a5d6ff; }
  .hljs-number, .hljs-symbol, .hljs-bullet { color: #79c0ff; }
  .hljs-title, .hljs-title.function_, .hljs-title.class_ { color: #d2a8ff; }
  .hljs-variable, .hljs-template-variable, .hljs-attribute { color: #ffa657; }
  .hljs-built_in, .hljs-builtin-name { color: #ffa657; }
  .hljs-deletion { color: #ffa198; }
  .hljs-emphasis { font-style: italic; }
  .hljs-strong { font-weight: bold; }
`;

/**
 * Builds the full HTML document written into the sandboxed
 * `<iframe sandbox="allow-scripts">`'s `srcdoc`. Every dynamic piece is
 * inserted as the literal text content of a real <script> element — this
 * plugin never calls eval() or new Function() to run MDX/component code.
 */
export function buildSrcdoc(options: SrcdocOptions): string {
	const { compiledFunctionBody, componentsBundleJs } = options;

	const bootScript = `
"use strict";
function __mdxModule() {
${compiledFunctionBody}
}
try {
  var __mdxMod = __mdxModule.call(null, window.__mdxRuntime);
  window.__mount(__mdxMod.default, window.__mdxComponents || {});
} catch (e) {
  window.__mountError(e);
}
`;

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;" />
<style>${BASE_CSS}${HLJS_THEME_CSS}</style>
</head>
<body>
<div id="mdx-root"></div>
<script>${escapeScriptClose(IFRAME_RUNTIME_JS)}</script>
${componentsBundleJs ? `<script>${escapeScriptClose(componentsBundleJs)}</script>` : ""}
<script>${escapeScriptClose(bootScript)}</script>
</body>
</html>`;
}
