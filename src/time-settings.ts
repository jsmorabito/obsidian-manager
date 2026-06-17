/* eslint-disable obsidianmd/ui/sentence-case */
import { App, Modal, Notice, PluginSettingTab, Setting, SettingDefinitionItem, SettingDefinitionPage, moment } from "obsidian";
import type TimeManagerPlugin from "./main";
import type { RecentFileEntry } from "./recently-viewed/types";
import type { InboxDisplayOptions } from "./inbox/types";
import { DEFAULT_INBOX_DISPLAY } from "./inbox/types";
import {
	DEFAULT_DAILY_NOTE_FORMAT,
	DEFAULT_MONTHLY_NOTE_FORMAT,
	DEFAULT_HALF_YEARLY_NOTE_FORMAT,
	DEFAULT_QUARTERLY_NOTE_FORMAT,
	DEFAULT_WEEKLY_NOTE_FORMAT,
	DEFAULT_YEARLY_NOTE_FORMAT,
} from "./periodic/constants";
import { granularities, displayConfigs, type Granularity, type PeriodicConfig } from "./periodic/types";
import { getTemplateVariableReference } from "./utils/template";
import type { DayOfWeek } from "./nldates/utils";
import type { CalendarSource } from "./calendar/types";
import { CALENDAR_COLORS } from "./calendar/types";

// ── NL Dates settings ─────────────────────────────────────────────────────────

export interface NLDatesSettings {
	/** Enable the @ autosuggest trigger in the editor. */
	isAutosuggestEnabled: boolean;
	/** Character(s) that trigger the date autosuggest (default: "@"). */
	autocompleteTriggerPhrase: string;
	/** Wrap autosuggest-inserted dates in [[wikilinks]] by default. */
	autosuggestToggleLink: boolean;
	/** Default moment format used as an alias when creating wikilink dates. */
	defaultAlias: string;
	/** Override the locale's week-start day for "this week" / "next week" parsing. */
	weekStart: DayOfWeek;
	/** Format string for time-only output (e.g. "HH:mm"). */
	timeFormat: string;
	/** Separator placed between date and time in date-time output (e.g. " "). */
	separator: string;
	/**
	 * Enable the `time:` prefix in autosuggest (e.g. `@time:now` → `14:30`).
	 * Off by default so it can be tested before enabling for all users.
	 */
	timePrefixEnabled: boolean;
	/**
	 * Register the `obsidian://time-tools?day=<NL date>` URI handler.
	 * Off by default — enable once you've tested it via Settings.
	 */
	uriHandlerEnabled: boolean;
	/** Moment format used by the date picker modal. */
	modalMomentFormat: string;
	/** Wrap date picker output in a link. */
	modalToggleLink: boolean;
}

export const DEFAULT_NLDATES_SETTINGS: NLDatesSettings = {
	isAutosuggestEnabled: true,
	autocompleteTriggerPhrase: "@",
	autosuggestToggleLink: true,
	defaultAlias: "",
	weekStart: "locale-default",
	timeFormat: "HH:mm",
	separator: " ",
	timePrefixEnabled: false,
	uriHandlerEnabled: false,
	modalMomentFormat: "YYYY-MM-DD HH:mm",
	modalToggleLink: false,
};

// ── Preset ────────────────────────────────────────────────────────────────────

export type PresetSelectionMode = "daily" | "folder" | "tag";

export interface Preset {
	id: string;
	name: string;
	selectionMode: PresetSelectionMode;
	folderPath?: string;
	tag?: string;
	timeRange?: string;
}

// ── Settings shape ────────────────────────────────────────────────────────────

export interface TimeManagerSettings {
	day: PeriodicConfig;
	week: PeriodicConfig;
	month: PeriodicConfig;
	quarter: PeriodicConfig;
	"half-year": PeriodicConfig;
	year: PeriodicConfig;

	// Startup behaviour
	createAndOpenEditorOnStartup: boolean;
	/** If set, open this granularity's current note on layout-ready. */
	openNoteOnStartup: Granularity | null;

	// Editor view display toggles
	hideFrontmatter: boolean;
	hideBacklinks: boolean;

	// Presets (folder / tag mode)
	presets: Preset[];

	// Sessions
	sessionsFolder: string;

	// Recently Viewed panel
	rvMaxItems: number;
	rvShowTimestamp: boolean;
	rvShowPath: boolean;
	recentFiles: RecentFileEntry[];

	// Migration: track whether we have already offered to import Daily Notes core settings.
	migratedFromDailyNotes: boolean;

	// Natural Language Dates
	nlDates: NLDatesSettings;

	// Calendar integration
	calendarSources: CalendarSource[];

	// Inbox
	inboxDisplay: InboxDisplayOptions;
	/** Tags that drive the inbox (without #). Default: ["inbox"]. */
	inboxTags: string[];
	/** If a file/line also carries any of these tags, it is suppressed from the inbox. */
	inboxExcludeTags: string[];
	/** Keys of inbox items the user has opened. "path" for file items, "path:line" for inline. */
	readTaggedItems: string[];
	/** Auto-remove inline inbox items whose line has a completed checkbox (- [x]). */
	inboxAutoRemoveDone: boolean;

