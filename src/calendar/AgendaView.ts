/**
 * Periodic Note Panel (AgendaView)
 *
 * A right-sidebar widget that activates whenever the focused file is a periodic
 * note. Shows:
 *   - Period header  (granularity badge + human-readable period title)
 *   - Toolbar        (prev / next navigation, open-today, create note, open in
 *                     the multi-note editor)
 *   - Agenda section (calendar events for the full period, grouped by day)
 *
 * When the active file is not a periodic note the panel shows an empty state.
 * The view is registered under TIME_MANAGER_AGENDA_VIEW so existing wiring in
 * main.ts and the file menu continues to work without changes.
 */

import { EventRef, ItemView, TFile, WorkspaceLeaf, moment, setIcon } from "obsidian";
import type TimeManagerPlugin from "../main";
import {
	findInPeriodic,
	getPeriodicNote,
	createPeriodicNote,
	openPeriodicNote,
} from "../periodic/api";
import { displayConfigs } from "../periodic/types";
import type { Granularity } from "../periodic/types";
import { TIME_MANAGER_EDITOR_VIEW } from "../editor/view";
import type { DailyNoteView } from "../editor/view";
import type { CalendarEvent } from "./types";
import { labelTargetDate } from "../target-date/target-date-service";
import { TargetPreviewPopover } from "../target-date/TargetPreviewPopover";
import { startOfHalfYear, endOfHalfYear, addHalfYears, isSameHalfYear, formatHalfYear } from "../periodic/half-year";
import TasksPanel from "./TasksPanel.svelte";

export const TIME_MANAGER_AGENDA_VIEW = "obsidian-time-tools-agenda-view";

/** moment startOf unit for each granularity */
const GRAN_UNIT: Record<Granularity, moment.unitOfTime.StartOf> = {
	day: "day",
	week: "isoWeek",
	month: "month",
	quarter: "quarter",
	"half-year": "month", // placeholder — overridden below for half-year
	year: "year",
};

/** Short human label for the period header */
const PERIOD_FORMAT: Record<Granularity, string> = {
	day: "ddd, MMM D",
	week: "[W]W · YYYY",
	month: "MMMM YYYY",
	quarter: "[Q]Q · YYYY",
	"half-year": "", // overridden below — uses formatHalfYear
	year: "YYYY",
};

/** Longer label used in today-button tooltip */
const PERIOD_FORMAT_LONG: Record<Granularity, string> = {
	day: "ddd, MMM D YYYY",
	week: "[Week] W, YYYY",
	month: "MMMM YYYY",
	quarter: "[Q]Q YYYY",
	"half-year": "", // overridden below — uses formatHalfYear
	year: "YYYY",
};

