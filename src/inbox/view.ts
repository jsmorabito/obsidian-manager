/* eslint-disable @typescript-eslint/no-misused-promises, obsidianmd/ui/sentence-case, obsidianmd/no-static-styles-assignment */
import { ItemView, MarkdownView, Menu, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type TimeManagerPlugin from "../main";
import { SnoozeModal } from "./SnoozeModal";
import { InboxService } from "../editor/InboxService";
import type { TaggedInboxItem } from "../editor/InboxService";

export const TIME_MANAGER_INBOX_VIEW = "obsidian-time-tools-inbox-view";

export class InboxView extends ItemView {
	private plugin: TimeManagerPlugin;
	private inboxService: InboxService;
	private activePopover: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TimeManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
		// Reuse the singleton on the plugin — do not create a second instance.
		this.inboxService = plugin.inboxService;
	}

	getViewType(): string { return TIME_MANAGER_INBOX_VIEW; }
	getDisplayText(): string { return "Inbox"; }
	getIcon(): string { return "inbox"; }

	async onOpen(): Promise<void> {
		this.render();

		this.registerDomEvent(document, "click", (e) => {
			if (this.activePopover && !this.activePopover.contains(e.target as Node)) {
				this.closePopover();
			}
		});

		let _refreshTimer: number | undefined;
		const scheduleRefresh = () => {
			window.clearTimeout(_refreshTimer);
			_refreshTimer = window.setTimeout(() => this.render(), 200);
		};
		this.registerEvent(this.app.vault.on("modify", scheduleRefresh));
		this.registerEvent(this.app.metadataCache.on("changed", scheduleRefresh));
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("tm-inbox-container");
		this.renderHeader(container);
		this.renderBody(container);
	}

	// ── Header ────────────────────────────────────────────────────────────────

	private renderHeader(container: HTMLElement): void {
		const header = container.createEl("div", { cls: "tm-inbox-header" });

		const left = header.createEl("div", { cls: "tm-inbox-header-left" });
		const iconEl = left.createEl("div", { cls: "tm-inbox-header-icon" });
		setIcon(iconEl, "inbox");
		left.createEl("span", { text: "Inbox", cls: "tm-inbox-title" });

		const allItems = this.inboxService.getInboxItems(
			this.plugin.settings.time.inboxTags,
			this.plugin.settings.time.inboxExcludeTags,
			this.plugin.settings.time.inboxAutoRemoveDone,
		);
		const unreadCount = allItems.filter((i) => !this.isRead(i)).length;
		if (unreadCount > 0) {
			left.createEl("span", { text: String(unreadCount), cls: "tm-inbox-badge" });
		}

		const right = header.createEl("div", { cls: "tm-inbox-header-right" });

		const displayBtn = right.createEl("button", { cls: "tm-inbox-icon-btn", attr: { "aria-label": "Display options" } });
		setIcon(displayBtn, "sliders-horizontal");
		if (this.plugin.settings.time.inboxDisplay.sortOrder !== "newest") {
			displayBtn.addClass("tm-inbox-btn-active");
		}
		displayBtn.addEventListener("click", (e) => { e.stopPropagation(); this.openDisplayPanel(displayBtn); });

		if (this.plugin.settings.time.inboxTags.length > 1) {
			const filterBtn = right.createEl("button", { cls: "tm-inbox-icon-btn", attr: { "aria-label": "Filter" } });
			setIcon(filterBtn, "filter");
			if (this.plugin.settings.time.inboxDisplay.inboxTagFilter) {
				filterBtn.addClass("tm-inbox-btn-active");
			}
			filterBtn.addEventListener("click", (e) => { e.stopPropagation(); this.openFilterPanel(filterBtn); });
		}
	}

	// ── Body ──────────────────────────────────────────────────────────────────

	private renderBody(container: HTMLElement): void {
		const activeTags = this.plugin.settings.time.inboxDisplay.inboxTagFilter ?? this.plugin.settings.time.inboxTags;
		const items = this.inboxService.getInboxItems(activeTags, this.plugin.settings.time.inboxExcludeTags, this.plugin.settings.time.inboxAutoRemoveDone);

		if (items.length === 0) {
			this.renderEmpty(container);
			return;
		}

		const sorted = this.sortItems(items);
		for (const item of sorted) {
			this.renderItem(container, item);
		}
	}

	private sortItems(items: TaggedInboxItem[]): TaggedInboxItem[] {
		const order = this.plugin.settings.time.inboxDisplay.sortOrder;
		return [...items].sort((a, b) => {
			switch (order) {
				case "oldest": return a.file.stat.mtime - b.file.stat.mtime;
				case "name":   return a.file.basename.localeCompare(b.file.basename);
				case "newest":
				default:       return b.file.stat.mtime - a.file.stat.mtime;
			}
		});
	}

	private renderEmpty(container: HTMLElement): void {
		const empty = container.createEl("div", { cls: "tm-inbox-empty" });
		const iconEl = empty.createEl("div", { cls: "tm-inbox-empty-icon" });
		setIcon(iconEl, "inbox");
		empty.createEl("p", { text: "Your inbox is empty.", cls: "tm-inbox-empty-title" });
		empty.createEl("p", {
			text: 'Run "Add file to inbox" or tag any line with #inbox.',
			cls: "tm-inbox-empty-sub",
		});
	}

	// ── Read tracking ─────────────────────────────────────────────────────────

	private itemKey(item: TaggedInboxItem): string {
		return item.type === "inline" ? `${item.file.path}:${item.line}` : item.file.path;
	}

	private isRead(item: TaggedInboxItem): boolean {
		return this.plugin.settings.time.readTaggedItems.includes(this.itemKey(item));
	}

	private async markRead(item: TaggedInboxItem): Promise<void> {
		const key = this.itemKey(item);
		if (!this.plugin.settings.time.readTaggedItems.includes(key)) {
			this.plugin.settings.time.readTaggedItems.push(key);
			await this.plugin.saveSettings();
		}
	}

	// ── Item Row ──────────────────────────────────────────────────────────────

	private renderItem(container: HTMLElement, item: TaggedInboxItem): void {
		const isRead = this.isRead(item);
		const row = container.createEl("div", { cls: "tm-inbox-item" });

		row.createEl("div", { cls: "tm-inbox-unread-dot" + (isRead ? "" : " is-unread") });

		const fileIcon = row.createEl("div", { cls: "tm-inbox-item-icon" });
		setIcon(fileIcon, item.type === "inline" ? "text" : "file-text");

		const content = row.createEl("div", { cls: "tm-inbox-item-content" });
		content.createEl("div", { cls: "tm-inbox-item-name", text: item.file.basename }).title = item.file.path;

		if (item.type === "inline") {
			const lineEl = content.createEl("div", { cls: "tm-inbox-item-line", text: "…" });
			void this.app.vault.cachedRead(item.file).then((txt) => {
				const lines = txt.split("\n");
				lineEl.setText(lines[item.line] ?? "");
			});
		}

		const rightEl = row.createEl("div", { cls: "tm-inbox-item-right" });
		rightEl.createEl("span", {
			cls: "tm-inbox-item-age",
			text: formatRelativeAge(item.addedAt),
			attr: { "aria-label": new Date(item.addedAt).toLocaleString() },
		});

		const actionsEl = rightEl.createEl("div", { cls: "tm-inbox-item-actions" });
		const moreBtn = actionsEl.createEl("button", {
			cls: "tm-inbox-item-more-btn",
			attr: { "aria-label": "Item actions" },
		});
		setIcon(moreBtn, "more-horizontal");
		moreBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.openItemMenu(e, item);
		});

		row.addEventListener("click", (e) => {
			if ((e.target as HTMLElement).closest(".tm-inbox-item-right")) return;
			void this.markRead(item).then(() => this.render());
			if (item.type === "inline") {
				void this.openFileAtLine(item.file.path, item.line);
			} else {
				void this.openFile(item.file.path);
			}
		});

		row.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			this.openItemMenu(e, item);
		});
	}

	// ── Item Menu ─────────────────────────────────────────────────────────────

	private openItemMenu(e: MouseEvent, item: TaggedInboxItem): void {
		const menu = new Menu();
		const isRead = this.isRead(item);

		menu.addItem((mi) => {
			mi.setTitle(isRead ? "Mark as unread" : "Mark as read");
			mi.setIcon(isRead ? "circle" : "check");
			mi.onClick(async () => {
				if (isRead) {
					const key = this.itemKey(item);
					this.plugin.settings.time.readTaggedItems = this.plugin.settings.time.readTaggedItems.filter((k) => k !== key);
					await this.plugin.saveSettings();
				} else {
					await this.markRead(item);
				}
				this.render();
			});
		});

		menu.addItem((mi) => {
			mi.setTitle("Snooze");
			mi.setIcon("clock");
			mi.onClick(() => {
				new SnoozeModal(this.app, async (remindAt) => {
					await this.inboxService.snoozeItem(item.file, remindAt);
					this.render();
				}).open();
			});
		});

		menu.addItem((mi) => {
			mi.setTitle("Dismiss");
			mi.setIcon("x");
			mi.onClick(async () => {
				if (item.type === "inline") {
					await this.inboxService.clearInlineItem(item);
				} else {
					await this.inboxService.clearFileItem(item, this.plugin.settings.time.inboxTags);
				}
				this.render();
			});
		});

		menu.showAtMouseEvent(e);
	}

	// ── Display Panel ─────────────────────────────────────────────────────────

	private openDisplayPanel(anchor: HTMLElement): void {
		this.closePopover();

		const display = this.plugin.settings.time.inboxDisplay;
		const panel = this.contentEl.createEl("div", { cls: "tm-inbox-popover tm-inbox-display-panel" });
		this.positionPopover(panel, anchor);
		this.activePopover = panel;

		const orderRow = panel.createEl("div", { cls: "tm-inbox-display-row" });
		orderRow.createEl("span", { text: "Sort by", cls: "tm-inbox-display-label" });
		const orderSelect = orderRow.createEl("select", { cls: "tm-inbox-display-select" });

		const sortOptions: { value: string; label: string }[] = [
			{ value: "newest", label: "Newest" },
			{ value: "oldest", label: "Oldest" },
			{ value: "name",   label: "Name" },
		];
		for (const opt of sortOptions) {
			const el = orderSelect.createEl("option", { value: opt.value, text: opt.label });
			if (display.sortOrder === opt.value) el.selected = true;
		}
		orderSelect.addEventListener("change", async (e) => {
			e.stopPropagation();
			display.sortOrder = (e.target as HTMLSelectElement).value as typeof display.sortOrder;
			await this.plugin.saveSettings();
			this.render();
		});
	}

	// ── Filter Panel ──────────────────────────────────────────────────────────

	private openFilterPanel(anchor: HTMLElement): void {
		this.closePopover();

		const configuredTags = this.plugin.settings.time.inboxTags;
		const display = this.plugin.settings.time.inboxDisplay;
		const panel = this.contentEl.createEl("div", { cls: "tm-inbox-popover tm-inbox-filter-panel" });
		this.positionPopover(panel, anchor);
		this.activePopover = panel;

		panel.createEl("div", { text: "Filter by tag", cls: "tm-inbox-popover-title" });

		const allOpt = panel.createEl("button", {
			cls: "tm-inbox-filter-option" + (!display.inboxTagFilter ? " is-active" : ""),
			text: "All",
		});
		allOpt.addEventListener("click", async (e) => {
			e.stopPropagation();
			display.inboxTagFilter = null;
			await this.plugin.saveSettings();
			this.closePopover();
			this.render();
		});

		for (const tag of configuredTags) {
			const isActive = display.inboxTagFilter?.length === 1 && display.inboxTagFilter[0] === tag;
			const opt = panel.createEl("button", {
				cls: "tm-inbox-filter-option" + (isActive ? " is-active" : ""),
				text: "#" + tag,
			});
			opt.addEventListener("click", async (e) => {
				e.stopPropagation();
				display.inboxTagFilter = [tag];
				await this.plugin.saveSettings();
				this.closePopover();
				this.render();
			});
		}
	}

	private positionPopover(panel: HTMLElement, anchor: HTMLElement): void {
		const rect = anchor.getBoundingClientRect();
		const containerRect = this.contentEl.getBoundingClientRect();
		panel.style.position = "absolute";
		panel.style.top = (rect.bottom - containerRect.top + 4) + "px";
		panel.style.right = (containerRect.right - rect.right) + "px";
		panel.style.setProperty("z-index", "var(--layer-menu)");
	}

	private closePopover(): void {
		if (this.activePopover) {
			this.activePopover.remove();
			this.activePopover = null;
		}
	}

	// ── File helpers ──────────────────────────────────────────────────────────

	private async openFileAtLine(filePath: string, line: number): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) { new Notice(`File not found: ${filePath}`); return; }
		const leaf = this.app.workspace.getLeaf(false);
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

	private async openFile(filePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) { new Notice(`File not found: ${filePath}`); return; }
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}
}

function formatRelativeAge(ctimeMs: number): string {
	const diffMs = Date.now() - ctimeMs;
	const mins = Math.floor(diffMs / 60_000);
	if (mins < 60) return `${Math.max(1, mins)}m`;
	const hours = Math.floor(diffMs / 3_600_000);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(diffMs / 86_400_000);
	if (days < 7) return `${days}d`;
	const weeks = Math.floor(days / 7);
	if (weeks < 5) return `${weeks}w`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo`;
	return `${Math.floor(months / 12)}y`;
}
