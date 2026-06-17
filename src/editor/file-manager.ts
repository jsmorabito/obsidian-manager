/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
// Rewritten from quorafind/Obsidian-Daily-Notes-Editor (MIT).
import { App, TFile, moment } from "obsidian";
import { createPeriodicNote } from "../periodic/api";
import { findPeriodicNotes } from "../periodic/discovery";
import { isSameHalfYear } from "../periodic/half-year";
import type { PeriodicResolver } from "../periodic/api";
import type { Granularity } from "../periodic/types";
import type { CustomRange, SelectionMode, TimeField, TimeRange } from "./types";

export interface FileManagerOptions {
	resolver: PeriodicResolver;
	app: App;
	timeRange: TimeRange;
	timeField: TimeField;
	granularity: Granularity;
	selectionMode: SelectionMode;
	folderPath?: string;
	tag?: string;
	customRange?: CustomRange;
}

export class FileManager {
	private allFiles: TFile[] = [];
	private filteredFiles: TFile[] = [];
	private hasCurrentDay = true;
	/** Populated during fetchPeriodicFiles; used for "date" / "dateReverse" sort. */
	private dateByPath: Map<string, moment.Moment> = new Map();

	public options: FileManagerOptions;

	constructor(options: FileManagerOptions) {
		this.options = { ...options };
		if (!this.options.selectionMode) this.options.selectionMode = "daily";
		this.fetchFiles();
	}

	private parseTimeField(): { isReverse: boolean; base: string } {
		const field = this.options.timeField || "mtime";
		const isReverse = field.endsWith("Reverse");
		const base = isReverse ? field.replace("Reverse", "") : field;
		return { isReverse, base };
	}

	private sortFiles(files: TFile[]): TFile[] {
		const { isReverse, base } = this.parseTimeField();
		return [...files].sort((a, b) => {
			if (base === "name") {
				const cmp = a.name.localeCompare(b.name);
				return isReverse ? -cmp : cmp;
			}
			if (base === "date") {
				// Sort by the date parsed from the filename (periodic notes).
				// Falls back to name sort for files without a date entry (folder/tag modes).
				const aDate = this.dateByPath.get(a.path);
				const bDate = this.dateByPath.get(b.path);
				if (aDate && bDate) {
					// isReverse = false → "newest first" (descending), isReverse = true → "oldest first" (ascending)
					return isReverse
						? aDate.valueOf() - bDate.valueOf()
						: bDate.valueOf() - aDate.valueOf();
				}
				// Fallback: alphabetical by name (YYYY-MM-DD names sort correctly).
				const cmp = a.name.localeCompare(b.name);
				return isReverse ? -cmp : cmp;
			}
			const aStat = a.stat as unknown as Record<string, number>;
			const bStat = b.stat as unknown as Record<string, number>;
			const aTime = aStat[base] ?? 0;
			const bTime = bStat[base] ?? 0;
			return isReverse ? aTime - bTime : bTime - aTime;
		});
	}

	private fetchFiles(): void {
		const mode = this.options.selectionMode;

		if (mode === "folder") {
			this.fetchFolderFiles();
		} else if (mode === "tag") {
			this.fetchTagFiles();
		} else {
			this.fetchPeriodicFiles();
		}
	}

	private fetchPeriodicFiles(): void {
		const g = this.options.granularity;
		const config = this.options.resolver.getConfig(g);
		const matches = findPeriodicNotes(this.options.app, config, g);
		// Build the date map before sorting so "date" / "dateReverse" sort has it.
		this.dateByPath = new Map(matches.map((m) => [m.file.path, m.date]));
		this.allFiles = this.sortFiles(matches.map((m) => m.file));
		this.checkCurrentPeriodNote();
		this.filterFilesByRange();
	}

	private fetchFolderFiles(): void {
		const folder = (this.options.folderPath ?? "").replace(/^\/+|\/+$/g, "");
		const all = this.options.app.vault.getMarkdownFiles().filter((f) => {
			if (!folder) return true;
			return f.path.startsWith(`${folder}/`) || f.path === folder;
		});
		this.allFiles = this.sortFiles(all);
		this.filteredFiles = [...this.allFiles];
		this.hasCurrentDay = true; // Not applicable for folder mode.
	}

