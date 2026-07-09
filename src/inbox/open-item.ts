import { MarkdownView, Notice, TFile, type App, type Editor } from "obsidian";
import type { TaggedInboxItem } from "../editor/InboxService";

/** Places the cursor at `line`, scrolls it into view, and briefly flashes it — used when navigating to an inline #inbox tag. */
export function scrollAndFlashLine(editor: Editor, line: number): void {
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

/** Open a file (by path), without touching the cursor. */
export async function openInboxFile(app: App, filePath: string, newLeaf = false): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) { new Notice(`File not found: ${filePath}`); return; }
	const leaf = app.workspace.getLeaf(newLeaf);
	await leaf.openFile(file);
}

/** Open a file at a specific line, placing the cursor there and flashing the line. */
export async function openInboxFileAtLine(app: App, filePath: string, line: number, newLeaf = false): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) { new Notice(`File not found: ${filePath}`); return; }
	const leaf = app.workspace.getLeaf(newLeaf);
	if (!leaf) return;
	await leaf.openFile(file);

	await new Promise<void>((r) => window.setTimeout(r, 100));

	const view = leaf.view;
	if (!(view instanceof MarkdownView)) return;
	scrollAndFlashLine(view.editor, line);
}

/** Open a tagged inbox item (file or inline occurrence), optionally in a new tab. */
export async function openInboxItem(app: App, item: TaggedInboxItem, newLeaf = false): Promise<void> {
	if (item.type === "inline") {
		await openInboxFileAtLine(app, item.file.path, item.line, newLeaf);
	} else {
		await openInboxFile(app, item.file.path, newLeaf);
	}
}
