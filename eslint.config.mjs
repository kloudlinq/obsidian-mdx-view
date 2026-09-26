import obsidianmd from "eslint-plugin-obsidianmd";

export default [
	{
		ignores: [
			"main.js",
			"node_modules/**",
			"src/runtime/iframeRuntimeSource.generated.ts",
			"esbuild.config.mjs",
			"eslint.config.mjs",
			"scripts/**",
		],
	},
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
];
