import type { App, TFile } from "obsidian";
import { isImagePath } from "./vaultPath";

/** JSX text child holding an arbitrary string safely: `{"…"}`. */
function jsxText(text: string): string {
	return `{${JSON.stringify(text)}}`;
}

/** JSX attribute value holding an arbitrary string safely: `attr={"…"}`. */
function jsxAttr(name: string, value: string): string {
	return `${name}={${JSON.stringify(value)}}`;
}

function basenameNoExt(path: string): string {
	const base = path.split("/").pop() ?? path;
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Splits `source` into alternating [prose, code, prose, code, ...] chunks
 * (fenced code blocks and inline code spans are never split apart) and
 * applies `transform` to the prose chunks only.
 */
function transformOutsideCode(source: string, transform: (chunk: string) => string): string {
	const CODE = /(```[\s\S]*?```|`[^`\n]*`)/g;
	const parts = source.split(CODE);
	return parts
		.map((part, i) => (i % 2 === 0 ? transform(part) : part))
		.join("");
}

interface WikilinkMatch {
	full: string;
	target: string;
	alias?: string;
}

function parseWikilinks(chunk: string, embed: boolean): WikilinkMatch[] {
	const re = embed
		? /!\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
		: /(?<!!)\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
	const out: WikilinkMatch[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(chunk))) {
		out.push({ full: m[0], target: m[1], alias: m[2] });
	}
	return out;
}

/**
 * Rewrites `![[target|alias]]` (embed) and `[[target|alias]]` (link) into
 * literal JSX that @mdx-js/mdx can parse natively — no `import`/network
 * needed. Image embeds become standard `<img>` elements (so
 * remarkResolveVaultImages can turn them into data: URIs alongside
 * ordinary markdown images); everything else becomes an anchor tagged
 * `data-wikilink="<vault path>"`, which the preview iframe intercepts on
 * click and forwards to Obsidian via postMessage (see MdxPreviewView).
 */
export function preprocessObsidianSyntax(app: App, sourceFile: TFile, source: string): string {
	return transformOutsideCode(source, (chunk) => {
		let result = chunk;

		for (const { full, target, alias } of parseWikilinks(chunk, true)) {
			const dest = app.metadataCache.getFirstLinkpathDest(target, sourceFile.path);
			let replacement: string;
			if (dest && isImagePath(dest.path)) {
				const altText = alias ?? basenameNoExt(dest.path);
				replacement = `<img src="${dest.path}" alt="${altText.replace(/"/g, "&quot;")}" />`;
			} else if (dest) {
				// Non-image embed: v1 renders a clickable reference, not full transclusion.
				const label = alias ?? dest.path;
				replacement = `<a ${jsxAttr("data-wikilink", dest.path)} className="mdx-wikilink mdx-wikilink-embed">${jsxText("📎 " + label)}</a>`;
			} else {
				replacement = `<span className="mdx-wikilink-unresolved">${jsxText("📎 " + (alias ?? target))}</span>`;
			}
			result = result.replace(full, replacement);
		}

		for (const { full, target, alias } of parseWikilinks(chunk, false)) {
			const dest = app.metadataCache.getFirstLinkpathDest(target, sourceFile.path);
			let replacement: string;
			if (dest) {
				const label = alias ?? basenameNoExt(dest.path);
				replacement = `<a ${jsxAttr("data-wikilink", dest.path)} className="mdx-wikilink">${jsxText(label)}</a>`;
			} else {
				replacement = `<span className="mdx-wikilink-unresolved">${jsxText(alias ?? target)}</span>`;
			}
			result = result.replace(full, replacement);
		}

		return result;
	});
}
