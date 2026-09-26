import { ItemView, TFile, WorkspaceLeaf, Notice, ViewStateResult, Platform } from "obsidian";
import { compileMdxSource } from "../mdx/compileMdx";
import { buildSrcdoc } from "../mdx/buildSrcdoc";
import { preprocessObsidianSyntax } from "../mdx/obsidianWikilinks";
import { dirname, isAbsoluteOrDataUrl, joinVaultPath, mimeForExtension, extensionOf } from "../mdx/vaultPath";
import type MdxViewPlugin from "../main";

export const MDX_PREVIEW_VIEW_TYPE = "mdx-preview-view";

interface MdxPreviewState {
	file?: string; // vault-relative path of the source .mdx file
	[key: string]: unknown;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	let binary = "";
	const bytes = new Uint8Array(buffer);
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/** Strips <script> elements and event-handler/javascript: attributes from a
 * rendered-HTML snapshot before it's ever loaded into a (script-less)
 * print iframe. Runs in the main Obsidian context on our own compiled
 * output, not on arbitrary untrusted input, but a buggy/malicious custom
 * component could still have written a literal <script> via
 * dangerouslySetInnerHTML, so this stays defense-in-depth rather than
 * optional. */
function sanitizeSnapshotHtml(html: string): string {
	const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
	doc.querySelectorAll("script").forEach((el) => el.remove());
	doc.querySelectorAll("*").forEach((el) => {
		for (const attr of Array.from(el.attributes)) {
			const name = attr.name.toLowerCase();
			const value = attr.value.trim().toLowerCase();
			if (name.startsWith("on") || value.startsWith("javascript:")) {
				el.removeAttribute(attr.name);
			}
		}
	});
	return doc.body.innerHTML;
}

export class MdxPreviewView extends ItemView {
	private plugin: MdxViewPlugin;
	private filePath: string | null = null;
	private iframeEl: HTMLIFrameElement | null = null;
	private statusEl: HTMLElement | null = null;
	private debounceHandle: number | null = null;
	private renderToken = 0;
	private pendingSnapshot: ((html: string) => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: MdxViewPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return MDX_PREVIEW_VIEW_TYPE;
	}

	getDisplayText(): string {
		if (this.filePath) {
			const name = this.filePath.split("/").pop() ?? this.filePath;
			return `Preview: ${name}`;
		}
		return "MDX preview";
	}

	getIcon(): string {
		return "eye";
	}

	async setState(state: MdxPreviewState, result: ViewStateResult): Promise<void> {
		if (state?.file) {
			this.filePath = state.file;
		}
		await super.setState(state, result);
		await this.renderNow();
	}

