<script lang="ts">
	/**
	 * TasksPanel — interactive task list for the AgendaView sidebar.
	 *
	 * Shows checkbox items sourced from all notes within the focused period.
	 * Supports All / Open / Done filter tabs and inline checkbox toggling.
	 */
	import { onMount } from "svelte";
	import { moment, MarkdownView } from "obsidian";
	import type { TFile } from "obsidian";
	import type TimeManagerPlugin from "../main";
	import type { Granularity } from "../periodic/types";
	import { getTasksForPeriod, toggleTask, type TaskItem } from "./TaskService";

	// ── Props ────────────────────────────────────────────────────────────────

	export let plugin: TimeManagerPlugin;
	export let granularity: Granularity;
	export let date: ReturnType<typeof moment>;

	// ── State ─────────────────────────────────────────────────────────────────

	type Filter = "all" | "open" | "done";
	let filter: Filter = (plugin.settings.time.agendaTaskFilter as Filter) ?? "all";

	let tasksByFile: Map<TFile, TaskItem[]> = new Map();
	let loading = true;
	let error   = false;

	// ── Load ──────────────────────────────────────────────────────────────────

	onMount(() => { void load(); });

	// Reload whenever the date or granularity changes.
	$: if (date || granularity) void load();

	async function load() {
		loading = true;
		error   = false;
		try {
			tasksByFile = await getTasksForPeriod(plugin, granularity, date);
		} catch (e) {
			console.error("[time-tools] TasksPanel:", e);
			error = true;
		} finally {
			loading = false;
		}
	}

	/** Public refresh hook — called by AgendaView after a vault change. */
	export function refresh() { void load(); }

	// ── Filter ────────────────────────────────────────────────────────────────

	function setFilter(f: Filter) {
		filter = f;
		plugin.settings.time.agendaTaskFilter = f;
		void plugin.saveSettings();
	}

	function visibleTasks(tasks: TaskItem[]): TaskItem[] {
		if (filter === "open") return tasks.filter((t) => !t.isComplete);
		if (filter === "done") return tasks.filter((t) =>  t.isComplete);
		return tasks;
	}

	$: totalAll  = [...tasksByFile.values()].flat().length;
	$: totalOpen = [...tasksByFile.values()].flat().filter((t) => !t.isComplete).length;
	$: totalDone = [...tasksByFile.values()].flat().filter((t) =>  t.isComplete).length;

	$: visibleCount = filter === "open" ? totalOpen : filter === "done" ? totalDone : totalAll;

	// ── Actions ───────────────────────────────────────────────────────────────

	async function handleToggle(item: TaskItem) {
		await toggleTask(plugin, item);
		await load(); // Re-read file so completion state is accurate.
	}

	async function handleNavigate(item: TaskItem) {
		const leaf = plugin.app.workspace.getLeaf(false);
		await leaf.openFile(item.file);

		// Wait one frame for the view to mount, then scroll to the line.
		await new Promise<void>((r) => window.setTimeout(r, 100));
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) return;
		const editor = view.editor;
		editor.setCursor({ line: item.line, ch: 0 });
		editor.scrollIntoView({ from: { line: item.line, ch: 0 }, to: { line: item.line, ch: 0 } }, true);
	}
</script>

<!-- ── Filter tabs ─────────────────────────────────────────────────────────── -->
<div class="tm-tasks-filters">
	<button
		class="tm-tasks-filter-btn"
		class:tm-tasks-filter-btn--active={filter === "all"}
		on:click={() => setFilter("all")}
	>All <span class="tm-tasks-filter-count">{totalAll}</span></button>
	<button
		class="tm-tasks-filter-btn"
		class:tm-tasks-filter-btn--active={filter === "open"}
		on:click={() => setFilter("open")}
	>Open <span class="tm-tasks-filter-count">{totalOpen}</span></button>
	<button
		class="tm-tasks-filter-btn"
		class:tm-tasks-filter-btn--active={filter === "done"}
		on:click={() => setFilter("done")}
	>Done <span class="tm-tasks-filter-count">{totalDone}</span></button>
</div>

