import { App, Notice, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
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

	/**
	 * Declarative settings (Obsidian 1.13.0+): gives this tab's settings
	 * search indexing and the standard settings-search UI. Each row is
	 * still rendered by the same `buildXRow` methods `display()` uses below,
	 * so behavior is identical either way — only how the row gets built
	 * (imperatively vs. via the declarative API) differs.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Components bundle",
				desc: this.bundleDesc(),
				render: (setting) => this.buildBundleRow(setting),
			},
			{
				name: "Components source (optional)",
				desc: this.sourceDesc(),
				render: (setting) => this.buildSourceRow(setting),
			},
			{
				name: "Preview debounce (ms)",
				desc: "How long to wait after you stop typing before re-rendering the preview.",
				render: (setting) => this.buildDebounceRow(setting),
			},
		];
	}

	/**
	 * Imperative fallback for Obsidian versions older than 1.13.0, which
	 * don't know about `getSettingDefinitions()`. Not called on 1.13.0+ (see
	 * `SettingTab.display()`'s doc comment in obsidian.d.ts).
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.buildBundleRow(new Setting(containerEl).setName("Components bundle").setDesc(this.bundleDesc()));
		this.buildSourceRow(
			new Setting(containerEl).setName("Components source (optional)").setDesc(this.sourceDesc())
		);
		this.buildDebounceRow(
			new Setting(containerEl)
				.setName("Preview debounce (ms)")
				.setDesc("How long to wait after you stop typing before re-rendering the preview.")
		);
	}

	private bundleDesc(): string {
		return (
			"Vault-relative path to a pre-bundled .js file that sets " +
			"window.__mdxComponents. This is what the preview reads. Build it " +
			"yourself, or set a source entry below and use \"Rebuild\"."
		);
	}

	private sourceDesc(): string {
		return (
			"Vault-relative entry file (e.g. _components/index.tsx) with named " +
			"exports for your React components. \"Rebuild\" compiles it with an " +
			"in-app esbuild-wasm bundler — fully offline, no CDN — and writes " +
			"the result to the components bundle path above."
		);
	}

	private buildBundleRow(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("_components/bundle.js")
				.setValue(this.plugin.settings.componentsBundlePath)
				.onChange(async (value) => {
					this.plugin.settings.componentsBundlePath = value.trim();
					await this.plugin.saveSettings();
				})
		);
	}

	private buildSourceRow(setting: Setting): void {
		setting
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
	}

	private buildDebounceRow(setting: Setting): void {
		setting.addText((text) =>
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