	private fetchTagFiles(): void {
		const tag = (this.options.tag ?? "").replace(/^#/, "");
		if (!tag) {
			this.allFiles = [];
			this.filteredFiles = [];
			return;
		}
		const all = this.options.app.vault.getMarkdownFiles().filter((f) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const cache = (this.options.app as any).metadataCache?.getFileCache(f) as Record<string, unknown> | null;
			 
			const tags: string[] = ((cache?.tags as Array<{ tag: string }> ?? []).map((t) =>
				t.tag.replace(/^#/, "")
			));
			 
			const frontmatterTags: string[] = (cache?.frontmatter as Record<string, unknown>)?.tags as string[] ?? [];
			return (
				tags.some((t) => t === tag || t.startsWith(`${tag}/`)) ||
				frontmatterTags.some((t) => t === tag || t.startsWith(`${tag}/`))
			);
		});
		this.allFiles = this.sortFiles(all);
		this.filteredFiles = [...this.allFiles];
		this.hasCurrentDay = true;
	}

	private filterFilesByRange(): TFile[] {
		const range = this.options.timeRange;
		if (!range || range === "all") {
			this.filteredFiles = [...this.allFiles];
			return this.filteredFiles;
		}

		if (range === "custom" && this.options.customRange) {
			const { start, end } = this.options.customRange;
			const startM = moment(start, "YYYY-MM-DD", true);
			const endM   = moment(end,   "YYYY-MM-DD", true);
			this.filteredFiles = this.allFiles.filter((f) => {
				const d = moment(f.stat.mtime);
				return d.isBetween(startM, endM, "day", "[]");
			});
			return this.filteredFiles;
		}

		const now = moment();

		this.filteredFiles = this.allFiles.filter((file) => {
			// For periodic (daily) mode, use the parsed note date from dateByPath.
			// For folder/tag modes, fall back to the file's modification time so
			// range filtering still works across all selection modes.
			const fileDate = this.dateByPath.get(file.path) ?? moment(file.stat.mtime);
			return this.isDateInRange(fileDate, now, range);
		});
		return this.filteredFiles;
	}

	private isDateInRange(
		fileDate: moment.Moment,
		now: moment.Moment,
		range: TimeRange
	): boolean {
		switch (range) {
			case "week":
				// Use isoWeek to match the ISO week format (gggg-[W]ww) used by week notes.
				return fileDate.isSame(now, "isoWeek");
			case "month":
				return fileDate.isSame(now, "month");
			case "quarter":
				return fileDate.isSame(now, "quarter");
			case "year":
				return fileDate.isSame(now, "year");
			case "last-week":
				return fileDate.isBetween(
					moment().subtract(1, "week").startOf("isoWeek"),
					moment().subtract(1, "week").endOf("isoWeek"),
					null, "[]"
				);
			case "last-month":
				return fileDate.isBetween(
					moment().subtract(1, "month").startOf("month"),
					moment().subtract(1, "month").endOf("month"),
					null, "[]"
				);
			case "last-quarter":
				return fileDate.isBetween(
					moment().subtract(1, "quarter").startOf("quarter"),
					moment().subtract(1, "quarter").endOf("quarter"),
					null, "[]"
				);
			case "last-year":
				return fileDate.isBetween(
					moment().subtract(1, "year").startOf("year"),
					moment().subtract(1, "year").endOf("year"),
					null, "[]"
				);
			default:
				return true;
		}
	}

	public checkCurrentPeriodNote(): boolean {
		if (this.options.selectionMode !== "daily") return true;
		const now = moment();
		const g = this.options.granularity;
		const config = this.options.resolver.getConfig(g);
		const matches = findPeriodicNotes(this.options.app, config, g);
		const hasCurrent = g === "half-year"
			? matches.some((m) => isSameHalfYear(m.date, now))
			: matches.some((m) => m.date.isSame(now, g === "week" ? "isoWeek" : g));

		if (!hasCurrent) {
			this.hasCurrentDay = false;
			return false;
		}
		if (this.hasCurrentDay === false) {
			this.fetchFiles();
		}
		this.hasCurrentDay = true;
		return true;
	}

	public async createCurrentPeriodNote(): Promise<TFile | null> {
		if (this.hasCurrentDay || this.options.selectionMode !== "daily") return null;
		const g = this.options.granularity;
		try {
			const file = await createPeriodicNote(this.options.resolver, g, moment());
			this.allFiles.push(file);
			this.allFiles = this.sortFiles(this.allFiles);
			this.hasCurrentDay = true;
			this.filterFilesByRange();
			return file;
		} catch (err) {
			console.error("Obsidian Time Tools: createCurrentPeriodNote failed", err);
			return null;
		}
	}

	public fileCreate(file: TFile): void {
		if (this.options.selectionMode === "folder") {
			const folder = (this.options.folderPath ?? "").replace(/^\/+|\/+$/g, "");
			if (folder && !file.path.startsWith(`${folder}/`)) return;
		} else if (this.options.selectionMode === "daily") {
			const g = this.options.granularity;
			const config = this.options.resolver.getConfig(g);
			const matches = findPeriodicNotes(this.options.app, config, g);
			const match = matches.find((m) => m.file.path === file.path);
			if (!match) return;
			const isCurrentPeriod = g === "half-year"
				? isSameHalfYear(match.date, moment())
				: match.date.isSame(moment(), g === "week" ? "isoWeek" : g);
			if (isCurrentPeriod) this.hasCurrentDay = true;
			// Keep dateByPath in sync for chronological sort.
			this.dateByPath.set(file.path, match.date);
		}

		if (!this.allFiles.some((f) => f.path === file.path)) {
			this.allFiles.push(file);
			this.allFiles = this.sortFiles(this.allFiles);
		}
		this.filterFilesByRange();
	}

	public fileDelete(file: TFile): void {
		this.allFiles = this.allFiles.filter((f) => f.path !== file.path);
		this.filteredFiles = this.filteredFiles.filter((f) => f.path !== file.path);
		if (this.options.selectionMode === "daily") this.checkCurrentPeriodNote();
	}

	public getFilteredFiles(): TFile[] {
		return this.filteredFiles;
	}

	public hasCurrentDayNote(): boolean {
		return this.hasCurrentDay;
	}

	public updateOptions(options: Partial<FileManagerOptions>): void {
		this.options = { ...this.options, ...options };
		this.allFiles = [];
		this.filteredFiles = [];
		this.hasCurrentDay = true;
		this.fetchFiles();
	}
}
