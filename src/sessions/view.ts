/* eslint-disable @typescript-eslint/no-unsafe-call */
import { ItemView, WorkspaceLeaf } from "obsidian";
import type TimeManagerPlugin from "../main";
import SessionsViewSvelte from "./SessionsView.svelte";

export const TIME_MANAGER_SESSIONS_VIEW = "obsidian-time-tools-sessions-view";

export class SessionsView extends ItemView {
	plugin: TimeManagerPlugin;
	private svelteView: SessionsViewSvelte | undefined;

	constructor(leaf: WorkspaceLeaf, plugin: TimeManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return TIME_MANAGER_SESSIONS_VIEW;
	}

	getDisplayText(): string {
		return "Sessions";
	}

	getIcon(): string {
		return "clipboard-clock";
	}

	async onOpen(): Promise<void> {
		this.svelteView = new SessionsViewSvelte({
			target: this.contentEl,
			props: {
				plugin: this.plugin,
				sessionManager: this.plugin.sessionManager,
			},
		});
	}

	async onClose(): Promise<void> {
		this.svelteView?.$destroy();
		this.svelteView = undefined;
	}

	/** Refresh the file list — called after settings change. */
	public refresh(): void {
		this.svelteView?.refresh();
	}
}
