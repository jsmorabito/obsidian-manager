<script lang="ts">
	import { moment } from "obsidian";
	import type TimeManagerPlugin from "../main";
	import type { CalendarEvent } from "./types";
	import Icon from "../utils/Icon.svelte";

	export let plugin: TimeManagerPlugin;
	/** The calendar day to display events for. Defaults to today. */
	export let date: ReturnType<typeof moment> = moment();

	let events: CalendarEvent[] = [];
	let loading = true;
	let error = false;
	let collapsed = false;

	$: hasSources = plugin.settings.time.calendarSources.some((s) => s.enabled);

	// Re-fetch only when the calendar day actually changes, not on every Moment
	// object re-creation (focusedDate returns a new instance each reactive tick).
	$: dateKey = date.format("YYYY-MM-DD");

	$: if (hasSources && dateKey) {
		fetchEvents(date);
	}

	async function fetchEvents(d: ReturnType<typeof moment>) {
		loading = true;
		error = false;
		try {
			events = await plugin.calendarService.getEventsForDate(d);
		} catch (e) {
			console.error("[time-tools] EventsStrip error:", e);
			error = true;
		} finally {
			loading = false;
		}
	}

	/** Called by DailyNoteView when calendar sources change. */
	export function refresh() {
		if (hasSources) fetchEvents(date);
	}

	function formatTime(evt: CalendarEvent): string {
		if (evt.allDay) return "All day";
		if (evt.end) return `${evt.start.format("HH:mm")}–${evt.end.format("HH:mm")}`;
		return evt.start.format("HH:mm");
	}
</script>

{#if hasSources}
	<div class="tm-events-strip" class:tm-events-strip--collapsed={collapsed}>
		<button
			class="tm-events-strip-header"
			on:click={() => (collapsed = !collapsed)}
			aria-expanded={!collapsed}
		>
			<span class="tm-events-strip-icon"><Icon name="calendar" size={12} /></span>

			{#if loading}
				<span class="tm-events-strip-label">Loading events…</span>
			{:else if error}
				<span class="tm-events-strip-label tm-events-strip-label--error">Calendar error</span>
			{:else}
				{@const isToday = date.isSame(moment(), "day")}
				{@const dayLabel = isToday ? "today" : date.format("MMM D")}
				<span class="tm-events-strip-label">
					{events.length === 0
						? `No events ${dayLabel}`
						: events.length === 1
						? `1 event ${dayLabel}`
						: `${events.length} events ${dayLabel}`}
				</span>
			{/if}

			<!-- Chevron -->
			<span class="tm-events-strip-chevron"><Icon name="chevron-down" size={11} /></span>
		</button>

		{#if !collapsed && !loading && !error && events.length > 0}
			<div class="tm-events-strip-body">
				{#each events as evt (evt.uid)}
					<div class="tm-events-strip-row">
						<span
							class="tm-events-strip-dot"
							style={evt.sourceColor ? `background:${evt.sourceColor}` : ""}
						></span>
						<span class="tm-events-strip-time">{formatTime(evt)}</span>
						<span class="tm-events-strip-summary">{evt.summary}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.tm-events-strip {
		flex-shrink: 0;
		border-bottom: 1px solid var(--background-modifier-border);
		background-color: var(--background-secondary);
	}

	.tm-events-strip-header {
		all: unset;
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 5px 12px;
		cursor: pointer;
		box-sizing: border-box;
		font-size: var(--font-ui-small);
		color: var(--text-muted);
		transition: background-color 80ms ease;
	}

	.tm-events-strip-header:hover {
		background-color: var(--background-modifier-hover);
	}

	.tm-events-strip-icon {
		flex-shrink: 0;
		opacity: 0.7;
	}

	.tm-events-strip-label {
		flex: 1;
	}

	.tm-events-strip-label--error {
		color: var(--text-error, var(--color-red));
	}

	.tm-events-strip-chevron {
		flex-shrink: 0;
		opacity: 0.6;
		transition: transform 120ms ease;
	}

	.tm-events-strip--collapsed .tm-events-strip-chevron {
		transform: rotate(-90deg);
	}

	.tm-events-strip-body {
		padding: 2px 12px 6px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.tm-events-strip-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 0;
	}

	.tm-events-strip-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		background-color: var(--interactive-accent);
	}

	.tm-events-strip-time {
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
		white-space: nowrap;
		min-width: 80px;
	}

	.tm-events-strip-summary {
		font-size: var(--font-ui-small);
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
