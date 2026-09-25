import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, MdxViewSettings, MdxViewSettingTab } from "./settings";
import { MDX_PREVIEW_VIEW_TYPE, MdxPreviewView } from "./view/MdxPreviewView";
import { bundleComponentsFromVault } from "./mdx/bundleComponents";
import { dirname, joinPath } from "./mdx/vaultPath";

export default class MdxViewPlugin extends Plugin {
	settings: MdxViewSettings = DEFAULT_SETTINGS;

	/**
	 * Whether the person has confirmed, for this Obsidian session, that MDX
	 * JavaScript may run in the sandboxed preview iframe. Deliberately
	 * in-memory only — resets on every restart, mirroring the consent-gate
	 * pattern used by the reference MDX Preview plugin.
	 */
	sessionConsentGiven = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Route .mdx onto Obsidian's built-in "markdown" view type. This
		// reuses the native CodeMirror 6 editor and default Reading Mode
		// as-is — nothing here subclasses MarkdownView (that approach is
		// documented as unreliable; getLeavesOfType() returns null for it).
		this.registerExtensions(["mdx"], "markdown");

		this.registerView(MDX_PREVIEW_VIEW_TYPE, (leaf: WorkspaceLeaf) => new MdxPreviewView(leaf, this));

		this.addRibbonIcon("eye", "Open MDX preview", () => {
			void this.openPreviewForActiveFile();
		});

		this.addCommand({
			id: "open-mdx-preview",
			name: "Open MDX preview",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const isMdx = file?.extension === "mdx";
				if (checking) return !!isMdx;
				if (isMdx) void this.openPreviewForActiveFile();
				return true;
			},
		});

		this.addCommand({
			id: "rebuild-mdx-components-bundle",
			name: "Rebuild MDX components bundle",
			callback: () => void this.rebuildComponentsBundle(),
		});

		this.addSettingTab(new MdxViewSettingTab(this.app, this));
	}

	private async openPreviewForActiveFile(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile) || file.extension !== "mdx") return;

		// Reuse an existing preview leaf for this file rather than always
		// splitting a new one — repeated invocations (ribbon click, command,
		// or Obsidian's own workspace restore on relaunch) would otherwise
		// accumulate duplicate panes for the same file.
		const existing = this.app.workspace.getLeavesOfType(MDX_PREVIEW_VIEW_TYPE).find((leaf) => {
			const state = leaf.view.getState() as { file?: string };
			return state.file === file.path;
		});
		if (existing) {
			this.app.workspace.revealLeaf(existing);
			return;
		}

		const leaf = this.app.workspace.getLeaf("split", "vertical");
		await leaf.setViewState({
			type: MDX_PREVIEW_VIEW_TYPE,
			active: true,
			state: { file: file.path },
		});
		this.app.workspace.revealLeaf(leaf);
	}

	/**
	 * Compiles `settings.componentsSourcePath` with the in-app esbuild-wasm
	 * bundler and writes the result to `settings.componentsBundlePath`
	 * (deriving a default output path next to the source file if none is
	 * set). See src/mdx/bundleComponents.ts for how the offline WASM load
	 * and the react/react-dom shimming work.
	 */
	async rebuildComponentsBundle(): Promise<void> {
		const { componentsSourcePath } = this.settings;
		if (!componentsSourcePath) {
			new Notice("MDX View: set a components source file in settings first.");
			return;
		}
		if (!(await this.app.vault.adapter.exists(componentsSourcePath))) {
			new Notice(`MDX View: source file not found: ${componentsSourcePath}`);
			return;
		}

		let outPath = this.settings.componentsBundlePath;
		if (!outPath) {
			outPath = joinPath(dirname(componentsSourcePath), "mdx-components.bundle.js");
			this.settings.componentsBundlePath = outPath;
			await this.saveSettings();
		}

		new Notice("MDX View: bundling components…");
		const result = await bundleComponentsFromVault(this.app, this.manifest.id, componentsSourcePath);
		if (!result.ok || !result.code) {
			new Notice(`MDX View: bundle failed — ${result.error ?? "unknown error"}`, 8000);
			return;
		}

		await this.app.vault.adapter.write(outPath, result.code);
		new Notice(`MDX View: components bundle updated (${outPath}).`);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