export class AgendaView extends ItemView {
	plugin: TimeManagerPlugin;
	/** File pinned by the multi-note editor's scroll focus. Cleared on tab switch. */
	private _pinnedFile: TFile | null = null;
	/** Debounce timer for refresh() calls that originate from vault/metadata events. */
	private _refreshTimer: number | undefined;
	/** Mounted TasksPanel Svelte component — destroyed before each re-render. */
	private _tasksPanel: TasksPanel | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TimeManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return TIME_MANAGER_AGENDA_VIEW; }
	getDisplayText(): string { return "Agenda"; }
	getIcon(): string { return "calendar-days"; }

	async onOpen(): Promise<void> {
		this.render();
		// When the user switches tabs, clear the pinned file so we fall back to
		// whatever leaf is now active.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this._pinnedFile = null;
				this.render();
			})
		);
		// When the multi-note editor scrolls to a new note, pin that file so the
		// AgendaView tracks the scroll position even though the leaf hasn't changed.
		const workspace = this.app.workspace as unknown as {
			on(name: "time-tools:focused-note", callback: (file: TFile) => void): EventRef;
		};
		this.registerEvent(
			workspace.on("time-tools:focused-note", (file) => {
				this._pinnedFile = file;
				this.render();
			})
		);
		this.registerEvent(
			this.app.vault.on("create", () => this.refreshImmediate())
		);
		this.registerEvent(
			this.app.vault.on("delete", () => this.refreshImmediate())
		);
	}

	async onClose(): Promise<void> { /* registerEvent handles cleanup */ }

	/** Debounced refresh — safe to call on high-frequency events like metadataCache.changed. */
	public refresh(): void {
		window.clearTimeout(this._refreshTimer);
		this._refreshTimer = window.setTimeout(() => this.render(), 200);
	}

	/** Immediate refresh — use when the caller already controls frequency (e.g. vault create/delete). */
	public refreshImmediate(): void { this.render(); }

	// ── Render ────────────────────────────────────────────────────────────────

	private render(): void {
		// Destroy existing Svelte component before clearing the DOM.
		if (this._tasksPanel) {
			this._tasksPanel.$destroy();
			this._tasksPanel = null;
		}

		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("tm-pnp");          // periodic-note panel root

		const activeFile = this._pinnedFile ?? this.app.workspace.getActiveFile();
		const meta = activeFile ? findInPeriodic(this.plugin, activeFile.path) : null;

		if (!meta) {
			this.renderEmptyState(contentEl);
			return;
		}

		const { granularity, date } = meta;
		const cfg = displayConfigs[granularity];
		const unit = GRAN_UNIT[granularity];
		const periodStart = granularity === "half-year" ? startOfHalfYear(date) : date.clone().startOf(unit);
		const periodEnd   = granularity === "half-year" ? endOfHalfYear(date)   : date.clone().endOf(unit);
		const periodLabel = granularity === "half-year" ? formatHalfYear(date) : date.format(PERIOD_FORMAT[granularity]);
		const periodLabelLong = granularity === "half-year" ? formatHalfYear(date) : date.format(PERIOD_FORMAT_LONG[granularity]);

		// ── Period header ──────────────────────────────────────────────────────
		const header = contentEl.createDiv({ cls: "tm-pnp-header" });

		const badge = header.createSpan({
			text: cfg.periodicity.charAt(0).toUpperCase() + cfg.periodicity.slice(1),
			cls: "tm-pnp-badge",
		});
		// Accent the badge for "day" to help orient the user
		if (granularity === "day" && date.isSame(moment(), "day")) {
			badge.addClass("tm-pnp-badge--today");
		}

		header.createDiv({
			text: periodLabel,
			cls: "tm-pnp-period-title",
		});

		// ── Toolbar ────────────────────────────────────────────────────────────
		const toolbar = contentEl.createDiv({ cls: "tm-pnp-toolbar" });

		// ← Prev
		const prevDate = granularity === "half-year" ? addHalfYears(date, -1) : date.clone().subtract(1, granularity as moment.unitOfTime.DurationConstructor);
		const prevExists = !!getPeriodicNote(this.plugin, granularity, prevDate);
		this.addToolbarBtn(toolbar, "arrow-left", `Previous ${cfg.periodicity}`, !prevExists, () => {
			void openPeriodicNote(this.plugin, granularity, prevDate);
		});

		// Period label (clickable → go to today)
		const todayDate = moment();
		const isOnToday = granularity === "half-year"
			? isSameHalfYear(date, todayDate)
			: date.isSame(todayDate, granularity === "week" ? "isoWeek" : granularity as moment.unitOfTime.StartOf);
		const periodBtn = toolbar.createEl("button", {
			cls: isOnToday ? "tm-pnp-toolbar-period tm-pnp-toolbar-period--current" : "tm-pnp-toolbar-period",
			attr: { "aria-label": `Go to current ${cfg.periodicity} (${periodLabelLong})` },
		});
		periodBtn.createSpan({ text: periodLabel });
		periodBtn.addEventListener("click", () => {
			void openPeriodicNote(this.plugin, granularity, moment());
		});

		// → Next
		const nextDate = granularity === "half-year" ? addHalfYears(date, 1) : date.clone().add(1, granularity as moment.unitOfTime.DurationConstructor);
		const nextExists = !!getPeriodicNote(this.plugin, granularity, nextDate);
		this.addToolbarBtn(toolbar, "arrow-right", `Next ${cfg.periodicity}`, !nextExists, () => {
			void openPeriodicNote(this.plugin, granularity, nextDate);
		});

		toolbar.createDiv({ cls: "tm-pnp-toolbar-spacer" });

		// Create note (only shown when note for this period doesn't exist)
		const noteExists = !!getPeriodicNote(this.plugin, granularity, date);
		if (!noteExists) {
			this.addToolbarBtn(toolbar, "file-plus", `Create this ${cfg.periodicity} note`, false, () => {
				void createPeriodicNote(this.plugin, granularity, date).then(() => this.render());
			});
		}

		// Open in multi-note editor
		this.addToolbarBtn(toolbar, "calendar-range", "Open in timeline editor", false, () => {
			void this.openInEditor(activeFile!.path, granularity);
		});

		// ── Work section: Tasks / Targets toggle ─────────────────────────────
		const workSection = contentEl.createDiv({ cls: "tm-pnp-work-section" });
		this.renderWorkToggle(workSection, granularity, date, periodStart, periodEnd);

		// ── Agenda (scrollable body — calendar events) ────────────────────────
		const agenda = contentEl.createDiv({ cls: "tm-pnp-agenda" });

		// ── Calendar events ───────────────────────────────────────────────────
		const sources = this.plugin.settings.time.calendarSources.filter((s) => s.enabled);

		if (sources.length === 0) {
			agenda.createEl("p", {
				text: "Add a calendar source in settings → calendar to see events here.",
				cls: "tm-pnp-agenda-empty",
			});
			return;
		}

		const loadingEl = agenda.createSpan({
			text: "Loading events…",
			cls: "tm-pnp-agenda-loading",
		});

		this.plugin.calendarService
			.getEventsForRange(periodStart, periodEnd)
			.then((byDay) => {
				loadingEl.remove();
				if (byDay.size === 0) {
					agenda.createSpan({
						text: "No events this period.",
						cls: "tm-pnp-agenda-empty",
					});
					return;
				}
				const sortedDays = Array.from(byDay.keys()).sort();
				for (const dayKey of sortedDays) {
					this.renderDayGroup(agenda, dayKey, byDay.get(dayKey)!, granularity);
				}
			})
			.catch((err) => {
				loadingEl.remove();
				agenda.createSpan({ text: "Failed to load events.", cls: "tm-pnp-agenda-error" });
				console.error("[time-tools] AgendaView:", err);
			});
	}

	// ── Work section (Tasks / Targets toggle) ─────────────────────────────────

	private renderWorkToggle(
		container: HTMLElement,
		granularity: Granularity,
		date: ReturnType<typeof moment>,
		periodStart: ReturnType<typeof moment>,
		periodEnd: ReturnType<typeof moment>
	): void {
		const mode = this.plugin.settings.time.agendaWorkSection;

		// Tab bar
		const tabs = container.createDiv({ cls: "tm-pnp-work-tabs" });

		const tasksTab = tabs.createEl("button", {
			text: "Tasks",
			cls: mode === "tasks" ? "tm-pnp-work-tab tm-pnp-work-tab--active" : "tm-pnp-work-tab",
		});
		const targetsTab = tabs.createEl("button", {
			text: "Targets",
			cls: mode === "targets" ? "tm-pnp-work-tab tm-pnp-work-tab--active" : "tm-pnp-work-tab",
		});

		// Body area
		const body = container.createDiv({ cls: "tm-pnp-work-body" });

		const switchTo = (newMode: "tasks" | "targets") => {
			this.plugin.settings.time.agendaWorkSection = newMode;
			void this.plugin.saveSettings();
			tasksTab.className   = newMode === "tasks"   ? "tm-pnp-work-tab tm-pnp-work-tab--active" : "tm-pnp-work-tab";
			targetsTab.className = newMode === "targets" ? "tm-pnp-work-tab tm-pnp-work-tab--active" : "tm-pnp-work-tab";
			body.empty();
			if (this._tasksPanel) { this._tasksPanel.$destroy(); this._tasksPanel = null; }
			if (newMode === "tasks") {
				this.mountTasksPanel(body, granularity, date);
			} else {
				this.renderTargetsBody(body, periodStart, periodEnd);
			}
		};

		tasksTab.addEventListener("click",   () => switchTo("tasks"));
		targetsTab.addEventListener("click", () => switchTo("targets"));

		// Mount initial body
		if (mode === "tasks") {
			this.mountTasksPanel(body, granularity, date);
		} else {
			this.renderTargetsBody(body, periodStart, periodEnd);
		}
	}

	private mountTasksPanel(
		target: HTMLElement,
		granularity: Granularity,
		date: ReturnType<typeof moment>
	): void {
		this._tasksPanel = new TasksPanel({
			target,
			props: { plugin: this.plugin, granularity, date },
		});
	}

	private renderTargetsBody(
		container: HTMLElement,
		periodStart: ReturnType<typeof moment>,
		periodEnd: ReturnType<typeof moment>
	): void {
		const svc = this.plugin.targetDateService;
		if (!svc) { container.createSpan({ text: "No targets.", cls: "tm-pnp-agenda-empty" }); return; }

		const targets = svc.getFilesWithTargetInRange(periodStart, periodEnd);
		if (targets.length === 0) {
			container.createSpan({ text: "No targets this period.", cls: "tm-pnp-agenda-empty" });
			return;
		}

		for (const { file, target } of targets) {
			const card = container.createDiv({ cls: "tm-pnp-target-card" });
			card.setAttribute("role", "button");
			card.setAttribute("tabindex", "0");
			card.setAttribute("title", "Click to preview · click open to open");
			card.createSpan({ cls: "tm-pnp-target-stripe", attr: { "aria-hidden": "true" } });
			const body = card.createDiv({ cls: "tm-pnp-target-body" });
			body.createSpan({
				text: file.basename,
				cls: "tm-pnp-target-title",
			});
			body.createSpan({
				text: labelTargetDate(target.raw, target.granularity),
				cls: "tm-pnp-target-date",
			});
			card.addEventListener("click", (e) => {
				e.stopPropagation();
				TargetPreviewPopover.show(this.app, file, target, card);
			});
			card.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					TargetPreviewPopover.show(this.app, file, target, card);
				}
			});
		}
	}

	// ── Day group ──────────────────────────────────────────────────────────────

	private renderDayGroup(
		container: HTMLElement,
		dayKey: string,
		events: CalendarEvent[],
		granularity: Granularity
	): void {
		const group = container.createDiv({ cls: "tm-pnp-day-group" });

		if (granularity !== "day") {
			const m = moment(dayKey, "YYYY-MM-DD");
			const isToday = m.isSame(moment(), "day");
			const heading = group.createDiv({
				cls: isToday ? "tm-pnp-day-heading tm-pnp-day-heading--today" : "tm-pnp-day-heading",
			});
			heading.createSpan({
				text: m.format("ddd D"),
				cls: "tm-pnp-day-label",
			});
			if (isToday) {
				heading.createSpan({ text: "Today", cls: "tm-pnp-today-chip" });
			}
		}

		for (const evt of events) {
			this.renderEventCard(group, evt);
		}
	}

	// ── Event card ─────────────────────────────────────────────────────────────

	private renderEventCard(container: HTMLElement, evt: CalendarEvent): void {
		const card = container.createDiv({ cls: "tm-pnp-event-card" });

		const stripe = card.createSpan({ cls: "tm-pnp-event-stripe" });
		// Use the source's explicit color if set; otherwise fall back to the
		// theme accent color via the CSS variable on .tm-pnp-event-stripe.
		if (evt.sourceColor) {
			stripe.style.setProperty("--tm-event-stripe-color", evt.sourceColor);
		}

		const body = card.createDiv({ cls: "tm-pnp-event-body" });
		body.createSpan({ text: evt.summary, cls: "tm-pnp-event-title" });

		const timeText = evt.allDay
			? "All day"
			: evt.end
			? `${evt.start.format("h:mm")}–${evt.end.format("h:mm a")}`
			: evt.start.format("h:mm a");
		body.createSpan({ text: timeText, cls: "tm-pnp-event-time" });
	}

	// ── Empty state ────────────────────────────────────────────────────────────

	private renderEmptyState(container: HTMLElement): void {
		const wrap = container.createDiv({ cls: "tm-pnp-empty" });
		const icon = wrap.createDiv({ cls: "tm-pnp-empty-icon" });
		setIcon(icon, "calendar-days");
		wrap.createEl("p", {
			text: "Open a periodic note to see its agenda and tools.",
			cls: "tm-pnp-empty-text",
		});
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	private addToolbarBtn(
		toolbar: HTMLElement,
		iconId: string,
		label: string,
		dimmed: boolean,
		onClick: () => void
	): HTMLButtonElement {
		const btn = toolbar.createEl("button", {
			cls: dimmed ? "tm-pnp-toolbar-btn tm-pnp-toolbar-btn--dimmed" : "tm-pnp-toolbar-btn",
			attr: { "aria-label": label },
		});
		setIcon(btn, iconId);
		btn.addEventListener("click", onClick);
		return btn;
	}

	private async openInEditor(filePath: string, granularity: Granularity): Promise<void> {
		const { workspace } = this.app;
		const file = workspace.getActiveFile();
		if (!file) return;
		const existing = workspace.getLeavesOfType(TIME_MANAGER_EDITOR_VIEW);
		let leaf: import("obsidian").WorkspaceLeaf;
		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getLeaf(true);
			await leaf.setViewState({ type: TIME_MANAGER_EDITOR_VIEW });
		}
		await workspace.revealLeaf(leaf);
		await (leaf.view as DailyNoteView).scrollToFile(file, granularity);
	}
}
