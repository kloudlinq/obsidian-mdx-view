/**
 * Bundled separately (see scripts/build-runtime.mjs) into a single browser
 * IIFE that is embedded, as source text, into the plugin's main.js at build
 * time. At runtime the resulting string is written literally into a
 * <script> tag inside the sandboxed preview iframe's srcdoc — never passed
 * through eval() or new Function().
 *
 * Exposes, on `window` inside that iframe:
 *   - __React, __ReactDOM          (so a vault-authored components bundle
 *                                    can share this single React instance)
 *   - __mdxRuntime                 ({ Fragment, jsx, jsxs }) — the exact
 *                                    shape @mdx-js/mdx's function-body
 *                                    output expects as its sole argument
 *   - __mount(ContentComponent, components)
 *   - __mountError(error)
 *
 * Also wires up two postMessage bridges back to the parent (MdxPreviewView):
 *   - clicking a `[data-wikilink]` element asks the parent to open that
 *     vault path in Obsidian (postMessage has no sandbox restriction)
 *   - a "request-snapshot" message gets a reply with the rendered HTML, for
 *     the print/PDF feature (the parent sanitizes it before printing)
 * And post-render, scans for `code.language-mermaid` blocks and replaces
 * them with rendered SVG via the bundled `mermaid` library (fully offline).
 */
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import mermaid from "mermaid";

declare global {
	interface Window {
		__React: typeof React;
		__ReactDOM: { createRoot: typeof ReactDOM.createRoot };
		__mdxRuntime: { Fragment: typeof Fragment; jsx: typeof jsx; jsxs: typeof jsxs };
		__mdxComponents?: Record<string, unknown>;
		__mount: (
			Content: React.ComponentType<{ components?: Record<string, unknown> }>,
			components: Record<string, unknown>
		) => void;
		__mountError: (error: unknown) => void;
	}
}

mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

let root: ReactDOM.Root | undefined;
let mermaidCounter = 0;

function getContainer(): HTMLElement {
	let el = document.getElementById("mdx-root");
	if (!el) {
		el = document.createElement("div");
		el.id = "mdx-root";
		document.body.appendChild(el);
	}
	return el;
}

function ErrorPanel({ error }: { error: unknown }) {
	const message = error instanceof Error ? error.message : String(error);
	const stack = error instanceof Error ? error.stack : undefined;
	return React.createElement(
		"div",
		{ className: "mdx-error" },
		React.createElement("strong", null, "MDX render error"),
		React.createElement("pre", null, message + (stack ? "\n\n" + stack : ""))
	);
}

class Boundary extends React.Component<{ children: React.ReactNode }, { error: unknown | null }> {
	state: { error: unknown | null } = { error: null };
	static getDerivedStateFromError(error: unknown) {
		return { error };
	}
	render() {
		if (this.state.error) {
			return React.createElement(ErrorPanel, { error: this.state.error });
		}
		return this.props.children;
	}
}

/** Post-render pass: turns `<pre><code class="language-mermaid">` blocks
 * (that's what rehype-highlight leaves mermaid fences as, since it doesn't
 * recognize the language) into rendered SVG diagrams. Runs after every
 * commit via a wrapper's useEffect, entirely offline. */
function MermaidPass({ children }: { children: React.ReactNode }) {
	const ref = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const blocks = Array.from(el.querySelectorAll("code.language-mermaid"));
		blocks.forEach((codeEl) => {
			const pre = codeEl.closest("pre");
			if (!pre || pre.dataset.mermaidDone) return;
			pre.dataset.mermaidDone = "1";
			const code = codeEl.textContent ?? "";
			const id = `mdx-mermaid-${++mermaidCounter}`;
			mermaid
				.render(id, code)
				.then(({ svg }) => {
					const wrapper = document.createElement("div");
					wrapper.className = "mdx-mermaid";
					wrapper.innerHTML = svg;
					pre.replaceWith(wrapper);
				})
				.catch((err: unknown) => {
					const msg = err instanceof Error ? err.message : String(err);
					const wrapper = document.createElement("div");
					wrapper.className = "mdx-error";
					wrapper.textContent = "Mermaid error: " + msg;
					pre.insertAdjacentElement("afterend", wrapper);
				});
		});
	});

	return React.createElement("div", { ref }, children);
}

window.__React = React;
window.__ReactDOM = ReactDOM;
window.__mdxRuntime = { Fragment, jsx, jsxs };

window.__mount = function mount(Content, components) {
	const container = getContainer();
	if (!root) {
		root = ReactDOM.createRoot(container);
	}
	root.render(
		React.createElement(
			Boundary,
			null,
			React.createElement(MermaidPass, null, React.createElement(Content, { components }))
		)
	);
};

window.__mountError = function mountError(error: unknown) {
	const container = getContainer();
	if (!root) {
		root = ReactDOM.createRoot(container);
	}
	root.render(React.createElement(ErrorPanel, { error }));
};

// --- postMessage bridges to the parent (MdxPreviewView) ---

document.addEventListener(
	"click",
	(e) => {
		const target = e.target as HTMLElement | null;
		const link = target?.closest<HTMLElement>("[data-wikilink]");
		if (!link) return;
		e.preventDefault();
		const path = link.getAttribute("data-wikilink");
		if (path) {
			window.parent.postMessage({ source: "mdx-view", type: "open-link", target: path }, "*");
		}
	},
	true
);

window.addEventListener("message", (event) => {
	const data = event.data as { source?: string; type?: string } | undefined;
	if (data?.source !== "mdx-view") return;
	if (data.type === "request-snapshot") {
		const html = document.getElementById("mdx-root")?.outerHTML ?? "";
		window.parent.postMessage({ source: "mdx-view", type: "snapshot", html }, "*");
	}
});