	// Calendar widget inbox (separate from the main inbox panel)
	/** Tags that drive the calendar inbox panel (without #). */
	calendarInboxTags: string[];
	/** Tags that suppress items from the calendar inbox panel. */
	calendarInboxExcludeTags: string[];

	// Ribbon icons
	ribbonDaily: boolean;
	ribbonEditor: boolean;
	ribbonInbox: boolean;

	// View placement — which sidebar each panel opens in
	timelineSide: "left" | "right";
	agendaSide:   "left" | "right";
	inboxSide:    "left" | "right";

	// AgendaView work section
	/** Which tab is active in the agenda sidebar: tasks or targets. */
	agendaWorkSection: "tasks" | "targets";
	/** Which filter is active in the tasks tab. */
	agendaTaskFilter: "all" | "open" | "done";
}

export type AgendaWorkSection = TimeManagerSettings["agendaWorkSection"];
export type AgendaTaskFilter  = TimeManagerSettings["agendaTaskFilter"];

export const DEFAULT_SETTINGS: TimeManagerSettings = {
	day: {
		enabled: true,
		format: DEFAULT_DAILY_NOTE_FORMAT,
		folder: "",
		templatePath: "",
	},
	week: {
		enabled: false,
		format: DEFAULT_WEEKLY_NOTE_FORMAT,
		folder: "",
		templatePath: "",
	},
	month: {
		enabled: false,
		format: DEFAULT_MONTHLY_NOTE_FORMAT,
		folder: "",
		templatePath: "",
	},
	quarter: {
		enabled: false,
		format: DEFAULT_QUARTERLY_NOTE_FORMAT,
		folder: "",
		templatePath: "",
	},
	"half-year": {
		enabled: false,
		format: DEFAULT_HALF_YEARLY_NOTE_FORMAT,
		folder: "",
		templatePath: "",
	},
	year: {
		enabled: false,
		format: DEFAULT_YEARLY_NOTE_FORMAT,
		folder: "",
		templatePath: "",
	},
	createAndOpenEditorOnStartup: false,
	openNoteOnStartup: null,
	hideFrontmatter: false,
	hideBacklinks: false,
	presets: [],
	sessionsFolder: "Sessions",
	rvMaxItems: 15,
	rvShowTimestamp: true,
	rvShowPath: true,
	recentFiles: [],
	migratedFromDailyNotes: false,
	nlDates: DEFAULT_NLDATES_SETTINGS,
	calendarSources: [],
	inboxDisplay: DEFAULT_INBOX_DISPLAY,
	inboxTags: ["inbox"],
	inboxExcludeTags: [],
	readTaggedItems: [],
	inboxAutoRemoveDone: true,

	// Calendar widget inbox
	calendarInboxTags: ["inbox"],
	calendarInboxExcludeTags: [],

	// Ribbon icons — only the editor ribbon on by default
	ribbonDaily:  false,
	ribbonEditor: true,
	ribbonInbox:  false,

	// View placement
	timelineSide: "right",
	agendaSide:   "right",
	inboxSide:    "left",

	// AgendaView work section
	agendaWorkSection: "tasks",
	agendaTaskFilter:  "all",
};

// ── Settings tab ──────────────────────────────────────────────────────────────

const PERIOD_FORMAT_EXAMPLES: Record<Granularity, string> = {
	day:          "YYYY-MM-DD",
	week:         "GGGG-[W]WW",
	month:        "YYYY-MM",
	quarter:      "YYYY-[Q]Q",
	"half-year":  "YYYY-[H]H",
	year:         "YYYY",
};

export class TimeManagerSettingTab extends PluginSettingTab {
	plugin: TimeManagerPlugin;

