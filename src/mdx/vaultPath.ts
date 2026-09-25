/** Vault-relative path utilities. Deliberately avoids Node's `path` module
 * (not available on mobile) — everything here is plain string handling. */

export function dirname(path: string): string {
	const idx = path.lastIndexOf("/");
	return idx === -1 ? "" : path.slice(0, idx);
}

/** Joins a base directory with a relative path, resolving "./" and "../". */
export function joinVaultPath(baseDir: string, rel: string): string {
	if (/^[a-z]+:\/\//i.test(rel) || rel.startsWith("data:")) return rel; // absolute URL/data URI, leave alone

	const isRelative = rel.startsWith("./") || rel.startsWith("../");
	const segments = (isRelative ? `${baseDir}/${rel}` : rel).split("/");
	const out: string[] = [];
	for (const seg of segments) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") {
			out.pop();
			continue;
		}
		out.push(seg);
	}
	return out.join("/");
}

const EXT_TO_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	svg: "image/svg+xml",
	webp: "image/webp",
	bmp: "image/bmp",
	avif: "image/avif",
};

export const IMAGE_EXTENSIONS = new Set(Object.keys(EXT_TO_MIME));

export function extensionOf(path: string): string {
	const idx = path.lastIndexOf(".");
	return idx === -1 ? "" : path.slice(idx + 1).toLowerCase();
}

export function isImagePath(path: string): boolean {
	return IMAGE_EXTENSIONS.has(extensionOf(path));
}

export function mimeForExtension(ext: string): string {
	return EXT_TO_MIME[ext.toLowerCase()] ?? "application/octet-stream";
}

export function isAbsoluteOrDataUrl(url: string): boolean {
	return /^[a-z]+:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("#");
}

/** Plain directory + filename join — unlike joinVaultPath (which treats a
 * bare filename as already vault-root-relative, by design, for resolving
 * import/image specifiers), this always prefixes with dir when present. */
export function joinPath(dir: string, name: string): string {
	return dir ? `${dir}/${name}` : name;
}
