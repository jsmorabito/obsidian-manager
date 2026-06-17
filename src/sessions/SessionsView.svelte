<script lang="ts">
	import type TimeManagerPlugin from "../main";
	import { TFile, normalizePath } from "obsidian";
	import { onDestroy, onMount } from "svelte";
	import SessionCard from "./SessionCard.svelte";
	import { StartSessionModal } from "./StartSessionModal";
	import { StopSessionModal } from "./StopSessionModal";
	import type { SessionManager } from "./session-manager";

	export let plugin: TimeManagerPlugin;
	export let sessionManager: SessionManager;

	// ── Reactive state ────────────────────────────────────────────────────────

	let isSessionActive = false;
	let isPaused = false;
	let timerDisplay = "00:00:00";

	let sessionFiles: TFile[] = [];

	let timerInterval: number;

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	onMount(() => {
		syncState();
		loadSessionFiles();
		timerInterval = window.setInterval(tick, 1000);

		// Keep the list up-to-date when session files are created externally.
		plugin.app.vault.on("create", handleVaultCreate);
		plugin.app.vault.on("delete", handleVaultDelete);
	});

	onDestroy(() => {
		window.clearInterval(timerInterval);
		plugin.app.vault.off("create", handleVaultCreate);
		plugin.app.vault.off("delete", handleVaultDelete);
	});

	// ── Timer ─────────────────────────────────────────────────────────────────

	function tick() {
		syncState();
		if (isSessionActive && !isPaused) {
			timerDisplay = formatMs(sessionManager.getElapsedMs());
		}
	}

	function syncState() {
		isSessionActive = sessionManager.activeSession !== null;
		isPaused = sessionManager.activeSession?.isPaused ?? false;
	}

	function formatMs(ms: number): string {
		const totalSecs = Math.floor(ms / 1000);
		const h = Math.floor(totalSecs / 3600);
		const m = Math.floor((totalSecs % 3600) / 60);
		const s = totalSecs % 60;
		return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
	}

	// ── Session actions ───────────────────────────────────────────────────────

	function handleStart() {
		new StartSessionModal(plugin.app, async (label, tags) => {
			const file = await sessionManager.startSession({ label: label || undefined, tags });
			sessionFiles = [file, ...sessionFiles];
			syncState();
			timerDisplay = "00:00:00";
		}).open();
	}

	function handlePause() {
		sessionManager.pauseSession();
		syncState();
	}

	function handleResume() {
		sessionManager.resumeSession();
		syncState();
	}

	function handleStop() {
		const currentTags = sessionManager.getActiveSessionTags();
		new StopSessionModal(plugin.app, currentTags, async (finalTags) => {
			await sessionManager.stopSession(finalTags);
			syncState();
			timerDisplay = "00:00:00";
		}).open();
	}

	// ── File list ─────────────────────────────────────────────────────────────

	function sessionsFolder(): string {
		return normalizePath(plugin.settings.time.sessionsFolder || "Sessions");
	}

	function loadSessionFiles() {
		const folder = sessionsFolder();
		sessionFiles = plugin.app.vault.getMarkdownFiles()
			.filter((f) => f.path.startsWith(folder + "/"))
			.sort((a, b) => b.stat.ctime - a.stat.ctime);
	}

	function handleVaultCreate(file: TFile | unknown) {
		if (!(file instanceof TFile)) return;
		const folder = sessionsFolder();
		if (file.path.startsWith(folder + "/") && !sessionFiles.some((f) => f.path === file.path)) {
			sessionFiles = [file, ...sessionFiles];
		}
	}

	function handleVaultDelete(file: TFile | unknown) {
		if (!(file instanceof TFile)) return;
		sessionFiles = sessionFiles.filter((f) => f.path !== file.path);
	}

	/** Re-expose so the ItemView can trigger a refresh (e.g. after settings change). */
	export function refresh() {
		loadSessionFiles();
		syncState();
	}

	$: activeFilePath = sessionManager.activeSession?.filePath ?? null;
</script>

