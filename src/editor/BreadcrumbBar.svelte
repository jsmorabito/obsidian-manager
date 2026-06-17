<script lang="ts">
	/**
	 * BreadcrumbBar — navigation bar shown below the toolbar in daily mode.
	 *
	 * Renders: prev/next chevrons, hierarchical breadcrumb segments, a
	 * period-nav dropdown on the active segment, and a "Today / This Week /…"
	 * return button when the view is not on the current period.
	 *
	 * All navigation is dispatched as events; the parent owns the actual
	 * scroll / file-creation logic.
	 */
	import { createEventDispatcher } from "svelte";
	import { moment } from "obsidian";
	import type { Granularity } from "../periodic/types";
	import { displayConfigs } from "../periodic/types";
	import type { BreadcrumbSeg, SubPeriod } from "./types";
	import { startOfHalfYear, halfOf } from "../periodic/half-year";

	// ── Props ────────────────────────────────────────────────────────────────

	export let granularity: Granularity;
	export let breadcrumbSegments: BreadcrumbSeg[];
	export let isOnToday: boolean;
	export let enabledGranularities: Granularity[];

	// ── Local state ──────────────────────────────────────────────────────────

	let showPeriodNav = false;

	// ── Dispatcher ───────────────────────────────────────────────────────────

	const dispatch = createEventDispatcher<{
		prev:              void;
		next:              void;
		today:             void;
		"breadcrumb-click": BreadcrumbSeg;
		"subperiod-click":  SubPeriod;
	}>();

	// ── Helpers ───────────────────────────────────────────────────────────────

	function periodNavClickOutside(node: HTMLElement) {
		const handle = (e: MouseEvent) => {
			if (!node.contains(e.target as Node)) showPeriodNav = false;
		};
		document.addEventListener("click", handle, true);
		return { destroy() { document.removeEventListener("click", handle, true); } };
	}

	/**
	 * Returns the child periods that fall inside the given period.
	 *   year    → Q1–Q4
	 *   quarter → 3 months
	 *   month   → isoWeeks overlapping the month
	 *   week    → 7 days (Mon–Sun)
	 *   day     → [] (no children)
	 */
	function getSubPeriods(date: ReturnType<typeof moment>, gran: Granularity): SubPeriod[] {
		switch (gran) {
			case "day": return [];
			case "week": {
				const start = date.clone().startOf("isoWeek");
				return Array.from({ length: 7 }, (_, i) => {
					const d = start.clone().add(i, "day");
					return { label: String(d.date()), subLabel: d.format("dd").slice(0, 2), gran: "day" as Granularity, date: d };
				});
			}
			case "month": {
				const monthStart = date.clone().startOf("month");
				const monthEnd   = date.clone().endOf("month");
				const weeks: SubPeriod[] = [];
				let w = monthStart.clone().startOf("isoWeek");
				while (w.isSameOrBefore(monthEnd, "day")) {
					weeks.push({ label: `W${w.isoWeek()}`, subLabel: w.format("MMM D"), gran: "week" as Granularity, date: w.clone() });
					w.add(1, "week");
				}
				return weeks;
			}
			case "quarter": {
				const qStart = date.clone().startOf("quarter");
				return [0, 1, 2].map(i => {
					const m = qStart.clone().add(i, "month");
					return { label: m.format("MMM"), subLabel: m.format("YYYY"), gran: "month" as Granularity, date: m };
				});
			}
			case "half-year": {
				const hStart = startOfHalfYear(date);
				return Array.from({ length: 6 }, (_, i) => {
					const mo = hStart.clone().add(i, "month");
					return { label: mo.format("MMM"), subLabel: mo.format("YYYY"), gran: "month" as Granularity, date: mo };
				});
			}
			case "year": {
				return [1, 2, 3, 4].map(q => {
					const qDate = date.clone().startOf("year").add((q - 1) * 3, "month");
					return { label: `Q${q}`, subLabel: qDate.format("MMM"), gran: "quarter" as Granularity, date: qDate };
				});
			}
		}
	}

	$: todayLabel = (() => {
		if (granularity === "day")     return "Today";
		if (granularity === "week")    return "This Week";
		if (granularity === "month")   return "This Month";
		if (granularity === "quarter") return "This Quarter";
		return "This Year";
	})();
</script>

