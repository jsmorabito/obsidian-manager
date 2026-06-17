/**
 * TaskService — fetches checkbox task items for a given periodic period.
 *
 * Sources included:
 *   1. Periodic notes (any enabled granularity) whose date falls within the period.
 *   2. Any note with a `targetDate` frontmatter field pointing within the period.
 *
 * Items are returned as a Map<TFile, TaskItem[]> so callers can group by source.
 */
import type { TFile } from "obsidian";
import { moment } from "obsidian";
import type TimeManagerPlugin from "../main";
import type { Granularity } from "../periodic/types";
import { granularities } from "../periodic/types";
import { getFormat } from "../periodic/api";
import { startOfHalfYear, endOfHalfYear, parseHalfYear } from "../periodic/half-year";

export interface TaskItem {
	/** The source file. */
	file: TFile;
	/** Zero-based line number in the source file. */
	line: number;
	/** Raw task text with the checkbox prefix stripped. */
	text: string;
	/** True when the checkbox character is `x` or `X`. */
	isComplete: boolean;
}

const GRAN_UNIT: Record<Granularity, moment.unitOfTime.StartOf> = {
	day: "day", week: "isoWeek", month: "month",
	quarter: "quarter", "half-year": "month", year: "year",
};

/**
 * Returns all task items within the given period, grouped by source file.
 * Files are sorted alphabetically; tasks within a file are sorted by line number.
 */
export async function getTasksForPeriod(
	plugin: TimeManagerPlugin,
	granularity: Granularity,
	date: ReturnType<typeof moment>
): Promise<Map<TFile, TaskItem[]>> {
	const { app } = plugin;

	// ── Period boundaries ─────────────────────────────────────────────────────
	const unit   = GRAN_UNIT[granularity];
	const start  = granularity === "half-year" ? startOfHalfYear(date) : date.clone().startOf(unit);
	const end    = granularity === "half-year" ? endOfHalfYear(date)   : date.clone().endOf(unit);

	// ── Collect source files ──────────────────────────────────────────────────
	const files = new Set<TFile>();

	// 1. Periodic notes for any enabled granularity whose parsed date is in range.
	for (const g of granularities) {
		if (!plugin.settings[g].enabled) continue;
		const fmt = getFormat(plugin.getConfig(g), g);

		for (const file of app.vault.getMarkdownFiles()) {
			let parsed: ReturnType<typeof moment>;
			if (g === "half-year") {
				const ph = parseHalfYear(file.basename);
				if (!ph?.isValid()) continue;
				parsed = ph;
				// Check if any day of the half-year overlaps the target period.
				const hStart = startOfHalfYear(parsed);
				const hEnd   = endOfHalfYear(parsed);
				if (hEnd.isBefore(start) || hStart.isAfter(end)) continue;
			} else {
				parsed = moment(file.basename, fmt, /* strict */ true);
				if (!parsed.isValid()) continue;
				if (!parsed.isBetween(start, end, undefined, "[]")) continue;
			}
			files.add(file);
		}
	}

	// 2. Notes whose targetDate frontmatter points within the period.
	if (plugin.targetDateService) {
		for (const { file } of plugin.targetDateService.getFilesWithTargetInRange(start, end)) {
			files.add(file);
		}
	}

	if (files.size === 0) return new Map();

	// ── Extract tasks ─────────────────────────────────────────────────────────
	const result = new Map<TFile, TaskItem[]>();

	// Sort files alphabetically by basename for a consistent display order.
	const sortedFiles = [...files].sort((a, b) => a.basename.localeCompare(b.basename));

	for (const file of sortedFiles) {
		const cache = app.metadataCache.getFileCache(file);
		const rawItems = cache?.listItems?.filter((i) => i.task !== undefined);
		if (!rawItems?.length) continue;

		let lines: string[];
		try {
			const content = await app.vault.cachedRead(file);
			lines = content.split("\n");
		} catch {
			continue;
		}

		const tasks: TaskItem[] = rawItems
			.sort((a, b) => a.position.start.line - b.position.start.line)
			.map((item) => {
				const rawLine = lines[item.position.start.line] ?? "";
				// Strip leading whitespace + "- [x] " prefix to get the clean text.
				const text = rawLine.replace(/^\s*[-*]\s*\[.\]\s*/, "").trim();
				return {
					file,
					line: item.position.start.line,
					text,
					isComplete: item.task === "x" || item.task === "X",
				};
			})
			.filter((t) => t.text.length > 0);

		if (tasks.length > 0) result.set(file, tasks);
	}

	return result;
}

/**
 * Toggle a single task's completion state by rewriting its line in the vault.
 * Uses vault.process so the change is atomic and undo-safe.
 */
export async function toggleTask(plugin: TimeManagerPlugin, item: TaskItem): Promise<void> {
	await plugin.app.vault.process(item.file, (content) => {
		const lines = content.split("\n");
		const line  = lines[item.line];
		if (!line) return content;

		if (item.isComplete) {
			// [x] → [ ]
			lines[item.line] = line.replace(/^(\s*[-*]\s*)\[x\]/i, "$1[ ]");
		} else {
			// [ ] → [x]
			lines[item.line] = line.replace(/^(\s*[-*]\s*)\[ \]/, "$1[x]");
		}
		return lines.join("\n");
	});
}
