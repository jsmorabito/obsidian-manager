/**
 * File-menu integrations — registered from main.ts via registerFileMenuHandlers().
 *
 * Keeps main.ts thin by moving the workspace "file-menu" event handler here.
 * Handles both file items (periodic-note actions + target date) and folder
 * items ("Open notes in multi-note editor").
 */
import { TAbstractFile, TFile, Menu, moment } from "obsidian";
import type TimeManagerPlugin from "../main";
import { findInPeriodic, openPeriodicNote } from "../periodic/api";
import { displayConfigs } from "../periodic/types";
import { addHalfYears } from "../periodic/half-year";
import { TIME_MANAGER_EDITOR_VIEW, DailyNoteView } from "./view";
import { TargetDateModal } from "../target-date/TargetDateModal";
import { TIME_MANAGER_CALENDAR_VIEW, CalendarView } from "../calendar/CalendarView";

export function registerFileMenuHandlers(plugin: TimeManagerPlugin): void {
	plugin.registerEvent(
		plugin.app.workspace.on("file-menu", (menu, file) => {
			if (file instanceof TFile) {
				handleFileItem(plugin, menu, file);
			} else {
				handleFolderItem(plugin, menu, file);
			}
		})
	);
}

// ── File item ────────────────────────────────────────────────────────────────

function handleFileItem(plugin: TimeManagerPlugin, menu: Menu, file: TFile): void {
	const meta = findInPeriodic(plugin, file.path);

	// Every markdown file gets a target-date option.
	addTargetDateMenuItem(plugin, menu, file);
	addShowInCalendarMenuItem(plugin, menu, file);

	if (!meta) {
		// Non-periodic files: just add the agenda view shortcut.
		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle("Open agenda panel");
			item.setIcon("calendar-days");
			item.onClick(() => void plugin.openAgendaView());
		});
		return;
	}

	const { granularity, date } = meta;
	const cfg = displayConfigs[granularity];
	const periodLabel = cfg.periodicity;

	menu.addSeparator();

	menu.addItem((item) => {
		item.setTitle(`Open previous ${periodLabel} note`);
		item.setIcon("arrow-left");
		item.onClick(() => {
			const prevDate =
				granularity === "half-year"
					? addHalfYears(date, -1)
					: date.clone().subtract(1, granularity as moment.unitOfTime.DurationConstructor);
			openPeriodicNote(plugin, granularity, prevDate).catch(console.error);
		});
	});

	menu.addItem((item) => {
		item.setTitle(`Open next ${periodLabel} note`);
		item.setIcon("arrow-right");
		item.onClick(() => {
			const nextDate =
				granularity === "half-year"
					? addHalfYears(date, 1)
					: date.clone().add(1, granularity as moment.unitOfTime.DurationConstructor);
			openPeriodicNote(plugin, granularity, nextDate).catch(console.error);
		});
	});

	menu.addItem((item) => {
		item.setTitle("Show in timeline sidebar");
		item.setIcon("calendar-range");
		item.onClick(() => plugin.openTimelineView());
	});

	menu.addItem((item) => {
		item.setTitle("Open agenda panel");
		item.setIcon("calendar-days");
		item.onClick(() => void plugin.openAgendaView());
	});
}

// ── Folder item ──────────────────────────────────────────────────────────────

function handleFolderItem(
	plugin: TimeManagerPlugin,
	menu: Menu,
	file: TAbstractFile
): void {
	const folderPath = file.path;

	menu.addItem((item) => {
		item.setTitle("Open notes in multi-note editor (this folder)");
		item.setIcon("calendar-range");
		item.onClick(() => {
			void (async () => {
				const { workspace } = plugin.app;
				const leaf = workspace.getLeaf(true);
				await leaf.setViewState({ type: TIME_MANAGER_EDITOR_VIEW });
				void workspace.revealLeaf(leaf);
				(leaf.view as DailyNoteView).setSelectionMode("folder", folderPath);
			})();
		});
	});
}

// ── Show in calendar ─────────────────────────────────────────────────────────

function addShowInCalendarMenuItem(
	plugin: TimeManagerPlugin,
	menu: Menu,
	file: TFile
): void {
	const td = plugin.targetDateService.getTargetDate(file);
	const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
	const hasTime = !!fm?.startTime || !!fm?.targetDate;

	if (!td && !hasTime) return;

	const dateStr = td
		? moment(td.raw).format("YYYY-MM-DD")
		: moment(fm!.targetDate as string).format("YYYY-MM-DD");

	menu.addItem((item) => {
		item.setTitle("Show in calendar");
		item.setIcon("calendar-search");
		item.onClick(() => {
			void (async () => {
				const { workspace } = plugin.app;
				const existing = workspace.getLeavesOfType(TIME_MANAGER_CALENDAR_VIEW);
				let leaf = existing[0];
				if (!leaf) {
					leaf = workspace.getLeaf(true);
					await leaf.setViewState({ type: TIME_MANAGER_CALENDAR_VIEW });
				}
				workspace.revealLeaf(leaf);
				if (leaf.view instanceof CalendarView) {
					leaf.view.navigateToDate(dateStr);
				}
			})();
		});
	});
}

// ── Target date ──────────────────────────────────────────────────────────────

function addTargetDateMenuItem(
	plugin: TimeManagerPlugin,
	menu: Menu,
	file: TFile
): void {
	const existing = plugin.targetDateService.getTargetDate(file);
	const label = existing ? "Change target date" : "Set target date";

	menu.addItem((item) => {
		item.setTitle(label);
		item.setIcon("target");
		item.onClick(() => {
			new TargetDateModal(
				plugin.app,
				existing,
				(date, gran) => {
					void plugin.targetDateService.setTargetDate(file, date, gran);
				},
				() => {
					void plugin.targetDateService.clearTargetDate(file);
				}
			).open();
		});
	});
}