	getState(): MdxPreviewState {
		return { file: this.filePath ?? undefined };
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("mdx-preview-container");

		this.addAction("refresh-cw", "Refresh preview", () => void this.renderNow());

		this.addAction("printer", "Print / save as PDF", () => void this.printPreview());

		this.addAction("hammer", "Rebuild components bundle", async () => {
			await this.plugin.rebuildComponentsBundle();
			await this.renderNow();
		});

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.path === this.filePath) {
					this.scheduleRender();
				}
			})
		);

		this.registerDomEvent(window, "message", (event: MessageEvent) => {
			if (event.source !== this.iframeEl?.contentWindow) return;
			const data = event.data as { source?: string; type?: string; target?: string; html?: string } | undefined;
			if (data?.source !== "mdx-view") return;

			if (data.type === "open-link" && data.target) {
				void this.app.workspace.openLinkText(data.target, this.filePath ?? "", false);
			} else if (data.type === "snapshot" && this.pendingSnapshot) {
				this.pendingSnapshot(data.html ?? "");
				this.pendingSnapshot = null;
			}
		});

		await this.renderNow();
	}

	async onClose(): Promise<void> {
		if (this.debounceHandle !== null) {
			window.clearTimeout(this.debounceHandle);
		}
	}

	private scheduleRender(): void {
		if (this.debounceHandle !== null) {
			window.clearTimeout(this.debounceHandle);
		}
		this.debounceHandle = window.setTimeout(() => {
			this.debounceHandle = null;
			void this.renderNow();
		}, this.plugin.settings.previewDebounceMs);
	}

	private async renderNow(): Promise<void> {
		const token = ++this.renderToken;
		this.contentEl.empty();
		this.iframeEl = null;

		if (!this.filePath) {
			this.contentEl.createDiv({
				text: "No .mdx file associated with this preview pane.",
				cls: "mdx-preview-empty",
			});
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(this.filePath);
		if (!(file instanceof TFile)) {
			this.contentEl.createDiv({
				text: `File not found: ${this.filePath}`,
				cls: "mdx-preview-empty",
			});
			return;
		}

		if (!this.plugin.sessionConsentGiven) {
			this.renderConsentGate();
			return;
		}

		await this.compileAndMount(file, token);
	}

	private renderConsentGate(): void {
		const wrap = this.contentEl.createDiv({ cls: "mdx-consent-gate" });
		wrap.createEl("p", {
			text:
				"MDX files can contain JSX and JavaScript. Rendering runs that " +
				"code inside a sandboxed, null-origin iframe with no access to " +
				"your vault or Obsidian's API — but you should still only preview " +
				"files you trust.",
		});
		const btn = wrap.createEl("button", { text: "Enable MDX preview for this session" });
		this.registerDomEvent(btn, "click", () => {
			this.plugin.sessionConsentGiven = true;
			void this.renderNow();
		});
	}

	/** Resolves an image reference (vault-root-relative, as produced by
	 * wikilink-embed preprocessing, or relative to the source file, as in
	 * ordinary markdown/JSX) to a data: URI by reading it from the vault. */
	private resolveImage = async (src: string): Promise<string | undefined> => {
		if (isAbsoluteOrDataUrl(src)) return undefined;

		let file = this.app.vault.getAbstractFileByPath(src);
		if (!(file instanceof TFile) && this.filePath) {
			const joined = joinVaultPath(dirname(this.filePath), src);
			file = this.app.vault.getAbstractFileByPath(joined);
		}
		if (!(file instanceof TFile)) return undefined;

		const bytes = await this.app.vault.readBinary(file);
		const base64 = arrayBufferToBase64(bytes);
		const mime = mimeForExtension(extensionOf(file.path));
		return `data:${mime};base64,${base64}`;
	};

	private async compileAndMount(file: TFile, token: number): Promise<void> {
		this.statusEl = this.contentEl.createDiv({ cls: "mdx-preview-status", text: "Compiling…" });

		const rawSource = await this.app.vault.cachedRead(file);
		const preprocessed = preprocessObsidianSyntax(this.app, file, rawSource);
		const result = await compileMdxSource(preprocessed, { resolveImage: this.resolveImage });

		if (token !== this.renderToken) return; // a newer render started; drop this one

		if (!result.ok || !result.code) {
			this.statusEl?.remove();
			const errEl = this.contentEl.createDiv({ cls: "mdx-error" });
			errEl.createEl("strong", { text: "Compile error" });
			errEl.createEl("pre", { text: result.error ?? "Unknown error" });
			return;
		}

		let componentsBundleJs: string | undefined;
		const bundlePath = this.plugin.settings.componentsBundlePath;
		if (bundlePath) {
			// Read via the raw adapter, not getAbstractFileByPath()/cachedRead():
			// this file is typically produced by rebuildComponentsBundle() via
			// adapter.write(), which — unlike the Vault API — doesn't update
			// Obsidian's file index, so an indexed lookup can miss a file that
			// genuinely exists on disk (confirmed: reproducible after a fresh
			// bundle write, even with the settings path itself correct).
			try {
				componentsBundleJs = await this.app.vault.adapter.read(bundlePath);
			} catch {
				new Notice(`MDX View: components bundle not found at "${bundlePath}"`);
			}
		}

		if (token !== this.renderToken) return;

		this.statusEl?.remove();
		this.statusEl = null;

		const html = buildSrcdoc({
			compiledFunctionBody: result.code,
			componentsBundleJs,
		});

		const iframe = this.contentEl.createEl("iframe", {
			cls: "mdx-preview-iframe",
			attr: { sandbox: "allow-scripts", srcdoc: html },
		});
		this.iframeEl = iframe;

		if (result.warnings.length > 0) {
			const warnEl = this.contentEl.createDiv({ cls: "mdx-preview-warnings" });
			warnEl.createEl("strong", { text: `${result.warnings.length} warning(s)` });
			const list = warnEl.createEl("ul");
			for (const w of result.warnings) {
				list.createEl("li", { text: w });
			}
		}
	}

	/** Requests a static HTML snapshot from the sandboxed iframe, sanitizes
	 * it, loads it into a hidden, script-less iframe (sandbox="" — not even
	 * allow-scripts), and prints that. Desktop-only: Obsidian mobile has no
	 * reliable print API. */
	private async printPreview(): Promise<void> {
		if (Platform.isMobileApp) {
			new Notice("MDX View: printing is only available on desktop.");
			return;
		}
		if (!this.iframeEl?.contentWindow) {
			new Notice("MDX View: nothing to print yet.");
			return;
		}

		const html = await new Promise<string>((resolve) => {
			this.pendingSnapshot = resolve;
			this.iframeEl?.contentWindow?.postMessage({ source: "mdx-view", type: "request-snapshot" }, "*");
			window.setTimeout(() => {
				if (this.pendingSnapshot === resolve) {
					this.pendingSnapshot = null;
					resolve("");
				}
			}, 3000);
		});

		if (!html) {
			new Notice("MDX View: couldn't capture the preview to print.");
			return;
		}

		const safeHtml = sanitizeSnapshotHtml(html);
		const printFrame = document.body.createEl("iframe", {
			cls: "mdx-print-frame",
			attr: { sandbox: "" }, // no scripts, no same-origin — static markup only
		});

		printFrame.onload = () => {
			try {
				printFrame.contentWindow?.print();
			} finally {
				window.setTimeout(() => printFrame.remove(), 1000);
			}
		};
		printFrame.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body>${safeHtml}</body></html>`;
	}
}