<div class="tm-breadcrumb-bar">
	<button
		class="tm-nav-btn"
		on:click={() => dispatch("prev")}
		aria-label="Previous period"
		title="Previous"
	>
		<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M10 3L5 8l5 5"/>
		</svg>
	</button>

	<div class="tm-breadcrumbs">
		{#each breadcrumbSegments as seg, i}
			{#if i > 0}<span class="tm-breadcrumb-sep">/</span>{/if}
			{#if seg.gran === granularity}
				{@const subPeriods = getSubPeriods(seg.date, granularity)}
				{#if subPeriods.length > 0}
					<div class="tm-period-nav-wrap" use:periodNavClickOutside>
						<button
							class="tm-breadcrumb-seg tm-breadcrumb-seg--current tm-breadcrumb-seg--nav"
							class:tm-breadcrumb-seg--nav-open={showPeriodNav}
							on:click|stopPropagation={() => (showPeriodNav = !showPeriodNav)}
							title="Navigate within {seg.label}"
							aria-haspopup="true"
							aria-expanded={showPeriodNav}
						>
							{seg.label}
							<svg class="tm-period-nav-chevron" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M4 6l4 4 4-4"/>
							</svg>
						</button>
						{#if showPeriodNav}
							<div
								class="tm-period-nav-dropdown"
								class:tm-period-nav-dropdown--days={granularity === "week"}
							>
								{#each subPeriods as sub}
									{@const isToday = sub.date.isSame(moment(), sub.gran === "week" ? "isoWeek" : sub.gran)}
									{@const isEnabled = enabledGranularities.includes(sub.gran)}
									<button
										class="tm-period-nav-item"
										class:tm-period-nav-item--today={isToday}
										class:tm-period-nav-item--disabled={!isEnabled}
										disabled={!isEnabled}
										on:click={() => { showPeriodNav = false; dispatch("subperiod-click", sub); }}
										title={isEnabled ? `Open ${sub.label} ${sub.gran} note` : `${sub.gran} notes not enabled`}
									>
										{#if granularity === "week"}
											<span class="tm-period-nav-day-num">{sub.label}</span>
											<span class="tm-period-nav-day-abbr">{sub.subLabel}</span>
										{:else}
											<span class="tm-period-nav-chip-label">{sub.label}</span>
											{#if granularity === "month"}
												<span class="tm-period-nav-chip-sub">{sub.subLabel}</span>
											{/if}
										{/if}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{:else}
					<button class="tm-breadcrumb-seg tm-breadcrumb-seg--current" title={seg.label}>{seg.label}</button>
				{/if}
			{:else}
				<button
					class="tm-breadcrumb-seg"
					on:click={() => dispatch("breadcrumb-click", seg)}
					title="View {seg.label} in {seg.gran} view"
				>{seg.label}</button>
			{/if}
		{/each}
	</div>

	<button
		class="tm-nav-btn"
		on:click={() => dispatch("next")}
		aria-label="Next period"
		title="Next"
	>
		<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M6 3l5 5-5 5"/>
		</svg>
	</button>

	{#if !isOnToday}
		<button class="tm-today-btn" on:click={() => dispatch("today")}>{todayLabel}</button>
	{/if}
</div>

<style>
	/* Breadcrumb bar */
	.tm-breadcrumb-bar {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 2px 8px;
		border-bottom: 1px solid var(--background-modifier-border);
		background-color: var(--background-primary);
		/* overflow: visible so the period-nav dropdown isn't clipped */
		overflow: visible;
	}

	.tm-breadcrumbs {
		display: flex;
		align-items: center;
		gap: 5px;
		flex: 1;
		justify-content: center;
	}

	.tm-breadcrumb-seg {
		all: unset;
		cursor: pointer;
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
		font-weight: 500;
		white-space: nowrap;
		padding: 1px 4px;
		border-radius: var(--radius-s);
		transition: background-color 80ms ease, color 80ms ease;
	}
	.tm-breadcrumb-seg:hover { background-color: var(--background-modifier-hover); color: var(--text-normal); }
	.tm-breadcrumb-seg--current { color: var(--text-normal); cursor: default; }
	.tm-breadcrumb-sep { font-size: var(--font-ui-smaller); color: var(--text-faint); flex-shrink: 0; }

	/* Nav buttons — 28×28 matches Obsidian's .clickable-icon standard */
	.tm-nav-btn {
		all: unset;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-s);
		color: var(--text-muted);
		flex-shrink: 0;
		transition: background-color 80ms ease, color 80ms ease;
	}
	.tm-nav-btn:hover { background-color: var(--background-modifier-hover); color: var(--text-normal); }

	.tm-today-btn {
		all: unset;
		cursor: pointer;
		padding: 2px 8px;
		border-radius: var(--radius-s);
		font-size: var(--font-ui-smaller);
		color: var(--text-accent);
		font-weight: 500;
		flex-shrink: 0;
		margin-left: 2px;
		transition: background-color 80ms ease;
	}
	.tm-today-btn:hover { background-color: var(--background-modifier-hover); }

	/* Period-nav dropdown */
	.tm-period-nav-wrap { position: relative; display: inline-flex; }
	.tm-breadcrumb-seg--nav { display: inline-flex; align-items: center; gap: 3px; cursor: pointer; }
	.tm-breadcrumb-seg--nav:hover,
	.tm-breadcrumb-seg--nav-open { background-color: var(--background-modifier-hover); color: var(--text-normal); }
	.tm-period-nav-chevron { flex-shrink: 0; opacity: 0.6; transition: transform 120ms ease; }
	.tm-breadcrumb-seg--nav-open .tm-period-nav-chevron { transform: rotate(180deg); }

	.tm-period-nav-dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 50%;
		transform: translateX(-50%);
		z-index: var(--layer-menu);
		background-color: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		box-shadow: var(--shadow-l);
		padding: 8px;
		display: flex;
		flex-direction: row;
		gap: 4px;
		white-space: nowrap;
	}
	.tm-period-nav-dropdown--days { gap: 2px; }

	.tm-period-nav-item {
		all: unset;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		border-radius: var(--radius-s);
		padding: 5px 8px;
		gap: 2px;
		transition: background-color 80ms ease;
		min-width: 32px;
	}
	.tm-period-nav-item:hover:not(:disabled) { background-color: var(--background-modifier-hover); }
	.tm-period-nav-item--today { background-color: var(--interactive-accent); color: var(--text-on-accent); }
	.tm-period-nav-item--today:hover { background-color: var(--interactive-accent-hover); }
	.tm-period-nav-item--disabled { opacity: 0.35; cursor: not-allowed; }
	.tm-period-nav-day-num { font-size: var(--font-ui-small); font-weight: 500; line-height: 1.2; }
	.tm-period-nav-day-abbr { font-size: var(--font-ui-smallest); opacity: 0.7; line-height: 1; }
	.tm-period-nav-chip-label { font-size: var(--font-ui-small); font-weight: 500; line-height: 1.2; }
	.tm-period-nav-chip-sub { font-size: var(--font-ui-smallest); opacity: 0.6; line-height: 1; }
</style>
