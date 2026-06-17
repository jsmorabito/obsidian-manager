/**
 * Modals for picking a folder or tag to use as the editor's selection target.
 */
import { App, FuzzySuggestModal, TFolder } from "obsidian";

// ── Folder picker ─────────────────────────────────────────────────────────────

export class SelectFolderModal extends FuzzySuggestModal<TFolder> {
	private onChoose: (folder: TFolder) => void;

	constructor(app: App, onChoose: (folder: TFolder) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder("Type a folder name…");
	}

	getItems(): TFolder[] {
		const folders: TFolder[] = [];
		const recurse = (folder: TFolder) => {
			folders.push(folder);
			for (const child of folder.children) {
				if (child instanceof TFolder) recurse(child);
			}
		};
		recurse(this.app.vault.getRoot());
		// Remove root itself (empty path), keep everything else.
		return folders.filter((f) => f.path !== "/");
	}

	getItemText(folder: TFolder): string {
		return folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onChoose(folder);
	}
}

// ── Tag picker ────────────────────────────────────────────────────────────────

interface TagEntry {
	tag: string;
	count: number;
}

export class SelectTagModal extends FuzzySuggestModal<TagEntry> {
	private onChoose: (tag: string) => void;

	constructor(app: App, onChoose: (tag: string) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder("Type a tag (without #)…");
	}

	getItems(): TagEntry[] {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		const tagCache: Record<string, number> = (this.app as any).metadataCache?.getTags?.() ?? {};
		return Object.entries(tagCache)
			.map(([tag, count]) => ({ tag: tag.replace(/^#/, ""), count }))
			.sort((a, b) => b.count - a.count);
	}

	getItemText(entry: TagEntry): string {
		return entry.tag;
	}

	renderSuggestion(match: { item: TagEntry }, el: HTMLElement): void {
		el.createSpan({ text: match.item.tag });
		el.createSpan({ text: ` (${match.item.count})`, cls: "tm-tag-count" });
	}

	onChooseItem(entry: TagEntry): void {
		this.onChoose(entry.tag);
	}
}
