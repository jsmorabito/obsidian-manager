import type { Granularity } from "../periodic/types";
// eslint-disable-next-line no-restricted-imports -- Moment type is not re-exported from obsidian
import type { Moment } from "moment";

export type TimeRange =
	| "all"
	| "week"
	| "month"
	| "quarter"
	| "year"
	| "last-week"
	| "last-month"
	| "last-quarter"
	| "last-year"
	| "custom";

export type SelectionMode = "daily" | "folder" | "tag" | "horizon" | "inbox";

export type TimeField =
	| "ctime"
	| "mtime"
	| "ctimeReverse"
	| "mtimeReverse"
	| "name"
	| "nameReverse"
	| "date"
	| "dateReverse";

export interface CustomRange {
	start: string; // ISO date YYYY-MM-DD
	end: string;   // ISO date YYYY-MM-DD
}

// ── Types shared between DailyNoteEditorView and its sub-components ────────

/** A single segment in the breadcrumb hierarchy (e.g. "2026 / Q2 / W24"). */
export interface BreadcrumbSeg {
	label: string;
	gran: Granularity;
	date: Moment;
}

/** A child period shown in the period-nav dropdown (e.g. each day in a week). */
export interface SubPeriod {
	label: string;
	subLabel: string;
	gran: Granularity;
	date: Moment;
}

/**
 * Minimal interface for calling back on the parent DailyNoteView leaf.
 * Using an interface avoids a circular import between DailyNoteEditorView.svelte
 * and view.ts (which imports the Svelte component).
 */
export interface IEditorLeafView {
	setGranularity?(g: Granularity): void;
	setSelectionMode?(mode: SelectionMode, pathOrTag?: string): void;
	setTimeField?(field: string): void;
	setScrollDirection?(dir: "vertical" | "horizontal"): void;
	setSelectedRange?(range: TimeRange): void;
	openCustomRangeModal?(): void;
}
