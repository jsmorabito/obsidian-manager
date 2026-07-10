 
import { ItemView, Notice, setIcon, WorkspaceLeaf } from "obsidian";
import type TimeManagerPlugin from "../main";
import { InboxListPanel } from "./InboxListPanel";
import { openInboxItem } from "./open-item";
import { SnoozePopover } from "./SnoozePopover";
import { EmbeddedLeaf } from "./EmbeddedLeaf";
import { Toast } from "./Toast";
import type { TaggedInboxItem } from "../editor/InboxService";

export const TIME_MANAGER_INBOX_TAB_VIEW = "obsidian-time-tools-inbox-tab-view";

function itemKey(item: TaggedInboxItem): string {
	return item.type === "inline" ? `${item.file.path}:${item.line}` : item.file.path;
}

/**
 * InboxTabView — inbox opened as a main-area tab.
 *
 * Left: the same inbox list as the sidebar InboxView (via InboxListPanel).
 * Right: a real, live-editable view of whichever item is selected, embedded
 * via EmbeddedLeaf — a detached WorkspaceLeaf attached into our own DOM
 * (see EmbeddedLeaf.ts), so the editor stays fully contained inside this
 * tab rather than opening as a separate workspace pane.
 */
export class InboxTabView extends ItemView {
	private plugin: TimeManagerPlugin;
	private listPanel: InboxListPanel | null = null;
	private selected: TaggedInboxItem | null = null;
	private embeddedLeaf: EmbeddedLeaf | null = null;
	private lastRemoval: { item: TaggedInboxItem; content: string } | null = null;
	private activeToast: Toast | null = null;
	private sidebarEl!: HTMLElement;
	private mainEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: TimeManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return TIME_MANAGER_INBOX_TAB_VIEW; }
	getDisplayText(): string { return "Inbox"; }
	getIcon(): string { return "inbox"; }

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("tm-inbox-tab");

		this.sidebarEl = root.createDiv({ cls: "tm-inbox-tab-sidebar" });
		this.mainEl = root.createDiv({ cls: "tm-inbox-tab-main" });

		this.listPanel = new InboxListPanel({
			plugin: this.plugin,
			container: this.sidebarEl,
			onSelect: (item) => this.selectItem(item),
			isSelected: (item) => this.selected !== null && itemKey(item) === itemKey(this.selected),
		});
		this.listPanel.render();
		this.renderMain();

		this.registerDomEvent(document, "click", (e) => {
			this.listPanel?.handleOutsideClick(e.target as Node);
		});

		this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
			if (!this.lastRemoval) return;
			const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z";
			if (!isUndo) return;
			// Let the embedded editor handle its own undo when it has focus.
			if ((e.target as HTMLElement)?.closest?.(".tm-inbox-tab-embed")) return;
			e.preventDefault();
			void this.undoLastRemoval();
		});

		// Only the sidebar list refreshes on vault changes. Rebuilding the main
		// panel here too would tear down (and steal focus from) the live embedded
		// editor on every keystroke, since editing the open file itself fires
		// these same "modify" events.
		let _refreshTimer: number | undefined;
		const scheduleListRefresh = () => {
			window.clearTimeout(_refreshTimer);
			_refreshTimer = window.setTimeout(() => this.listPanel?.render(), 200);
		};
		this.registerEvent(this.app.vault.on("modify", scheduleListRefresh));
		this.registerEvent(this.app.metadataCache.on("changed", scheduleListRefresh));
	}

	async onClose(): Promise<void> {
		this.listPanel?.destroy();
		this.embeddedLeaf?.detach();
		this.contentEl.empty();
	}

	private selectItem(item: TaggedInboxItem): void {
		this.selected = item;
		this.listPanel?.render();
		this.renderMain();
	}

	/** Removes `item` from the inbox and selects whichever item now takes its place in the list (or the previous one if it was last). */
	private async dismissAndAdvance(item: TaggedInboxItem): Promise<void> {
		const visible = this.listPanel?.getVisibleItems() ?? [];
		const idx = visible.findIndex((i) => itemKey(i) === itemKey(item));
		const next = idx >= 0 ? (visible[idx + 1] ?? visible[idx - 1] ?? null) : null;

		// Snapshot the exact file content so a Ctrl/Cmd+Z can restore it byte-for-byte,
		// regardless of how the tag removal itself rewrote the file.
		const content = await this.app.vault.read(item.file);
		this.lastRemoval = { item, content };

		if (item.type === "inline") {
			await this.plugin.inboxService.clearInlineItem(item);
		} else {
			await this.plugin.inboxService.clearFileItem(item, this.plugin.settings.time.inboxTags);
		}

		this.activeToast?.dismiss();
		this.activeToast = new Toast(
			`Removed "${item.file.basename}" from inbox.`,
			"Undo",
			() => void this.undoLastRemoval(),
		);

		this.selected = next;
		this.listPanel?.render();
		this.renderMain();
	}

	private async undoLastRemoval(): Promise<void> {
		const pending = this.lastRemoval;
		if (!pending) return;
		this.lastRemoval = null;
		this.activeToast?.dismiss();
		this.activeToast = null;

		await this.app.vault.modify(pending.item.file, pending.content);
		new Notice(`Restored "${pending.item.file.basename}" to the inbox.`);
		this.selectItem(pending.item);
	}

	private renderMain(): void {
		const container = this.mainEl;
		container.empty();

		if (!this.selected) {
			const empty = container.createDiv({ cls: "tm-inbox-tab-empty" });
			const iconEl = empty.createDiv({ cls: "tm-inbox-tab-empty-icon" });
			setIcon(iconEl, "mouse-pointer-click");
			empty.createEl("p", { text: "Select an item from the inbox to preview it.", cls: "tm-inbox-tab-empty-title" });
			return;
		}

		const item = this.selected;

		const header = container.createDiv({ cls: "tm-inbox-tab-main-header" });
		const titleWrap = header.createDiv({ cls: "tm-inbox-tab-main-title-wrap" });
		const fileIcon = titleWrap.createSpan({ cls: "tm-inbox-tab-main-file-icon" });
		setIcon(fileIcon, "file-text");
		titleWrap.createSpan({ text: item.file.basename, cls: "tm-inbox-tab-main-title" });
		if (item.type === "inline") {
			titleWrap.createSpan({ text: item.tag, cls: "tm-inbox-tab-main-tag" });
		}

		const actions = header.createDiv({ cls: "tm-inbox-tab-main-actions" });

		const snoozeBtn = actions.createEl("button", { cls: "tm-inbox-icon-btn clickable-icon", attr: { "aria-label": "Snooze" } });
		setIcon(snoozeBtn, "clock");
		snoozeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			SnoozePopover.show(this.plugin, item.file, snoozeBtn, () => {
				// Snoozed items drop out of getInboxItems() — clear the now-stale selection.
				this.selected = null;
				this.listPanel?.render();
				this.renderMain();
			});
		});

		const removeBtn = actions.createEl("button", { cls: "tm-inbox-icon-btn clickable-icon", attr: { "aria-label": "Remove from inbox" } });
		setIcon(removeBtn, "delete");
		removeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.dismissAndAdvance(item);
		});

		const openBtn = actions.createEl("button", { cls: "tm-inbox-tab-open-btn mod-cta", text: "Open" });
		openBtn.addEventListener("click", () => void openInboxItem(this.app, item));

		const embedEl = container.createDiv({ cls: "tm-inbox-tab-embed" });
		if (!this.embeddedLeaf) this.embeddedLeaf = new EmbeddedLeaf(this.app);
		this.embeddedLeaf.attachTo(embedEl);
		void this.embeddedLeaf.openFile(item.file, item.type === "inline" ? item.line : undefined);
	}
}