	constructor(app: App, plugin: TimeManagerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Dot-notation support for nested settings (e.g. "nlDates.isAutosuggestEnabled", "day.folder").
	getControlValue(key: string): unknown {
		const parts = key.split(".");
		let val: unknown = this.plugin.settings;
		for (const part of parts) {
			val = (val as Record<string, unknown>)[part];
		}
		return val;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const parts = key.split(".");
		let obj = this.plugin.settings as unknown as Record<string, unknown>;
		for (let i = 0; i < parts.length - 1; i++) {
			obj = obj[parts[i]] as Record<string, unknown>;
		}
		obj[parts[parts.length - 1]] = value;
		await this.plugin.saveSettings();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const s = this.plugin.settings;

		return [
			// ── Startup (main tab) ───────────────────────────────────────────
			{
				name: "Open editor on startup",
				desc: "On startup, create today's daily note if missing and open the multi-note editor.",
				control: { type: "toggle" as const, key: "createAndOpenEditorOnStartup" },
			},
			{
				name: "Open periodic note on startup",
				desc: "Also open the current note for the chosen granularity when Obsidian loads. Only enabled granularities are shown.",
				render: (setting) => {
					setting.addDropdown((dd) => {
						dd.addOption("", "None");
						for (const g of granularities) {
							if (s[g].enabled) {
								const label = displayConfigs[g].periodicity;
								dd.addOption(g, label.charAt(0).toUpperCase() + label.slice(1) + " note");
							}
						}
						dd.setValue(s.openNoteOnStartup ?? "");
						dd.onChange(async (value) => {
							s.openNoteOnStartup = value ? (value as Granularity) : null;
							await this.plugin.saveSettings();
						});
					});
				},
			},

			// ── Ribbon icons ─────────────────────────────────────────────────
			{
				name: "Show timeline ribbon icon",
				desc: "Show the timeline editor icon in the left ribbon.",
				render: (setting) => {
					setting.addToggle((t) =>
						t.setValue(s.ribbonEditor).onChange(async (v) => {
							s.ribbonEditor = v;
							await this.plugin.saveSettings();
						})
					);
				},
			},
			{
				name: "Show daily note ribbon icon",
				desc: "Show the 'open today's note' icon in the left ribbon. Only active when daily notes are enabled.",
				render: (setting) => {
					setting.addToggle((t) =>
						t.setValue(s.ribbonDaily).onChange(async (v) => {
							s.ribbonDaily = v;
							await this.plugin.saveSettings();
						})
					);
				},
			},
			{
				name: "Show inbox ribbon icon",
				desc: "Show the inbox icon in the left ribbon.",
				render: (setting) => {
					setting.addToggle((t) =>
						t.setValue(s.ribbonInbox).onChange(async (v) => {
							s.ribbonInbox = v;
							await this.plugin.saveSettings();
						})
					);
				},
			},

			// ── View placement ────────────────────────────────────────────────
			{
				name: "Timeline sidebar",
				desc: "Which sidebar the timeline panel opens in.",
				render: (setting) => {
					setting.addDropdown((dd) => {
						dd.addOption("right", "Right sidebar");
						dd.addOption("left",  "Left sidebar");
						dd.setValue(s.timelineSide);
						dd.onChange(async (v) => {
							s.timelineSide = v as "left" | "right";
							await this.plugin.saveSettings();
						});
					});
				},
			},
			{
				name: "Agenda panel",
				desc: "Which sidebar the agenda panel opens in.",
				render: (setting) => {
					setting.addDropdown((dd) => {
						dd.addOption("right", "Right sidebar");
						dd.addOption("left",  "Left sidebar");
						dd.setValue(s.agendaSide);
						dd.onChange(async (v) => {
							s.agendaSide = v as "left" | "right";
							await this.plugin.saveSettings();
						});
					});
				},
			},
			{
				name: "Inbox panel",
				desc: "Which sidebar the inbox panel opens in.",
				render: (setting) => {
					setting.addDropdown((dd) => {
						dd.addOption("left",  "Left sidebar");
						dd.addOption("right", "Right sidebar");
						dd.setValue(s.inboxSide);
						dd.onChange(async (v) => {
							s.inboxSide = v as "left" | "right";
							await this.plugin.saveSettings();
						});
					});
				},
			},

			// ── Sub-pages ────────────────────────────────────────────────────
			{
				type: "page" as const,
				name: "Periodic notes",
				desc: "Daily, weekly, monthly, quarterly, half-yearly, and yearly notes.",
				items: granularities.map((g) => this.periodicNotePage(g)),
			},
			{
				type: "page" as const,
				name: "Editor view",
				desc: "Multi-note editor display options.",
				items: [
					{
						name: "Hide frontmatter",
						desc: "Hide frontmatter blocks inside notes rendered in the editor view.",
						render: (setting) => {
							setting.addToggle((t) =>
								t.setValue(s.hideFrontmatter).onChange(async (v) => {
									s.hideFrontmatter = v;
									document.body.classList.toggle("tm-hide-frontmatter", v);
									await this.plugin.saveSettings();
								})
							);
						},
					},
					{
						name: "Hide backlinks",
						desc: "Hide backlink panes inside notes rendered in the editor view.",
						render: (setting) => {
							setting.addToggle((t) =>
								t.setValue(s.hideBacklinks).onChange(async (v) => {
									s.hideBacklinks = v;
									document.body.classList.toggle("tm-hide-backlinks", v);
									await this.plugin.saveSettings();
								})
							);
						},
					},
				],
			},
			{
				type: "page" as const,
				name: "Sessions",
				items: [
					{
						name: "Sessions folder",
						desc: "Folder where session notes are stored. Leave blank for vault root.",
						control: { type: "folder" as const, key: "sessionsFolder", includeRoot: true },
					},
				],
			},
			{
				type: "page" as const,
				name: "Recently viewed",
				items: [
					{
						name: "Max items",
						desc: "Maximum number of files to keep in history (5–50).",
						control: { type: "slider" as const, key: "rvMaxItems", min: 5, max: 50, step: 5 },
					},
					{
						name: "Show timestamps",
						desc: 'Display relative time (e.g. "5m ago") next to each file.',
						render: (setting) => {
							setting.addToggle((t) =>
								t.setValue(s.rvShowTimestamp).onChange(async (v) => {
									s.rvShowTimestamp = v;
									await this.plugin.saveSettings();
									this.plugin.refreshRecentlyViewedPanel();
								})
							);
						},
					},
					{
						name: "Show folder path",
						desc: "Display the folder path below each file name.",
						render: (setting) => {
							setting.addToggle((t) =>
								t.setValue(s.rvShowPath).onChange(async (v) => {
									s.rvShowPath = v;
									await this.plugin.saveSettings();
									this.plugin.refreshRecentlyViewedPanel();
								})
							);
						},
					},
					{
						name: "Clear history",
						desc: "Remove all files from the recently viewed list.",
						render: (setting) => {
							setting.addButton((btn) =>
								btn
									.setButtonText("Clear history")
									.setDestructive()
									.onClick(async () => {
										s.recentFiles = [];
										await this.plugin.saveSettings();
										this.plugin.refreshRecentlyViewedPanel();
									})
							);
						},
					},
				],
			},
			{
				type: "page" as const,
				name: "Natural language dates",
				items: this.nlDatesItems(),
			},
			{
				type: "page" as const,
				name: "Calendar",
				items: this.calendarItems(),
			},
			{
				type: "page" as const,
				name: "Presets",
				items: this.presetsItems(),
			},
			{
				type: "page" as const,
				name: "Inbox",
				desc: "Configure which tags feed the Inbox tagged section.",
				items: this.inboxItems(),
			},
		];
	}

	private periodicNotePage(g: Granularity): SettingDefinitionPage {
		const config = this.plugin.settings[g];
		const label = displayConfigs[g].periodicity;
		const caps = label.charAt(0).toUpperCase() + label.slice(1);
		const example = PERIOD_FORMAT_EXAMPLES[g];

		return {
			type: "page",
			name: `${caps} notes`,
			items: [
				{
					name: `Enable ${label} notes`,
					desc: `Turn on to register ${label} commands. Reload the plugin after changing this to refresh the command palette.`,
					render: (setting) => {
						setting.addToggle((t) =>
							t.setValue(config.enabled).onChange(async (v) => {
								config.enabled = v;
								await this.plugin.saveSettings();
							})
						);
					},
				},
				{
					name: "Date format",
					desc: `Moment.js format string (e.g. ${example}).`,
					render: (setting) => {
						const previewEl = setting.descEl.createEl("div", {
							cls: "tm-format-preview",
							text: `→ ${moment().format(config.format)}`,
						});
						setting.addText((t) =>
							t
								.setPlaceholder(config.format)
								.setValue(config.format)
								.onChange(async (v) => {
									config.format = v.trim() || config.format;
									previewEl.setText(`→ ${moment().format(config.format)}`);
									await this.plugin.saveSettings();
								})
						);
					},
				},
				{
					name: "Folder",
					desc: `Folder to store ${label} notes. Leave blank for vault root.`,
					control: { type: "folder" as const, key: `${g}.folder`, includeRoot: true },
				},
				{
					name: "Template file",
					desc: "Path to a markdown file used as a template for new notes.",
					render: (setting) => {
						// File picker
						/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
						(setting as any).addSearch?.((s: any) => {
							s.setPlaceholder("Templates/daily.md");
							s.setValue(config.templatePath);
							s.onChange(async (v: string) => {
								config.templatePath = v;
								await this.plugin.saveSettings();
							});
						});
						/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

						// Variables reference — collapsible <details> block
						const details = setting.descEl.createEl("details", {
							cls: "tm-template-vars-details",
						});
						details.createEl("summary", {
							text: "Available variables",
							cls: "tm-template-vars-summary",
						});
						const table = details.createEl("table", { cls: "tm-template-vars-table" });
						for (const [variable, description] of getTemplateVariableReference(g)) {
							const row = table.createEl("tr");
							row.createEl("td", { cls: "tm-template-var-name", text: variable });
							row.createEl("td", { cls: "tm-template-var-desc", text: description });
						}
					},
				},
			],
		};
	}

	private nlDatesItems(): SettingDefinitionItem[] {
		const nl = this.plugin.settings.time.nlDates;
		return [
			{
				name: "Enable date autosuggestion",
				desc: "Show date completions when you type the trigger phrase (default: @).",
				control: { type: "toggle" as const, key: "nlDates.isAutosuggestEnabled" },
			},
			{
				name: "Trigger phrase",
				desc: "Character(s) that open the date autosuggest. Default: @",
				render: (setting) => {
					setting.addText((t) =>
						t
							.setPlaceholder("@")
							.setValue(nl.autocompleteTriggerPhrase)
							.onChange(async (v) => {
								nl.autocompleteTriggerPhrase = v.trim() || "@";
								await this.plugin.saveSettings();
							})
					);
				},
			},
			{
				name: "Wrap suggestions in links",
				desc: "Autosuggest inserts [[wikilinks]] by default. Disable to insert plain dates.",
				control: { type: "toggle" as const, key: "nlDates.autosuggestToggleLink" },
			},
			{
				name: "Default alias format",
				desc: "Moment format used as the display alias when wrapping in a wikilink. Leave blank for none.",
				render: (setting) => {
					setting.addText((t) =>
						t
							.setPlaceholder("ddd MMM D")
							.setValue(nl.defaultAlias)
							.onChange(async (v) => {
								nl.defaultAlias = v.trim();
								await this.plugin.saveSettings();
							})
					);
				},
			},
			{
				name: "Time format",
				desc: "Moment format for time-only output (e.g. HH:mm).",
				render: (setting) => {
					setting.addMomentFormat((mf) =>
						mf
							.setDefaultFormat("HH:mm")
							.setValue(nl.timeFormat)
							.onChange(async (v) => {
								nl.timeFormat = v.trim() || "HH:mm";
								await this.plugin.saveSettings();
							})
					);
				},
			},
			{
				name: "Date-time separator",
				desc: "Character(s) placed between date and time when inserting both. Default: space.",
				render: (setting) => {
					setting.addText((t) =>
						t
							.setPlaceholder(" ")
							.setValue(nl.separator)
							.onChange(async (v) => {
								nl.separator = v === "" ? " " : v;
								await this.plugin.saveSettings();
							})
					);
				},
			},
			{
				name: "Enable time: prefix in autosuggest",
				desc: "When on, typing @time:now inserts a formatted time string instead of a date. Off by default for testing.",
				control: { type: "toggle" as const, key: "nlDates.timePrefixEnabled" },
			},
			{
				name: "Enable URI handler (obsidian://time-tools)",
				desc: "Register the obsidian://time-tools?day=<date> URI so external apps can open periodic notes. Off by default.",
				render: (setting) => {
					setting.addToggle((t) =>
						t.setValue(nl.uriHandlerEnabled).onChange(async (v) => {
							nl.uriHandlerEnabled = v;
							await this.plugin.saveSettings();
							if (v) new Notice("Reload Obsidian to activate the URI handler.");
						})
					);
				},
			},
		];
	}

	private calendarItems(): SettingDefinitionItem[] {
		const items: SettingDefinitionItem[] = [
			{
				name: "Add calendar source",
				desc: "Connect an ICS/iCal feed (Google, Apple iCloud, Outlook…) or a local .ics file in your vault.",
				render: (setting) => {
					setting.addButton((btn) =>
						btn.setButtonText("Add source").onClick(() => {
							new AddCalendarSourceModal(this.app, this.plugin, () => this.update()).open();
						})
					);
				},
			},
		];

		for (const source of this.plugin.settings.time.calendarSources) {
			const typeLabel = source.type === "url" ? "URL" : "File";
			const shortValue =
				source.value.length > 50 ? source.value.slice(0, 47) + "…" : source.value;

			items.push({
				name: source.name,
				desc: `${typeLabel}: ${shortValue}`,
				render: (setting) => {
					// Colour swatch
					const swatchEl = setting.nameEl.createEl("span", {
						cls: "tm-calendar-source-swatch",
						attr: { style: `background:${source.color || "var(--interactive-accent)"}` },
					});
					setting.nameEl.prepend(swatchEl);

					setting
						.addToggle((toggle) =>
							toggle.setValue(source.enabled).onChange(async (value) => {
								source.enabled = value;
								this.plugin.calendarService.invalidate(source.id);
								await this.plugin.saveSettings();
								this.plugin.refreshCalendarViews();
							})
						)
						.addColorPicker((cp) => {
							// Empty string means "use accent color" — show the accent
							// hex as a placeholder but store "" so the CSS var takes over.
							const accentHex = getComputedStyle(document.body)
								.getPropertyValue("--interactive-accent")
								.trim() || "#7c3aed";
							cp.setValue(source.color || accentHex);
							cp.onChange(async (v) => {
								// If the user picks the exact accent color, treat as "no override"
								source.color = v === accentHex ? "" : v;
								swatchEl.setAttribute(
									"style",
									`background:${source.color || "var(--interactive-accent)"}`
								);
								this.plugin.calendarService.invalidate(source.id);
								await this.plugin.saveSettings();
								this.plugin.refreshCalendarViews();
							});
						})
						.addButton((btn) =>
							btn
								.setButtonText("Refresh")
								.setTooltip("Force re-fetch this source now")
								.onClick(() => {
									this.plugin.calendarService.invalidate(source.id);
									this.plugin.refreshCalendarViews();
									new Notice(`Refreshed "${source.name}"`);
								})
						)
						.addButton((btn) =>
							btn
								.setButtonText("Delete")
								.setDestructive()
								.onClick(async () => {
									this.plugin.settings.time.calendarSources =
										this.plugin.settings.time.calendarSources.filter(
											(c) => c.id !== source.id
										);
									this.plugin.calendarService.invalidate(source.id);
									await this.plugin.saveSettings();
									this.plugin.refreshCalendarViews();
									this.update();
								})
						);
				},
			});
		}

		// ── Calendar inbox ─────────────────────────────────────────────────────
		items.push({
			name: "Calendar inbox tags",
			desc: "Tags (without #) that drive the calendar widget's inbox panel. Defaults to the same tags as the main inbox.",
			render: (setting) => {
				setting.addButton((btn) =>
					btn.setButtonText("Add tag").onClick(() => {
						new AddInboxTagModal(this.app, this.plugin, "calendar-inbox", () => this.update()).open();
					})
				);
			},
		});

		for (const tag of this.plugin.settings.time.calendarInboxTags) {
			items.push({
				name: `#${tag}`,
				render: (setting) => {
					setting.addButton((btn) =>
						btn
							.setButtonText("Remove")
							.setDestructive()
							.onClick(async () => {
								this.plugin.settings.time.calendarInboxTags =
									this.plugin.settings.time.calendarInboxTags.filter((t) => t !== tag);
								await this.plugin.saveSettings();
								this.update();
							})
					);
				},
			});
		}

		items.push({
			name: "Calendar inbox exclude tags",
			desc: "Items that also carry any of these tags are hidden from the calendar inbox panel.",
			render: (setting) => {
				setting.addButton((btn) =>
					btn.setButtonText("Add tag").onClick(() => {
						new AddInboxTagModal(this.app, this.plugin, "calendar-inbox-exclude", () => this.update()).open();
					})
				);
			},
		});

		for (const tag of this.plugin.settings.time.calendarInboxExcludeTags) {
			items.push({
				name: `#${tag}`,
				render: (setting) => {
					setting.addButton((btn) =>
						btn
							.setButtonText("Remove")
							.setDestructive()
							.onClick(async () => {
								this.plugin.settings.time.calendarInboxExcludeTags =
									this.plugin.settings.time.calendarInboxExcludeTags.filter((t) => t !== tag);
								await this.plugin.saveSettings();
								this.update();
							})
					);
				},
			});
		}

		return items;
	}

	private inboxItems(): SettingDefinitionItem[] {
		const items: SettingDefinitionItem[] = [
			// ── Inbox tags ───────────────────────────────────────────────────────
			{
				name: "Inbox tags",
				desc: "Files and lines carrying any of these tags will appear in the Tagged section. #inbox is always included.",
				render: (setting) => {
					setting.addButton((btn) =>
						btn.setButtonText("Add tag").onClick(() => {
							new AddInboxTagModal(this.app, this.plugin, "inbox", () => this.update()).open();
						})
					);
				},
			},
		];

		for (const tag of this.plugin.settings.time.inboxTags) {
			const isDefault = tag === "inbox";
			items.push({
				name: "#" + tag,
				desc: isDefault ? "Default — cannot be removed." : "",
				render: (setting) => {
					if (!isDefault) {
						setting.addButton((btn) =>
							btn
								.setButtonText("Remove")
								.setDestructive()
								.onClick(async () => {
									this.plugin.settings.time.inboxTags =
										this.plugin.settings.time.inboxTags.filter((t) => t !== tag);
									const filter = this.plugin.settings.time.inboxDisplay.inboxTagFilter;
									if (filter) {
										const updated = filter.filter((t) => t !== tag);
										this.plugin.settings.time.inboxDisplay.inboxTagFilter =
											updated.length > 0 ? updated : null;
									}
									await this.plugin.saveSettings();
									this.update();
								})
						);
					}
				},
			});
		}

		// ── Exclusion tags ───────────────────────────────────────────────────────
		items.push({
			name: "Exclusion tags",
			desc: "If a file or line also carries any of these tags, it is hidden from the Tagged section — even if it matches an inbox tag. Useful for tags like #resolved or #done.",
			render: (setting) => {
				setting.addButton((btn) =>
					btn.setButtonText("Add tag").onClick(() => {
						new AddInboxTagModal(this.app, this.plugin, "exclude", () => this.update()).open();
					})
				);
			},
		});

		if (this.plugin.settings.time.inboxExcludeTags.length === 0) {
			items.push({
				name: "No exclusion tags",
				desc: "Add a tag above to start suppressing resolved items.",
				render: () => { /* label only */ },
			});
		}

		for (const tag of this.plugin.settings.time.inboxExcludeTags) {
			items.push({
				name: "#" + tag,
				render: (setting) => {
					setting.addButton((btn) =>
						btn
							.setButtonText("Remove")
							.setDestructive()
							.onClick(async () => {
								this.plugin.settings.time.inboxExcludeTags =
									this.plugin.settings.time.inboxExcludeTags.filter((t) => t !== tag);
								await this.plugin.saveSettings();
								this.update();
							})
					);
				},
			});
		}

		// ── Auto-remove done ─────────────────────────────────────────────────────
		items.push({
			name: "Auto-remove completed tasks",
			desc: "Automatically hide inline inbox items whose line contains a completed checkbox (- [x]).",
			render: (setting) => {
				setting.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.time.inboxAutoRemoveDone)
						.onChange(async (value) => {
							this.plugin.settings.time.inboxAutoRemoveDone = value;
							await this.plugin.saveSettings();
							this.update();
						})
				);
			},
		});

