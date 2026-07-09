/* eslint-disable @typescript-eslint/no-misused-promises, obsidianmd/ui/sentence-case, obsidianmd/no-static-styles-assignment */
import { Menu, setIcon } from "obsidian";
import type TimeManagerPlugin from "../main";
import { SnoozeModal } from "./SnoozeModal";
import { openInboxItem } from "./open-item";
import type { TaggedInboxItem } from "../editor/InboxService";

/**
 * InboxListPanel — the inbox list (header + sortable/filterable item rows)
 * shared between the sidebar InboxView and the full-tab InboxTabView.
 *
 * Callers own the container element and decide what happens when a row is
 * selected via `onSelect` — the sidebar view navigates the workspace to the
 * file, the tab view shows it in its own preview panel instead.
 */
export class InboxListPanel {
	private plugin: TimeManagerPlugin;
	private container: HTMLElement;
	private onSelect: (item: TaggedInboxItem) => void;
	private isSelected: (item: TaggedInboxItem) => boolean;
	private activePopover: HTMLElement | null = null;
	private activePopoverAnchor: HTMLElement | null = null;

	constructor(opts: {
		plugin: TimeManagerPlugin;
		container: HTMLElement;
		onSelect: (item: TaggedInboxItem) => void;
		isSelected?: (item: TaggedInboxItem) => boolean;
	}) {
		this.plugin = opts.plugin;
		this.container = opts.container;
		this.onSelect = opts.onSelect;
		this.isSelected = opts.isSelected ?? (() => false);
	}

	private get app() { return this.plugin.app; }
	private get inboxService() { return this.plugin.inboxService; }

	destroy(): void {
		this.closePopover();
	}

