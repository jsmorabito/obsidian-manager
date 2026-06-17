<script lang="ts">
	/**
	 * HorizonView — horizontal multi-column view showing today's note for each
	 * enabled granularity side by side.
	 */
	import { createEventDispatcher } from "svelte";
	import type { WorkspaceLeaf, TFile } from "obsidian";
	import { moment } from "obsidian";
	import type TimeManagerPlugin from "../main";
	import type { Granularity } from "../periodic/types";
	import { displayConfigs } from "../periodic/types";
	import DailyNote from "./DailyNote.svelte";
	import { halfOf } from "../periodic/half-year";

	// ── Props ────────────────────────────────────────────────────────────────

	export let plugin: TimeManagerPlugin;
	export let leaf: WorkspaceLeaf;
	export let enabledGranularities: Granularity[];
	export let horizonFiles: Partial<Record<Granularity, TFile | null>>;

	// ── Dispatcher ───────────────────────────────────────────────────────────

	const dispatch = createEventDispatcher<{
		"create-note": { granularity: Granularity };
	}>();

	// ── Helpers ──────────────────────────────────────────────────────────────

	function getHorizonLabel(g: Granularity): string {
		const now = moment();
		switch (g) {
			case "day":       return "Today";
			case "week":      return "This Week";
			case "month":     return now.format("MMMM");
			case "quarter":   return `Q${now.quarter()}`;
			case "half-year": return `H${halfOf(now)} ${now.format("YYYY")}`;
			case "year":      return String(now.year());
		}
	}

	function getHorizonDate(g: Granularity): string {
		const now = moment();
		switch (g) {
			case "day": return now.format("MMM D");
			case "week": {
				const start = now.clone().startOf("isoWeek");
				const end   = now.clone().endOf("isoWeek");
				return start.month() === end.month()
					? `${start.format("MMM D")}–${end.format("D")}`
					: `${start.format("MMM D")}–${end.format("MMM D")}`;
			}
			case "month":     return now.format("YYYY");
			case "quarter":   return now.format("YYYY");
			case "half-year": return now.format("YYYY");
			case "year":      return "";
		}
	}
</script>

<div class="tm-horizon-view">
	{#each enabledGranularities as g}
		{@const hFile = horizonFiles[g]}
		<div class="tm-horizon-column">
			<div class="tm-horizon-col-header">
				<span class="tm-horizon-col-label">{getHorizonLabel(g)}</span>
				{#if getHorizonDate(g)}
					<span class="tm-horizon-col-date">{getHorizonDate(g)}</span>
				{/if}
			</div>
			{#if hFile}
				<div class="tm-horizon-col-body">
					<DailyNote file={hFile} {plugin} {leaf} shouldRender={true} granularity={g} selectionMode="daily" />
				</div>
			{:else}
				<div
					class="tm-horizon-col-empty"
					role="button"
					tabindex="0"
					on:click={() => dispatch("create-note", { granularity: g })}
					on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") dispatch("create-note", { granularity: g }); }}
				>
					<span class="tm-horizon-col-create">
						{displayConfigs[g].labelOpenPresent.replace("Open", "Create")}
					</span>
				</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.tm-horizon-view {
		display: flex;
		flex-direction: row;
		flex: 1;
		overflow-x: auto;
		overflow-y: hidden;
		align-items: stretch;
		-webkit-overflow-scrolling: touch;
		scroll-snap-type: x proximity;
	}

	.tm-horizon-column {
		flex-shrink: 0;
		width: clamp(320px, 40vw, 560px);
		height: 100%;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--background-modifier-border);
		scroll-snap-align: start;
	}

	.tm-horizon-col-header {
		flex-shrink: 0;
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 10px 16px 8px;
		border-bottom: 1px solid var(--background-modifier-border);
		background-color: var(--background-primary);
	}

	.tm-horizon-col-label { font-size: var(--font-ui-medium); font-weight: 600; color: var(--text-normal); }
	.tm-horizon-col-date  { font-size: var(--font-ui-small);  color: var(--text-muted); }
	.tm-horizon-col-body  { flex: 1; overflow-y: auto; }

	.tm-horizon-col-empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		color: var(--text-faint);
		transition: color 150ms ease;
	}
	.tm-horizon-col-empty:hover { color: var(--text-muted); }
	.tm-horizon-col-create { font-size: var(--font-ui-small); text-align: center; }
</style>
