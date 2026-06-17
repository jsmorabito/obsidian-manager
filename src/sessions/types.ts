/**
 * A single contiguous block of work within a session.
 * `end` is null while the segment is active (running or just before pause is
 * committed to disk).
 */
export interface SessionSegment {
	start: string;      // ISO 8601
	end: string | null; // null = still running
}

/**
 * Shape written to a session file's YAML frontmatter.
 */
export interface SessionFrontmatter {
	session_start: string;
	session_end: string | null;
	duration_minutes: number | null;
	/** Optional short description of what was worked on, set at session start. */
	label: string | null;
	tags: string[];
	segments: SessionSegment[];
}

/**
 * In-memory state for a running session. Lives on the SessionManager, not in
 * any file, so it can be accessed across Obsidian reloads via crash recovery.
 */
export interface ActiveSession {
	filePath: string;
	/** wall-clock ms when the session was started (or recovered) */
	startTime: number;
	/** total ms that have been paused so far (closed pauses only) */
	pausedMs: number;
	isPaused: boolean;
	/** wall-clock ms when the current pause began, null if not paused */
	pauseStartTime: number | null;
}
