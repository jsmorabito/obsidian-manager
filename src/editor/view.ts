/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-redundant-type-constituents */
// Ported from quorafind/Obsidian-Daily-Notes-Editor (MIT).
import {
	ItemView,
	Menu,
	Scope,
	TAbstractFile,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import type TimeManagerPlugin from "../main";
import DailyNoteEditorView from "./DailyNoteEditorView.svelte";
import type { Granularity } from "../periodic/types";
import { granularities } from "../periodic/types";
import type { CustomRange, SelectionMode, TimeField, TimeRange } from "./types";
import { CustomRangeModal } from "./CustomRangeModal";
import { SelectFolderModal, SelectTagModal } from "./SelectTargetModal";

export const TIME_MANAGER_EDITOR_VIEW = "obsidian-time-tools-editor-view";

export class DailyNoteView extends ItemView {
	view!: DailyNoteEditorView;
	plugin: TimeManagerPlugin;
	scope: Scope;

	selectedRange: TimeRange = "all";
	timeField: TimeField = "date";
	granularity: Granularity = "day";
	selectionMode: SelectionMode = "daily";
	folderPath = "";
	tag = "";
	customRange: CustomRange | undefined = undefined;
	scrollDirection: "vertical" | "horizontal" = "vertical";

	constructor(leaf: WorkspaceLeaf, plugin: TimeManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.scope = new Scope(plugin.app.scope);
	}

	getMode = () => "source";

	getViewType(): string {
		return TIME_MANAGER_EDITOR_VIEW;
	}

	getDisplayText(): string {
		return "Timeline";
	}

	getIcon(): string {
		return "timeline";
	}

	/** Called by the plugin after settings are saved to push the updated enabled-granularities list into the toolbar. */
	refreshSettings() {
		const enabled = granularities.filter(
			(g) => g === "day" || this.plugin.settings.time[g].enabled
		);
		this.view?.$set({ enabledGranularities: enabled });
	}

	/** Called when calendar sources change so the events strip re-fetches. */
	refreshCalendar() {
		this.view?.refreshCalendar?.();
	}

	setGranularity(g: Granularity) {
		this.granularity = g;
		this.view?.$set({ granularity: g });
		this.app.workspace.trigger("layout-change");
	}

	setSelectionMode(mode: SelectionMode, pathOrTag = "") {
		this.selectionMode = mode;
		if (mode === "folder") this.folderPath = pathOrTag;
		if (mode === "tag")    this.tag        = pathOrTag;
		this.view?.$set({ selectionMode: mode, folderPath: this.folderPath, tag: this.tag });
		this.app.workspace.trigger("layout-change");
	}

	private onFileCreate = (file: TAbstractFile) => {
		if (file instanceof TFile) this.view?.fileCreate(file);
	};

	private onFileDelete = (file: TAbstractFile) => {
		if (file instanceof TFile) this.view?.fileDelete(file);
	};

	setSelectedRange(range: TimeRange) {
		this.selectedRange = range;
		this.view?.$set({ selectedRange: range });
	}

	setTimeField(field: TimeField) {
		this.timeField = field;
		this.view?.$set({ timeField: field });
	}

	setScrollDirection(direction: "vertical" | "horizontal") {
		this.scrollDirection = direction;
		this.view?.$set({ scrollDirection: direction });
	}

	setCustomRange(cr: CustomRange) {
		this.customRange = cr;
		this.selectedRange = "custom";
		this.view?.$set({ selectedRange: "custom", customRange: cr });
	}

	openCustomRangeModal() {
		new CustomRangeModal(this.app, (cr) => this.setCustomRange(cr)).open();
	}

	getState(): Record<string, unknown> {
		const state = super.getState();
		return {
			...state,
			timeField:       this.timeField,
			selectedRange:   this.selectedRange,
			granularity:     this.granularity,
			selectionMode:   this.selectionMode,
			folderPath:      this.folderPath,
			tag:             this.tag,
			scrollDirection: this.scrollDirection,
		};
	}

	async setState(state: unknown, result?: any): Promise<void> {
		this._setStateAt = Date.now();
		await super.setState(state, result);
		if (state && typeof state === "object" && !this.view) {
			const cs = state as {
				timeField?: TimeField;
				selectedRange?: TimeRange;
				granularity?: Granularity;
				selectionMode?: SelectionMode;
				folderPath?: string;
				tag?: string;
				scrollDirection?: "vertical" | "horizontal";
			};
			if (cs.timeField)       this.timeField       = cs.timeField;
			if (cs.selectedRange)   this.selectedRange   = cs.selectedRange;
			if (cs.granularity)     this.granularity     = cs.granularity;
			if (cs.selectionMode)   this.selectionMode   = cs.selectionMode;
			if (cs.folderPath)      this.folderPath      = cs.folderPath;
			if (cs.tag)             this.tag             = cs.tag;
			if (cs.scrollDirection) this.scrollDirection = cs.scrollDirection;

			this.view = new DailyNoteEditorView({
				target: this.contentEl,
				props: {
					plugin:          this.plugin,
					leaf:            this.leaf,
					selectedRange:   this.selectedRange,
					timeField:       this.timeField,
					granularity:     this.granularity,
					selectionMode:   this.selectionMode,
					folderPath:      this.folderPath,
					tag:             this.tag,
					scrollDirection: this.scrollDirection,
				},
			});

			this.app.workspace.onLayoutReady(() => {
				this.view.tick();
			});

			this.registerInterval(
				window.setInterval(() => this.view.check(), 1000 * 60 * 60)
			);
		}
	}

	/**
	 * Tracks the timestamp of the last setState call so setEphemeralState can
	 * distinguish workspace-restore calls from the spurious calls Obsidian makes
	 * whenever the leaf becomes active (e.g. when clicking into an embedded note
	 * triggers setActiveLeaf(parentLeaf) via the workspace patch).
	 */
	private _setStateAt = 0;

	/**
	 * Obsidian calls setEphemeralState after setState to restore the previous
	 * scroll position. Since onMount already positions today at renderedFiles[0],
	 * we just need to reset scrollTop=0 after Obsidian's restore runs.
	 *
	 * Guard: only reset during workspace restore (within 10 s of setState).
	 * Clicking into an embedded note also triggers setEphemeralState (via
	 * setActiveLeaf redirection in workspace-patches.ts) but does NOT call
	 * setState first, so the timestamp guard prevents an unwanted scroll-to-top.
	 */
	setEphemeralState(state: unknown): void {
		super.setEphemeralState(state);
		if (Date.now() - this._setStateAt < 10_000) {
			// Defer one frame so scrollEl is bound and Obsidian's own scroll-restore
			// (from super) has already run before we reset to position 0.
			window.requestAnimationFrame(() => this.view?.resetScrollToTop?.());
		}
	}

	async onOpen(): Promise<void> {
		this.scope.register(["Mod"], "f", () => {
			// No-op: prevent the global find handler from hijacking inside our view.
		});

		// Source selector — switches between daily / folder / tag / inbox modes.
		this.addAction("folder-open", "Select source", (e) => {
			const menu = new Menu();

			menu.addItem((item) => {
				item.setTitle("Daily notes");
				item.setChecked(this.selectionMode === "daily");
				item.onClick(() => this.setSelectionMode("daily"));
			});

			menu.addItem((item) => {
				item.setTitle("Inbox");
				item.setChecked(this.selectionMode === "inbox");
				item.onClick(() => this.setSelectionMode("inbox"));
			});

			menu.addSeparator();

			menu.addItem((item) => {
				item.setTitle("Browse by folder…");
				item.setChecked(this.selectionMode === "folder");
				item.onClick(() => {
					new SelectFolderModal(this.app, (folder) => {
						this.setSelectionMode("folder", folder.path);
					}).open();
				});
			});

			menu.addItem((item) => {
				item.setTitle("Browse by tag…");
				item.setChecked(this.selectionMode === "tag");
				item.onClick(() => {
					new SelectTagModal(this.app, (tag) => {
						this.setSelectionMode("tag", tag);
					}).open();
				});
			});

			menu.showAtMouseEvent(e as MouseEvent);
		});

		this.addAction("calendar-range", "Select date range", (e) => {
			const menu = new Menu();
			const add = (title: string, range: TimeRange) => {
				menu.addItem((item) => {
					item.setTitle(title);
					item.setChecked(this.selectedRange === range);
					item.onClick(() => this.setSelectedRange(range));
				});
			};
			add("All notes",    "all");
			add("This week",    "week");
			add("This month",   "month");
			add("This quarter", "quarter");
			add("This year",    "year");
			add("Last week",    "last-week");
			add("Last month",   "last-month");
			add("Last quarter", "last-quarter");
			add("Last year",    "last-year");
			menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle("Custom range…");
				item.setChecked(this.selectedRange === "custom");
				item.onClick(() => {
					new CustomRangeModal(this.app, (cr) => this.setCustomRange(cr)).open();
				});
			});
			menu.showAtMouseEvent(e as MouseEvent);
		});

		// Presets menu.
		this.addAction("bookmark", "Select preset", (e) => {
			const menu = new Menu();
			const presets = this.plugin.settings.time.presets;
			if (presets.length === 0) {
				menu.addItem((item) => {
					item.setTitle("No presets saved");
					item.setDisabled(true);
				});
			} else {
				for (const preset of presets) {
					menu.addItem((item) => {
						item.setTitle(preset.name);
						item.onClick(() => {
							if (preset.selectionMode === "folder") {
								this.setSelectionMode("folder", preset.folderPath ?? "");
							} else if (preset.selectionMode === "tag") {
								this.setSelectionMode("tag", preset.tag ?? "");
							} else {
								this.setSelectionMode("daily");
							}
							if (preset.timeRange) this.setSelectedRange(preset.timeRange as TimeRange);
						});
					});
				}
			}
			menu.showAtMouseEvent(e as MouseEvent);
		});

		this.addAction("refresh", "Refresh", () => {
			if (this.view) {
				this.view.check();
				this.view.tick();
				this.view.$set({ selectedRange: this.selectedRange });
			}
		});

		this.registerEvent(this.app.vault.on("create", this.onFileCreate));
		this.registerEvent(this.app.vault.on("delete", this.onFileDelete));

		// Refresh inbox on file changes. Use both vault "modify" (fires immediately on
		// save) and metadataCache "changed" (fires after full re-index) so the inbox
		// is live regardless of which event arrives first.
		let _inboxRefreshTimer: number | undefined;
		const scheduleInboxRefresh = () => {
			if (this.selectionMode !== "inbox") return;
			window.clearTimeout(_inboxRefreshTimer);
			_inboxRefreshTimer = window.setTimeout(() => {
				this.view?.refreshInbox?.();
			}, 100);
		};
		this.registerEvent(this.app.vault.on("modify", scheduleInboxRefresh));
		this.registerEvent(this.app.metadataCache.on("changed", scheduleInboxRefresh));
	}

	onPaneMenu(menu: Menu, source: "more-options" | "tab-header" | string): void {
		if (source === "tab-header" || source === "more-options") {
			menu.addItem((item) => {
				// @ts-ignore — unofficial pinned API
				item.setIcon(this.leaf.pinned ? "pin-off" : "pin");
				// @ts-ignore
				item.setTitle(this.leaf.pinned ? "Unpin" : "Pin");
				item.onClick(() => this.leaf.togglePinned());
			});
		}
	}

	/**
	 * Switch the editor to the appropriate granularity + "all notes" range, then
	 * scroll to `file`.  Called from the nav-actions "open in view" button.
	 */
	public async scrollToFile(file: TFile, granularity: Granularity): Promise<void> {
		// Align view state so the target file will be in the filtered list.
		if (this.granularity !== granularity) this.setGranularity(granularity);
		if (this.selectionMode !== "daily")   this.setSelectionMode("daily");
		if (this.selectedRange !== "all")     this.setSelectedRange("all");

		// Give Svelte one event-loop turn to process the reactive updates and
		// re-run fileManager.updateOptions before we try to scroll.
		await new Promise<void>((r) => setTimeout(r, 80));

		if (this.view) await this.view.scrollToFile(file);
	}

	public refreshForNewDay(): void {
		if (this.view) {
			this.view.check();
			this.view.tick();
			this.view.$set({
				selectedRange: this.selectedRange,
				granularity:   this.granularity,
			});
		}
	}
}
