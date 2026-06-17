 
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
/**
 * Quick-switcher integrations.
 *
 * - Related-files switcher: shows all periodic notes related to the active file
 *   (same granularity, sorted by proximity to the active date).
 * - File-options switcher: shows actions for the active periodic note
 *   (open, create next/prev, reveal in explorer).
 */
import { App, FuzzySuggestModal, SuggestModal, TFile } from "obsidian";
import type TimeManagerPlugin from "../main";
import { findInPeriodic, openPeriodicNote } from "./api";
import { findPeriodicNotes } from "./discovery";
import { displayConfigs } from "./types";
import type { Granularity } from "./types";
import { addHalfYears } from "./half-year";
// eslint-disable-next-line no-restricted-imports
import type moment from "moment";

// ── Related-files switcher ────────────────────────────────────────────────────

interface RelatedFile {
	file: TFile;
	label: string;
}

class RelatedFilesSwitcher extends FuzzySuggestModal<RelatedFile> {
	constructor(
		app: App,
		private plugin: TimeManagerPlugin,
		private granularity: Granularity
	) {
		super(app);
		this.setPlaceholder(`Jump to ${displayConfigs[granularity].periodicity} note…`);
	}

	getItems(): RelatedFile[] {
		const config = this.plugin.getConfig(this.granularity);
		const matches = findPeriodicNotes(this.app, config, this.granularity);
		return matches.map((m) => ({
			file: m.file,
			label: m.file.basename,
		}));
	}

	getItemText(item: RelatedFile): string {
		return item.label;
	}

	onChooseItem(item: RelatedFile): void {
		void this.app.workspace.getLeaf(false).openFile(item.file);
	}
}

// ── File-options switcher ─────────────────────────────────────────────────────

interface FileOption {
	label: string;
	action: () => void;
}

class FileOptionsSwitcher extends SuggestModal<FileOption> {
	constructor(app: App, private options: FileOption[]) {
		super(app);
		this.setPlaceholder("Choose an action…");
	}

	getSuggestions(query: string): FileOption[] {
		const q = query.toLowerCase();
		return this.options.filter((o) => o.label.toLowerCase().includes(q));
	}

	renderSuggestion(option: FileOption, el: HTMLElement): void {
		el.setText(option.label);
	}

	onChooseSuggestion(option: FileOption): void {
		option.action();
	}
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerQuickSwitchers(plugin: TimeManagerPlugin): void {
	plugin.addCommand({
		id: "open-related-files-switcher",
		name: "Open related periodic notes switcher",
		checkCallback: (checking) => {
			const activeFile = plugin.app.workspace.getActiveFile();
			if (!activeFile) return false;
			const meta = findInPeriodic(plugin, activeFile.path);
			if (!meta) return false;
			if (!checking) {
				new RelatedFilesSwitcher(plugin.app, plugin, meta.granularity).open();
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "open-file-options-switcher",
		name: "Open periodic note actions",
		checkCallback: (checking) => {
			const activeFile = plugin.app.workspace.getActiveFile();
			if (!activeFile) return false;
			const meta = findInPeriodic(plugin, activeFile.path);
			if (!meta) return false;

			if (!checking) {
				const { granularity, date } = meta;
				const cfg = displayConfigs[granularity];
				const options: FileOption[] = [
					{
						label: `Open next ${cfg.periodicity} note`,
						action: () => {
						const nextDate = granularity === "half-year" ? addHalfYears(date, 1) : date.clone().add(1, granularity as moment.unitOfTime.DurationConstructor);
						openPeriodicNote(plugin, granularity, nextDate).catch(console.error);
					},
					},
					{
						label: `Open previous ${cfg.periodicity} note`,
						action: () => {
						const prevDate = granularity === "half-year" ? addHalfYears(date, -1) : date.clone().subtract(1, granularity as moment.unitOfTime.DurationConstructor);
						openPeriodicNote(plugin, granularity, prevDate).catch(console.error);
					},
					},
					{
						label: "Reveal in file explorer",
						action: () => {
							 
							const explorer = (plugin.app as any).internalPlugins?.plugins?.[
								"file-explorer"
							]?.instance;
							if (explorer?.revealInFolder) explorer.revealInFolder(activeFile);
						},
					},
				];
				new FileOptionsSwitcher(plugin.app, options).open();
			}
			return true;
		},
	});
}
