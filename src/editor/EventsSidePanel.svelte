<script lang="ts">
	/**
	 * EventsSidePanel — the collapsible events + targets panel shown beside the
	 * note list when a calendar source is configured.
	 *
	 * Fetches calendar events from CalendarService and target-date files from
	 * TargetDateService for the focused period.  Re-fetches whenever
	 * focusedDate or granularity changes.
	 */
	import { createEventDispatcher } from "svelte";
	import { moment } from "obsidian";
	import type TimeManagerPlugin from "../main";
	import type { Granularity } from "../periodic/types";
	import type { CalendarEvent } from "../calendar/types";
	import { startOfHalfYear, endOfHalfYear, halfOf } from "../periodic/half-year";
	import { labelTargetDate } from "../target-date/target-date-service";

	// ── Props ────────────────────────────────────────────────────────────────

	export let plugin: TimeManagerPlugin;
	export let focusedDate: ReturnType<typeof moment> | null;
	export let granularity: Granularity;

	// ── Dispatcher ───────────────────────────────────────────────────────────

	const dispatch = createEventDispatcher<{ close: void }>();

	// ── Local state ──────────────────────────────────────────────────────────

	let panelEventsByDay: Map<string, CalendarEvent[]> = new Map();
	let panelLoading = false;
	let panelError   = false;

	// ── Helpers ───────────────────────────────────────────────────────────────

	const GRAN_UNIT: Record<Granularity, moment.unitOfTime.StartOf> = {
		day: "day", week: "isoWeek", month: "month",
		quarter: "quarter", "half-year": "month", year: "year",
	};

	$: panelTitle = (() => {
		const d = focusedDate ?? moment();
		if (granularity === "day")       return d.isSame(moment(), "day") ? "Today" : d.format("ddd, MMM D");
		if (granularity === "week")      return `Week ${d.format("W")}`;
		if (granularity === "month")     return d.format("MMMM YYYY");
		if (granularity === "quarter")   return `Q${d.format("Q")} ${d.format("YYYY")}`;
		if (granularity === "half-year") return `H${halfOf(d)} ${d.format("YYYY")}`;
		return d.format("YYYY");
	})();

	$: panelFetchKey = `${focusedDate?.format("YYYY-MM-DD") ?? ""}::${granularity}`;
	$: if (panelFetchKey) void fetchPanelEvents(focusedDate ?? moment(), granularity);

	$: panelTargets = (() => {
		if (!focusedDate || !plugin.targetDateService) return [];
		const unit = GRAN_UNIT[granularity];
		const start = granularity === "half-year" ? startOfHalfYear(focusedDate) : focusedDate.clone().startOf(unit);
		const end   = granularity === "half-year" ? endOfHalfYear(focusedDate)   : focusedDate.clone().endOf(unit);
		return plugin.targetDateService.getFilesWithTargetInRange(start, end);
	})();

	async function fetchPanelEvents(
		d: ReturnType<typeof moment>,
		gran: Granularity
	): Promise<void> {
		panelLoading = true;
		panelError   = false;
		try {
			const unit  = GRAN_UNIT[gran];
			const start = gran === "half-year" ? startOfHalfYear(d) : d.clone().startOf(unit);
			const end   = gran === "half-year" ? endOfHalfYear(d)   : d.clone().endOf(unit);
			panelEventsByDay = await plugin.calendarService.getEventsForRange(start, end);
		} catch (e) {
			console.error("[time-tools] EventsSidePanel:", e);
			panelError = true;
		} finally {
			panelLoading = false;
		}
	}

	function formatPanelTime(evt: CalendarEvent): string {
		if (evt.allDay) return "All day";
		if (evt.end)    return `${evt.start.format("h:mm")}–${evt.end.format("h:mm a")}`;
		return evt.start.format("h:mm a");
	}

	/** Called by DailyNoteEditorView when calendar sources change. */
	export function refreshCalendar() {
		if (focusedDate) void fetchPanelEvents(focusedDate, granularity);
	}
</script>

