import { compile } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import rehypeHighlight from "rehype-highlight";
import { remarkResolveVaultImages, type ImageResolver } from "./remarkResolveVaultImages";

export interface CompileResult {
	ok: boolean;
	code?: string;
	error?: string;
	warnings: string[];
}

export interface CompileOptions {
	/** Resolves vault-relative image paths (including ones produced by
	 * wikilink-embed preprocessing) to data: URIs. */
	resolveImage?: ImageResolver;
}

/** Strips a leading YAML frontmatter block before scanning for bare
 * `import`/`export` statements, so a frontmatter key like `export: true`
 * can never be mistaken for JS syntax. */
function stripLeadingFrontmatter(source: string): string {
	const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(source);
	return m ? source.slice(m[0].length) : source;
}

const IMPORT_RE = /^\s*import\s+.+\s+from\s+['"].+['"]/m;
const EXPORT_RE = /^\s*export\s+(default\s|const\s|function\s|\{)/m;

/**
 * Compiles MDX source to a `function-body` string (see @mdx-js/mdx docs).
 * That string is later wrapped in a literal `function(){ ... }` and written
 * into a real <script> tag inside the sandboxed preview iframe — never
 * passed through eval() or new Function() in this plugin's own context.
 *
 * `import`/`export … from` statements (real JS ones, not frontmatter keys)
 * are intentionally NOT supported: supporting them would require
 * @mdx-js/mdx's dynamic `import()` fallback, which needs network or blob:
 * URL resolution inside a null-origin sandboxed iframe. Custom components
 * are provided instead via the `components` prop mechanism (see README
 * "Custom components"). YAML frontmatter IS supported and becomes a plain
 * local `frontmatter` object usable in the body, e.g. `{frontmatter.title}`.
 */
export async function compileMdxSource(source: string, options: CompileOptions = {}): Promise<CompileResult> {
	const warnings: string[] = [];
	const bodyOnly = stripLeadingFrontmatter(source);

	if (IMPORT_RE.test(bodyOnly) || EXPORT_RE.test(bodyOnly)) {
		return {
			ok: false,
			warnings,
			error:
				"`.mdx` files in this plugin can't use `import`/`export` statements " +
				"(the sandboxed preview has no network access). Reference custom " +
				"components directly as JSX tags instead — see Settings → MDX View " +
				"→ Components bundle.",
		};
	}

	// unified's plugin list accepts either a bare attacher or an
	// [attacher, options] tuple; remarkResolveVaultImages *is* the attacher
	// (it takes the resolver as its settings and returns a transformer).
	const remarkPlugins: Array<unknown> = [remarkFrontmatter, remarkMdxFrontmatter, remarkGfm];
	if (options.resolveImage) {
		remarkPlugins.push([remarkResolveVaultImages, options.resolveImage]);
	}

	try {
		const file = await compile(source, {
			outputFormat: "function-body",
			development: false,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			remarkPlugins: remarkPlugins as any,
			rehypePlugins: [rehypeHighlight],
		});

		for (const message of file.messages) {
			warnings.push(message.reason);
		}

		return { ok: true, code: String(file), warnings };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, warnings, error: message };
	}
}