		return items;
	}

	private presetsItems(): SettingDefinitionItem[] {
		const items: SettingDefinitionItem[] = [
			{
				name: "Add preset",
				desc: "Save a named selection (folder, tag, or daily) to quickly switch the editor view.",
				render: (setting) => {
					setting.addButton((btn) =>
						btn.setButtonText("Add preset").onClick(() => {
							new AddPresetModal(this.app, this.plugin, () => this.update()).open();
						})
					);
				},
			},
		];

		for (const preset of this.plugin.settings.time.presets) {
			const modeDesc =
				preset.selectionMode === "folder"
					? `Folder: ${preset.folderPath ?? ""}`
					: preset.selectionMode === "tag"
					? `Tag: ${preset.tag ?? ""}`
					: "Daily notes";
			const rangeDesc = preset.timeRange
				? ` · ${PRESET_TIME_RANGE_OPTIONS[preset.timeRange] ?? preset.timeRange}`
				: "";

			items.push({
				name: preset.name,
				desc: modeDesc + rangeDesc,
				render: (setting) => {
					setting.addButton((btn) =>
						btn
							.setButtonText("Delete")
							.setDestructive()
							.onClick(async () => {
								this.plugin.settings.time.presets = this.plugin.settings.time.presets.filter(
									(p) => p.id !== preset.id
								);
								await this.plugin.saveSettings();
								this.update();
							})
					);
				},
			});
		}

		return items;
	}
}

