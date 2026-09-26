import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type MdxViewPlugin from "./main";

export interface MdxViewSettings {
	/**
	 * Vault-relative path to a pre-bundled JS file that assigns
	 * `window.__mdxComponents = { ComponentName: Component, ... }`. This is
	 * what the preview actually reads at render time — either hand-built
	 * with your own bundler, or generated from `componentsSourcePath` below
	 * via "Rebuild components bundle".
	 */
	componentsBundlePath: string;
	/**
	 * Optional vault-relative entry file (.tsx/.ts/.jsx/.js) with named
	 * `export`s for your components. "Rebuild components bundle" compiles
	 * it (and any relative imports) with an in-app esbuild-wasm bundler and
	 * writes the result to componentsBundlePath.
	 */
	componentsSourcePath: string;
	/** Milliseconds to wait after the last edit before re-rendering the preview. */
	previewDebounceMs: number;
}

export const DEFAULT_SETTINGS: MdxViewSettings = {
	componentsBundlePath: "",
	componentsSourcePath: "",
	previewDebounceMs: 400,
};

export class MdxViewSettingTab extends PluginSettingTab {
	plugin: MdxViewPlugin;

	constructor(app: App, plugin: MdxViewPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Components bundle")
			.setDesc(
				"Vault-relative path to a pre-bundled .js file that sets " +
					"window.__mdxComponents. This is what the preview reads. Build it " +
					"yourself, or set a source entry below and use \"Rebuild\"."
			)
			.addText((text) =>
				text
					.setPlaceholder("_components/bundle.js")
					.setValue(this.plugin.settings.componentsBundlePath)
					.onChange(async (value) => {
						this.plugin.settings.componentsBundlePath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Components source (optional)")
			.setDesc(
				"Vault-relative entry file (e.g. _components/index.tsx) with named " +
					"exports for your React components. \"Rebuild\" compiles it with an " +
					"in-app esbuild-wasm bundler — fully offline, no CDN — and writes " +
					"the result to the components bundle path above."
			)
			.addText((text) =>
				text
					.setPlaceholder("_components/index.tsx")
					.setValue(this.plugin.settings.componentsSourcePath)
					.onChange(async (value) => {
						this.plugin.settings.componentsSourcePath = value.trim();
						await this.plugin.saveSettings();
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText("Rebuild")
					.setCta()
					.onClick(async () => {
						btn.setDisabled(true).setButtonText("Rebuilding…");
						try {
							await this.plugin.rebuildComponentsBundle();
						} finally {
							btn.setDisabled(false).setButtonText("Rebuild");
						}
					})
			);

		new Setting(containerEl)
			.setName("Preview debounce (ms)")
			.setDesc("How long to wait after you stop typing before re-rendering the preview.")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.previewDebounceMs)).onChange(async (value) => {
					const n = Number(value);
					if (Number.isFinite(n) && n >= 0) {
						this.plugin.settings.previewDebounceMs = n;
						await this.plugin.saveSettings();
					} else {
						new Notice("Preview debounce must be a non-negative number.");
					}
				})
			);
	}
}