	render(): void {
		const container = this.container;
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

		const displayBtn = right.createEl("button", { cls: "tm-inbox-icon-btn clickable-icon", attr: { "aria-label": "Display options" } });
		setIcon(displayBtn, "sliders-horizontal");
		if (this.plugin.settings.time.inboxDisplay.sortOrder !== "newest") {
			displayBtn.addClass("tm-inbox-btn-active");
		}
		displayBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			if (this.togglePopoverFor(displayBtn)) this.openDisplayPanel(displayBtn);
		});

		const filterBtn = right.createEl("button", { cls: "tm-inbox-icon-btn clickable-icon", attr: { "aria-label": "Filter" } });
		setIcon(filterBtn, "filter");
		if (this.hasActiveFilters()) {
			filterBtn.addClass("tm-inbox-btn-active");
		}
		filterBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			if (this.togglePopoverFor(filterBtn)) this.openFilterPanel(filterBtn);
		});
	}

	/**
	 * Closes whichever popover is open. Returns true if the caller should now
	 * open its own popover (nothing was open, or a different anchor's was) —
	 * false if this click was on the anchor whose popover just closed, i.e. a
	 * toggle-off, so the caller should not reopen it.
	 */
	private togglePopoverFor(anchor: HTMLElement): boolean {
		const wasOpenForThisAnchor = this.activePopoverAnchor === anchor;
		this.closePopover();
		return !wasOpenForThisAnchor;
	}

	private hasActiveFilters(): boolean {
		const display = this.plugin.settings.time.inboxDisplay;
		return display.inboxTagFilter !== null
			|| display.typeFilter !== "all"
			|| display.readFilter !== "all"
			|| display.folderFilter !== null;
	}

	// ── Body ──────────────────────────────────────────────────────────────────

	/** The current items in display order, after tag/type/read/folder filters and sorting — the same set rendered in the list. */
	getVisibleItems(): TaggedInboxItem[] {
		const display = this.plugin.settings.time.inboxDisplay;
		const activeTags = display.inboxTagFilter ?? this.plugin.settings.time.inboxTags;
		let items = this.inboxService.getInboxItems(activeTags, this.plugin.settings.time.inboxExcludeTags, this.plugin.settings.time.inboxAutoRemoveDone);

		if (display.typeFilter !== "all") {
			items = items.filter((i) => i.type === display.typeFilter);
		}
		if (display.readFilter !== "all") {
			const wantUnread = display.readFilter === "unread";
			items = items.filter((i) => this.isRead(i) !== wantUnread);
		}
		if (display.folderFilter !== null) {
			items = items.filter((i) => (i.file.parent?.path ?? "") === display.folderFilter);
		}

		return this.sortItems(items);
	}

	private renderBody(container: HTMLElement): void {
		const sorted = this.getVisibleItems();

		if (sorted.length === 0) {
			this.renderEmpty(container);
			return;
		}

		for (const item of sorted) {
			this.renderItem(container, item);
		}
	}

	/** Distinct folder paths ("" = vault root) among items matching the current tag filter, for the folder filter section. */
	private availableFolders(): string[] {
		const display = this.plugin.settings.time.inboxDisplay;
		const activeTags = display.inboxTagFilter ?? this.plugin.settings.time.inboxTags;
		const items = this.inboxService.getInboxItems(activeTags, this.plugin.settings.time.inboxExcludeTags, this.plugin.settings.time.inboxAutoRemoveDone);
		const folders = new Set(items.map((i) => i.file.parent?.path ?? ""));
		return Array.from(folders).sort((a, b) => a.localeCompare(b));
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
		if (this.isSelected(item)) row.addClass("is-selected");

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
			this.onSelect(item);
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
			mi.setTitle("Open in new tab");
			mi.setIcon("square-arrow-out-up-right");
			mi.onClick(() => void openInboxItem(this.app, item, true));
		});

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
		const panel = this.container.createEl("div", { cls: "tm-inbox-popover tm-inbox-display-panel" });
		this.positionPopover(panel, anchor);
		this.activePopover = panel;
		this.activePopoverAnchor = anchor;

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
			this.closePopover();
			this.render();
		});
	}

	// ── Filter Panel ──────────────────────────────────────────────────────────

	/** Renders one labelled group of single-select filter options into `panel`. */
	private renderFilterSection(
		panel: HTMLElement,
		label: string,
		options: { text: string; isActive: boolean; onClick: () => void | Promise<void> }[],
	): void {
		const section = panel.createEl("div", { cls: "tm-inbox-filter-section" });
		section.createEl("span", { text: label, cls: "tm-inbox-filter-label" });
		for (const opt of options) {
			const btn = section.createEl("button", {
				cls: "tm-inbox-filter-option" + (opt.isActive ? " is-active" : ""),
				text: opt.text,
			});
			btn.addEventListener("click", async (e) => {
				e.stopPropagation();
				await opt.onClick();
				await this.plugin.saveSettings();
				this.closePopover();
				this.render();
			});
		}
	}

	private openFilterPanel(anchor: HTMLElement): void {
		this.closePopover();

		const configuredTags = this.plugin.settings.time.inboxTags;
		const display = this.plugin.settings.time.inboxDisplay;
		const folders = this.availableFolders();
		const panel = this.container.createEl("div", { cls: "tm-inbox-popover tm-inbox-filter-panel" });
		this.positionPopover(panel, anchor);
		this.activePopover = panel;
		this.activePopoverAnchor = anchor;

		panel.createEl("div", { text: "Filters", cls: "tm-inbox-popover-title" });

		this.renderFilterSection(panel, "Type", [
			{ text: "All",    isActive: display.typeFilter === "all",    onClick: () => { display.typeFilter = "all"; } },
			{ text: "Files",  isActive: display.typeFilter === "file",   onClick: () => { display.typeFilter = "file"; } },
			{ text: "Inline", isActive: display.typeFilter === "inline", onClick: () => { display.typeFilter = "inline"; } },
		]);

		this.renderFilterSection(panel, "Status", [
			{ text: "All",    isActive: display.readFilter === "all",    onClick: () => { display.readFilter = "all"; } },
			{ text: "Unread", isActive: display.readFilter === "unread", onClick: () => { display.readFilter = "unread"; } },
			{ text: "Read",   isActive: display.readFilter === "read",   onClick: () => { display.readFilter = "read"; } },
		]);

		if (configuredTags.length > 1) {
			this.renderFilterSection(panel, "Tag", [
				{ text: "All", isActive: !display.inboxTagFilter, onClick: () => { display.inboxTagFilter = null; } },
				...configuredTags.map((tag) => ({
					text: "#" + tag,
					isActive: display.inboxTagFilter?.length === 1 && display.inboxTagFilter[0] === tag,
					onClick: () => { display.inboxTagFilter = [tag]; },
				})),
			]);
		}

		if (folders.length > 1) {
			this.renderFilterSection(panel, "Folder", [
				{ text: "All", isActive: display.folderFilter === null, onClick: () => { display.folderFilter = null; } },
				...folders.map((folder) => ({
					text: folder === "" ? "(Root)" : folder,
					isActive: display.folderFilter === folder,
					onClick: () => { display.folderFilter = folder; },
				})),
			]);
		}

		if (this.hasActiveFilters()) {
			const clearSection = panel.createEl("div", { cls: "tm-inbox-filter-section" });
			const clearBtn = clearSection.createEl("button", { cls: "tm-inbox-filter-option tm-inbox-filter-clear", text: "Clear all filters" });
			clearBtn.addEventListener("click", async (e) => {
				e.stopPropagation();
				display.inboxTagFilter = null;
				display.typeFilter = "all";
				display.readFilter = "all";
				display.folderFilter = null;
				await this.plugin.saveSettings();
				this.closePopover();
				this.render();
			});
		}
	}

	private positionPopover(panel: HTMLElement, anchor: HTMLElement): void {
		const rect = anchor.getBoundingClientRect();
		const containerRect = this.container.getBoundingClientRect();
		panel.style.position = "absolute";
		panel.style.top = (rect.bottom - containerRect.top + 4) + "px";
		panel.style.right = (containerRect.right - rect.right) + "px";
		panel.style.setProperty("z-index", "var(--layer-menu)");
	}

	private closePopover(): void {
		if (this.activePopover) {
			this.activePopover.remove();
			this.activePopover = null;
			this.activePopoverAnchor = null;
		}
	}

	/** Close any open popover if `target` is outside it. Call from a document click listener. */
	handleOutsideClick(target: Node): void {
		if (this.activePopover && !this.activePopover.contains(target)) {
			this.closePopover();
		}
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
