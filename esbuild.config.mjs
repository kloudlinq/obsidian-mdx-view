import * as esbuild from "esbuild";
import process from "node:process";
import builtins from "builtin-modules";

const production = process.argv[2] === "production";
const watch = process.argv[2] === "watch";

const ctx = await esbuild.context({
	banner: {
		js: "/* MDX View for Obsidian — generated file, do not edit. */",
	},
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: ["obsidian", "electron", "@codemirror/*", ...builtins],
	format: "cjs",
	platform: "browser", // honor packages' "browser" field (e.g. esbuild-wasm) for mobile safety
	target: "es2020",
	logLevel: "info",
	sourcemap: production ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: production,
});

if (watch) {
	await ctx.watch();
	console.log("[esbuild] watching…");
} else {
	await ctx.rebuild();
	await ctx.dispose();
}