// ── Add-preset modal ──────────────────────────────────────────────────────────

const PRESET_TIME_RANGE_OPTIONS: Record<string, string> = {
	all:            "All notes",
	week:           "This week",
	month:          "This month",
	quarter:        "This quarter",
	year:           "This year",
	"last-week":    "Last week",
	"last-month":   "Last month",
	"last-quarter": "Last quarter",
	"last-year":    "Last year",
};

export class AddPresetModal extends Modal {
	plugin: TimeManagerPlugin;
	onSave: () => void;

	name = "";
	selectionMode: PresetSelectionMode = "daily";
	folderPath = "";
	tag = "";
	timeRange = "all";

	constructor(app: App, plugin: TimeManagerPlugin, onSave: () => void) {
		super(app);
		this.plugin = plugin;
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Add editor preset" });

		new Setting(contentEl)
			.setName("Preset name")
			.addText((t) => t.setPlaceholder("My preset").onChange((v) => (this.name = v)));

		new Setting(contentEl).setName("Selection mode").addDropdown((dd) => {
			dd.addOption("daily",  "Daily notes");
			dd.addOption("folder", "Folder");
			dd.addOption("tag",    "Tag");
			dd.setValue(this.selectionMode);
			dd.onChange((v) => {
				this.selectionMode = v as PresetSelectionMode;
				this.onOpen();
			});
		});

		if (this.selectionMode === "folder") {
			new Setting(contentEl)
				.setName("Folder path")
				.addText((t) =>
					t.setPlaceholder("Notes/Work").onChange((v) => (this.folderPath = v))
				);
		}

		if (this.selectionMode === "tag") {
			new Setting(contentEl)
				.setName("Tag")
				.addText((t) =>
					t.setPlaceholder("project/work").onChange((v) => (this.tag = v))
				);
		}

		new Setting(contentEl).setName("Default time range").addDropdown((dd) => {
			for (const [value, label] of Object.entries(PRESET_TIME_RANGE_OPTIONS)) {
				dd.addOption(value, label);
			}
			dd.setValue(this.timeRange);
			dd.onChange((v) => (this.timeRange = v));
		});

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Save")
				.setCta()
				.onClick(async () => {
					if (!this.name.trim()) {
						new Notice("Please enter a preset name.");
						return;
					}
					const preset: Preset = {
						id: crypto.randomUUID(),
						name: this.name.trim(),
						selectionMode: this.selectionMode,
						folderPath:
							this.selectionMode === "folder" ? this.folderPath.trim() : undefined,
						tag: this.selectionMode === "tag" ? this.tag.trim() : undefined,
						timeRange: this.timeRange !== "all" ? this.timeRange : undefined,
					};
					this.plugin.settings.time.presets.push(preset);
					await this.plugin.saveSettings();
					this.onSave();
					this.close();
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ── Add-inbox-tag modal ───────────────────────────────────────────────────────

export class AddInboxTagModal extends Modal {
	plugin: TimeManagerPlugin;
	/** Which list this modal adds to. */
	listType: "inbox" | "exclude" | "calendar-inbox" | "calendar-inbox-exclude";
	onSave: () => void;
	tag = "";

	constructor(app: App, plugin: TimeManagerPlugin, listType: "inbox" | "exclude" | "calendar-inbox" | "calendar-inbox-exclude", onSave: () => void) {
		super(app);
		this.plugin = plugin;
		this.listType = listType;
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		const isExclude = this.listType === "exclude" || this.listType === "calendar-inbox-exclude";
		const isCalendar = this.listType === "calendar-inbox" || this.listType === "calendar-inbox-exclude";
		const title = isExclude
			? (isCalendar ? "Add calendar inbox exclusion tag" : "Add exclusion tag")
			: (isCalendar ? "Add calendar inbox tag" : "Add inbox tag");
		contentEl.createEl("h2", { text: title });

		new Setting(contentEl)
			.setName("Tag")
			.setDesc(
				isExclude
					? 'Items that also carry this tag will be hidden (e.g. "resolved" or "done").'
					: 'Enter without the # (e.g. "review" or "action").'
			)
			.addText((t) =>
				t
					.setPlaceholder(isExclude ? "resolved" : "review")
					.onChange((v) => (this.tag = v.trim().replace(/^#/, "")))
			);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Add")
				.setCta()
				.onClick(async () => {
					const tag = this.tag.toLowerCase();
					if (!tag) {
						new Notice("Please enter a tag name.");
						return;
					}
					let list: string[];
					if (this.listType === "calendar-inbox-exclude") {
						list = this.plugin.settings.time.calendarInboxExcludeTags;
					} else if (this.listType === "calendar-inbox") {
						list = this.plugin.settings.time.calendarInboxTags;
					} else if (this.listType === "exclude") {
						list = this.plugin.settings.time.inboxExcludeTags;
					} else {
						list = this.plugin.settings.time.inboxTags;
					}
					if (list.includes(tag)) {
						new Notice(`#${tag} is already in the list.`);
						return;
					}
					list.push(tag);
					await this.plugin.saveSettings();
					this.onSave();
					this.close();
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ── Add-calendar-source modal ─────────────────────────────────────────────────

export class AddCalendarSourceModal extends Modal {
	plugin: TimeManagerPlugin;
	onSave: () => void;

	name = "";
	type: "url" | "file" = "url";
	value = "";
	color = "";

	constructor(app: App, plugin: TimeManagerPlugin, onSave: () => void) {
		super(app);
		this.plugin = plugin;
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Add calendar source" });

		new Setting(contentEl)
			.setName("Display name")
			.addText((t) =>
				t.setPlaceholder("Work calendar").onChange((v) => (this.name = v))
			);

		new Setting(contentEl).setName("Source type").addDropdown((dd) => {
			dd.addOption("url", "Remote URL (ICS/iCal feed)");
			dd.addOption("file", "Local vault file (.ics)");
			dd.setValue(this.type);
			dd.onChange((v) => {
				this.type = v as "url" | "file";
				this.onOpen();
			});
		});

		if (this.type === "url") {
			new Setting(contentEl)
				.setName("Calendar URL")
				.setDesc(
					"Paste the ICS/iCal URL. For Google: Settings → 'Secret address in iCal format'. " +
					"For Apple iCloud: Share calendar → copy the public link."
				)
				.addText((t) =>
					t
						.setPlaceholder("https://calendar.google.com/…/basic.ics")
						.onChange((v) => (this.value = v.trim()))
				);
		} else {
			new Setting(contentEl)
				.setName("Vault file path")
				.setDesc("Path to a .ics file relative to your vault root.")
				.addText((t) =>
					t
						.setPlaceholder("Calendars/work.ics")
						.onChange((v) => (this.value = v.trim()))
				);
		}

		// Default new sources to theme accent (empty string = use CSS var).
		// Offer an explicit color picker for overrides.
		const colorSetting = new Setting(contentEl)
			.setName("Color")
			.setDesc("Color for this calendar's event stripes. Leave on accent to match your theme.");

		let useAccent = true;
		colorSetting.addToggle((t) => {
			t.setTooltip("Use theme accent color");
			t.setValue(true);
			t.onChange((on) => {
				useAccent = on;
				this.color = on ? "" : (CALENDAR_COLORS[0] ?? "#4A90D9");
				colorPickerEl.style.display = on ? "none" : "";
			});
		});
		colorSetting.addText((t) => {
			// Hidden color-hex input (shown only when accent toggle is off).
			// Using addText instead of addColorPicker to get a reference to the element.
			t.inputEl.type = "color";
			t.inputEl.value = CALENDAR_COLORS[0] ?? "#4A90D9";
			t.inputEl.addClass("tm-settings-color-input");
			t.onChange((v) => {
				if (!useAccent) this.color = v;
			});
		});
		// Grab the color input element for show/hide toggling.
		const colorPickerEl = colorSetting.settingEl.querySelector("input[type=color]") as HTMLElement;

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Save")
				.setCta()
				.onClick(async () => {
					if (!this.name.trim()) {
						new Notice("Please enter a name.");
						return;
					}
					if (!this.value.trim()) {
						new Notice("Please enter a URL or file path.");
						return;
					}
					const source: CalendarSource = {
						id: crypto.randomUUID(),
						name: this.name.trim(),
						type: this.type,
						value: this.value,
						color: this.color,
						enabled: true,
					};
					this.plugin.settings.time.calendarSources.push(source);
					await this.plugin.saveSettings();
					this.plugin.refreshCalendarViews();
					this.onSave();
					this.close();
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
