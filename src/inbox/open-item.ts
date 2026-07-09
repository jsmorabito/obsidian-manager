import { MarkdownView, Notice, TFile, type App } from "obsidian";
import type { TaggedInboxItem } from "../editor/InboxService";

/** Open a file (by path) in the current leaf, without touching the cursor. */
export async function openInboxFile(app: App, filePath: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) { new Notice(`File not found: ${filePath}`); return; }
	const leaf = app.workspace.getLeaf(false);
	await leaf.openFile(file);
}

/** Open a file at a specific line, placing the cursor there and flashing the line. */
export async function openInboxFileAtLine(app: App, filePath: string, line: number): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) { new Notice(`File not found: ${filePath}`); return; }
	const leaf = app.workspace.getLeaf(false);
	if (!leaf) return;
	await leaf.openFile(file);

	await new Promise<void>((r) => window.setTimeout(r, 100));

	const view = leaf.view;
	if (!(view instanceof MarkdownView)) return;
	const editor = view.editor;
	editor.setCursor({ line, ch: 0 });
	editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);

	const cmView = (editor as unknown as { cm: { state: { doc: { line(n: number): { from: number } } }; domAtPos(pos: number): { node: Node } } }).cm;
	const lineFrom = cmView.state.doc.line(line + 1).from;
	const { node } = cmView.domAtPos(lineFrom);
	const lineEl = (node instanceof HTMLElement ? node : node.parentElement)?.closest(".cm-line") as HTMLElement | null;
	if (lineEl) {
		lineEl.classList.add("tm-tm-inbox-line-flash");
		window.setTimeout(() => lineEl.classList.remove("tm-tm-inbox-line-flash"), 1500);
	}
}

/** Open a tagged inbox item in the current leaf (file or inline occurrence). */
export async function openInboxItem(app: App, item: TaggedInboxItem): Promise<void> {
	if (item.type === "inline") {
		await openInboxFileAtLine(app, item.file.path, item.line);
	} else {
		await openInboxFile(app, item.file.path);
	}
}
