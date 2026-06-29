<script lang="ts">
	/**
	 * CalendarGrid -- day / week / month / year views for the CalendarView tab.
	 *
	 * Day view:   hourly time grid with events; open/create daily note button.
	 * Week view:  7 day columns with events and note buttons.
	 * Month view: 5--6 week rows x 7 day cells with note dots and event dots.
	 * Year view:  4x3 mini-month grid with note dots and today highlight.
	 */

	import { onDestroy, tick } from "svelte";
	import { Menu, moment, Notice, TFile } from "obsidian";
	import { TemplateSuggestModal, ExistingNoteSuggestModal, NoteNameModal } from "./CalendarNoteModal";
	import type TimeManagerPlugin from "../main";
	import type { CalendarEvent } from "./types";
	import type { TargetGranularity } from "../target-date/types";
	import { getPeriodicNote, createPeriodicNote } from "../periodic/api";
	import { formatTargetDate, targetDateToEndMoment } from "../target-date/target-date-service";
	import { TargetPreviewPopover } from "../target-date/TargetPreviewPopover";
	import Icon from "../utils/Icon.svelte";
	import TargetDatePanel from "./TargetDatePanel.svelte";
	import CalendarInboxPanel from "./CalendarInboxPanel.svelte";
	import CalendarChainsPanel from "./CalendarChainsPanel.svelte";
	import { getDragPayload, setDragPayload } from "./drag-state";
	import { ReminderModal } from "../reminders/ReminderModal";
	import { granularities, type Granularity } from "../periodic/types";
	import { halfOf } from "../periodic/half-year";

	// -- Props ----------------------------------------------------------------

	export let plugin: TimeManagerPlugin;
	/** "day" | "week" | "month" | "year" -- persisted via CalendarView getState/setState */
	export let viewType: "day" | "week" | "month" | "year" | "horizon" | "agenda" = "month";
	/** ISO date string (YYYY-MM-DD) used as the anchor for the visible range */
	export let anchorDate: string = moment().format("YYYY-MM-DD");
	/** Called whenever the period label changes so CalendarView can update the pane header. */
	export let onTitleChange: ((t: string) => void) | undefined = undefined;
	// -- Internal state --------------------------------------------------------

	let showTargetPanel  = false;
	let showInboxPanel   = false;
	let showChainsPanel  = false;
	let showFilterPanel  = false;

	// -- List panel state -------------------------------------------------------
	let showListPanel = false;
	let listPanelBefore = 30;
	let listPanelAfter  = 90;
	let listPanelScrollEl: HTMLElement | null = null;
	let listPanelEventsByDay: Map<string, import("./types").CalendarEvent[]> = new Map();
	let listPanelDayTargets: Map<string, TFile[]> = new Map();
	let listPanelFetchGen = 0;

	$: listPanelRangeStart = anchor.clone().subtract(listPanelBefore, "day").startOf("day");
	$: listPanelRangeEnd   = anchor.clone().add(listPanelAfter, "day").endOf("day");

	// Reactive target files for the list panel (day-granularity only, same metaVersion dep)
	$: {
		void metaVersion;
		if (showListPanel) {
			const items = plugin.targetDateService.getFilesWithTargetInRange(listPanelRangeStart, listPanelRangeEnd);
			const dm = new Map<string, TFile[]>();
			for (const { file, target } of items) {
				if (target.granularity === "day") {
					const arr = dm.get(target.raw) ?? [];
					arr.push(file);
					dm.set(target.raw, arr);
				}
			}
			listPanelDayTargets = dm;
		}
	}

	$: if (showListPanel) void fetchListPanelEvents(anchorDate, listPanelBefore, listPanelAfter);

	async function fetchListPanelEvents(ad: string, before: number, after: number): Promise<void> {
		if (!plugin.settings.time.calendarSources?.some(s => s.enabled)) return;
		const gen = ++listPanelFetchGen;
		const a = moment(ad, "YYYY-MM-DD");
		const s = a.clone().subtract(before, "day").startOf("day");
		const e = a.clone().add(after, "day").endOf("day");
		try {
			const result = await plugin.calendarService.getEventsForRange(s, e);
			if (gen !== listPanelFetchGen) return;
			listPanelEventsByDay = result;
		} catch (err) {
			if (gen !== listPanelFetchGen) return;
			console.error("[time-tools] ListPanel:", err);
		}
	}

	$: listPanelAllDays = showListPanel
		? Array.from({ length: listPanelBefore + listPanelAfter + 1 }, (_, i) =>
			anchor.clone().subtract(listPanelBefore - i, "day"))
		: ([] as ReturnType<typeof moment>[]);

	$: listPanelDaysWithContent = listPanelAllDays.filter(d => {
		const dk = dayKey(d);
		return (listPanelEventsByDay.get(dk) ?? []).length > 0 || (listPanelDayTargets.get(dk) ?? []).length > 0;
	});

	// Scroll to today/anchor when the panel opens
	$: if (showListPanel) {
		tick().then(() => {
			listPanelScrollEl?.querySelector<HTMLElement>(`#lp-day-${anchorDate}`)?.scrollIntoView({ block: "start" });
		});
	}

	function listPanelTopSentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(async entries => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					const prevH = listPanelScrollEl?.scrollHeight ?? 0;
					listPanelBefore += 30;
					await tick();
					if (listPanelScrollEl) listPanelScrollEl.scrollTop += listPanelScrollEl.scrollHeight - prevH;
				}
			}
		}, { rootMargin: "200px" });
		observer.observe(node);
		return { destroy() { observer.disconnect(); } };
	}

	function listPanelBottomSentinel(node: HTMLElement) {
		const observer = new IntersectionObserver(entries => {
			for (const entry of entries) {
				if (entry.isIntersecting) listPanelAfter += 30;
			}
		}, { rootMargin: "200px" });
		observer.observe(node);
		return { destroy() { observer.disconnect(); } };
	}

	// -- Drag state ------------------------------------------------------------

	/** Key of the cell currently under an active drag ("YYYY-MM-DD" or "week-YYYY-WXX"). */
	let dragOverKey: string | null = null;
	/** Hour (0–23) of the day-view slot currently under an active drag, or null. */
	let dragOverHour: number | null = null;

	// -- Target date maps (reactive to range + metadata changes) ---------------

	/** Incremented on every metadataCache.changed or vault delete -- forces reactive re-derive. */
	let metaVersion = 0;
	const _unsubMeta = plugin.app.metadataCache.on("changed", () => { metaVersion++; });
	const _unsubDelete = plugin.app.vault.on("delete", () => { metaVersion++; });
	onDestroy(() => {
		plugin.app.metadataCache.offref(_unsubMeta);
		plugin.app.vault.offref(_unsubDelete);
	});

	/** Files with day-granularity targetDate, keyed by "YYYY-MM-DD". */
	let dayTargets: Map<string, TFile[]> = new Map();
	/** Files with week-granularity targetDate, keyed by "YYYY-WXX" (formatTargetDate week format). */
	let weekTargets: Map<string, TFile[]> = new Map();
	/** Files with month-granularity targetDate, keyed by "YYYY-MM". */
	let monthTargets: Map<string, TFile[]> = new Map();
	/** Files with year-granularity targetDate, keyed by "YYYY". */
	let yearTargets: Map<string, TFile[]> = new Map();
	/** Files with quarter-granularity targetDate, keyed by "YYYY-Q1" etc. */
	let quarterTargets: Map<string, TFile[]> = new Map();
	/** Files with half-year-granularity targetDate, keyed by "YYYY-H1" or "YYYY-H2". */
	let halfYearTargets: Map<string, TFile[]> = new Map();

	$: {
		// Depend on metaVersion so this re-runs on every metadata change.
		void metaVersion;
		const items = plugin.targetDateService.getFilesWithTargetInRange(rangeStart, rangeEnd);
		const dm = new Map<string, TFile[]>();
		const wm = new Map<string, TFile[]>();
		const mm = new Map<string, TFile[]>();
		const ym = new Map<string, TFile[]>();
		const qm = new Map<string, TFile[]>();
		const hm = new Map<string, TFile[]>();
		for (const { file, target } of items) {
			if (target.granularity === "day") {
				const key = target.raw; // YYYY-MM-DD
				const arr = dm.get(key) ?? [];
				arr.push(file);
				dm.set(key, arr);
			} else if (target.granularity === "week") {
				const key = target.raw; // YYYY-WXX
				const arr = wm.get(key) ?? [];
				arr.push(file);
				wm.set(key, arr);
			} else if (target.granularity === "month") {
				const key = target.raw; // YYYY-MM
				const arr = mm.get(key) ?? [];
				arr.push(file);
				mm.set(key, arr);
			} else if (target.granularity === "year") {
				const key = target.raw; // YYYY
				const arr = ym.get(key) ?? [];
				arr.push(file);
				ym.set(key, arr);
			} else if (target.granularity === "quarter") {
				const key = target.raw; // YYYY-Q1 etc.
				const arr = qm.get(key) ?? [];
				arr.push(file);
				qm.set(key, arr);
			} else if (target.granularity === "half-year") {
				const key = target.raw; // YYYY-H1 or YYYY-H2
				const arr = hm.get(key) ?? [];
				arr.push(file);
				hm.set(key, arr);
			}
		}
		dayTargets = dm;
		weekTargets = wm;
		monthTargets = mm;
		yearTargets = ym;
		quarterTargets = qm;
		halfYearTargets = hm;
	}

	/** Files with a reminderDate, keyed by "YYYY-MM-DD". */
	let remindersByDay: Map<string, TFile[]> = new Map();

	$: {
		void metaVersion;
		const start = rangeStart.format("YYYY-MM-DD");
		const end = rangeEnd.format("YYYY-MM-DD");
		remindersByDay = plugin.reminderService.getFilesWithReminderInRange(start, end);
	}

	/** Day-view reminders split by timed (keyed by hour) vs untimed (all-day bar). */
	let dayUntimedReminders: TFile[] = [];
	let dayTimedReminders: Map<number, TFile[]> = new Map();

	$: {
		void metaVersion;
		void remindersByDay;
		const files = remindersByDay.get(dayKey(anchor)) ?? [];
		const untimedArr: TFile[] = [];
		const timedMap = new Map<number, TFile[]>();
		for (const tf of files) {
			const r = plugin.reminderService.getReminder(tf);
			if (r?.time && /^\d{1,2}:\d{2}$/.test(r.time)) {
				const h = parseInt(r.time.split(":")[0], 10);
				if (h >= 0 && h < 24) {
					const arr = timedMap.get(h) ?? [];
					arr.push(tf);
					timedMap.set(h, arr);
					continue;
				}
			}
			untimedArr.push(tf);
		}
		dayUntimedReminders = untimedArr;
		dayTimedReminders = timedMap;
	}

	/** Week-view reminders split by day key, then timed vs untimed. */
	let weekDayUntimedReminders: Map<string, TFile[]> = new Map();
	let weekDayTimedReminders: Map<string, Map<number, TFile[]>> = new Map();

	$: {
		void metaVersion;
		void remindersByDay;
		const um = new Map<string, TFile[]>();
		const tm = new Map<string, Map<number, TFile[]>>();
		for (const [dk, files] of remindersByDay) {
			const untimedArr: TFile[] = [];
			const timedMap = new Map<number, TFile[]>();
			for (const tf of files) {
				const r = plugin.reminderService.getReminder(tf);
				if (r?.time && /^\d{1,2}:\d{2}$/.test(r.time)) {
					const h = parseInt(r.time.split(":")[0], 10);
					if (h >= 0 && h < 24) {
						const arr = timedMap.get(h) ?? [];
						arr.push(tf);
						timedMap.set(h, arr);
						continue;
					}
				}
				untimedArr.push(tf);
			}
			um.set(dk, untimedArr);
			tm.set(dk, timedMap);
		}
		weekDayUntimedReminders = um;
		weekDayTimedReminders = tm;
	}

	/** Deduplicated list of all reminder files in the current range (for year-view bar). */
	$: yearViewReminders = (() => {
		const seen = new Set<string>();
		const files: TFile[] = [];
		for (const arr of remindersByDay.values()) {
			for (const f of arr) {
				if (!seen.has(f.path)) { seen.add(f.path); files.push(f); }
			}
		}
		return files;
	})();

	/** Day-view targets that have no startTime -- shown in the header bar as all-day chips. */
	let dayUntimedTargets: TFile[] = [];
	/** Day-view targets keyed by start hour (from startTime frontmatter). */
	let dayTimedTargets: Map<number, TFile[]> = new Map();

	$: {
		void metaVersion;
		const key = dayKey(anchor);
		const files = dayTargets.get(key) ?? [];
		const untimedArr: TFile[] = [];
		const timedMap = new Map<number, TFile[]>();
		for (const tf of files) {
			const st: string | undefined = plugin.app.metadataCache.getFileCache(tf)?.frontmatter?.startTime;
			if (st && /^\d{1,2}:\d{2}$/.test(st)) {
				const h = parseInt(st.split(":")[0], 10);
				if (h >= 0 && h < 24) {
					const arr = timedMap.get(h) ?? [];
					arr.push(tf);
					timedMap.set(h, arr);
					continue;
				}
			}
			untimedArr.push(tf);
		}
		dayUntimedTargets = untimedArr;
		dayTimedTargets = timedMap;
	}

	/**
	 * Week-view per-day timed/untimed split.
	 * Keyed by "YYYY-MM-DD". Mirrors the day-view split but for all 7 days.
	 */
	let weekDayUntimedTargets: Map<string, TFile[]> = new Map();
	let weekDayTimedTargets: Map<string, Map<number, TFile[]>> = new Map();

	$: {
		void metaVersion;
		void dayTargets; // depend on dayTargets so this re-runs when it changes
		const um = new Map<string, TFile[]>();
		const tm = new Map<string, Map<number, TFile[]>>();
		for (const [dk, files] of dayTargets) {
			const untimedArr: TFile[] = [];
			const timedMap = new Map<number, TFile[]>();
			for (const tf of files) {
				const st: string | undefined = plugin.app.metadataCache.getFileCache(tf)?.frontmatter?.startTime;
				if (st && /^\d{1,2}:\d{2}$/.test(st)) {
					const h = parseInt(st.split(":")[0], 10);
					if (h >= 0 && h < 24) {
						const arr = timedMap.get(h) ?? [];
						arr.push(tf);
						timedMap.set(h, arr);
						continue;
					}
				}
				untimedArr.push(tf);
			}
			um.set(dk, untimedArr);
			tm.set(dk, timedMap);
		}
		weekDayUntimedTargets = um;
		weekDayTimedTargets = tm;
	}

	// `anchor` is derived from `anchorDate` (single source of truth).
	// This creates a clear reactive chain: anchorDate -> anchor -> range* -> rangeKey -> fetch.
	$: anchor = moment(anchorDate, "YYYY-MM-DD");

	let eventsByDay: Map<string, CalendarEvent[]> = new Map();
	let loading = false;
	let hasLoadedOnce = false;

	// Day-of-week header labels (Mon-first, ISO weeks)
	const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
	const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
	const HOURS = Array.from({ length: 24 }, (_, i) => i);

	// -- Exported accessors for state persistence ------------------------------

	export function getViewType(): "day" | "week" | "month" | "year" | "horizon" | "agenda" { return viewType; }
	export function getAnchorDate(): string { return anchorDate; }
	/** Called by CalendarView.setState after every $set to guarantee a fetch fires. */
	export function refresh(): void { void fetchEvents(anchorDate, viewType); }

	// -- Derived grid data -----------------------------------------------------

	$: weekEnabled = plugin.settings.time.week.enabled;
	$: dayEnabled  = plugin.settings.time.day.enabled;

	$: title = viewType === "month"   ? anchor.format("MMMM YYYY")
	         : viewType === "week"    ? `Week ${anchor.isoWeek()} - ${anchor.format("YYYY")}`
	         : viewType === "day"     ? anchor.format("ddd, MMM D, YYYY")
	         : viewType === "horizon" ? "Horizon"
	         : viewType === "agenda"  ? `Agenda · ${anchor.format("MMM D")} – ${anchor.clone().add(29, "day").format("MMM D, YYYY")}`
	         :                          anchor.format("YYYY");

	$: onTitleChange?.(title);

	$: monthWeeks  = buildMonthGrid(anchor);
	$: weekDays    = buildWeekDays(anchor);
	$: yearMonths  = buildYearMonths(anchor);

	$: rangeStart = viewType === "month"  ? anchor.clone().startOf("month").startOf("isoWeek")
	              : viewType === "week"   ? anchor.clone().startOf("isoWeek")
	              : viewType === "day"    ? anchor.clone().startOf("day")
	              : viewType === "agenda" ? anchor.clone().startOf("day")
	              :                         anchor.clone().startOf("year");
	$: rangeEnd = viewType === "month"  ? anchor.clone().endOf("month").endOf("isoWeek")
	            : viewType === "week"   ? anchor.clone().endOf("isoWeek")
	            : viewType === "day"    ? anchor.clone().endOf("day")
	            : viewType === "agenda" ? anchor.clone().add(29, "day").endOf("day")
	            :                         anchor.clone().endOf("year");

	$: gridColumns = weekEnabled
		? "32px repeat(7, 1fr)"
		: "repeat(7, 1fr)";

	// IDs of calendar sources currently set to visible (reactive to settings changes)
	$: visibleSourceIds = new Set(
		plugin.settings.time.calendarSources
			.filter(s => s.visible !== false)
			.map(s => s.id)
	);
	$: showTargetFiles = plugin.settings.time.showTargetFiles !== false;

	// eventsByDay filtered to only visible sources
	$: visibleEventsByDay = (() => {
		const m = new Map<string, import("./types").CalendarEvent[]>();
		for (const [k, evts] of eventsByDay) {
			const filtered = evts.filter(e => visibleSourceIds.has(e.sourceId));
			if (filtered.length > 0) m.set(k, filtered);
		}
		return m;
	})();

	// Day view -- split events into all-day and timed
	$: dayAllEvents   = visibleEventsByDay.get(dayKey(anchor)) ?? [];
	$: dayAllDayEvts  = dayAllEvents.filter(e => e.allDay);
	$: dayTimedEvts   = dayAllEvents.filter(e => !e.allDay);

	// -- Fetch events ----------------------------------------------------------

	// Generation counter -- incremented on every fetchEvents call so that a
	// slower earlier fetch cannot overwrite the result of a faster later one.
	let fetchGen = 0;

	// Re-fetch whenever anchorDate or viewType changes (navigation, view switch,
	// or parent setState calling $set). The reactive statement runs during
	// component init, so the onMount fetch that used to live here is removed
	// (it was a redundant double-fetch on every mount).
	$: void fetchEvents(anchorDate, viewType);

	async function fetchEvents(ad: string, vt: string): Promise<void> {
		if (!plugin.settings.time.calendarSources?.some((s) => s.enabled)) return;

		const gen = ++fetchGen;

		const a = moment(ad, "YYYY-MM-DD");
		const start = vt === "month"  ? a.clone().startOf("month").startOf("isoWeek")
		            : vt === "week"   ? a.clone().startOf("isoWeek")
		            : vt === "day"    ? a.clone().startOf("day")
		            : vt === "agenda" ? a.clone().startOf("day")
		            :                   a.clone().startOf("year");
		const end   = vt === "month"  ? a.clone().endOf("month").endOf("isoWeek")
		            : vt === "week"   ? a.clone().endOf("isoWeek")
		            : vt === "day"    ? a.clone().endOf("day")
		            : vt === "agenda" ? a.clone().add(29, "day").endOf("day")
		            :                   a.clone().endOf("year");

		loading = true;
		try {
			const result = await plugin.calendarService.getEventsForRange(start, end);
			// Drop stale results from an earlier fetch that resolved out of order.
			if (gen !== fetchGen) return;
			eventsByDay = result;
			hasLoadedOnce = true;
		} catch (e) {
			if (gen !== fetchGen) return;
			console.error("[time-tools] CalendarGrid:", e);
		} finally {
			if (gen === fetchGen) loading = false;
		}
	}

	// -- Grid helpers ----------------------------------------------------------

	function buildMonthGrid(d: ReturnType<typeof moment>): ReturnType<typeof moment>[][] {
		const start = d.clone().startOf("month").startOf("isoWeek");
		const end   = d.clone().endOf("month").endOf("isoWeek");
		const weeks: ReturnType<typeof moment>[][] = [];
		let cur = start.clone();
		while (cur.isSameOrBefore(end, "day")) {
			const week = Array.from({ length: 7 }, () => { const x = cur.clone(); cur.add(1, "day"); return x; });
			weeks.push(week);
		}
		return weeks;
	}

	function buildWeekDays(d: ReturnType<typeof moment>): ReturnType<typeof moment>[] {
		const start = d.clone().startOf("isoWeek");
		return Array.from({ length: 7 }, (_, i) => start.clone().add(i, "day"));
	}

	function buildYearMonths(d: ReturnType<typeof moment>): Array<{ m: ReturnType<typeof moment>; weeks: ReturnType<typeof moment>[][] }> {
		return Array.from({ length: 12 }, (_, i) => {
			const m = d.clone().startOf("year").add(i, "month");
			return { m, weeks: buildMonthGrid(m) };
		});
	}

	function dayKey(d: ReturnType<typeof moment>): string { return d.format("YYYY-MM-DD"); }
	function isToday(d: ReturnType<typeof moment>): boolean { return d.isSame(moment(), "day"); }
	function isCurrentMonth(d: ReturnType<typeof moment>): boolean { return d.isSame(anchor, "month"); }

	function eventsForDay(d: ReturnType<typeof moment>): CalendarEvent[] {
		return visibleEventsByDay.get(dayKey(d)) ?? [];
	}

	function noteExistsForDay(d: ReturnType<typeof moment>): boolean {
		if (!dayEnabled) return false;
		return !!getPeriodicNote(plugin, "day", d);
	}

	function weekNoteExists(d: ReturnType<typeof moment>): boolean {
		if (!weekEnabled) return false;
		return !!getPeriodicNote(plugin, "week", d);
	}

	function formatHour(h: number): string {
		if (h === 0)  return "12 AM";
		if (h < 12)   return `${h} AM`;
		if (h === 12) return "12 PM";
		return `${h - 12} PM`;
	}

	function eventsForHour(h: number): CalendarEvent[] {
		return dayTimedEvts.filter(e => e.start.hour() === h);
	}

	// -- Actions ---------------------------------------------------------------

	async function openDay(d: ReturnType<typeof moment>): Promise<void> {
		if (!dayEnabled) return;
		let note = getPeriodicNote(plugin, "day", d);
		if (!note) note = await createPeriodicNote(plugin, "day", d);
		await plugin.app.workspace.getLeaf(false).openFile(note);
	}

	async function openWeek(d: ReturnType<typeof moment>): Promise<void> {
		if (!weekEnabled) return;
		let note = getPeriodicNote(plugin, "week", d);
		if (!note) note = await createPeriodicNote(plugin, "week", d);
		await plugin.app.workspace.getLeaf(false).openFile(note);
	}

	// -- Navigation ------------------------------------------------------------

	function navigate(dir: -1 | 1): void {
		const unit = viewType === "month"   ? "month" as const
		           : viewType === "week"    ? "week"  as const
		           : viewType === "day"     ? "day"   as const
		           : viewType === "horizon" ? "day"   as const
		           : viewType === "agenda"  ? "day"   as const
		           :                          "year"  as const;
		const amount = viewType === "agenda" ? dir * 30 : dir;
		anchorDate = anchor.clone().add(amount, unit).format("YYYY-MM-DD");
	}

	function goToday(): void {
		anchorDate = moment().format("YYYY-MM-DD");
	}

	// -- Horizon view ----------------------------------------------------------

	interface HorizonBand {
		gran: Granularity;
		granLabel: string;
		periodLabel: string;
		noteExists: boolean;
		targets: TFile[];
	}

	async function openPeriodicNote(gran: Granularity): Promise<void> {
		let note = getPeriodicNote(plugin, gran, anchor);
		if (!note) note = await createPeriodicNote(plugin, gran, anchor);
		await plugin.app.workspace.getLeaf(false).openFile(note);
	}

	// Ordered from largest to smallest; only show enabled granularities.
	// Depends on anchor + all 6 target maps so it re-runs whenever any changes.
	$: horizonBands = ((): HorizonBand[] => {
		const ordered: Granularity[] = ["year", "half-year", "quarter", "month", "week", "day"];
		return ordered
			.filter(g => plugin.settings.time[g]?.enabled)
			.map(gran => {
				let targets: TFile[];
				let periodLabel: string;
				let granLabel: string;
				const h = halfOf(anchor);
				switch (gran) {
					case "year":
						targets = yearTargets.get(anchor.format("YYYY")) ?? [];
						periodLabel = anchor.format("YYYY");
						granLabel = "Year";
						break;
					case "half-year":
						targets = halfYearTargets.get(`${anchor.year()}-H${h}`) ?? [];
						periodLabel = `H${h} ${anchor.format("YYYY")}`;
						granLabel = "Half‑Year";
						break;
					case "quarter":
						targets = quarterTargets.get(anchor.format("YYYY-[Q]Q")) ?? [];
						periodLabel = `Q${anchor.quarter()} ${anchor.format("YYYY")}`;
						granLabel = "Quarter";
						break;
					case "month":
						targets = monthTargets.get(anchor.format("YYYY-MM")) ?? [];
						periodLabel = anchor.format("MMMM YYYY");
						granLabel = "Month";
						break;
					case "week":
						targets = weekTargets.get(anchor.format("YYYY-[W]WW")) ?? [];
						periodLabel = `Week ${anchor.isoWeek()} · ${anchor.format("YYYY")}`;
						granLabel = "Week";
						break;
					case "day":
						targets = dayTargets.get(anchor.format("YYYY-MM-DD")) ?? [];
						periodLabel = anchor.format("ddd, MMM D");
						granLabel = "Day";
						break;
					default:
						targets = [];
						periodLabel = "";
						granLabel = "";
				}
				return {
					gran,
					granLabel,
					periodLabel,
					noteExists: !!getPeriodicNote(plugin, gran, anchor),
					targets,
				};
			});
	})();

	function switchView(v: "day" | "week" | "month" | "year" | "horizon" | "agenda"): void {
		viewType = v;
	}

	function openDayView(e: MouseEvent, day: ReturnType<typeof moment>): void {
		const target = e.target as HTMLElement;
		if (target.closest("button, .tm-cal-target-chip")) return;
		anchorDate = dayKey(day);
		viewType = "day";
	}

	// -- Drag / drop handlers --------------------------------------------------

	function onDragOver(e: DragEvent, key: string): void {
		const payload = getDragPayload();
		// Also accept drags from external panels (e.g. obsidian-task-tools chain view)
		// that set a file path via dataTransfer but don't call setDragPayload().
		const hasExternalFilePath = !payload && !!e.dataTransfer?.types.includes("text/plain");
		if (!payload && !hasExternalFilePath) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
		dragOverKey = key;
	}

	function onDragLeave(key: string): void {
		if (dragOverKey === key) dragOverKey = null;
	}

	function onDragOverHour(e: DragEvent, hour: number): void {
		const payload = getDragPayload();
		const hasExternalFilePath = !payload && !!e.dataTransfer?.types.includes("text/plain");
		if (!payload && !hasExternalFilePath) return;
		e.preventDefault();
		e.stopPropagation(); // prevent outer day-view drop target from also highlighting
		if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
		dragOverHour = hour;
		dragOverKey = null;
	}

	function onDragLeaveHour(hour: number): void {
		if (dragOverHour === hour) dragOverHour = null;
	}

	async function onDropTime(e: DragEvent, date: ReturnType<typeof moment>, hour: number): Promise<void> {
		e.preventDefault();
		e.stopPropagation();
		dragOverHour = null;
		dragOverKey = null;

		const payload = getDragPayload();
		const filePath = payload?.filePath ?? e.dataTransfer?.getData("text/plain") ?? "";
		if (!filePath) return;

		const abstract = plugin.app.vault.getAbstractFileByPath(filePath);
		if (!(abstract instanceof TFile)) return;
		const file = abstract;

		const startTime = `${String(hour).padStart(2, "0")}:00`;
		const endTime = `${String((hour + 1) % 24).padStart(2, "0")}:00`;

		try {
			if (payload?.type === "reminder") {
				await plugin.reminderService.setReminder(file, date.format("YYYY-MM-DD"), startTime);
			} else {
				await plugin.targetDateService.setTargetDate(file, date, "day");
				await plugin.app.fileManager.processFrontMatter(file, (fm) => {
					fm["startTime"] = startTime;
					fm["endTime"] = endTime;
				});
			}
		} catch (err) {
			console.error("[time-tools] Failed to set time slot:", err);
			new Notice(`Failed to set time: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** Remove targetDate, startTime, and endTime — chip disappears entirely. */
	async function clearTimeSlot(e: MouseEvent, file: TFile): Promise<void> {
		e.stopPropagation();
		e.preventDefault();
		await plugin.targetDateService.clearTargetDate(file);
		await plugin.app.fileManager.processFrontMatter(file, (fm) => {
			delete fm["startTime"];
			delete fm["endTime"];
		});
	}

	async function onDrop(e: DragEvent, date: ReturnType<typeof moment>, gran: TargetGranularity): Promise<void> {
		e.preventDefault();
		dragOverKey = null;

		// Resolve the payload: prefer the in-process singleton (set by time-tools panels),
		// fall back to the dataTransfer file path (set by external panels like task-tools chains).
		const payload = getDragPayload();
		const filePath = payload?.filePath ?? e.dataTransfer?.getData("text/plain") ?? "";
		if (!filePath) return;

		const abstract = plugin.app.vault.getAbstractFileByPath(filePath);
		if (!(abstract instanceof TFile)) return;
		const file = abstract;

		try {
			if (payload?.type === "reminder") {
				await plugin.reminderService.setReminder(file, date.format("YYYY-MM-DD"), undefined);
			} else if (payload?.type === "inline" && payload.line !== undefined) {
				await addInlineTargetTag(file, payload.line, date, gran);
			} else {
				await plugin.targetDateService.setTargetDate(file, date, gran);
				// Dropping on an all-day day target (not a specific hour slot) clears any
				// time scheduling, converting the chip back to an all-day header chip.
				if (gran === "day") {
					await plugin.app.fileManager.processFrontMatter(file, (fm) => {
						delete fm["startTime"];
						delete fm["endTime"];
					});
				}
			}
			// metaVersion will be bumped by the metadataCache.changed event automatically.
		} catch (err) {
			console.error("[time-tools] Failed to set target date:", err);
			new Notice(`Failed to set target date: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async function clearTargetDate(e: MouseEvent, file: TFile): Promise<void> {
		e.stopPropagation();
		e.preventDefault();
		await plugin.targetDateService.clearTargetDate(file);
	}

	function previewChip(e: MouseEvent, file: TFile): void {
		e.stopPropagation();
		const td = plugin.targetDateService.getTargetDate(file);
		if (!td) return;
		const endMoment = targetDateToEndMoment(td.raw, td.granularity);
		if (!endMoment) return;
		TargetPreviewPopover.show(plugin.app, file, { ...td, endMoment }, e.currentTarget as HTMLElement);
	}

	// -- Right-click / context menu helpers -----------------------------------

	async function createNoteAt(
		date: ReturnType<typeof moment>,
		gran: TargetGranularity,
		hour?: number,
		templateContent?: string,
		nameOverride?: string
	): Promise<void> {
		const app = plugin.app;
		const dateStr = formatTargetDate(date, gran);
		const timeStr = hour !== undefined ? ` ${String(hour).padStart(2, "0")}00` : "";
		const baseName = nameOverride ?? (dateStr + timeStr);

		let path = `${baseName}.md`;
		let counter = 1;
		while (app.vault.getAbstractFileByPath(path)) {
			path = `${baseName} ${counter}.md`;
			counter++;
		}

		const file = await app.vault.create(path, templateContent ?? "");
		await plugin.targetDateService.setTargetDate(file, date, gran);

		if (gran === "day" && hour !== undefined) {
			const startTime = `${String(hour).padStart(2, "0")}:00`;
			const endTime   = `${String((hour + 1) % 24).padStart(2, "0")}:00`;
			await app.fileManager.processFrontMatter(file, (fm) => {
				fm["startTime"] = startTime;
				fm["endTime"]   = endTime;
			});
		}

		await app.workspace.getLeaf(false).openFile(file);
	}

	function showNewNoteMenu(
		e: MouseEvent,
		date: ReturnType<typeof moment>,
		gran: TargetGranularity,
		hour?: number
	): void {
		e.preventDefault();
		e.stopPropagation();

		const h = date.month() < 6 ? 1 : 2;
		const label =
			gran === "day"       ? date.format("MMM D, YYYY") + (hour !== undefined ? ` at ${formatHour(hour)}` : "")
			: gran === "week"    ? `W${date.isoWeek()} ${date.year()}`
			: gran === "month"   ? date.format("MMMM YYYY")
			: gran === "quarter" ? `Q${date.quarter()} ${date.year()}`
			: gran === "half-year" ? `H${h} ${date.year()}`
			: date.format("YYYY");

		const menu = new Menu();

		menu.addItem(item => {
			item.setTitle(`New note — ${label}`)
				.setIcon("file-plus")
				.onClick(() => void createNoteAt(date, gran, hour));
		});

		menu.addItem(item => {
			item.setTitle(`New note from template — ${label}`)
				.setIcon("layout-template")
				.onClick(() => {
					new TemplateSuggestModal(plugin.app, (templateFile) => {
						void plugin.app.vault.cachedRead(templateFile).then((content) => {
							const dateStr = formatTargetDate(date, gran);
							const timeStr = hour !== undefined ? ` ${String(hour).padStart(2, "0")}00` : "";
							const defaultName = dateStr + timeStr;
							new NoteNameModal(plugin.app, defaultName, (name) => {
								void createNoteAt(date, gran, hour, content, name);
							}).open();
						});
					}).open();
				});
		});

		menu.addItem(item => {
			item.setTitle(`Add existing note — ${label}`)
				.setIcon("file-search")
				.onClick(() => {
					new ExistingNoteSuggestModal(plugin.app, (file) => {
						void plugin.targetDateService.setTargetDate(file, date, gran).then(() => {
							if (gran === "day" && hour !== undefined) {
								const startTime = `${String(hour).padStart(2, "0")}:00`;
								const endTime   = `${String((hour + 1) % 24).padStart(2, "0")}:00`;
								void plugin.app.fileManager.processFrontMatter(file, (fm) => {
									fm["startTime"] = startTime;
									fm["endTime"]   = endTime;
								});
							}
						});
					}).open();
				});
		});

		menu.showAtMouseEvent(e);
	}

	/** Append (or replace existing) #target/DATE tag on a specific line. */
	async function addInlineTargetTag(
		file: TFile,
		line: number,
		date: ReturnType<typeof moment>,
		gran: TargetGranularity
	): Promise<void> {
		const tagValue = formatTargetDate(date, gran);
		const fullTag = `#target/${tagValue}`;
		const content = await plugin.app.vault.read(file);
		const lines = content.split("\n");
		if (line >= lines.length) return;
		// Replace any existing #target/* tag on this line, then append the new one.
		const updated = lines[line].replace(/#target\/[\w-]+/g, "").replace(/\s{2,}/g, " ").trimEnd();
		lines[line] = `${updated} ${fullTag}`.trimStart();
		await plugin.app.vault.modify(file, lines.join("\n"));
	}

	// ── Status icon helpers ────────────────────────────────────────────────────

	type NoteStatus = "Backlog" | "Todo" | "In Progress" | "Done" | "Cancelled";

	const STATUS_CYCLE: Array<NoteStatus | null> = [null, "Backlog", "Todo", "In Progress", "Done", "Cancelled"];

	function getFileStatus(file: TFile): NoteStatus | null {
		const raw = plugin.app.metadataCache.getFileCache(file)?.frontmatter?.["status"];
		if (raw === "Backlog" || raw === "Todo" || raw === "In Progress" || raw === "Done" || raw === "Cancelled") {
			return raw;
		}
		return null;
	}

	async function cycleStatus(e: MouseEvent, file: TFile): Promise<void> {
		e.stopPropagation();
		e.preventDefault();
		const current = getFileStatus(file);
		const idx = STATUS_CYCLE.indexOf(current);
		const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
		await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			if (next === null) {
				delete fm["status"];
			} else {
				fm["status"] = next;
			}
		});
	}

	function showChipMenu(e: MouseEvent, tf: TFile): void {
		e.preventDefault();
		e.stopPropagation();
		const menu = new Menu();
		const current = getFileStatus(tf);

		const ALL_STATUSES: NoteStatus[] = ["Backlog", "Todo", "In Progress", "Done", "Cancelled"];
		for (const status of ALL_STATUSES) {
			menu.addItem((item) =>
				item
					.setSection("status")
					.setTitle(status)
					.setChecked(current === status)
					.onClick(() => void plugin.app.fileManager.processFrontMatter(tf, (fm: Record<string, unknown>) => { fm["status"] = status; }))
			);
		}
		if (current !== null) {
			menu.addItem((item) =>
				item
					.setSection("status")
					.setTitle("Clear status")
					.setIcon("x")
					.onClick(() => void plugin.app.fileManager.processFrontMatter(tf, (fm: Record<string, unknown>) => { delete fm["status"]; }))
			);
		}

		menu.addItem((item) =>
			item
				.setSection("file")
				.setTitle("Open in new tab")
				.setIcon("arrow-up-right")
				.onClick(() => void plugin.app.workspace.getLeaf("tab").openFile(tf))
		);

		menu.addItem((item) =>
			item
				.setSection("danger")
				.setTitle("Remove target date")
				.setIcon("target")
				.onClick(() => void plugin.targetDateService.clearTargetDate(tf))
		);
		menu.addItem((item) =>
			item
				.setSection("danger")
				.setTitle("Delete file")
				.setIcon("trash-2")
				.onClick(() => void plugin.app.vault.trash(tf, true))
		);

		menu.showAtMouseEvent(e);
	}

	function showReminderChipMenu(e: MouseEvent, tf: TFile): void {
		e.preventDefault();
		e.stopPropagation();
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Open file")
				.setIcon("file-text")
				.onClick(() => void plugin.app.workspace.getLeaf(false).openFile(tf))
		);
		menu.addItem((item) =>
			item
				.setTitle("Reschedule reminder")
				.setIcon("alarm-clock")
				.onClick(() => {
					new ReminderModal(plugin.app, (date, time) => {
						void plugin.reminderService.setReminder(tf, date, time);
					}).open();
				})
		);
		menu.addItem((item) =>
			item
				.setTitle("Cancel reminder")
				.setIcon("bell-off")
				.onClick(() => void plugin.reminderService.clearReminder(tf))
		);
		menu.showAtMouseEvent(e);
	}

	function statusSvg(status: NoteStatus | null): string {
		switch (status) {
			case "Backlog":
				return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="#A1A1A1" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 4"/></svg>`;
			case "Todo":
				return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="#A1A1A1" stroke-width="2" stroke-linecap="round"/></svg>`;
			case "In Progress":
				return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="#BD8E37" stroke-width="2" stroke-linecap="round"/><path d="M12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6V18Z" fill="#BD8E37"/></svg>`;
			case "Done":
				return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2ZM15.707 9.29297C15.3165 8.90244 14.6835 8.90244 14.293 9.29297L11 12.5859L9.70703 11.293C9.31651 10.9024 8.68349 10.9024 8.29297 11.293C7.90244 11.6835 7.90244 12.3165 8.29297 12.707L10.293 14.707C10.6835 15.0976 11.3165 15.0976 11.707 14.707L15.707 10.707C16.0976 10.3165 16.0976 9.68349 15.707 9.29297Z" fill="#8E68F5"/></svg>`;
			case "Cancelled":
				return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2ZM15.707 8.29297C15.3165 7.90244 14.6835 7.90244 14.293 8.29297L12 10.5859L9.70703 8.29297C9.31651 7.90244 8.68349 7.90244 8.29297 8.29297C7.90244 8.68349 7.90244 9.31651 8.29297 9.70703L10.5859 12L8.29297 14.293C7.90244 14.6835 7.90244 15.3165 8.29297 15.707C8.68349 16.0976 9.31651 16.0976 9.70703 15.707L12 13.4141L14.293 15.707C14.6835 16.0976 15.3165 16.0976 15.707 15.707C16.0976 15.3165 16.0976 14.6835 15.707 14.293L13.4141 12L15.707 9.70703C16.0976 9.31651 16.0976 8.68349 15.707 8.29297Z" fill="#A1A1A1"/></svg>`;
			default:
				return "";
		}
	}
</script>

<div class="tm-cal">
	<!-- ── Header ──────────────────────────────────────────────────────────── -->
	<div class="tm-cal-header">
		<!-- Left: panel toggles (title is in the Obsidian pane header) -->
		<div class="tm-cal-header-left">
				<!-- Panel toggle button group -->
			<div class="tm-cal-panel-btns">
				<button
					class="tm-cal-panel-btn"
					class:tm-cal-panel-btn--active={showFilterPanel}
					on:click={() => { showFilterPanel = !showFilterPanel; if (showFilterPanel) { showListPanel = false; showInboxPanel = false; showTargetPanel = false; showChainsPanel = false; } }}
					title="{showFilterPanel ? 'Hide' : 'Show'} filter panel"
					aria-label="Toggle filter panel"
				>
					<Icon name="sliders-horizontal" size={15} />
				</button>
				<button
					class="tm-cal-panel-btn"
					class:tm-cal-panel-btn--active={showListPanel}
					on:click={() => { showListPanel = !showListPanel; if (showListPanel) { showFilterPanel = false; showInboxPanel = false; showTargetPanel = false; showChainsPanel = false; } }}
					title="{showListPanel ? 'Hide' : 'Show'} list panel"
					aria-label="Toggle list panel"
				>
					<Icon name="list" size={15} />
				</button>
				<button
					class="tm-cal-panel-btn"
					class:tm-cal-panel-btn--active={showInboxPanel}
					on:click={() => { showInboxPanel = !showInboxPanel; if (showInboxPanel) { showListPanel = false; showTargetPanel = false; showChainsPanel = false; } }}
					title="{showInboxPanel ? 'Hide' : 'Show'} inbox panel"
					aria-label="Toggle calendar inbox panel"
				>
					<Icon name="inbox" size={15} />
				</button>
				<button
					class="tm-cal-panel-btn"
					class:tm-cal-panel-btn--active={showChainsPanel}
					on:click={() => { showChainsPanel = !showChainsPanel; if (showChainsPanel) { showListPanel = false; showInboxPanel = false; showTargetPanel = false; } }}
					title="{showChainsPanel ? 'Hide' : 'Show'} chains panel"
					aria-label="Toggle chains panel"
				>
					<Icon name="link" size={15} />
				</button>
				<button
					class="tm-cal-panel-btn"
					class:tm-cal-panel-btn--active={showTargetPanel}
					on:click={() => { showTargetPanel = !showTargetPanel; if (showTargetPanel) { showListPanel = false; showInboxPanel = false; showChainsPanel = false; } }}
					title="{showTargetPanel ? 'Hide' : 'Show'} target dates panel"
					aria-label="Toggle targets panel"
				>
					<Icon name="target" size={15} />
				</button>
			</div>
		</div>

		<!-- Center: view type picker -->
		<div class="tm-cal-header-center">
			<div class="tm-cal-view-toggle">
				<button
					class="tm-cal-view-btn"
					class:tm-cal-view-btn--active={viewType === "day"}
					on:click={() => switchView("day")}
				>Day</button>
				<button
					class="tm-cal-view-btn"
					class:tm-cal-view-btn--active={viewType === "week"}
					on:click={() => switchView("week")}
				>Week</button>
				<button
					class="tm-cal-view-btn"
					class:tm-cal-view-btn--active={viewType === "month"}
					on:click={() => switchView("month")}
				>Month</button>
				<button
					class="tm-cal-view-btn"
					class:tm-cal-view-btn--active={viewType === "year"}
					on:click={() => switchView("year")}
				>Year</button>
				<button
					class="tm-cal-view-btn"
					class:tm-cal-view-btn--active={viewType === "horizon"}
					on:click={() => switchView("horizon")}
					title="Horizon — all granularities stacked"
				>Horizon</button>
				<button
					class="tm-cal-view-btn"
					class:tm-cal-view-btn--active={viewType === "agenda"}
					on:click={() => switchView("agenda")}
					title="Agenda — upcoming events and files"
				>Agenda</button>
			</div>
		</div>

		<!-- Right: prev + Today + next -->
		<div class="tm-cal-header-right">
			<div class="tm-cal-nav">
				<button class="tm-cal-nav-btn" on:click={() => navigate(-1)} aria-label="Previous">
					<Icon name="chevron-left" size={16} />
				</button>
				<button
					class="tm-cal-today-btn"
					on:click={goToday}
					title="Go to today"
				>Today</button>
				<button class="tm-cal-nav-btn" on:click={() => navigate(1)} aria-label="Next">
					<Icon name="chevron-right" size={16} />
				</button>
			</div>
		</div>
	</div>

	<!-- ── Body (panel + calendar) ────────────────────────────────────────── -->
	<div class="tm-cal-body">
	{#if showFilterPanel}
		<!-- Filter panel -->
		<div class="tm-cal-filter-panel">
			<!-- Files with target dates -->
			<div class="tm-cal-filter-section">
				<div class="tm-cal-filter-section-title">Files</div>
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<div
					class="tm-cal-filter-row"
					on:click={async () => {
						plugin.settings.time.showTargetFiles = !plugin.settings.time.showTargetFiles;
						await plugin.saveSettings();
					}}
					role="button"
					tabindex="0"
					on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); plugin.settings.time.showTargetFiles = !plugin.settings.time.showTargetFiles; void plugin.saveSettings(); } }}
				>
					<div
						class="tm-cal-filter-check"
						class:tm-cal-filter-check--on={plugin.settings.time.showTargetFiles !== false}
						style="background: var(--interactive-accent); border-color: var(--interactive-accent);"
					>
						{#if plugin.settings.time.showTargetFiles !== false}
							<Icon name="check" size={10} />
						{/if}
					</div>
					<span class="tm-cal-filter-label">Files with target dates</span>
				</div>
			</div>

			<!-- Calendar sources -->
			{#if plugin.settings.time.calendarSources.filter(s => s.enabled).length > 0}
				<div class="tm-cal-filter-section">
					<div class="tm-cal-filter-section-title">Calendars</div>
					{#each plugin.settings.time.calendarSources.filter(s => s.enabled) as source (source.id)}
						{@const color = source.color || "var(--interactive-accent)"}
						{@const isOn = source.visible !== false}
						<!-- svelte-ignore a11y-no-static-element-interactions -->
						<div
							class="tm-cal-filter-row"
							on:click={async () => {
								source.visible = !isOn;
								await plugin.saveSettings();
								// Force Svelte to see the mutation
								plugin.settings.time.calendarSources = [...plugin.settings.time.calendarSources];
							}}
							role="button"
							tabindex="0"
							on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); source.visible = !isOn; void plugin.saveSettings(); plugin.settings.time.calendarSources = [...plugin.settings.time.calendarSources]; } }}
						>
							<div
								class="tm-cal-filter-check"
								class:tm-cal-filter-check--on={isOn}
								style={isOn ? `background:${color};border-color:${color}` : `border-color:${color}`}
							>
								{#if isOn}<Icon name="check" size={10} />{/if}
							</div>
							<span class="tm-cal-filter-label">{source.name}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{:else if showListPanel}
		<!-- List panel — infinitely scrollable day list, independent of main granularity -->
		<div class="tm-cal-list-panel" bind:this={listPanelScrollEl}>
			<div use:listPanelTopSentinel></div>
			{#if listPanelDaysWithContent.length === 0}
				<div class="tm-cal-list-empty">No events or scheduled files in this period.</div>
			{:else}
				{#each listPanelDaysWithContent as day (dayKey(day))}
					{@const dk = dayKey(day)}
					{@const lpEvts = (listPanelEventsByDay.get(dk) ?? []).filter(e => visibleSourceIds.has(e.sourceId))}
					{@const lpTargets = showTargetFiles ? (listPanelDayTargets.get(dk) ?? []) : []}
					{@const today = isToday(day)}
					<div class="tm-cal-list-day" class:tm-cal-list-day--today={today} id="lp-day-{dk}">
						<div class="tm-cal-list-day-header">
							<!-- svelte-ignore a11y-no-static-element-interactions -->
							<div
								class="tm-cal-list-day-label"
								class:tm-cal-list-day-label--today={today}
								on:click={() => { anchorDate = dk; viewType = "day"; }}
								role="button"
								tabindex="0"
								on:keydown={(e) => { if (e.key === "Enter") { anchorDate = dk; viewType = "day"; } }}
								title="Go to {day.format('MMM D')} in day view"
							>
								<span class="tm-cal-list-day-dow">{day.format("ddd")}</span>
								<span class="tm-cal-list-day-num" class:tm-cal-list-day-num--today={today}>{day.format("D")}</span>
								<span class="tm-cal-list-day-month">{day.format("MMM YYYY")}</span>
								{#if today}<span class="tm-cal-list-today-chip">Today</span>{/if}
							</div>
							{#if dayEnabled}
								{@const dn = noteExistsForDay(day)}
								<button
									class="tm-cal-list-note-btn"
									class:tm-cal-list-note-btn--exists={dn}
									on:click={() => void openDay(day)}
									title="{dn ? 'Open' : 'Create'} daily note"
								><Icon name={dn ? "file-text" : "file-plus"} size={12} /></button>
							{/if}
						</div>
						<div class="tm-cal-list-day-body">
							{#each lpEvts as evt (evt.uid)}
								{@const timeText = evt.allDay ? "All day" : evt.end ? `${evt.start.format("h:mm")}–${evt.end.format("h:mm a")}` : evt.start.format("h:mm a")}
								<div
									class="tm-cal-list-evt"
									style={evt.sourceColor ? `border-left-color:${evt.sourceColor}` : ""}
									title={evt.summary}
								>
									<span class="tm-cal-list-evt-time">{timeText}</span>
									<span class="tm-cal-list-evt-title">{evt.summary}</span>
								</div>
							{/each}
							{#each lpTargets as tf (tf.path)}
								{@const _lp = getFileStatus(tf)}
								<!-- svelte-ignore a11y-no-static-element-interactions -->
								<div class="tm-cal-target-chip" title="{tf.basename}" on:contextmenu={(e) => showChipMenu(e, tf)}>
									{#if _lp}<button class="tm-cal-target-chip-status" title={_lp} on:click={(e) => void cycleStatus(e, tf)}>{@html statusSvg(_lp)}</button>{/if}
									<span
										class="tm-cal-target-chip-name"
										draggable={true}
										on:dragstart={(e) => { setDragPayload({ type: "file", filePath: tf.path }); if (e.dataTransfer) { e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("text/plain", tf.path); } }}
										on:dragend={() => setDragPayload(null)}
										on:dblclick={(e) => previewChip(e, tf)}
									>{tf.basename}</span>
									<button
										class="tm-cal-target-chip-remove"
										draggable={false}
										on:click={(e) => void clearTargetDate(e, tf)}
										aria-label="Remove target date from {tf.basename}"
									>×</button>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			{/if}
			<div use:listPanelBottomSentinel></div>
		</div>
	{:else if showInboxPanel}
		<CalendarInboxPanel {plugin} />
	{:else if showChainsPanel}
		<CalendarChainsPanel {plugin} />
	{:else if showTargetPanel}
		<TargetDatePanel {plugin} {anchorDate} {viewType} />
	{/if}

	<div class="tm-cal-content">

	<!-- ── Loading states ─────────────────────────────────────────────────── -->
	{#if loading && !hasLoadedOnce}
		<!-- Skeleton: first load — no data yet, show shimmer placeholders -->
		<div class="tm-cal-skeleton">
			{#if viewType === "day"}
				<!-- Day skeleton: time gutter + event blobs -->
				<div class="tm-cal-skeleton-day">
					{#each [3, 7, 9, 11, 14, 16, 19] as h}
						<div class="tm-cal-skeleton-slot">
							<div class="tm-cal-skeleton-time shimmer"></div>
							{#if [7, 11, 16].includes(h)}
								<div class="tm-cal-skeleton-evt shimmer" style="width:{[55,72,40][([7,11,16].indexOf(h))]}%"></div>
							{/if}
						</div>
					{/each}
				</div>
			{:else if viewType === "week"}
				<div class="tm-cal-skeleton-week">
					{#each Array(7) as _, ci}
						<div class="tm-cal-skeleton-col">
							{#each Array(3) as _, ri}
								{#if (ci + ri) % 3 === 0}
									<div class="tm-cal-skeleton-evt shimmer" style="width:85%;margin-top:{ri * 60 + 40}px"></div>
								{/if}
							{/each}
						</div>
					{/each}
				</div>
			{:else if viewType === "month"}
				<div class="tm-cal-skeleton-month">
					{#each Array(35) as _, i}
						<div class="tm-cal-skeleton-cell">
							<div class="tm-cal-skeleton-cell-num shimmer"></div>
							{#if [2,5,8,11,15,20,23,27,30].includes(i)}
								<div class="tm-cal-skeleton-cell-bar shimmer"></div>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<!-- Generic skeleton for year/horizon/agenda -->
				<div class="tm-cal-skeleton-generic">
					{#each [80, 55, 90, 40, 70] as w}
						<div class="tm-cal-skeleton-line shimmer" style="width:{w}%"></div>
					{/each}
				</div>
			{/if}
		</div>
	{:else if loading && hasLoadedOnce}
		<!-- Re-fetch: data already visible, show a thin top progress bar -->
		<div class="tm-cal-progress-bar">
			<div class="tm-cal-progress-bar-fill"></div>
		</div>
	{/if}

	<!-- ── Day view ────────────────────────────────────────────────────────── -->
	{#if viewType === "day"}
		{@const dayExists = noteExistsForDay(anchor)}
		{@const dayViewKey = dayKey(anchor)}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="tm-cal-day-view"
			class:tm-cal-day-view--drag-over={dragOverKey === dayViewKey}
			on:dragover={(e) => onDragOver(e, dayViewKey)}
			on:dragleave={() => onDragLeave(dayViewKey)}
			on:drop={(e) => void onDrop(e, anchor, "day")}
		>
			<!-- Note button -->
			{#if dayEnabled}
				<div class="tm-cal-day-note-row">
					<button
						class="tm-cal-day-note-btn"
						class:tm-cal-day-note-btn--exists={dayExists}
						on:click={() => void openDay(anchor)}
					>
						{#if dayExists}
							<Icon name="file-text" size={13} />
							Open daily note
						{:else}
							<Icon name="file-plus" size={13} />
							Create daily note
						{/if}
					</button>
				</div>
			{/if}

			<!-- "all-day" bar — day-granularity targets with no time + reminders -->
			<!-- svelte-ignore a11y-no-static-element-interactions -->
			<div
				class="tm-cal-period-bar"
				class:tm-cal-period-bar--drag-over={dragOverKey === dayViewKey}
				on:dragover={(e) => onDragOver(e, dayViewKey)}
				on:dragleave={() => onDragLeave(dayViewKey)}
				on:drop={(e) => void onDrop(e, anchor, "day")}
				on:contextmenu={(e) => showNewNoteMenu(e, anchor, "day")}
			>
				<span class="tm-cal-period-bar-label">this day</span>
				{#if dayUntimedReminders.length > 0}
					<div class="tm-cal-period-bar-chips">
						{#each dayUntimedReminders as tf (tf.path)}
							<div class="tm-cal-reminder-chip-cal" title="Reminder: {tf.basename} — drag to reschedule"
								on:contextmenu={(e) => showReminderChipMenu(e, tf)}>
								<Icon name="alarm-clock" size={11} />
								<!-- svelte-ignore a11y-no-static-element-interactions -->
								<span
									class="tm-cal-reminder-chip-cal-name"
									draggable={true}
									on:click={() => void plugin.app.workspace.getLeaf(false).openFile(tf)}
									on:dragstart={(e) => {
										setDragPayload({ type: "reminder", filePath: tf.path });
										if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", tf.path); }
									}}
									on:dragend={() => setDragPayload(null)}
								>{tf.basename}</span>
								<button class="tm-cal-reminder-chip-remove" draggable={false} on:click={(e) => { e.stopPropagation(); void plugin.reminderService.clearReminder(tf); }} aria-label="Clear reminder">×</button>
							</div>
						{/each}
					</div>
				{/if}
				{#if showTargetFiles && dayUntimedTargets.length > 0}
					<div class="tm-cal-period-bar-chips">
						{#each dayUntimedTargets as tf (tf.path)}
							{@const _ds = getFileStatus(tf)}
							<div class="tm-cal-target-chip" title="{tf.basename} — drag name to move, click × to remove" on:contextmenu={(e) => showChipMenu(e, tf)}>
								{#if _ds}<button class="tm-cal-target-chip-status" title={_ds} on:click={(e) => void cycleStatus(e, tf)}>{@html statusSvg(_ds)}</button>{/if}
								<!-- svelte-ignore a11y-no-static-element-interactions -->
								<span
									class="tm-cal-target-chip-name"
									draggable={true}
									on:dragstart={(e) => {
										setDragPayload({ type: "file", filePath: tf.path });
										if (e.dataTransfer) {
											e.dataTransfer.effectAllowed = "copy";
											e.dataTransfer.setData("text/plain", tf.path);
										}
									}}
									on:dragend={() => setDragPayload(null)}
								on:dblclick={(e) => previewChip(e, tf)}
								>{tf.basename}</span>
								<button
									class="tm-cal-target-chip-remove"
									draggable={false}
									on:click={(e) => void clearTargetDate(e, tf)}
									aria-label="Remove target date from {tf.basename}"
								>×</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- All-day events -->
			{#if dayAllDayEvts.length > 0}
				<div class="tm-cal-day-allday">
					<span class="tm-cal-day-allday-label">All day</span>
					<div class="tm-cal-day-allday-events">
						{#each dayAllDayEvts as evt (evt.uid)}
							<div
								class="tm-cal-day-allday-evt"
								style={evt.sourceColor ? `background:color-mix(in srgb, ${evt.sourceColor} 20%, transparent); border-left-color:${evt.sourceColor}` : ""}
								title={evt.summary}
							>{evt.summary}</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Hourly time grid -->
			<div class="tm-cal-day-slots">
				{#each HOURS as hour (hour)}
					{@const hourEvts = eventsForHour(hour)}
					{@const hourChips = showTargetFiles ? (dayTimedTargets.get(hour) ?? []) : []}
					{@const hourReminders = dayTimedReminders.get(hour) ?? []}
					<!-- svelte-ignore a11y-no-static-element-interactions -->
					<div
						class="tm-cal-day-slot"
						class:tm-cal-day-slot--current={moment().hour() === hour && isToday(anchor)}
						class:tm-cal-day-slot--drag-over={dragOverHour === hour}
						on:dragover={(e) => onDragOverHour(e, hour)}
						on:dragleave={() => onDragLeaveHour(hour)}
						on:drop={(e) => void onDropTime(e, anchor, hour)}
						on:contextmenu={(e) => showNewNoteMenu(e, anchor, "day", hour)}
					>
						<span class="tm-cal-day-slot-label">{formatHour(hour)}</span>
						<div class="tm-cal-day-slot-body">
							{#each hourEvts as evt (evt.uid)}
								<div
									class="tm-cal-day-slot-evt"
									style={evt.sourceColor ? `border-left-color:${evt.sourceColor}` : ""}
									title={evt.summary}
								>
									<span class="tm-cal-day-slot-evt-time">
										{evt.start.format("h:mm")}{evt.end ? `–${evt.end.format("h:mm a")}` : " a"}
									</span>
									<span class="tm-cal-day-slot-evt-title">{evt.summary}</span>
								</div>
							{/each}
							{#each hourChips as tf (tf.path)}
								{@const _dh = getFileStatus(tf)}
								<div class="tm-cal-target-chip tm-cal-target-chip--block" title="{tf.basename} — drag name to reschedule, click × to remove target date" on:contextmenu={(e) => showChipMenu(e, tf)}>
									{#if _dh}<button class="tm-cal-target-chip-status" title={_dh} on:click={(e) => void cycleStatus(e, tf)}>{@html statusSvg(_dh)}</button>{/if}
									<!-- svelte-ignore a11y-no-static-element-interactions -->
									<span
										class="tm-cal-target-chip-name"
										draggable={true}
										on:dragstart={(e) => {
											setDragPayload({ type: "file", filePath: tf.path });
											if (e.dataTransfer) {
												e.dataTransfer.effectAllowed = "copy";
												e.dataTransfer.setData("text/plain", tf.path);
											}
										}}
										on:dragend={() => setDragPayload(null)}
										on:dblclick={(e) => previewChip(e, tf)}
									>{tf.basename}</span>
									<button
										class="tm-cal-target-chip-remove"
										draggable={false}
										on:click={(e) => void clearTimeSlot(e, tf)}
										aria-label="Remove target date for {tf.basename}"
									>×</button>
								</div>
							{/each}
							{#each hourReminders as tf (tf.path)}
								<div class="tm-cal-reminder-chip-cal tm-cal-reminder-chip-cal--block" title="Reminder: {tf.basename} — drag to reschedule"
								on:contextmenu={(e) => showReminderChipMenu(e, tf)}>
									<Icon name="alarm-clock" size={11} />
									<!-- svelte-ignore a11y-no-static-element-interactions -->
									<span
										class="tm-cal-reminder-chip-cal-name"
										draggable={true}
										on:click={() => void plugin.app.workspace.getLeaf(false).openFile(tf)}
										on:dragstart={(e) => {
											setDragPayload({ type: "reminder", filePath: tf.path });
											if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", tf.path); }
										}}
										on:dragend={() => setDragPayload(null)}
									>{tf.basename}</span>
									<button class="tm-cal-reminder-chip-remove" draggable={false} on:click={(e) => { e.stopPropagation(); void plugin.reminderService.clearReminder(tf); }} aria-label="Clear reminder">×</button>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>

	<!-- ── Month view ──────────────────────────────────────────────────────── -->
	{:else if viewType === "month"}
		{@const monthKey = anchor.format("YYYY-MM")}
		{@const monthViewTargets = monthTargets.get(monthKey) ?? []}
		<!-- "This month" drop zone — accepts drags to set month-granularity targetDate -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="tm-cal-period-bar"
			class:tm-cal-period-bar--drag-over={dragOverKey === monthKey}
			on:dragover={(e) => onDragOver(e, monthKey)}
			on:dragleave={() => onDragLeave(monthKey)}
			on:drop={(e) => void onDrop(e, anchor, "month")}
			on:contextmenu={(e) => showNewNoteMenu(e, anchor, "month")}
		>
			<span class="tm-cal-period-bar-label">this month</span>
			{#if monthViewTargets.length > 0}
				<div class="tm-cal-period-bar-chips">
					{#each monthViewTargets as tf (tf.path)}
						{@const _mv = getFileStatus(tf)}
						<div class="tm-cal-target-chip" title="{tf.basename} — drag name to move, click × to remove" on:contextmenu={(e) => showChipMenu(e, tf)}>
							{#if _mv}<button class="tm-cal-target-chip-status" title={_mv} on:click={(e) => void cycleStatus(e, tf)}>{@html statusSvg(_mv)}</button>{/if}
							<!-- svelte-ignore a11y-no-static-element-interactions -->
							<span
								class="tm-cal-target-chip-name"
								draggable={true}
								on:dragstart={(e) => {
									setDragPayload({ type: "file", filePath: tf.path });
									if (e.dataTransfer) {
										e.dataTransfer.effectAllowed = "copy";
										e.dataTransfer.setData("text/plain", tf.path);
									}
								}}
								on:dragend={() => setDragPayload(null)}
								on:dblclick={(e) => previewChip(e, tf)}
							>{tf.basename}</span>
							<button
								class="tm-cal-target-chip-remove"
								draggable={false}
								on:click={(e) => void clearTargetDate(e, tf)}
								aria-label="Remove target date from {tf.basename}"
							>×</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="tm-cal-month-grid" style="grid-template-columns: {gridColumns}">
			<!-- Column headers -->
			{#if weekEnabled}<div class="tm-cal-week-label-header"></div>{/if}
			{#each DAY_LABELS as label}
				<div class="tm-cal-day-header">{label}</div>
			{/each}

			<!-- Week rows -->
			{#each monthWeeks as week}
				<!-- Week number -->
				{#if weekEnabled}
					{@const wExists = weekNoteExists(week[0])}
					{@const wk = week[0].format("YYYY-[W]WW")}
					{@const wTargets = weekTargets.get(wk) ?? []}
     <!-- svelte-ignore a11y-no-static-element-interactions -->
					<div
						class="tm-cal-week-num-cell"
						class:tm-cal-week-num-cell--drag-over={dragOverKey === wk}
						on:dragover={(e) => onDragOver(e, wk)}
						on:dragleave={() => onDragLeave(wk)}
						on:drop={(e) => void onDrop(e, week[0], "week")}
						on:contextmenu={(e) => showNewNoteMenu(e, week[0], "week")}
					>
						<button
							class="tm-cal-week-num"
							class:tm-cal-week-num--exists={wExists}
							on:click={() => void openWeek(week[0])}
							title="Week {week[0].isoWeek()} — {wExists ? 'open' : 'create'} weekly note"
						>W{week[0].isoWeek()}</button>
						{#if wTargets.length > 0}
							<div class="tm-cal-week-target-badges">
								{#each wTargets as tf (tf.path)}
									<button
										class="tm-cal-week-target-badge"
										on:click|stopPropagation={(e) => void clearTargetDate(e, tf)}
										title="{tf.basename} — click to remove week target"
									>·</button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Day cells -->
				{#each week as day (dayKey(day))}
					{@const dk = dayKey(day)}
					{@const events = visibleEventsByDay.get(dk) ?? []}
					{@const targets = showTargetFiles ? (dayTargets.get(dk) ?? []) : []}
					{@const exists = noteExistsForDay(day)}
					{@const today  = isToday(day)}
					{@const inMonth = isCurrentMonth(day)}
					<!-- svelte-ignore a11y-click-events-have-key-events -->
					<div
						class="tm-cal-day-cell"
						class:tm-cal-day-cell--today={today}
						class:tm-cal-day-cell--other-month={!inMonth}
						class:tm-cal-day-cell--drag-over={dragOverKey === dk}
						on:dragenter={(e) => onDragOver(e, dk)}
						on:dragover={(e) => onDragOver(e, dk)}
						on:dragleave={() => onDragLeave(dk)}
						on:drop={(e) => void onDrop(e, day, "day")}
						on:contextmenu={(e) => showNewNoteMenu(e, day, "day")}
						on:dblclick={(e) => openDayView(e, day)}
					>
						<span class="tm-cal-day-num" class:tm-cal-day-num--today={today}>{day.date()}</span>

						<!-- Note existence dot -->
						{#if dayEnabled}
							<span
								class="tm-cal-note-dot"
								class:tm-cal-note-dot--exists={exists}
								aria-label={exists ? "Note exists" : "No note"}
							></span>
						{/if}

						<!-- Reminder chips -->
						{#each remindersByDay.get(dk) ?? [] as tf (tf.path)}
							<div class="tm-cal-reminder-chip-cal tm-cal-reminder-chip-cal--block" title="Reminder: {tf.basename} — drag to reschedule"
								on:contextmenu={(e) => showReminderChipMenu(e, tf)}>
								<Icon name="alarm-clock" size={11} />
								<!-- svelte-ignore a11y-no-static-element-interactions -->
								<span
									class="tm-cal-reminder-chip-cal-name"
									draggable={true}
									on:click={() => void plugin.app.workspace.getLeaf(false).openFile(tf)}
									on:dragstart={(e) => {
										setDragPayload({ type: "reminder", filePath: tf.path });
										if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", tf.path); }
									}}
									on:dragend={() => setDragPayload(null)}
								>{tf.basename}</span>
								<button class="tm-cal-reminder-chip-remove" draggable={false} on:click={(e) => { e.stopPropagation(); void plugin.reminderService.clearReminder(tf); }} aria-label="Clear reminder">×</button>
							</div>
						{/each}

						<!-- Target date chips -->
						{#if targets.length > 0}
							<div class="tm-cal-target-chips">
								{#each targets as tf (tf.path)}
									{@const _tc = getFileStatus(tf)}
									<div class="tm-cal-target-chip tm-cal-target-chip--block" title="{tf.basename} — drag name to move, click × to remove" on:contextmenu={(e) => showChipMenu(e, tf)}>
										{#if _tc}<button class="tm-cal-target-chip-status" title={_tc} on:click={(e) => void cycleStatus(e, tf)}>{@html statusSvg(_tc)}</button>{/if}
										<!-- svelte-ignore a11y-no-static-element-interactions -->
										<span
											class="tm-cal-target-chip-name"
											draggable={true}
											on:dragstart={(e) => {
												setDragPayload({ type: "file", filePath: tf.path });
												if (e.dataTransfer) {
													e.dataTransfer.effectAllowed = "copy";
													e.dataTransfer.setData("text/plain", tf.path);
												}
											}}
											on:dragend={() => setDragPayload(null)}
											on:dblclick={(e) => previewChip(e, tf)}
										>{tf.basename}</span>
										<button
											class="tm-cal-target-chip-remove"
											draggable={false}
											on:click={(e) => void clearTargetDate(e, tf)}
											aria-label="Remove target date from {tf.basename}"
										>×</button>
									</div>
								{/each}
							</div>
						{/if}

						<!-- Event bars (up to 3 + overflow count) -->
						{#if events.length > 0}
							<div class="tm-cal-event-bars">
								{#each events.slice(0, 3) as evt (evt.uid)}
									<div
										class="tm-cal-event-bar"
										style={evt.sourceColor
											? `background:color-mix(in srgb, ${evt.sourceColor} 22%, transparent); color:${evt.sourceColor}`
											: ""}
										title={evt.summary}
									>{evt.summary}</div>
								{/each}
								{#if events.length > 3}
									<span class="tm-cal-event-more">+{events.length - 3} more</span>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			{/each}
		</div>

	<!-- ── Week view ───────────────────────────────────────────────────────── -->
	{:else if viewType === "week"}
		{@const weekBarKey = anchor.clone().startOf("isoWeek").format("YYYY-[W]WW")}
		{@const weekViewTargets = weekTargets.get(weekBarKey) ?? []}
		<!-- "all-week" bar — week-granularity targets -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="tm-cal-period-bar"
			class:tm-cal-period-bar--drag-over={dragOverKey === weekBarKey}
			on:dragover={(e) => onDragOver(e, weekBarKey)}
			on:dragleave={() => onDragLeave(weekBarKey)}
			on:drop={(e) => void onDrop(e, anchor, "week")}
			on:contextmenu={(e) => showNewNoteMenu(e, anchor, "week")}
		>
			<span class="tm-cal-period-bar-label">this week</span>
			{#if weekViewTargets.length > 0}
				<div class="tm-cal-period-bar-chips">
					{#each weekViewTargets as tf (tf.path)}
						{@const _wv = getFileStatus(tf)}
						<div class="tm-cal-target-chip" title="{tf.basename} — drag name to move, click × to remove" on:contextmenu={(e) => showChipMenu(e, tf)}>
							{#if _wv}<button class="tm-cal-target-chip-status" title={_wv} on:click={(e) => void cycleStatus(e, tf)}>{@html statusSvg(_wv)}</button>{/if}
							<!-- svelte-ignore a11y-no-static-element-interactions -->
							<span
								class="tm-cal-target-chip-name"
								draggable={true}
								on:dragstart={(e) => {
									setDragPayload({ type: "file", filePath: tf.path });
									if (e.dataTransfer) {
										e.dataTransfer.effectAllowed = "copy";
										e.dataTransfer.setData("text/plain", tf.path);
									}
								}}
								on:dragend={() => setDragPayload(null)}
								on:dblclick={(e) => previewChip(e, tf)}
							>{tf.basename}</span>
							<button
								class="tm-cal-target-chip-remove"
								draggable={false}
								on:click={(e) => void clearTargetDate(e, tf)}
								aria-label="Remove target date from {tf.basename}"
							>×</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Shared column headers -->
		<div class="tm-cal-week-header-row">
			<div class="tm-cal-week-time-gutter"></div>
			{#each weekDays as day (dayKey(day))}
				{@const today = isToday(day)}
				{@const exists = noteExistsForDay(day)}
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<div class="tm-cal-week-col-header" class:tm-cal-week-col-header--today={today}
					on:contextmenu={(e) => showNewNoteMenu(e, day, "day")}
				>
					<span class="tm-cal-week-day-name">{day.format("ddd")}</span>
					<button
						class="tm-cal-week-day-num"
						class:tm-cal-week-day-num--today={today}
						on:click={() => void openDay(day)}
						title="{day.format('MMM D')} — {exists ? 'open' : 'create'} note"
					>{day.date()}</button>
				</div>
			{/each}
		</div>

		<!-- All-day row: calendar events + untimed day targets + reminders -->
		<div class="tm-cal-week-allday-row">
			<div class="tm-cal-week-time-gutter tm-cal-week-time-gutter--label">all day</div>
			{#each weekDays as day (dayKey(day))}
				{@const dk = dayKey(day)}
				{@const adEvts = (visibleEventsByDay.get(dk) ?? []).filter(e => e.allDay)}
				{@const targets = showTargetFiles ? (weekDayUntimedTargets.get(dk) ?? []) : []}
				{@const reminders = weekDayUntimedReminders.get(dk) ?? []}
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<div
					class="tm-cal-week-allday-cell"
					class:tm-cal-week-allday-cell--drag-over={dragOverKey === dk}
					on:dragover={(e) => onDragOver(e, dk)}
					on:dragleave={() => onDragLeave(dk)}
					on:drop={(e) => void onDrop(e, day, "day")}
					on:contextmenu={(e) => showNewNoteMenu(e, day, "day")}
				>
					{#each adEvts as evt (evt.uid)}
						<div
							class="tm-cal-week-allday-evt"
							style={evt.sourceColor ? `background:color-mix(in srgb, ${evt.sourceColor} 20%, transparent); border-left-color:${evt.sourceColor}` : ""}
							title={evt.summary}
						>{evt.summary}</div>
					{/each}
					{#each targets as tf (tf.path)}
						{@const _wh = getFileStatus(tf)}
						<div class="tm-cal-target-chip tm-cal-target-chip--block" title="{tf.basename} — click × to remove" on:contextmenu={(e) => showChipMenu(e, tf)}>
							{#if _wh}<button class="tm-cal-target-chip-status" title={_wh} on:click={(e) => void cycleStatus(e, tf)}>{@html statusSvg(_wh)}</button>{/if}
							<!-- svelte-ignore a11y-no-static-element-interactions -->
							<span class="tm-cal-target-chip-name" on:dblclick={(e) => previewChip(e, tf)}
								draggable={true}
								on:dragstart={(e) => { setDragPayload({ type: "file", filePath: tf.path }); if (e.dataTransfer) { e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData("text/plain", tf.path); } }}
								on:dragend={() => setDragPayload(null)}
							>{tf.basename}</span>
							<button class="tm-cal-target-chip-remove" on:click={(e) => void clearTargetDate(e, tf)} aria-label="Remove">×</button>
						</div>
					{/each}
					{#each reminders as tf (tf.path)}
						<div class="tm-cal-reminder-chip-cal tm-cal-reminder-chip-cal--block" title="Reminder: {tf.basename} — drag to reschedule"
								on:contextmenu={(e) => showReminderChipMenu(e, tf)}>
							<Icon name="alarm-clock" size={11} />
							<!-- svelte-ignore a11y-no-static-element-interactions -->
							<span
								class="tm-cal-reminder-chip-cal-name"
								draggable={true}
								on:click={() => void plugin.app.workspace.getLeaf(false).openFile(tf)}
								on:dragstart={(e) => {
									setDragPayload({ type: "reminder", filePath: tf.path });
									if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", tf.path); }
								}}
								on:dragend={() => setDragPayload(null)}
							>{tf.basename}</span>
							<button class="tm-cal-reminder-chip-remove" draggable={false} on:click={(e) => { e.stopPropagation(); void plugin.reminderService.clearReminder(tf); }} aria-label="Clear reminder">×</button>
						</div>
					{/each}
				</div>
			{/each}
		</div>

		<!-- 2D time grid: 24 hour rows × 7 day columns -->
		<div class="tm-cal-week-time-grid">
			{#each HOURS as hour (hour)}
				<div class="tm-cal-week-hour-gutter">
					<span class="tm-cal-week-hour-label">{formatHour(hour)}</span>
				</div>
				{#each weekDays as day (`${dayKey(day)}-${hour}`)}
					{@const dk = dayKey(day)}
					{@const today = isToday(day)}
					{@const isCurrent = today && moment().hour() === hour}
					{@const hourEvts = (visibleEventsByDay.get(dk) ?? []).filter(e => !e.allDay && e.start.hour() === hour)}
					{@const hourChips = showTargetFiles ? (weekDayTimedTargets.get(dk)?.get(hour) ?? []) : []}
					{@const hourReminders = weekDayTimedReminders.get(dk)?.get(hour) ?? []}
					<!-- svelte-ignore a11y-no-static-element-interactions -->
					<div
						class="tm-cal-week-hour-cell"
						class:tm-cal-week-hour-cell--today={today}
						class:tm-cal-week-hour-cell--current={isCurrent}
						on:dragover={(e) => onDragOverHour(e, hour)}
						on:dragleave={() => onDragLeaveHour(hour)}
						on:drop={(e) => void onDropTime(e, day, hour)}
						on:contextmenu={(e) => showNewNoteMenu(e, day, "day", hour)}
					>
						{#each hourEvts as evt (evt.uid)}
							<div
								class="tm-cal-week-hour-evt"
								style={evt.sourceColor ? `border-left-color:${evt.sourceColor}` : ""}
								title={evt.summary}
							>
								<span class="tm-cal-week-hour-evt-time">
									{evt.start.format("h:mm")}{evt.end ? `–${evt.end.format("h:mm a")}` : " a"}
								</span>
								<span class="tm-cal-week-hour-evt-title">{evt.summary}</span>
							</div>
						{/each}
						{#each hourChips as tf (tf.path)}
							{@const _wt = getFileStatus(tf)}
							<div class="tm-cal-target-chip tm-cal-target-chip--block" title="{tf.basename} — drag to reschedule, click × to unschedule" on:contextmenu={(e) => showChipMenu(e, tf)}>
								{#if _wt}<button class="tm-cal-target-chip-status" title={_wt} on:click={(e) => void cycleStatus(e, tf)}>{@html statusSvg(_wt)}</button>{/if}
								<!-- svelte-ignore a11y-no-static-element-interactions -->
								<span
									class="tm-cal-target-chip-name"
									draggable={true}
									on:dragstart={(e) => {
										setDragPayload({ type: "file", filePath: tf.path });
										if (e.dataTransfer) {
											e.dataTransfer.effectAllowed = "copy";
											e.dataTransfer.setData("text/plain", tf.path);
										}
									}}
									on:dragend={() => setDragPayload(null)}
									on:dblclick={(e) => previewChip(e, tf)}
								>{tf.basename}</span>
								<button
									class="tm-cal-target-chip-remove"
									draggable={false}
									on:click={(e) => void clearTimeSlot(e, tf)}
									aria-label="Remove target date for {tf.basename}"
								>×</button>
							</div>
						{/each}
						{#each hourReminders as tf (tf.path)}
							<div class="tm-cal-reminder-chip-cal tm-cal-reminder-chip-cal--block" title="Reminder: {tf.basename} — drag to reschedule"
								on:contextmenu={(e) => showReminderChipMenu(e, tf)}>
								<Icon name="alarm-clock" size={11} />
								<!-- svelte-ignore a11y-no-static-element-interactions -->
								<span
									class="tm-cal-reminder-chip-cal-name"
									draggable={true}
									on:click={() => void plugin.app.workspace.getLeaf(false).openFile(tf)}
									on:dragstart={(e) => {
										setDragPayload({ type: "reminder", filePath: tf.path });
										if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", tf.path); }
									}}
									on:dragend={() => setDragPayload(null)}
								>{tf.basename}</span>
								<button class="tm-cal-reminder-chip-remove" draggable={false} on:click={(e) => { e.stopPropagation(); void plugin.reminderService.clearReminder(tf); }} aria-label="Clear reminder">×</button>
							</div>
						{/each}
					</div>
				{/each}
			{/each}
		</div>

	<!-- ── Year view ───────────────────────────────────────────────────────── -->
	{:else if viewType === "year"}
		{@const yearBarKey = anchor.format("YYYY")}
		{@const yearViewTargets = yearTargets.get(yearBarKey) ?? []}
		<!-- "all-year" bar — year-granularity targets -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="tm-cal-period-bar"
			class:tm-cal-period-bar--drag-over={dragOverKey === yearBarKey}
			on:dragover={(e) => onDragOver(e, yearBarKey)}
			on:dragleave={() => onDragLeave(yearBarKey)}
			on:drop={(e) => void onDrop(e, anchor, "year")}
			on:contextmenu={(e) => showNewNoteMenu(e, anchor, "year")}
		>
			<span class="tm-cal-period-bar-label">this year</span>
			{#if yearViewReminders.length > 0}
				<div class="tm-cal-period-bar-chips">
					{#each yearViewReminders as tf (tf.path)}
						<div class="tm-cal-reminder-chip-cal" title="Reminder: {tf.basename} — drag to reschedule"
								on:contextmenu={(e) => showReminderChipMenu(e, tf)}>
							<Icon name="alarm-clock" size={11} />
							<!-- svelte-ignore a11y-no-static-element-interactions -->
							<span
								class="tm-cal-reminder-chip-cal-name"
								draggable={true}
								on:click={() => void plugin.app.workspace.getLeaf(false).openFile(tf)}
								on:dragstart={(e) => {
									setDragPayload({ type: "reminder", filePath: tf.path });
									if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", tf.path); }
								}}
								on:dragend={() => setDragPayload(null)}
							>{tf.basename}</span>
							<button class="tm-cal-reminder-chip-remove" draggable={false} on:click={(e) => { e.stopPropagation(); void plugin.reminderService.clearReminder(tf); }} aria-label="Clear reminder">×</button>
						</div>
					{/each}
				</div>
			{/if}
			{#if yearViewTargets.length > 0}
				<div class="tm-cal-period-bar-chips">
					{#each yearViewTargets as tf (tf.path)}
						{@const _yv = getFileStatus(tf)}
						<div class="tm-cal-target-chip" title="{tf.basename} — drag name to move, click × to remove" on:contextmenu={(e) => showChipMenu(e, tf)}>
							{#if _yv}<button class="tm-cal-target-chip-status" title={_yv} on:click={(e) => void cycleStatus(e, tf)}>{@html statusSvg(_yv)}</button>{/if}
							<!-- svelte-ignore a11y-no-static-element-interactions -->
							<span
								class="tm-cal-target-chip-name"
								draggable={true}
								on:dragstart={(e) => {
									setDragPayload({ type: "file", filePath: tf.path });
									if (e.dataTransfer) {
										e.dataTransfer.effectAllowed = "copy";
										e.dataTransfer.setData("text/plain", tf.path);
									}
								}}
								on:dragend={() => setDragPayload(null)}
								on:dblclick={(e) => previewChip(e, tf)}
							>{tf.basename}</span>
							<button
								class="tm-cal-target-chip-remove"
								draggable={false}
								on:click={(e) => void clearTargetDate(e, tf)}
								aria-label="Remove target date from {tf.basename}"
							>×</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="tm-cal-year-grid">
			{#each yearMonths as { m, weeks } (m.month())}
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<div class="tm-cal-year-month" on:contextmenu={(e) => showNewNoteMenu(e, m, "month")}>
					<div class="tm-cal-year-month-name">{m.format("MMMM")}</div>
					<div class="tm-cal-year-mini-grid">
						<!-- Day-of-week letters -->
						{#each DAY_LETTERS as letter, i (i)}
							<div class="tm-cal-year-dow">{letter}</div>
						{/each}
						<!-- Day cells -->
						{#each weeks as week}
							{#each week as day (dayKey(day))}
								{@const today   = isToday(day)}
								{@const inMonth = day.isSame(m, "month")}
								{@const exists  = noteExistsForDay(day)}
								<!-- svelte-ignore a11y-click-events-have-key-events -->
								<div
									class="tm-cal-year-day"
									class:tm-cal-year-day--today={today}
									class:tm-cal-year-day--other-month={!inMonth}
									class:tm-cal-year-day--has-note={exists && inMonth}
									on:click={() => inMonth && void openDay(day)}
									on:contextmenu={(e) => inMonth && showNewNoteMenu(e, day, "day")}
									role="button"
									tabindex={dayEnabled && inMonth ? 0 : -1}
									title={inMonth ? `${day.format("MMM D")} — ${exists ? "open" : "create"} note` : ""}
								>
									{day.date()}
									{#if exists && inMonth}
										<span class="tm-cal-year-note-dot"></span>
									{/if}
								</div>
							{/each}
						{/each}
					</div>
				</div>
			{/each}
		</div>
	<!-- ── Horizon view ───────────────────────────────────────────────────── -->
	{:else if viewType === "horizon"}
		{#if horizonBands.length === 0}
			<div class="tm-cal-horizon-empty">
				No periodic note granularities are enabled. Enable some in plugin settings.
			</div>
		{:else}
			<div class="tm-cal-horizon">
				{#each horizonBands as band (band.gran)}
					{@const isToday_ = band.gran === "day" && isToday(anchor)}
					<!-- svelte-ignore a11y-no-static-element-interactions -->
					<div class="tm-cal-horizon-band" class:tm-cal-horizon-band--today={isToday_}
						on:contextmenu={(e) => showNewNoteMenu(e, anchor, band.gran)}
					>
						<div class="tm-cal-horizon-band-header">
							<div class="tm-cal-horizon-band-titles">
								<span class="tm-cal-horizon-gran">{band.granLabel}</span>
								<span class="tm-cal-horizon-period">{band.periodLabel}</span>
							</div>
							<button
								class="tm-cal-horizon-note-btn"
								class:tm-cal-horizon-note-btn--exists={band.noteExists}
								on:click={() => void openPeriodicNote(band.gran)}
								title="{band.noteExists ? 'Open' : 'Create'} {band.gran} note"
							>
								{#if band.noteExists}
									<Icon name="file-text" size={12} />
									Open
								{:else}
									<Icon name="file-plus" size={12} />
									New
								{/if}
							</button>
						</div>
						{#if band.targets.length > 0}
							<div class="tm-cal-horizon-chips">
								{#each band.targets as tf (tf.path)}
									{@const _hz = getFileStatus(tf)}
									<div
										class="tm-cal-target-chip"
										title="{tf.basename} — drag to move, click × to remove"
										on:contextmenu={(e) => showChipMenu(e, tf)}
									>
										{#if _hz}<button class="tm-cal-target-chip-status" title={_hz} on:click={(e) => void cycleStatus(e, tf)}>{@html statusSvg(_hz)}</button>{/if}
										<!-- svelte-ignore a11y-no-static-element-interactions -->
										<span
											class="tm-cal-target-chip-name"
											draggable={true}
											on:dragstart={(e) => {
												setDragPayload({ type: "file", filePath: tf.path });
												if (e.dataTransfer) {
													e.dataTransfer.effectAllowed = "copy";
													e.dataTransfer.setData("text/plain", tf.path);
												}
											}}
											on:dragend={() => setDragPayload(null)}
											on:dblclick={(e) => previewChip(e, tf)}
										>{tf.basename}</span>
										<button
											class="tm-cal-target-chip-remove"
											draggable={false}
											on:click={(e) => void clearTargetDate(e, tf)}
											aria-label="Remove target date from {tf.basename}"
										>×</button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

	{/if}

	<!-- ── Agenda view ────────────────────────────────────────────────────── -->
	{#if viewType === "agenda"}
		{@const agendaDays = Array.from({ length: 30 }, (_, i) => anchor.clone().add(i, "day"))}
		<div class="tm-cal-agenda">
			{#each agendaDays as day (dayKey(day))}
				{@const dk = dayKey(day)}
				{@const agEvts = visibleEventsByDay.get(dk) ?? []}
				{@const agTargets = showTargetFiles ? (dayTargets.get(dk) ?? []) : []}
				{#if agEvts.length > 0 || agTargets.length > 0}
					{@const today = isToday(day)}
					<div class="tm-cal-agenda-day" class:tm-cal-agenda-day--today={today}>
						<div class="tm-cal-agenda-day-header">
							<button
								class="tm-cal-agenda-day-label"
								class:tm-cal-agenda-day-label--today={today}
								on:click={() => { anchorDate = dk; viewType = "day"; }}
								title="Switch to day view for {day.format('MMM D')}"
							>
								<span class="tm-cal-agenda-day-dow">{day.format("ddd")}</span>
								<span class="tm-cal-agenda-day-num">{day.format("D")}</span>
								{#if today}<span class="tm-cal-agenda-today-chip">Today</span>{/if}
							</button>
							{#if dayEnabled}
								{@const dn = noteExistsForDay(day)}
								<button
									class="tm-cal-agenda-note-btn"
									class:tm-cal-agenda-note-btn--exists={dn}
									on:click={() => void openDay(day)}
									title="{dn ? 'Open' : 'Create'} daily note"
								>
									<Icon name={dn ? "file-text" : "file-plus"} size={12} />
								</button>
							{/if}
						</div>
						<div class="tm-cal-agenda-day-body">
							{#each agEvts as evt (evt.uid)}
								{@const timeText = evt.allDay ? "All day" : evt.end ? `${evt.start.format("h:mm")}–${evt.end.format("h:mm a")}` : evt.start.format("h:mm a")}
								<div
									class="tm-cal-agenda-evt"
									style={evt.sourceColor ? `border-left-color:${evt.sourceColor}` : ""}
									title={evt.summary}
								>
									<span class="tm-cal-agenda-evt-time">{timeText}</span>
									<span class="tm-cal-agenda-evt-title">{evt.summary}</span>
								</div>
							{/each}
							{#each agTargets as tf (tf.path)}
								{@const _ag = getFileStatus(tf)}
								<div class="tm-cal-target-chip" title="{tf.basename} — drag to move, click × to remove" on:contextmenu={(e) => showChipMenu(e, tf)}>
									{#if _ag}<button class="tm-cal-target-chip-status" title={_ag} on:click={(e) => void cycleStatus(e, tf)}>{@html statusSvg(_ag)}</button>{/if}
									<!-- svelte-ignore a11y-no-static-element-interactions -->
									<span
										class="tm-cal-target-chip-name"
										draggable={true}
										on:dragstart={(e) => {
											setDragPayload({ type: "file", filePath: tf.path });
											if (e.dataTransfer) {
												e.dataTransfer.effectAllowed = "copy";
												e.dataTransfer.setData("text/plain", tf.path);
											}
										}}
										on:dragend={() => setDragPayload(null)}
										on:dblclick={(e) => previewChip(e, tf)}
									>{tf.basename}</span>
									<button
										class="tm-cal-target-chip-remove"
										draggable={false}
										on:click={(e) => void clearTargetDate(e, tf)}
										aria-label="Remove target date from {tf.basename}"
									>×</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/each}
			{#if agendaDays.every(d => (visibleEventsByDay.get(dayKey(d)) ?? []).length === 0 && (!showTargetFiles || (dayTargets.get(dayKey(d)) ?? []).length === 0))}
				<div class="tm-cal-agenda-empty">No events or scheduled files in the next 30 days.</div>
			{/if}
		</div>
	{/if}

	</div><!-- /.tm-cal-content -->
	</div><!-- /.tm-cal-body -->
</div>

<style>
	/* ── Shell ── */
	.tm-cal {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		background: var(--background-primary);
	}

	/* ── Body (panel + calendar side-by-side) ── */
	.tm-cal-body {
		flex: 1;
		display: flex;
		flex-direction: row;
		overflow: hidden;
		min-height: 0;
	}

	.tm-cal-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-width: 0;
		position: relative;
	}

	/* ── Panel toggle button group ── */
	.tm-cal-panel-btns {
		display: flex;
		align-items: center;
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-s);
		overflow: hidden;
	}

	.tm-cal-panel-btn {
		all: unset;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		color: var(--text-muted);
		transition: background 80ms ease, color 80ms ease;
	}
	.tm-cal-panel-btn + .tm-cal-panel-btn {
		border-left: 1px solid var(--background-modifier-border);
	}
	.tm-cal-panel-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	.tm-cal-panel-btn--active {
		background: color-mix(in srgb, var(--interactive-accent) 15%, transparent);
		color: var(--interactive-accent);
	}

	/* ── Header ── */
	.tm-cal-header {
		flex-shrink: 0;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		padding: 10px 16px;
		border-bottom: 1px solid var(--background-modifier-border);
		gap: 8px;
	}

	.tm-cal-header-left {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}

	.tm-cal-header-center {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.tm-cal-header-right {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 6px;
	}

	.tm-cal-nav {
		display: flex;
		align-items: center;
		gap: 0;
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-s);
		overflow: hidden;
	}

	.tm-cal-nav-btn {
		all: unset;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		color: var(--text-muted);
		transition: background 80ms ease, color 80ms ease;
	}
	.tm-cal-nav-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }

	.tm-cal-title {
		margin: 0;
		font-size: var(--font-ui-medium);
		font-weight: 600;
		color: var(--text-normal);
		white-space: nowrap;
	}

	/* ── Skeleton / loading ── */
	@keyframes shimmer {
		0%   { background-position: -400px 0; }
		100% { background-position:  400px 0; }
	}

	.shimmer {
		background: linear-gradient(
			90deg,
			var(--background-modifier-hover) 25%,
			color-mix(in srgb, var(--background-modifier-hover) 50%, var(--background-secondary)) 50%,
			var(--background-modifier-hover) 75%
		);
		background-size: 400px 100%;
		animation: shimmer 1.4s ease-in-out infinite;
		border-radius: var(--radius-s);
	}

	.tm-cal-skeleton {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 2;
		background: var(--background-primary);
		overflow: hidden;
	}

	/* Day skeleton */
	.tm-cal-skeleton-day {
		display: flex;
		flex-direction: column;
		padding-top: 8px;
	}
	.tm-cal-skeleton-slot {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 44px;
		padding: 0 16px 0 16px;
		border-bottom: 1px solid var(--background-modifier-border);
	}
	.tm-cal-skeleton-time {
		width: 40px;
		height: 11px;
		flex-shrink: 0;
	}
	.tm-cal-skeleton-evt {
		height: 28px;
	}

	/* Week skeleton */
	.tm-cal-skeleton-week {
		display: flex;
		gap: 1px;
		padding: 48px 8px 0;
		height: 100%;
	}
	.tm-cal-skeleton-col {
		flex: 1;
		position: relative;
	}

	/* Month skeleton */
	.tm-cal-skeleton-month {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 1px;
		padding: 32px 0 0;
	}
	.tm-cal-skeleton-cell {
		padding: 6px 8px;
		min-height: 80px;
	}
	.tm-cal-skeleton-cell-num {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		margin-bottom: 6px;
	}
	.tm-cal-skeleton-cell-bar {
		height: 14px;
		width: 85%;
	}

	/* Generic skeleton */
	.tm-cal-skeleton-generic {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 32px 24px;
	}
	.tm-cal-skeleton-line {
		height: 14px;
	}

	/* Re-fetch progress bar */
	.tm-cal-progress-bar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		z-index: 2;
		overflow: hidden;
		pointer-events: none;
	}
	.tm-cal-progress-bar-fill {
		height: 100%;
		background: var(--interactive-accent);
		animation: progress-slide 1.2s ease-in-out infinite;
	}
	@keyframes progress-slide {
		0%   { transform: translateX(-100%); }
		100% { transform: translateX(400%); }
	}

	.tm-cal-today-btn {
		all: unset;
		cursor: pointer;
		padding: 3px 10px;
		font-size: var(--font-ui-small);
		font-weight: 500;
		color: var(--text-muted);
		border-left: 1px solid var(--background-modifier-border);
		border-right: 1px solid var(--background-modifier-border);
		transition: background 80ms ease, color 80ms ease;
	}
	.tm-cal-today-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }

	.tm-cal-view-toggle {
		display: flex;
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-s);
		overflow: hidden;
	}

	.tm-cal-view-btn {
		all: unset;
		cursor: pointer;
		padding: 3px 10px;
		font-size: var(--font-ui-small);
		font-weight: 500;
		color: var(--text-muted);
		transition: background 80ms ease, color 80ms ease;
	}
	.tm-cal-view-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
	.tm-cal-view-btn--active {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	/* ── Filter panel ── */
	.tm-cal-filter-panel {
		width: 220px;
		min-width: 180px;
		flex-shrink: 0;
		border-right: 1px solid var(--background-modifier-border);
		overflow-y: auto;
		background: var(--background-primary);
		padding: 12px 0 16px;
	}

	.tm-cal-filter-section {
		margin-bottom: 8px;
	}

	.tm-cal-filter-section-title {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-faint);
		padding: 4px 16px 6px;
	}

	.tm-cal-filter-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 5px 16px;
		cursor: pointer;
		border-radius: 0;
		transition: background 80ms ease;
		user-select: none;
	}
	.tm-cal-filter-row:hover { background: var(--background-modifier-hover); }

	.tm-cal-filter-check {
		width: 16px;
		height: 16px;
		border-radius: 4px;
		border: 2px solid var(--background-modifier-border);
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: white;
		transition: background 80ms ease, border-color 80ms ease;
	}
	.tm-cal-filter-check--on { color: white; }

	.tm-cal-filter-label {
		font-size: var(--font-ui-small);
		color: var(--text-normal);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── List panel ── */
	.tm-cal-list-panel {
		width: 260px;
		min-width: 200px;
		flex-shrink: 0;
		border-right: 1px solid var(--background-modifier-border);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		background: var(--background-primary);
	}

	.tm-cal-list-empty {
		padding: 32px 20px;
		text-align: center;
		color: var(--text-faint);
		font-size: var(--font-ui-small);
	}

	.tm-cal-list-day {
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.tm-cal-list-day--today .tm-cal-list-day-header {
		background: color-mix(in srgb, var(--interactive-accent) 5%, transparent);
	}

	.tm-cal-list-day-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 16px 6px;
		position: sticky;
		top: 0;
		background: var(--background-primary);
		z-index: 1;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.tm-cal-list-day-label {
		display: flex;
		align-items: baseline;
		gap: 6px;
		cursor: pointer;
		flex: 1;
		min-width: 0;
		color: var(--text-muted);
		border-radius: var(--radius-s);
		padding: 2px 4px;
		margin: -2px -4px;
		transition: background 80ms ease;
	}
	.tm-cal-list-day-label:hover { background: var(--background-modifier-hover); }
	.tm-cal-list-day-label--today { color: var(--text-normal); }

	.tm-cal-list-day-dow {
		font-size: var(--font-ui-small);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.tm-cal-list-day-num {
		font-size: 20px;
		font-weight: 600;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}
	.tm-cal-list-day-num--today {
		color: var(--interactive-accent);
	}

	.tm-cal-list-day-month {
		font-size: var(--font-ui-smaller);
		color: var(--text-faint);
	}

	.tm-cal-list-today-chip {
		font-size: 10px;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 99px;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}

	.tm-cal-list-note-btn {
		all: unset;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: var(--radius-s);
		color: var(--text-faint);
		flex-shrink: 0;
		transition: background 80ms ease, color 80ms ease;
	}
	.tm-cal-list-note-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
	.tm-cal-list-note-btn--exists { color: var(--text-muted); }

	.tm-cal-list-day-body {
		padding: 6px 16px 10px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.tm-cal-list-evt {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 4px 10px;
		border-radius: var(--radius-s);
		background: var(--background-secondary);
		border-left: 3px solid var(--interactive-accent);
		font-size: var(--font-ui-smaller);
		overflow: hidden;
	}

	.tm-cal-list-evt-time {
		flex-shrink: 0;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		min-width: 80px;
	}

	.tm-cal-list-evt-title {
		color: var(--text-normal);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── Day view ── */
	.tm-cal-day-view {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	/* Outer day-view drag-over: highlights the note-row and all-day-events row.
	   The period bar handles its own highlight via .tm-cal-period-bar--drag-over. */
	.tm-cal-day-view--drag-over .tm-cal-day-note-row,
	.tm-cal-day-view--drag-over .tm-cal-day-allday {
		background: color-mix(in srgb, var(--color-orange, #f59e0b) 8%, transparent);
	}

	.tm-cal-day-note-row {
		flex-shrink: 0;
		padding: 8px 16px 4px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.tm-cal-day-note-btn {
		all: unset;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 12px;
		border-radius: var(--radius-s);
		border: 1px dashed var(--background-modifier-border);
		font-size: var(--font-ui-small);
		color: var(--text-faint);
		transition: background 80ms ease, color 80ms ease, border-color 80ms ease;
	}
	.tm-cal-day-note-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		border-color: var(--background-modifier-border-hover, var(--background-modifier-border));
	}
	.tm-cal-day-note-btn--exists {
		border-style: solid;
		color: var(--text-muted);
	}
	.tm-cal-day-note-btn--exists:hover { color: var(--text-accent); }

	.tm-cal-day-allday {
		flex-shrink: 0;
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 6px 16px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
	}

	.tm-cal-day-allday-label {
		flex-shrink: 0;
		font-size: var(--font-ui-smaller);
		color: var(--text-faint);
		padding-top: 2px;
		min-width: 46px;
		text-align: right;
	}

	.tm-cal-day-allday-events {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.tm-cal-day-allday-evt {
		font-size: var(--font-ui-smaller);
		padding: 2px 8px;
		border-radius: var(--radius-s);
		border-left: 3px solid var(--interactive-accent);
		background: color-mix(in srgb, var(--interactive-accent) 10%, transparent);
		color: var(--text-normal);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 240px;
	}

	.tm-cal-day-slots {
		flex: 1;
		overflow-y: auto;
	}

	.tm-cal-day-slot {
		display: flex;
		align-items: flex-start;
		gap: 0;
		border-bottom: 1px solid var(--background-modifier-border);
		min-height: 44px;
	}
	.tm-cal-day-slot--current {
		background: color-mix(in srgb, var(--interactive-accent) 4%, var(--background-primary));
	}
	.tm-cal-day-slot--drag-over {
		background: color-mix(in srgb, var(--color-orange, #f59e0b) 10%, var(--background-primary));
		outline: 1px dashed color-mix(in srgb, var(--color-orange, #f59e0b) 50%, transparent);
		outline-offset: -1px;
	}

	.tm-cal-day-slot-label {
		flex-shrink: 0;
		width: 56px;
		padding: 12px 8px 0 16px;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--text-faint);
		text-align: right;
		line-height: 1;
	}
	.tm-cal-day-slot--current .tm-cal-day-slot-label {
		color: var(--interactive-accent);
		font-weight: 600;
	}

	.tm-cal-day-slot-body {
		flex: 1;
		padding: 4px 8px 4px 12px;
		display: flex;
		flex-direction: row;
		align-items: stretch;
		gap: 3px;
	}

	.tm-cal-day-slot-evt {
		flex: 1;
		min-width: 0;
		font-size: var(--font-ui-smaller);
		padding: 3px 8px;
		border-radius: var(--radius-s);
		background: var(--background-secondary);
		border-left: 3px solid var(--interactive-accent);
		display: flex;
		flex-direction: column;
		gap: 1px;
		overflow: hidden;
	}

	.tm-cal-day-slot-evt-time {
		font-size: 10px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.tm-cal-day-slot-evt-title {
		color: var(--text-normal);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── Shared period target bar (all-day / all-week / all-month / all-year) ── */
	.tm-cal-period-bar {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 8px 2px 12px;
		border-bottom: 1px solid var(--background-modifier-border);
		min-height: 24px;
		transition: background 80ms ease;
	}
	.tm-cal-period-bar--drag-over {
		background: color-mix(in srgb, var(--color-orange, #f59e0b) 8%, transparent);
		outline: 1px dashed color-mix(in srgb, var(--color-orange, #f59e0b) 40%, transparent);
		outline-offset: -1px;
	}
	.tm-cal-period-bar-label {
		flex-shrink: 0;
		font-size: 11px;
		color: var(--text-faint);
		user-select: none;
		min-width: 52px;
		text-align: right;
	}
	.tm-cal-period-bar-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 3px;
		min-width: 0;
		overflow: hidden;
	}

	/* ── Month grid ── */
	.tm-cal-month-grid {
		flex: 1;
		display: grid;
		/* grid-template-columns set inline via style prop */
		grid-auto-rows: 1fr;
		gap: 1px;
		background: var(--background-modifier-border);
		overflow: hidden;
	}

	.tm-cal-week-label-header,
	.tm-cal-day-header {
		background: var(--background-primary);
		font-size: var(--font-ui-smaller);
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		text-align: center;
		padding: 6px 4px 4px;
	}

	/* Week number column */
	.tm-cal-week-num {
		all: unset;
		cursor: pointer;
		background: var(--background-secondary);
		font-size: var(--font-ui-smallest);
		font-weight: 600;
		color: var(--text-faint);
		text-align: center;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 80ms ease, color 80ms ease;
	}
	.tm-cal-week-num:hover { background: var(--background-modifier-hover); color: var(--text-accent); }
	.tm-cal-week-num--exists { color: var(--text-muted); }

	/* Day cell */
	.tm-cal-day-cell {
		background: var(--background-primary);
		padding: 4px 4px 3px;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 2px;
		transition: background 60ms ease;
		min-height: 0;
		overflow: hidden;
	}
	.tm-cal-day-cell--other-month { background: var(--background-secondary); }

	.tm-cal-day-num {
		font-size: var(--font-ui-small);
		font-weight: 500;
		color: var(--text-muted);
		line-height: 1.2;
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.tm-cal-day-num--today {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		font-weight: 700;
	}
	.tm-cal-day-cell--other-month .tm-cal-day-num { color: var(--text-faint); }

	/* Note existence dot */
	.tm-cal-note-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
		border: 1.5px solid var(--text-faint);
		background: transparent;
		transition: background 80ms ease, border-color 80ms ease;
	}
	.tm-cal-note-dot--exists {
		background: var(--interactive-accent);
		border-color: var(--interactive-accent);
	}

	.tm-cal-reminder-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
		background: var(--color-orange, #f5a623);
		border: 1.5px solid var(--color-orange, #f5a623);
		cursor: default;
	}

	/* Event bars */
	.tm-cal-event-bars {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.tm-cal-event-bar {
		font-size: 10px;
		font-weight: 500;
		line-height: 1.3;
		padding: 1px 4px;
		border-radius: 3px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		background: color-mix(in srgb, var(--interactive-accent) 22%, transparent);
		color: var(--interactive-accent);
		min-width: 0;
	}
	.tm-cal-event-more {
		font-size: 9px;
		color: var(--text-faint);
		line-height: 1;
		padding-left: 2px;
	}

	/* ── Week grid ── */
	/* ── Week time grid (2D: 24 hours × 7 days) ── */
	.tm-cal-week-time-grid {
		flex: 1;
		overflow-y: auto;
		display: grid;
		grid-template-columns: 52px repeat(7, 1fr);
		grid-auto-rows: 44px;
		border-top: 1px solid var(--background-modifier-border);
	}

	.tm-cal-week-hour-gutter {
		display: flex;
		align-items: flex-start;
		justify-content: flex-end;
		padding: 2px 8px 0;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
	}

	.tm-cal-week-hour-label {
		font-size: 10px;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		transform: translateY(-6px);
	}

	.tm-cal-week-hour-cell {
		border-left: 1px solid var(--background-modifier-border);
		border-bottom: 1px solid var(--background-modifier-border);
		padding: 2px 3px;
		overflow: hidden;
		display: flex;
		flex-direction: row;
		align-items: stretch;
		gap: 1px;
		background: var(--background-primary);
	}

	.tm-cal-week-hour-cell--today {
		background: color-mix(in srgb, var(--interactive-accent) 3%, var(--background-primary));
	}

	.tm-cal-week-hour-cell--current {
		background: color-mix(in srgb, var(--interactive-accent) 8%, var(--background-primary));
	}

	.tm-cal-week-hour-evt {
		font-size: 10px;
		padding: 2px 5px;
		border-radius: 3px;
		background: var(--background-secondary);
		border-left: 3px solid var(--interactive-accent);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		gap: 1px;
		flex: 1;
		min-width: 0;
	}

	.tm-cal-week-hour-evt-time {
		font-size: 9px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.tm-cal-week-hour-evt-title {
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text-normal);
	}

	/* ── Week shared header row ── */
	.tm-cal-week-header-row {
		flex-shrink: 0;
		display: grid;
		grid-template-columns: 52px repeat(7, 1fr);
		gap: 1px;
		background: var(--background-modifier-border);
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.tm-cal-week-col-header {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 10px 4px 8px;
		gap: 4px;
		background: var(--background-primary);
	}

	.tm-cal-week-col-header--today {
		background: color-mix(in srgb, var(--interactive-accent) 5%, var(--background-primary));
	}

	.tm-cal-week-day-name {
		font-size: var(--font-ui-smaller);
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.tm-cal-week-day-num {
		all: unset;
		cursor: pointer;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--font-ui-medium);
		font-weight: 500;
		color: var(--text-muted);
		transition: background 80ms ease, color 80ms ease;
	}
	.tm-cal-week-day-num:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
	.tm-cal-week-day-num--today {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		font-weight: 700;
	}
	.tm-cal-week-day-num--today:hover { background: var(--interactive-accent-hover); }

	/* Note button */
	.tm-cal-week-note-btn {
		all: unset;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		margin: 6px 8px 2px;
		padding: 4px 8px;
		border-radius: var(--radius-s);
		border: 1px dashed var(--background-modifier-border);
		font-size: var(--font-ui-smaller);
		color: var(--text-faint);
		transition: background 80ms ease, color 80ms ease, border-color 80ms ease;
		flex-shrink: 0;
	}
	.tm-cal-week-note-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		border-color: var(--background-modifier-border-hover, var(--background-modifier-border));
	}
	.tm-cal-week-note-btn--exists {
		border-style: solid;
		color: var(--text-muted);
		border-color: var(--background-modifier-border);
	}
	.tm-cal-week-note-btn--exists:hover { color: var(--text-accent); }

	/* Events list */
	.tm-cal-week-events {
		flex: 1;
		overflow-y: auto;
		padding: 4px 6px 8px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.tm-cal-week-no-events {
		font-size: var(--font-ui-smaller);
		color: var(--text-faint);
		text-align: center;
		padding: 8px 0;
	}

	.tm-cal-week-event {
		font-size: var(--font-ui-smaller);
		padding: 3px 6px;
		border-radius: var(--radius-s);
		background: var(--background-secondary);
		border-left: 3px solid var(--interactive-accent);
		display: flex;
		flex-direction: column;
		gap: 1px;
		cursor: default;
		overflow: hidden;
	}
	.tm-cal-week-event--allday {
		background: color-mix(in srgb, var(--interactive-accent) 10%, transparent);
	}

	.tm-cal-week-event-time {
		font-size: 10px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.tm-cal-week-event-title {
		color: var(--text-normal);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── Week all-day row ── */
	.tm-cal-week-allday-row {
		flex-shrink: 0;
		display: grid;
		grid-template-columns: 52px repeat(7, 1fr);
		gap: 1px;
		background: var(--background-modifier-border);
		border-bottom: 1px solid var(--background-modifier-border);
		min-height: 28px;
	}

	.tm-cal-week-allday-cell {
		background: var(--background-primary);
		padding: 3px 4px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 24px;
		overflow: hidden;
	}

	/* ── Time gutter (shared left column across header, all-day, and week grid) ── */
	.tm-cal-week-time-gutter {
		background: var(--background-primary);
	}

	.tm-cal-week-time-gutter--label {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding-right: 8px;
		font-size: 10px;
		color: var(--text-faint);
		user-select: none;
		white-space: nowrap;
	}

	.tm-cal-week-time-gutter--col {
		/* spans full height of week grid — intentionally empty */
	}

	.tm-cal-week-allday-evt {
		font-size: var(--font-ui-smaller);
		padding: 2px 6px;
		border-radius: 3px;
		border-left: 3px solid var(--interactive-accent);
		background: color-mix(in srgb, var(--interactive-accent) 10%, transparent);
		color: var(--text-normal);
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: default;
	}

	/* ── Year grid ── */
	.tm-cal-year-grid {
		flex: 1;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		grid-template-rows: repeat(3, 1fr);
		gap: 1px;
		background: var(--background-modifier-border);
		overflow: hidden;
		padding: 0;
	}

	.tm-cal-year-month {
		background: var(--background-primary);
		display: flex;
		flex-direction: column;
		padding: 10px 8px 8px;
		min-height: 0;
		overflow: hidden;
	}

	.tm-cal-year-month-name {
		font-size: var(--font-ui-small);
		font-weight: 600;
		color: var(--text-normal);
		margin-bottom: 6px;
		flex-shrink: 0;
	}

	.tm-cal-year-mini-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 1px;
		flex: 1;
	}

	.tm-cal-year-dow {
		font-size: 9px;
		font-weight: 600;
		color: var(--text-faint);
		text-align: center;
		text-transform: uppercase;
		padding-bottom: 2px;
	}

	.tm-cal-year-day {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		border-radius: 50%;
		aspect-ratio: 1;
		cursor: pointer;
		transition: background 60ms ease;
		line-height: 1;
	}
	.tm-cal-year-day:hover:not(.tm-cal-year-day--other-month) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	.tm-cal-year-day--other-month {
		color: var(--text-faint);
		opacity: 0.35;
		cursor: default;
		pointer-events: none;
	}
	.tm-cal-year-day--today {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		font-weight: 700;
	}
	.tm-cal-year-day--today:hover { background: var(--interactive-accent-hover); }
	.tm-cal-year-day--has-note {
		font-weight: 600;
		color: var(--text-normal);
	}

	.tm-cal-year-note-dot {
		position: absolute;
		bottom: 1px;
		left: 50%;
		transform: translateX(-50%);
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--interactive-accent);
	}
	.tm-cal-year-day--today .tm-cal-year-note-dot {
		background: var(--text-on-accent);
	}

	/* ── Drag-over highlights ── */
	.tm-cal-day-cell--drag-over {
		background: color-mix(in srgb, var(--interactive-accent) 12%, var(--background-primary)) !important;
		outline: 1.5px dashed var(--interactive-accent);
		outline-offset: -1px;
	}
	.tm-cal-week-col--drag-over {
		background: color-mix(in srgb, var(--interactive-accent) 10%, var(--background-primary)) !important;
	}
	.tm-cal-week-num-cell--drag-over .tm-cal-week-num {
		background: color-mix(in srgb, var(--interactive-accent) 18%, transparent);
		color: var(--interactive-accent);
	}
	.tm-cal-day-view--drag-over {
		outline: 2px dashed var(--interactive-accent);
		outline-offset: -4px;
	}

	/* ── Week number wrapper (needed to host both the button and target badges) ── */
	.tm-cal-week-num-cell {
		background: var(--background-secondary);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		gap: 2px;
		padding-top: 2px;
		/* Override the button's background so it doesn't double-apply */
	}
	/* The inner button no longer needs to paint its own background */
	.tm-cal-week-num-cell .tm-cal-week-num {
		background: transparent;
		width: 100%;
		height: auto;
		padding: 6px 2px 4px;
	}

	.tm-cal-week-target-badges {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		width: 100%;
	}
	.tm-cal-week-target-badge {
		all: unset;
		cursor: pointer;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-orange, #f59e0b);
		display: block;
		transition: transform 80ms ease;
	}
	.tm-cal-week-target-badge:hover {
		transform: scale(1.4);
		background: var(--text-error);
	}

	/* ── Target date chips (shared across all views) ── */
	.tm-cal-target-chips,
	.tm-cal-week-targets {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
	}

	.tm-cal-week-targets {
		flex-shrink: 0;
		padding: 4px 6px 0;
	}

	.tm-cal-target-chip {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		max-width: 100%;
		font-size: 10px;
		font-weight: 500;
		line-height: 1.3;
		padding: 1px 3px 1px 4px;
		border-radius: 3px;
		background: var(--background-modifier-hover);
		color: var(--text-muted);
		border: 1px solid var(--background-modifier-border);
		min-width: 0;
	}

	.tm-cal-target-chip-status {
		all: unset;
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		line-height: 0;
		cursor: pointer;
		border-radius: 50%;
		transition: transform 80ms ease;
	}
	.tm-cal-target-chip-status:hover {
		transform: scale(1.25);
	}

	.tm-cal-target-chip-name {
		cursor: grab;
		user-select: none;
	}

	.tm-cal-target-chip-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	.tm-cal-target-chip-remove {
		all: unset;
		cursor: pointer;
		flex-shrink: 0;
		font-size: 11px;
		line-height: 1;
		color: var(--text-faint);
		opacity: 0;
		transition: opacity 80ms ease, color 80ms ease;
		padding: 0 1px;
	}
	.tm-cal-target-chip:hover .tm-cal-target-chip-remove {
		opacity: 1;
	}
	.tm-cal-target-chip-remove:hover {
		color: var(--text-error);
	}

	/* Time-slot chip (rendered inside a day-view hour row) */
	.tm-cal-day-slot-chip {
		align-self: flex-start;
	}

	/* Reminder chip in calendar views */
	.tm-cal-reminder-chip-cal {
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 1px 4px;
		border-radius: var(--radius-s);
		font-size: var(--font-ui-smaller);
		color: var(--interactive-accent);
		background: color-mix(in srgb, var(--interactive-accent) 10%, transparent);
		overflow: hidden;
		white-space: nowrap;
		align-self: flex-start;
	}
	.tm-cal-reminder-chip-cal:hover {
		background: color-mix(in srgb, var(--interactive-accent) 18%, transparent);
	}
	.tm-cal-reminder-chip-cal-icon { flex-shrink: 0; }
	.tm-cal-reminder-chip-cal-name {
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
		cursor: grab;
		user-select: none;
	}
	.tm-cal-reminder-chip-cal--block {
		width: 100%;
		box-sizing: border-box;
	}
	.tm-cal-reminder-chip-remove {
		all: unset;
		cursor: pointer;
		flex-shrink: 0;
		font-size: 11px;
		line-height: 1;
		opacity: 0.5;
		padding: 0 1px;
	}
	.tm-cal-reminder-chip-remove:hover { opacity: 1; }

	/* Full-width block chip — used inside month day cells, week all-day cells, week hour cells */
	.tm-cal-target-chip--block {
		display: flex;
		width: 100%;
		box-sizing: border-box;
		align-self: flex-start;
	}

	/* ── Horizon view ── */
	.tm-cal-horizon {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	.tm-cal-horizon-empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--font-ui-small);
		color: var(--text-faint);
		padding: 32px;
		text-align: center;
	}

	.tm-cal-horizon-band {
		padding: 12px 20px 12px;
		border-bottom: 1px solid var(--background-modifier-border);
		display: flex;
		flex-direction: column;
		gap: 8px;
		transition: background 60ms ease;
	}

	.tm-cal-horizon-band--today {
		background: color-mix(in srgb, var(--interactive-accent) 4%, var(--background-primary));
	}

	.tm-cal-horizon-band-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.tm-cal-horizon-band-titles {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.tm-cal-horizon-gran {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-faint);
		line-height: 1;
	}

	.tm-cal-horizon-period {
		font-size: var(--font-ui-medium);
		font-weight: 600;
		color: var(--text-normal);
		line-height: 1.3;
	}

	.tm-cal-horizon-band--today .tm-cal-horizon-gran {
		color: var(--interactive-accent);
	}

	.tm-cal-horizon-note-btn {
		all: unset;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 11px;
		border-radius: var(--radius-s);
		border: 1px dashed var(--background-modifier-border);
		font-size: var(--font-ui-smaller);
		color: var(--text-faint);
		flex-shrink: 0;
		transition: background 80ms ease, color 80ms ease, border-color 80ms ease;
	}
	.tm-cal-horizon-note-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		border-color: var(--background-modifier-border-hover, var(--background-modifier-border));
	}
	.tm-cal-horizon-note-btn--exists {
		border-style: solid;
		color: var(--text-muted);
	}
	.tm-cal-horizon-note-btn--exists:hover { color: var(--text-accent); }

	.tm-cal-horizon-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	/* ── Agenda view ── */
	.tm-cal-agenda {
		flex: 1;
		overflow-y: auto;
		padding: 8px 0;
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.tm-cal-agenda-empty {
		padding: 24px 20px;
		color: var(--text-faint);
		font-size: var(--font-ui-small);
		text-align: center;
	}

	.tm-cal-agenda-day {
		display: flex;
		flex-direction: column;
		border-bottom: 1px solid var(--background-modifier-border);
	}
	.tm-cal-agenda-day--today {
		background: color-mix(in srgb, var(--interactive-accent) 5%, transparent);
	}

	.tm-cal-agenda-day-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 16px 4px;
	}

	.tm-cal-agenda-day-label {
		all: unset;
		cursor: pointer;
		display: flex;
		align-items: baseline;
		gap: 6px;
		flex: 1;
	}
	.tm-cal-agenda-day-label:hover .tm-cal-agenda-day-num {
		color: var(--interactive-accent);
	}

	.tm-cal-agenda-day-dow {
		font-size: var(--font-ui-smaller);
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		min-width: 28px;
	}

	.tm-cal-agenda-day-num {
		font-size: var(--font-ui-medium);
		font-weight: 600;
		color: var(--text-normal);
		transition: color 80ms ease;
	}

	.tm-cal-agenda-day-label--today .tm-cal-agenda-day-dow {
		color: var(--interactive-accent);
	}
	.tm-cal-agenda-day-label--today .tm-cal-agenda-day-num {
		color: var(--interactive-accent);
	}

	.tm-cal-agenda-today-chip {
		font-size: var(--font-ui-smaller);
		font-weight: 500;
		color: var(--interactive-accent);
		background: color-mix(in srgb, var(--interactive-accent) 15%, transparent);
		border-radius: 10px;
		padding: 1px 7px;
	}

	.tm-cal-agenda-note-btn {
		all: unset;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: var(--radius-s);
		color: var(--text-faint);
		transition: background 80ms ease, color 80ms ease;
	}
	.tm-cal-agenda-note-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	.tm-cal-agenda-note-btn--exists { color: var(--text-muted); }
	.tm-cal-agenda-note-btn--exists:hover { color: var(--text-accent); }

	.tm-cal-agenda-day-body {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 2px 16px 10px 52px;
	}

	.tm-cal-agenda-evt {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 4px 8px;
		border-left: 3px solid var(--interactive-accent);
		border-radius: 0 var(--radius-s) var(--radius-s) 0;
		background: var(--background-secondary);
		font-size: var(--font-ui-small);
	}

	.tm-cal-agenda-evt-time {
		flex-shrink: 0;
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
		min-width: 80px;
	}

	.tm-cal-agenda-evt-title {
		color: var(--text-normal);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
