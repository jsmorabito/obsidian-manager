 
// Find periodic notes by scanning the vault. We deliberately avoid building a
// long-lived metadata cache for the MVP — `getMarkdownFiles()` is cheap enough
// and we recompute per query. A real cache is tracked in deferred features.
 
import type { Moment } from "moment";
import { App, TFile } from "obsidian";
import { DEFAULT_FORMAT } from "./constants";
import type { Granularity, PeriodicConfig } from "./types";
import { parseHalfYear, isSameHalfYear } from "./half-year";

function resolvedFormat(config: PeriodicConfig, granularity: Granularity): string {
	return config.format?.trim() ? config.format : DEFAULT_FORMAT[granularity];
}

function resolvedFolder(config: PeriodicConfig): string {
	// Strip both leading and trailing slashes. Obsidian vault paths are always
	// relative (e.g. "Daily/2024-01-01.md"), so a user-entered "/Daily" must
	// become "Daily" before we can match with startsWith().
	return (config.folder ?? "").replace(/^\/+|\/+$/g, "");
}

/**
 * Match a markdown file against a periodic configuration. Users sometimes write
 * a format like `YYYY/YYYY-MM-DD` (year folder + date filename) — we accept
 * either the full path-aware format or just the basename portion after the last
 * slash. Returns the parsed date if the file matches, otherwise null.
 */
export function matchPeriodicFile(
	file: TFile,
	config: PeriodicConfig,
	granularity: Granularity
): Moment | null {
	if (!config.enabled) return null;

	// Half-year uses a custom format "YYYY-H1" that moment can't parse reliably.
	if (granularity === "half-year") {
		const folder = resolvedFolder(config);
		if (folder && folder !== "/" && !file.path.startsWith(`${folder}/`)) return null;
		return parseHalfYear(file.basename);
	}

	const fullFormat = resolvedFormat(config, granularity);
	const folder = resolvedFolder(config);

	// Optional folder scoping: the file must live under the configured folder
	// (or anywhere if folder is empty / root).
	if (folder && folder !== "/" && !file.path.startsWith(`${folder}/`)) {
		// Allow the case where the format itself encodes folder structure.
		// In that case we don't filter by folder.
		if (!fullFormat.includes("/")) return null;
	}

	const candidates: string[] = [fullFormat];
	const partialFormat = /[^/]*$/.exec(fullFormat)?.[0];
	if (partialFormat && partialFormat !== fullFormat) candidates.push(partialFormat);

	// Try the full path against full format, then the basename against partial.
	const subjects: string[] = [file.path.replace(/\.md$/, ""), file.basename];

	for (const fmt of candidates) {
		for (const subject of subjects) {
			const parsed = window.moment(subject, fmt, true);
			if (parsed.isValid()) return parsed;
		}
	}
	return null;
}

export interface PeriodicMatch {
	file: TFile;
	date: Moment;
	granularity: Granularity;
}

export function findPeriodicNotes(
	app: App,
	config: PeriodicConfig,
	granularity: Granularity
): PeriodicMatch[] {
	if (!config.enabled) return [];

	const matches: PeriodicMatch[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const date = matchPeriodicFile(file, config, granularity);
		if (date) matches.push({ file, date, granularity });
	}
	// Newest first.
	matches.sort((a, b) => b.date.valueOf() - a.date.valueOf());
	return matches;
}

export function getPeriodicNoteForDate(
	app: App,
	config: PeriodicConfig,
	granularity: Granularity,
	date: Moment
): TFile | null {
	// Half-year notes use a custom comparison since moment has no half-year unit.
	// Week notes: use "isoWeek" when the format uses ISO tokens (GGGG/WW),
	// or "week" when it uses locale tokens (gggg/ww). Mixing them causes
	// off-by-one bugs — e.g. locale W29 starts on Sunday, which is the last day
	// of ISO W28, so a locale-format W29 file incorrectly matches an ISO W28 query.
	for (const { file, date: fileDate } of findPeriodicNotes(app, config, granularity)) {
		if (granularity === "half-year") {
			if (isSameHalfYear(fileDate, date)) return file;
		} else {
			let granUnit: string;
			if (granularity === "week") {
				const fmt = resolvedFormat(config, granularity);
				granUnit = fmt.includes("gggg") ? "week" : "isoWeek";
			} else {
				granUnit = granularity;
			}
			if (fileDate.isSame(date, granUnit as Parameters<Moment["isSame"]>[1])) return file;
		}
	}
	return null;
}
