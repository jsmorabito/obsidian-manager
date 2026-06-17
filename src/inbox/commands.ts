 
import { Notice, TFile } from "obsidian";
import type TimeManagerPlugin from "../main";
import { InboxService } from "../editor/InboxService";

export function registerInboxCommands(plugin: TimeManagerPlugin): void {
	const inboxService = new InboxService(plugin.app);

	plugin.addCommand({
		id: "open-inbox",
		name: "Open inbox",
		callback: () => plugin.openInboxView(),
	});

	// Adds #inbox to the active file's frontmatter tags
	plugin.addCommand({
		id: "add-file-to-inbox",
		name: "Add file to inbox",
		checkCallback: (checking) => {
			const file = plugin.app.workspace.getActiveFile();
			if (!file) return false;
			if (!checking) {
				void inboxService.addInboxTag(file, plugin.settings.time.inboxTags).then(() => {
					new Notice(`Added "${file.basename}" to inbox`);
					plugin.refreshInboxView();
				});
			}
			return true;
		},
	});
}

export function addInboxFileMenuItem(plugin: TimeManagerPlugin): void {
	const inboxService = new InboxService(plugin.app);

	plugin.registerEvent(
		plugin.app.workspace.on("file-menu", (menu, abstractFile) => {
			if (!(abstractFile instanceof TFile)) return;
			const file = abstractFile;

			menu.addItem((item) => {
				item.setTitle("Add to inbox");
				item.setIcon("inbox");
				item.onClick(() => {
					void inboxService.addInboxTag(file, plugin.settings.time.inboxTags).then(() => {
						new Notice(`Added "${file.basename}" to inbox`);
						plugin.refreshInboxView();
					});
				});
			});
		})
	);
}