<div class="tm-sessions-shell">
	<!-- ── Timer header ─────────────────────────────────────────────────────── -->
	<div class="tm-sessions-header">
		<div class="tm-sessions-timer-row">
			{#if isSessionActive}
				<span class="tm-sessions-dot" class:tm-sessions-dot--paused={isPaused} aria-hidden="true"></span>
			{/if}
			<span class="tm-sessions-clock" class:tm-sessions-clock--paused={isPaused}>
				{timerDisplay}
			</span>
		</div>

		<div class="tm-sessions-controls">
			{#if !isSessionActive}
				<button class="tm-sessions-btn tm-sessions-btn--start" on:click={handleStart}>
					Start session
				</button>
			{:else if isPaused}
				<button class="tm-sessions-btn" on:click={handleResume}>Resume</button>
				<button class="tm-sessions-btn tm-sessions-btn--stop" on:click={handleStop}>Stop</button>
			{:else}
				<button class="tm-sessions-btn" on:click={handlePause}>Pause</button>
				<button class="tm-sessions-btn tm-sessions-btn--stop" on:click={handleStop}>Stop</button>
			{/if}
		</div>
	</div>

	<!-- ── Session list ──────────────────────────────────────────────────────── -->
	<div class="tm-sessions-list">
		{#if sessionFiles.length === 0}
			<div class="tm-sessions-empty">
				<p>No sessions yet.</p>
				<p>Hit <strong>Start session</strong> to begin tracking your work.</p>
			</div>
		{/if}

		{#each sessionFiles as file (file.path)}
			<div class="tm-session-card-wrap">
				<SessionCard
					{file}
					{plugin}
					isActive={file.path === activeFilePath}
				/>
			</div>
		{/each}

		{#if sessionFiles.length > 0}
			<div class="tm-sessions-end">— End of sessions —</div>
		{/if}
	</div>
</div>

<style>
	/* ── Shell ─────────────────────────────────────────────────────────────── */

	.tm-sessions-shell {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	/* ── Header ────────────────────────────────────────────────────────────── */

	.tm-sessions-header {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: var(--size-4-2);
		padding: var(--size-4-3) var(--size-4-4);
		background-color: var(--background-primary);
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.tm-sessions-timer-row {
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
	}

	/* Pulsing dot shown while a session is running */
	.tm-sessions-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background-color: var(--color-red);
		animation: tm-pulse 1.4s ease-in-out infinite;
		flex-shrink: 0;
	}

	.tm-sessions-dot--paused {
		animation: none;
		opacity: 0.4;
	}

	@keyframes tm-pulse {
		0%, 100% { opacity: 1; }
		50%       { opacity: 0.3; }
	}

	.tm-sessions-clock {
		font-size: var(--font-ui-large);
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: var(--text-normal);
		letter-spacing: 0.04em;
	}

	.tm-sessions-clock--paused {
		color: var(--text-muted);
	}

	/* ── Controls ──────────────────────────────────────────────────────────── */

	.tm-sessions-controls {
		display: flex;
		gap: var(--size-4-1);
	}

	.tm-sessions-btn {
		all: unset;
		cursor: pointer;
		padding: var(--size-4-1) var(--size-4-3);
		border-radius: var(--radius-s);
		font-size: var(--font-ui-small);
		background-color: var(--background-modifier-hover);
		color: var(--text-normal);
		transition: background-color 80ms ease;
	}

	.tm-sessions-btn:hover {
		background-color: var(--background-modifier-active-hover);
	}

	.tm-sessions-btn--start {
		background-color: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.tm-sessions-btn--start:hover {
		background-color: var(--interactive-accent-hover);
	}

	.tm-sessions-btn--stop {
		color: var(--text-error);
	}

	/* ── List ──────────────────────────────────────────────────────────────── */

	.tm-sessions-list {
		flex: 1;
		overflow-y: auto;
		padding: var(--size-4-3) var(--size-4-3);
		display: flex;
		flex-direction: column;
		gap: var(--size-4-2);
	}

	.tm-session-card-wrap {
		width: 100%;
	}

	.tm-sessions-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 200px;
		gap: var(--size-4-1);
		color: var(--text-muted);
		text-align: center;
	}

	.tm-sessions-empty p {
		margin: 0;
	}

	.tm-sessions-end {
		text-align: center;
		color: var(--text-muted);
		font-size: var(--font-ui-small);
		padding: var(--size-4-4) 0 var(--size-4-8);
	}
</style>
