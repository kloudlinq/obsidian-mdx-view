import obsidianmd from "eslint-plugin-obsidianmd";

// obsidianmd/ui/sentence-case's `brands` option *replaces* its built-in list
// rather than extending it, so this is that built-in list (mirrored from
// eslint-plugin-obsidianmd's ui/brands.js) plus this plugin's own name and
// its acronym, which the rule otherwise has no way of knowing not to
// lowercase (e.g. "Open MDX preview" -> "Open mdx preview").
const SENTENCE_CASE_BRANDS = [
	"iOS",
	"iPadOS",
	"macOS",
	"Windows",
	"Android",
	"Linux",
	"Obsidian",
	"Obsidian Sync",
	"Obsidian Publish",
	"Google",
	"Gemini",
	"Vertex AI",
	"OpenAI",
	"GPT",
	"Anthropic",
	"Claude",
	"Cursor",
	"Microsoft",
	"Google Drive",
	"Dropbox",
	"OneDrive",
	"iCloud Drive",
	"YouTube",
	"Slack",
	"Discord",
	"Telegram",
	"WhatsApp",
	"Twitter",
	"X",
	"Readwise",
	"Zotero",
	"Excalidraw",
	"Mermaid",
	"Markdown",
	"LaTeX",
	"JavaScript",
	"TypeScript",
	"Node.js",
	"npm",
	"pnpm",
	"Yarn",
	"Git",
	"GitHub",
	"GitLab",
	"Anki",
	"CalDAV",
	"CardDAV",
	"Evernote",
	"IntelliJ IDEA",
	"Jekyll",
	"Logseq",
	"Notion",
	"PyCharm",
	"React",
	"Reddit",
	"Roam Research",
	"Svelte",
	"VS Code",
	"Visual Studio Code",
	"WebDAV",
	"WebStorm",
	// This plugin.
	"MDX View",
	"MDX",
];

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
	{
		rules: {
			"obsidianmd/ui/sentence-case": ["warn", { brands: SENTENCE_CASE_BRANDS }],
		},
	},
];