<div class="tm-events-panel">
	<div class="tm-events-panel-header">
		<span class="tm-events-panel-date">{panelTitle}</span>
		<button
			class="tm-events-panel-close"
			on:click={() => dispatch("close")}
			aria-label="Close events panel"
		>
			<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M12 4L4 12M4 4l8 8"/>
			</svg>
		</button>
	</div>

	<div class="tm-events-panel-body">
		{#if panelLoading}
			<span class="tm-events-panel-status">Loading…</span>
		{:else if panelError}
			<span class="tm-events-panel-status tm-events-panel-status--error">Failed to load events.</span>
		{:else if panelEventsByDay.size === 0}
			<span class="tm-events-panel-status">No events</span>
		{:else}
			{#each Array.from(panelEventsByDay.keys()).sort() as dayKey (dayKey)}
				{@const dayEvents = panelEventsByDay.get(dayKey) ?? []}
				{@const dayMoment = moment(dayKey, "YYYY-MM-DD")}
				{@const isToday = dayMoment.isSame(moment(), "day")}

				{#if granularity !== "day"}
					<div class="tm-events-panel-day-heading" class:tm-events-panel-day-heading--today={isToday}>
						<span class="tm-events-panel-day-label">{dayMoment.format("ddd D")}</span>
						{#if isToday}<span class="tm-pnp-today-chip">Today</span>{/if}
					</div>
				{/if}

				{#each dayEvents as evt (evt.uid)}
					<div class="tm-pnp-event-card">
						<span
							class="tm-pnp-event-stripe"
							style={evt.sourceColor ? `background:${evt.sourceColor}` : ""}
						></span>
						<div class="tm-pnp-event-body">
							<span class="tm-pnp-event-title">{evt.summary}</span>
							<span class="tm-pnp-event-time">{formatPanelTime(evt)}</span>
						</div>
					</div>
				{/each}
			{/each}
		{/if}

		{#if panelTargets.length > 0}
			<div class="tm-events-panel-targets">
				<div class="tm-events-panel-targets-heading">Targets</div>
				{#each panelTargets as { file, target } (file.path)}
					<div class="tm-pnp-target-card">
						<span class="tm-pnp-target-stripe" aria-hidden="true"></span>
						<div class="tm-pnp-target-body">
							<!-- svelte-ignore a11y-click-events-have-key-events -->
							<!-- svelte-ignore a11y-no-static-element-interactions -->
							<span
								class="tm-pnp-target-title"
								on:click={() => plugin.app.workspace.openLinkText(file.path, "", false)}
							>{file.basename}</span>
							<span class="tm-pnp-target-date">{labelTargetDate(target.raw, target.granularity)}</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.tm-events-panel {
		width: 220px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		overflow: hidden;
	}

	.tm-events-panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px 8px;
		border-bottom: 1px solid var(--background-modifier-border);
		flex-shrink: 0;
	}

	.tm-events-panel-date { font-size: var(--font-ui-small); font-weight: 600; color: var(--text-normal); }

	.tm-events-panel-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 4px;
		border: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		flex-shrink: 0;
		transition: background 80ms ease;
	}
	.tm-events-panel-close:hover { background: var(--background-modifier-hover); color: var(--text-normal); }

	.tm-events-panel-body {
		flex: 1;
		overflow-y: auto;
		padding: 8px 8px 16px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.tm-events-panel-status { font-size: var(--font-ui-smaller); color: var(--text-muted); padding: 8px 4px; }
	.tm-events-panel-status--error { color: var(--text-error, var(--color-red)); }

	.tm-events-panel-day-heading {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 6px 2px 2px;
		margin-top: 2px;
	}
	.tm-events-panel-day-heading:first-child { padding-top: 2px; margin-top: 0; }

	.tm-events-panel-day-label { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); }
	.tm-events-panel-day-heading--today .tm-events-panel-day-label { color: var(--interactive-accent); }

	.tm-events-panel-targets {
		margin-top: 10px;
		padding-top: 8px;
		border-top: 1px solid var(--background-modifier-border);
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.tm-events-panel-targets-heading { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; }
</style>
