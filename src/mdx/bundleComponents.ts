import * as esbuildWasm from "esbuild-wasm";
import type { App } from "obsidian";
import { dirname, joinVaultPath } from "./vaultPath";

let initPromise: Promise<void> | null = null;

/** Loads esbuild's WebAssembly binary from the plugin's own folder (via the
 * vault adapter, so it works on desktop and mobile alike) and initializes
 * esbuild-wasm with `wasmModule` rather than `wasmURL` — the option
 * esbuild-wasm's own types document as being "for environments where it's
 * not possible to download the WebAssembly module", which describes a
 * null-network sandboxed context well. `worker: false` keeps this on the
 * main thread; it only runs when the user explicitly asks to rebuild. */
async function ensureInitialized(app: App, pluginId: string): Promise<void> {
	if (initPromise) return initPromise;
	initPromise = (async () => {
		const wasmPath = `${app.vault.configDir}/plugins/${pluginId}/esbuild.wasm`;
		const bytes = await app.vault.adapter.readBinary(wasmPath);
		const wasmModule = await WebAssembly.compile(bytes);
		await esbuildWasm.initialize({ wasmModule, worker: false });
	})();
	return initPromise;
}

const REACT_SHIM = "module.exports = window.__React;";
const REACT_DOM_SHIM = "module.exports = window.__ReactDOM;";
const JSX_RUNTIME_SHIM = "module.exports = window.__mdxRuntime;";
const CANDIDATE_EXTENSIONS = ["tsx", "ts", "jsx", "js"];

function isReactSpecifier(path: string): boolean {
	return path === "react" || path === "react-dom" || path.startsWith("react/jsx-runtime") || path.startsWith("react/jsx-dev-runtime");
}

/**
 * Reads vault files as esbuild's module graph (no real filesystem access),
 * and redirects react/react-dom/react-jsx-runtime imports to the same
 * globals the preview iframe's own runtime bundle exposes, so a
 * vault-authored components file shares this plugin's single React
 * instance instead of bundling its own copy.
 */
function vaultFsPlugin(app: App): esbuildWasm.Plugin {
	return {
		name: "obsidian-vault-fs",
		setup(build) {
			build.onResolve({ filter: /.*/ }, async (args) => {
				if (isReactSpecifier(args.path)) {
					return { path: args.path, namespace: "react-shim" };
				}
				if (args.kind === "entry-point") {
					return { path: args.path, namespace: "vault-fs" };
				}

				let resolved = joinVaultPath(dirname(args.importer), args.path);
				if (!/\.(tsx|ts|jsx|js)$/.test(resolved)) {
					for (const ext of CANDIDATE_EXTENSIONS) {
						const candidate = `${resolved}.${ext}`;
						if (await app.vault.adapter.exists(candidate)) {
							resolved = candidate;
							break;
						}
					}
				}
				if (!(await app.vault.adapter.exists(resolved))) {
					return {
						errors: [{ text: `Cannot find "${args.path}" (resolved to "${resolved}") in the vault.` }],
					};
				}
				return { path: resolved, namespace: "vault-fs" };
			});

			build.onLoad({ filter: /.*/, namespace: "react-shim" }, (args) => {
				const contents =
					args.path === "react" ? REACT_SHIM : args.path === "react-dom" ? REACT_DOM_SHIM : JSX_RUNTIME_SHIM;
				return { contents, loader: "js" };
			});

			build.onLoad({ filter: /.*/, namespace: "vault-fs" }, async (args) => {
				const contents = await app.vault.adapter.read(args.path);
				const ext = args.path.split(".").pop() ?? "";
				const loader: esbuildWasm.Loader =
					ext === "tsx" ? "tsx" : ext === "ts" ? "ts" : ext === "jsx" ? "jsx" : "js";
				return { contents, loader };
			});
		},
	};
}

export interface BundleResult {
	ok: boolean;
	code?: string;
	error?: string;
}

/**
 * Bundles a vault-authored entry file (expected to use named `export`s for
 * its React components — e.g. `export function MyChart() {...}`) into a
 * single IIFE that assigns `window.__mdxComponents`. This is the in-app
 * alternative to running your own esbuild/webpack/rollup externally; the
 * output format is identical either way (see README "Custom components").
 */
export async function bundleComponentsFromVault(app: App, pluginId: string, entryPath: string): Promise<BundleResult> {
	try {
		await ensureInitialized(app, pluginId);

		const result = await esbuildWasm.build({
			entryPoints: [entryPath],
			bundle: true,
			write: false,
			format: "iife",
			globalName: "__MdxComponentsExport",
			platform: "browser",
			target: "es2020",
			jsx: "automatic",
			plugins: [vaultFsPlugin(app)],
			logLevel: "silent",
		});

		const bundled = result.outputFiles?.[0]?.text ?? "";
		const code = `${bundled}\nwindow.__mdxComponents = window.__MdxComponentsExport;\n`;
		return { ok: true, code };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, error: message };
	}
}
