/**
 * Migration from Obsidian's built-in Daily Notes core plugin.
 *
 * On first load, if the core plugin has a format/folder/template configured
 * and Obsidian Time Tools' daily settings are still at defaults, we offer to import
 * them. We only ask once (guarded by settings.migratedFromDailyNotes).
 */
import { Modal, Notice, Setting } from "obsidian";
import type TimeManagerPlugin from "../main";
import { DEFAULT_DAILY_NOTE_FORMAT } from "./constants";

interface CoreDailyNotesConfig {
	format?: string;
	folder?: string;
	template?: string;
}

// Obsidian stores core plugin settings in app.internalPlugins, which isn't part
// of the public API.
interface AppWithInternalPlugins {
	internalPlugins?: {
		plugins?: Record<
			string,
			{
				enabled?: boolean;
				instance?: {
					options?: { format?: string; folder?: string; template?: string };
				};
			}
		>;
	};
}

function readCoreConfig(plugin: TimeManagerPlugin): CoreDailyNotesConfig | null {
	try {
		const internal = (plugin.app as unknown as AppWithInternalPlugins).internalPlugins;
		const dailyNotes = internal?.plugins?.["daily-notes"];
		if (!dailyNotes?.enabled) return null;
		const instance = dailyNotes.instance;
		if (!instance) return null;

		const config: CoreDailyNotesConfig = {};
		if (instance.options?.format)   config.format   = instance.options.format;
		if (instance.options?.folder)   config.folder   = instance.options.folder;
		if (instance.options?.template) config.template = instance.options.template;
		return config;
	} catch {
		return null;
	}
}

export async function maybeMigrateFromDailyNotesCore(
	plugin: TimeManagerPlugin
): Promise<void> {
	if (plugin.settings.time.migratedFromDailyNotes) return;

	const core = readCoreConfig(plugin);
	if (!core) {
		// Core plugin not enabled or not found — mark done so we don't check again.
		plugin.settings.time.migratedFromDailyNotes = true;
		await plugin.saveSettings();
		return;
	}

	// Only offer if there's something useful to import.
	const hasContent = core.format || core.folder || core.template;
	if (!hasContent) {
		plugin.settings.time.migratedFromDailyNotes = true;
		await plugin.saveSettings();
		return;
	}

	// Check if Obsidian Time Tools' daily config is still default (don't clobber manual config).
	const day = plugin.settings.time.day;
	const isDefault =
		day.format === DEFAULT_DAILY_NOTE_FORMAT && !day.folder && !day.templatePath;
	if (!isDefault) {
		plugin.settings.time.migratedFromDailyNotes = true;
		await plugin.saveSettings();
		return;
	}

	new MigrationModal(plugin, core).open();
}

class MigrationModal extends Modal {
	constructor(
		private plugin: TimeManagerPlugin,
		private core: CoreDailyNotesConfig
	) {
		super(plugin.app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Import Daily Notes settings" });
		contentEl.createEl("p", {
			text:
				"Obsidian Time Tools found your existing Daily Notes core plugin configuration. " +
				"Would you like to import it so your notes are found correctly?",
		});

		const details: string[] = [];
		if (this.core.format)   details.push(`Format: ${this.core.format}`);
		if (this.core.folder)   details.push(`Folder: ${this.core.folder}`);
		if (this.core.template) details.push(`Template: ${this.core.template}`);

		contentEl.createEl("pre", { text: details.join("\n") });

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Import")
					.setCta()
					.onClick(async () => {
						if (this.core.format)   this.plugin.settings.time.day.format       = this.core.format;
						if (this.core.folder)   this.plugin.settings.time.day.folder       = this.core.folder;
						if (this.core.template) this.plugin.settings.time.day.templatePath = this.core.template;
						this.plugin.settings.time.migratedFromDailyNotes = true;
						await this.plugin.saveSettings();
						new Notice("Obsidian Time Tools: Daily Notes settings imported.");
						this.close();
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Skip").onClick(async () => {
					this.plugin.settings.time.migratedFromDailyNotes = true;
					await this.plugin.saveSettings();
					this.close();
				})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
