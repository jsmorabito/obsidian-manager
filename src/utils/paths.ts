import { App, normalizePath } from "obsidian";
import type { PeriodicConfig } from "../periodic/types";

// Credit: @creationix/path.js (via liamcain/obsidian-periodic-notes, MIT).
export function join(...partSegments: string[]): string {
	let parts: string[] = [];
	for (let i = 0, l = partSegments.length; i < l; i++) {
		parts = parts.concat(partSegments[i].split("/"));
	}
	const newParts: string[] = [];
	for (let i = 0, l = parts.length; i < l; i++) {
		const part = parts[i];
		if (!part || part === ".") continue;
		newParts.push(part);
	}
	if (parts[0] === "") newParts.unshift("");
	return newParts.join("/");
}

export function basename(fullPath: string): string {
	let base = fullPath.substring(fullPath.lastIndexOf("/") + 1);
	if (base.lastIndexOf(".") !== -1) {
		base = base.substring(0, base.lastIndexOf("."));
	}
	return base;
}

async function ensureFolderExists(app: App, path: string): Promise<void> {
	const dirs = path.replace(/\\/g, "/").split("/");
	dirs.pop();

	if (dirs.length) {
		const dir = join(...dirs);
		if (!app.vault.getAbstractFileByPath(dir)) {
			await app.vault.createFolder(dir);
		}
	}
}

export async function getNoteCreationPath(
	app: App,
	filename: string,
	periodicConfig: PeriodicConfig
): Promise<string> {
	const directory = periodicConfig.folder ?? "";
	const filenameWithExt = !filename.endsWith(".md") ? `${filename}.md` : filename;
	const path = normalizePath(join(directory, filenameWithExt));
	await ensureFolderExists(app, path);
	return path;
}
