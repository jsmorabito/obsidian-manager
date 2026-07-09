import { ItemView, WorkspaceLeaf } from "obsidian";
import type TimeManagerPlugin from "../main";
import { InboxListPanel } from "./InboxListPanel";
import { openInboxItem } from "./open-item";

export const TIME_MANAGER_INBOX_VIEW = "obsidian-time-tools-inbox-view";

export class InboxView extends ItemView {
	private plugin: TimeManagerPlugin;
	private panel: InboxListPanel | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TimeManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return TIME_MANAGER_INBOX_VIEW; }
	getDisplayText(): string { return "Inbox"; }
	getIcon(): string { return "inbox"; }

	async onOpen(): Promise<void> {
		this.panel = new InboxListPanel({
			plugin: this.plugin,
			container: this.contentEl,
			onSelect: (item) => void openInboxItem(this.app, item),
		});
		this.render();

		this.registerDomEvent(document, "click", (e) => {
			this.panel?.handleOutsideClick(e.target as Node);
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
		this.panel?.destroy();
		this.contentEl.empty();
	}

	render(): void {
		this.panel?.render();
	}
}
