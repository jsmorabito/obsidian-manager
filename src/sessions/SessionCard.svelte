<script lang="ts">
	import type TimeManagerPlugin from "../main";
	import { TFile } from "obsidian";
	import { onMount } from "svelte";
	import type { SessionFrontmatter } from "./types";

	export let file: TFile;
	export let plugin: TimeManagerPlugin;
	/** True while this is the currently-active (unstopped) session. */
	export let isActive = false;

	// ── Metadata from cache ───────────────────────────────────────────────────

	$: cache = plugin.app.metadataCache.getFileCache(file);
	$: fm = ((cache?.frontmatter ?? {}) as Partial<SessionFrontmatter>);

	$: label      = fm.label ?? null;
	$: duration   = fm.duration_minutes ?? null;
	$: tags       = Array.isArray(fm.tags) ? (fm.tags as string[]) : [];
	$: sessionStart = fm.session_start ?? null;

	$: dateLabel = sessionStart
		? window.moment(sessionStart).format("ddd MMM D, YYYY · h:mm A")
		: file.basename;

	$: durationLabel = duration != null ? formatDuration(duration) : null;

	function formatDuration(minutes: number): string {
		if (minutes < 60) return `${minutes}m`;
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}

	// ── Body preview (async read, stripped of frontmatter) ────────────────────

	let bodyPreview = "";

	onMount(async () => {
		try {
			const content = await plugin.app.vault.cachedRead(file);
			// Strip YAML frontmatter block.
			const stripped = content.replace(/^---[\s\S]*?---\n?/, "").trim();
			// Take the first two non-empty lines, join, and trim to 200 chars.
			bodyPreview = stripped
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean)
				.slice(0, 2)
				.join(" · ")
				.slice(0, 200);
		} catch {
			bodyPreview = "";
		}
	});

	// ── Interaction ───────────────────────────────────────────────────────────

	function openFile() {
		plugin.app.workspace.getLeaf(false).openFile(file);
	}
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-interactive-supports-focus -->
<div
	class="tm-session-card"
	class:tm-session-card--active={isActive}
	role="button"
	tabindex="0"
	on:click={openFile}
	on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") openFile(); }}
	title="Open session note"
>
	<div class="tm-sc-header">
		<span class="tm-sc-date">{dateLabel}</span>
		<div class="tm-sc-chips">
			{#if isActive}
				<span class="tm-sc-chip tm-sc-chip--active">Active</span>
			{:else if durationLabel}
				<span class="tm-sc-chip">{durationLabel}</span>
			{/if}
		</div>
	</div>

	{#if label}
		<div class="tm-sc-label">{label}</div>
	{/if}

	{#if tags.length > 0}
		<div class="tm-sc-tags">
			{#each tags as tag}
				<span class="tm-sc-tag">#{tag}</span>
			{/each}
		</div>
	{/if}

	{#if bodyPreview && !label}
		<!-- Only show body preview when there's no label (the label already gives context) -->
		<div class="tm-sc-preview">{bodyPreview}</div>
	{/if}
</div>

<style>
	.tm-session-card {
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		padding: var(--size-4-3) var(--size-4-4);
		cursor: pointer;
		transition: background-color 80ms ease, box-shadow 80ms ease;
		max-width: var(--file-line-width);
		margin: 0 auto;
		width: 100%;
	}

	.tm-session-card:hover {
		background-color: var(--background-modifier-hover);
	}

	.tm-session-card--active {
		border-color: var(--interactive-accent);
	}

	/* ── Header row: date + chip ── */

	.tm-sc-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--size-4-2);
	}

	.tm-sc-date {
		font-size: var(--font-ui-small);
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tm-sc-chips {
		display: flex;
		gap: var(--size-4-1);
		flex-shrink: 0;
	}

	.tm-sc-chip {
		display: inline-flex;
		align-items: center;
		padding: 1px var(--size-4-1);
		border-radius: var(--radius-s);
		font-size: var(--font-ui-smaller);
		font-weight: 500;
		background-color: var(--background-modifier-border);
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	.tm-sc-chip--active {
		background-color: var(--color-red);
		color: var(--text-on-accent);
	}

	/* ── Label (session goal) ── */

	.tm-sc-label {
		margin-top: var(--size-4-1);
		font-size: var(--font-ui-medium);
		font-weight: 500;
		color: var(--text-normal);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── Tags ── */

	.tm-sc-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--size-4-1);
		margin-top: var(--size-4-1);
	}

	.tm-sc-tag {
		font-size: var(--font-ui-smaller);
		color: var(--text-accent);
	}

	/* ── Body preview ── */

	.tm-sc-preview {
		margin-top: var(--size-4-1);
		font-size: var(--font-ui-small);
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
