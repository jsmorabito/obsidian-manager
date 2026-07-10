import { normalizePath, TFile, TFolder } from "obsidian";
import type TimeManagerPlugin from "../main";
import type { ActiveSession, SessionFrontmatter } from "./types";

export class SessionManager {
	private plugin: TimeManagerPlugin;
	activeSession: ActiveSession | null = null;

	constructor(plugin: TimeManagerPlugin) {
		this.plugin = plugin;
	}

	/**
	 * Called from plugin onload (after layout-ready). Scans the sessions folder
	 * for any file that has session_end == null — indicating a session that was
	 * left open by a crash or abrupt close.
	 */
	async initialize(): Promise<void> {
		await this.recoverOpenSession();
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Start a new session. If one is already running it is stopped first.
	 * Returns the newly created TFile.
	 */
	async startSession(options: { label?: string; tags?: string[] } = {}): Promise<TFile> {
		if (this.activeSession) await this.stopSession();

		const folder = this.sessionsFolder();
		await this.ensureFolder(folder);

		const now = window.moment();
		const filename = now.format("YYYY-MM-DD HH-mm-ss") + ".md";
		const path = normalizePath(`${folder}/${filename}`);

		const startIso = now.toISOString();
		const content = buildInitialContent(startIso, options.label, options.tags);

		const file = await this.plugin.app.vault.create(path, content);

		this.activeSession = {
			filePath: file.path,
			startTime: Date.now(),
			pausedMs: 0,
			isPaused: false,
			pauseStartTime: null,
		};

		return file;
	}

	/**
	 * Pause the running session. Writes the current segment's end time to the
	 * file so crash recovery knows when the pause began.
	 */
	pauseSession(): void {
		if (!this.activeSession || this.activeSession.isPaused) return;
		this.activeSession.isPaused = true;
		this.activeSession.pauseStartTime = Date.now();
		// Close the current segment in the file — fire and forget.
		void this.writeLastSegmentEnd(new Date().toISOString());
	}

	/**
	 * Resume a paused session. Accumulates the paused duration and opens a new
	 * segment in the file.
	 */
	resumeSession(): void {
		if (!this.activeSession || !this.activeSession.isPaused) return;
		if (this.activeSession.pauseStartTime !== null) {
			this.activeSession.pausedMs += Date.now() - this.activeSession.pauseStartTime;
		}
		this.activeSession.isPaused = false;
		this.activeSession.pauseStartTime = null;
		// Open a fresh segment in the file — fire and forget.
		void this.appendSegment(new Date().toISOString());
	}

	/**
	 * Stop the current session, write final frontmatter, and clear state.
	 * If `finalTags` is provided, it overwrites the tags array in frontmatter.
	 */
	async stopSession(finalTags?: string[]): Promise<void> {
		if (!this.activeSession) return;

		const session = this.activeSession;
		const endMs = Date.now();

		let totalPausedMs = session.pausedMs;
		if (session.isPaused && session.pauseStartTime !== null) {
			totalPausedMs += endMs - session.pauseStartTime;
		}

		const elapsedMs = endMs - session.startTime - totalPausedMs;
		const durationMinutes = Math.round(Math.max(0, elapsedMs) / 60_000);
		const endIso = new Date().toISOString();

		const file = this.getFile(session.filePath);
		if (file) {
			await this.plugin.app.fileManager.processFrontMatter(file, (fm: SessionFrontmatter) => {
				fm.session_end = endIso;
				fm.duration_minutes = durationMinutes;
				if (finalTags !== undefined) fm.tags = finalTags;
				// Close any still-open segment.
				if (Array.isArray(fm.segments) && fm.segments.length > 0) {
					const last = fm.segments[fm.segments.length - 1];
					if (last.end == null) last.end = endIso;
				}
			});
		}

		this.activeSession = null;
	}

	/**
	 * Returns the tags stored in the active session's frontmatter, or [] if
	 * there is no active session or the cache isn't ready yet.
	 */
	getActiveSessionTags(): string[] {
		if (!this.activeSession) return [];
		const file = this.getFile(this.activeSession.filePath);
		if (!file) return [];
		const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		return Array.isArray(fm?.tags) ? (fm.tags as string[]) : [];
	}

	/**
	 * Returns the total elapsed (non-paused) milliseconds for the active
	 * session. Returns 0 if no session is active.
	 */
	getElapsedMs(): number {
		if (!this.activeSession) return 0;
		const session = this.activeSession;
		let elapsed = Date.now() - session.startTime - session.pausedMs;
		// Subtract the current pause if paused right now.
		if (session.isPaused && session.pauseStartTime !== null) {
			elapsed -= Date.now() - session.pauseStartTime;
		}
		return Math.max(0, elapsed);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private sessionsFolder(): string {
		return normalizePath(this.plugin.settings.time.sessionsFolder || "Sessions");
	}

	private getFile(path: string): TFile | null {
		const f = this.plugin.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		const existing = this.plugin.app.vault.getAbstractFileByPath(folderPath);
		if (!(existing instanceof TFolder)) {
			await this.plugin.app.vault.createFolder(folderPath);
		}
	}

	private async writeLastSegmentEnd(endIso: string): Promise<void> {
		if (!this.activeSession) return;
		const file = this.getFile(this.activeSession.filePath);
		if (!file) return;
		await this.plugin.app.fileManager.processFrontMatter(file, (fm: SessionFrontmatter) => {
			if (Array.isArray(fm.segments) && fm.segments.length > 0) {
				const last = fm.segments[fm.segments.length - 1];
				if (last.end == null) last.end = endIso;
			}
		});
	}

	private async appendSegment(startIso: string): Promise<void> {
		if (!this.activeSession) return;
		const file = this.getFile(this.activeSession.filePath);
		if (!file) return;
		await this.plugin.app.fileManager.processFrontMatter(file, (fm: SessionFrontmatter) => {
			if (!Array.isArray(fm.segments)) fm.segments = [];
			fm.segments.push({ start: startIso, end: null });
		});
	}

	/**
	 * On startup, look for a session file in the sessions folder that has no
	 * session_end — this means Obsidian was closed while a session was running.
	 * We restore enough state to continue showing the timer from the original
	 * start time (paused duration cannot be recovered across restarts, so we
	 * treat the whole gap as elapsed time).
	 */
	private async recoverOpenSession(): Promise<void> {
		const folder = this.sessionsFolder();
		const files = this.plugin.app.vault.getMarkdownFiles().filter((f) =>
			f.path.startsWith(folder + "/")
		);

		for (const file of files) {
			const cache = this.plugin.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter;
			if (!fm) continue;
			// session_end == null means the session was never closed.
			if (fm.session_end != null) continue;

			const startMs = fm.session_start
				? new Date(fm.session_start as string).getTime()
				: Date.now();

			this.activeSession = {
				filePath: file.path,
				startTime: isNaN(startMs) ? Date.now() : startMs,
				pausedMs: 0,
				isPaused: false,
				pauseStartTime: null,
			};
			break; // Only one open session at a time.
		}
	}
}

// ── File content builder ──────────────────────────────────────────────────────

function buildInitialContent(startIso: string, label?: string, tags: string[] = []): string {
	const tagLine =
		tags.length > 0
			? `tags: [${tags.map((t) => `"${t}"`).join(", ")}]`
			: "tags: []";

	const lines = [
		"---",
		`session_start: "${startIso}"`,
		`session_end: null`,
		`duration_minutes: null`,
		label ? `label: "${label.replace(/"/g, '\\"')}"` : "label: null",
		tagLine,
		"segments:",
		`  - start: "${startIso}"`,
		`    end: null`,
		"---",
		"",
	];

	// Use the label as a top-level heading so the note is immediately meaningful.
	if (label) lines.push(`# ${label}`, "");

	return lines.join("\n");
}