<!-- ── Body ───────────────────────────────────────────────────────────────── -->
{#if loading}
	<span class="tm-tasks-status">Loading…</span>
{:else if error}
	<span class="tm-tasks-status tm-tasks-status--error">Failed to load tasks.</span>
{:else if visibleCount === 0}
	<span class="tm-tasks-status">
		{totalAll === 0 ? "No tasks this period." : "No " + filter + " tasks."}
	</span>
{:else}
	{#each [...tasksByFile.entries()] as [file, tasks] (file.path)}
		{@const visible = visibleTasks(tasks)}
		{#if visible.length > 0}
			<div class="tm-tasks-group">
				<div class="tm-tasks-group-header">{file.basename}</div>
				{#each visible as item (item.line)}
					<div class="tm-tasks-row" class:tm-tasks-row--done={item.isComplete}>
						<button
							class="tm-tasks-checkbox"
							aria-label={item.isComplete ? "Mark incomplete" : "Mark complete"}
							aria-checked={item.isComplete}
							role="checkbox"
							on:click|stopPropagation={() => void handleToggle(item)}
						>
							{#if item.isComplete}
								<!-- Checked -->
								<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
									<rect x="2" y="2" width="12" height="12" rx="2"/>
									<path d="M5 8l2.5 2.5L11 5.5"/>
								</svg>
							{:else}
								<!-- Unchecked -->
								<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
									<rect x="2" y="2" width="12" height="12" rx="2"/>
								</svg>
							{/if}
						</button>
						<button
							class="tm-tasks-text"
							on:click={() => void handleNavigate(item)}
							title="Jump to line in {file.basename}"
						>{item.text}</button>
					</div>
				{/each}
			</div>
		{/if}
	{/each}
{/if}

<style>
	/* Filter tabs */
	.tm-tasks-filters {
		display: flex;
		gap: 2px;
		padding: 6px 10px 4px;
		border-bottom: 1px solid var(--background-modifier-border);
		flex-shrink: 0;
	}

	.tm-tasks-filter-btn {
		all: unset;
		cursor: pointer;
		font-size: var(--font-ui-smaller);
		font-weight: 500;
		padding: 2px 8px;
		border-radius: var(--radius-s);
		color: var(--text-muted);
		display: inline-flex;
		align-items: center;
		gap: 4px;
		transition: background 80ms ease, color 80ms ease;
	}

	.tm-tasks-filter-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.tm-tasks-filter-btn--active {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.tm-tasks-filter-count {
		font-size: var(--font-ui-smallest);
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	/* Status messages */
	.tm-tasks-status {
		font-size: var(--font-ui-small);
		color: var(--text-muted);
		padding: 12px 14px;
		display: block;
	}

	.tm-tasks-status--error { color: var(--text-error, var(--color-red)); }

	/* Task groups */
	.tm-tasks-group {
		display: flex;
		flex-direction: column;
		padding: 6px 0 2px;
	}

	.tm-tasks-group-header {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-muted);
		padding: 2px 14px 4px;
	}

	/* Task row */
	.tm-tasks-row {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		padding: 3px 10px;
		border-radius: var(--radius-s);
		margin: 0 4px;
		transition: background 60ms ease;
	}

	.tm-tasks-row:hover {
		background: var(--background-modifier-hover);
	}

	.tm-tasks-row--done {
		opacity: 0.5;
	}

	/* Checkbox button */
	.tm-tasks-checkbox {
		all: unset;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-top: 1px;
		color: var(--text-muted);
		border-radius: 3px;
		padding: 1px;
		transition: color 80ms ease, background 80ms ease;
	}

	.tm-tasks-checkbox:hover {
		color: var(--interactive-accent);
		background: color-mix(in srgb, var(--interactive-accent) 10%, transparent);
	}

	.tm-tasks-row--done .tm-tasks-checkbox {
		color: var(--interactive-accent);
	}

	/* Task text button */
	.tm-tasks-text {
		all: unset;
		cursor: pointer;
		font-size: var(--font-ui-small);
		color: var(--text-normal);
		line-height: 1.4;
		flex: 1;
		min-width: 0;
		word-break: break-word;
	}

	.tm-tasks-text:hover {
		color: var(--text-accent);
		text-decoration: underline;
	}

	.tm-tasks-row--done .tm-tasks-text {
		text-decoration: line-through;
		color: var(--text-muted);
	}

	.tm-tasks-row--done .tm-tasks-text:hover {
		color: var(--text-accent);
	}
</style>
