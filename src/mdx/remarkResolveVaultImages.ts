import { visit } from "unist-util-visit";
import type { Root, Image } from "mdast";
import type { MdxJsxFlowElement, MdxJsxTextElement, MdxJsxAttribute } from "mdast-util-mdx-jsx";
import { isAbsoluteOrDataUrl } from "./vaultPath";

/** Resolves a (possibly vault-relative or wikilink-style) image reference to
 * a data: URI, or returns undefined if it can't be resolved. */
export type ImageResolver = (src: string) => Promise<string | undefined>;

function isImgJsxElement(node: unknown): node is MdxJsxFlowElement | MdxJsxTextElement {
	if (!node || typeof node !== "object") return false;
	const n = node as { type?: string; name?: string | null };
	return (n.type === "mdxJsxFlowElement" || n.type === "mdxJsxTextElement") && n.name === "img";
}

/**
 * A remark plugin (used via @mdx-js/mdx's `remarkPlugins`) that walks the
 * tree for standard markdown images and JSX `<img>` elements and rewrites
 * their `src`/`url` to a data: URI using the supplied resolver. Runs as an
 * async transformer — unified's `run()` awaits plugins that return a
 * Promise, which @mdx-js/mdx's compile() uses internally.
 */
export function remarkResolveVaultImages(resolver: ImageResolver) {
	return async function transformer(tree: Root): Promise<void> {
		const jobs: Array<Promise<void>> = [];

		visit(tree, "image", (node: Image) => {
			if (isAbsoluteOrDataUrl(node.url)) return;
			jobs.push(
				resolver(node.url).then((dataUrl) => {
					if (dataUrl) node.url = dataUrl;
				})
			);
		});

		visit(
			tree,
			(node) => isImgJsxElement(node),
			(node) => {
				const el = node as MdxJsxFlowElement | MdxJsxTextElement;
				const srcAttr = el.attributes.find(
					(a): a is MdxJsxAttribute => a.type === "mdxJsxAttribute" && a.name === "src"
				);
				if (!srcAttr || typeof srcAttr.value !== "string") return;
				if (isAbsoluteOrDataUrl(srcAttr.value)) return;
				jobs.push(
					resolver(srcAttr.value).then((dataUrl) => {
						if (dataUrl) srcAttr.value = dataUrl;
					})
				);
			}
		);

		await Promise.all(jobs);
	};
}
