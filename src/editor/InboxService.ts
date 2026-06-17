import type { App, TFile } from "obsidian";
import { moment } from "obsidian";

/**
 * A whole-file inbox item — the file carries #inbox in its frontmatter tags.
 * Rendered as a full embedded note.
 */
export interface InboxFileItem {
	type: "file";
	file: TFile;
	/** Unix ms when the file was added to the inbox (from `inbox-added` frontmatter; falls back to mtime). */
	addedAt: number;
}

/**
 * An inline inbox item — #inbox appears on a specific line in the file body.
 * Rendered as a lightweight line card.
 */
export interface InboxInlineItem {
	type: "inline";
	file: TFile;
	/** 0-based line number within the file. */
	line: number;
	/** Character offset of the tag within the file (for precise replacement). */
	offset: number;
	/** The full tag string as indexed (e.g. "#inbox" or "#inbox/later"). */
	tag: string;
	/** Unix ms — mtime of the file (best available proxy for when the inline tag was added). */
	addedAt: number;
}

export type TaggedInboxItem = InboxFileItem | InboxInlineItem;

function normTag(t: string): string {
	return t.replace(/^#/, "").toLowerCase();
}

function makeTagMatcher(watchedTags: string[]): (t: string) => boolean {
	const normalized = watchedTags.map((t) => normTag(t));
	return (t: string) => {
		const n = normTag(t);
		return normalized.some((wt) => n === wt || n.startsWith(`${wt}/`));
	};
}

export class InboxService {
	constructor(private app: App) {}

	/**
	 * Synchronously scans the metadata cache and returns all inbox items for
	 * the given set of watched tags (without #, e.g. ["inbox", "review"]).
	 * Falls back to ["inbox"] if the list is empty.
	 *
	 * excludeTags: if a file or line also carries any of these tags, it is
	 * suppressed even if it matches a watched tag. Useful for e.g. "resolved".
	 *
	 * Files tagged in frontmatter are returned as "file" items.
	 * Lines with inline tags are returned as "inline" items.
	 * A file that matches as a whole-file item will NOT also produce inline items.
	 */
	getInboxItems(watchedTags: string[] = ["inbox"], excludeTags: string[] = [], autoRemoveDone = false): TaggedInboxItem[] {
		const tags = watchedTags.length > 0 ? watchedTags : ["inbox"];
		const isWatchedTag = makeTagMatcher(tags);
		const isExcluded = excludeTags.length > 0 ? makeTagMatcher(excludeTags) : () => false;
		const now = new Date().toISOString();
		const items: TaggedInboxItem[] = [];

		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;

			// Cast to Record<string, unknown> so downstream accesses are safe.
			const cacheFm = cache.frontmatter as Record<string, unknown> | undefined;

			// Skip snoozed items (inbox-snooze frontmatter field set to a future ISO timestamp).
			const snoozeUntil = cacheFm?.["inbox-snooze"];
			if (typeof snoozeUntil === "string" && snoozeUntil > now) continue;

			// --- frontmatter tags → whole-file item ---
			const rawFm = cacheFm?.["tags"];
			const fmTags: string[] = Array.isArray(rawFm)
				? (rawFm as unknown[]).map(String)
				: typeof rawFm === "string"
				? [rawFm]
				: [];

			if (fmTags.some(isWatchedTag)) {
				// Suppress if the file frontmatter also has an exclusion tag
				if (fmTags.some(isExcluded)) continue;
				const addedRaw = cacheFm?.["inbox-added"];
				const addedAt = typeof addedRaw === "string" ? Date.parse(addedRaw) || file.stat.mtime : file.stat.mtime;
				items.push({ type: "file", file, addedAt });
				continue; // skip inline scan for this file
			}

			// --- inline tags → per-occurrence line cards ---
			// Build a set of lines that carry an exclusion tag so we can suppress
			// individual lines without affecting the rest of the file.
			const inlineTags = cache.tags ?? [];
			const excludedLines = new Set<number>();
			if (excludeTags.length > 0) {
				for (const tc of inlineTags) {
					if (isExcluded(tc.tag)) excludedLines.add(tc.position.start.line);
				}
			}

			// Build a set of lines that are completed checkboxes (- [x]).
			const doneLines = new Set<number>();
			if (autoRemoveDone) {
				for (const li of cache.listItems ?? []) {
					if (li.task === "x" || li.task === "X") doneLines.add(li.position.start.line);
				}
			}

			for (const tagCache of inlineTags) {
				if (isWatchedTag(tagCache.tag) && !excludedLines.has(tagCache.position.start.line) && !doneLines.has(tagCache.position.start.line)) {
					items.push({
						type: "inline",
						file,
						line: tagCache.position.start.line,
						offset: tagCache.position.start.offset,
						tag: tagCache.tag,
						addedAt: file.stat.mtime,
					});
				}
			}
		}

		// Sort: file items first (by filename), then inline items (by file then line).
		items.sort((a, b) => {
			if (a.type !== b.type) return a.type === "file" ? -1 : 1;
			const nameCmp = a.file.name.localeCompare(b.file.name);
			if (nameCmp !== 0) return nameCmp;
			if (a.type === "inline" && b.type === "inline") return a.line - b.line;
			return 0;
		});

		return items;
	}

	/**
	 * Remove a specific inline #inbox tag from the given file at the given line.
	 * Only removes the tag matched by `tag`; leaves the rest of the line intact.
	 */
	async clearInlineItem(item: InboxInlineItem): Promise<void> {
		const content = await this.app.vault.read(item.file);
		const lines = content.split("\n");
		if (item.line >= lines.length) return;

		// Remove the specific tag occurrence (case-insensitive, whole-tag boundary).
		// Use a regex that matches the exact tag string followed by a word boundary.
		const escaped = item.tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const re = new RegExp(escaped + "(?![\\w/-])", "i");
		lines[item.line] = lines[item.line].replace(re, "").replace(/\s{2,}/g, " ").trim();

		await this.app.vault.modify(item.file, lines.join("\n"));
	}

	/**
	 * Add the primary inbox tag ("inbox") to the file's frontmatter tags array.
	 * Creates the tags array if absent. No-ops if the tag is already present.
	 */
	async addInboxTag(file: TFile, watchedTags: string[] = ["inbox"]): Promise<void> {
		const primaryTag = (watchedTags[0] ?? "inbox").replace(/^#/, "");
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			const raw: unknown = fm["tags"];
			if (Array.isArray(raw)) {
				const existing = (raw as string[]).map((t) => normTag(t));
				if (!existing.includes(normTag(primaryTag))) {
					(raw as string[]).push(primaryTag);
					fm["inbox-added"] = new Date().toISOString();
				}
			} else if (typeof raw === "string") {
				if (normTag(raw) !== normTag(primaryTag)) {
					fm["tags"] = [raw, primaryTag];
					fm["inbox-added"] = new Date().toISOString();
				}
			} else {
				fm["tags"] = [primaryTag];
				fm["inbox-added"] = new Date().toISOString();
			}
		});
	}

	/**
	 * Snooze an inbox item by writing `inbox-snooze: <ISO>` to the file's frontmatter.
	 * The item will be hidden from getInboxItems() until the timestamp passes.
	 */
	async snoozeItem(file: TFile, remindAt: string): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm["inbox-snooze"] = remindAt;
		});
	}

	/**
	 * Clear the inbox-snooze field from frontmatter (un-snooze).
	 */
	async clearSnooze(file: TFile): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			delete fm["inbox-snooze"];
		});
	}

	/**
	 * Remove all watched inbox tags from the frontmatter of the given file.
	 * Also clears any inbox-snooze field. Uses processFrontMatter so other plugins see the change.
	 */
	async clearFileItem(item: InboxFileItem, watchedTags: string[] = ["inbox"]): Promise<void> {
		const isWatched = makeTagMatcher(watchedTags);
		await this.app.fileManager.processFrontMatter(item.file, (fm: Record<string, unknown>) => {
			const tags: unknown = fm["tags"];
			if (Array.isArray(tags)) {
				fm["tags"] = (tags as string[]).filter((t) => !isWatched(String(t)));
			} else if (typeof tags === "string" && isWatched(tags)) {
				delete fm["tags"];
			}
			delete fm["inbox-snooze"];
		});
	}

	/** Exposed so main.ts can schedule a periodic refresh when snoozes expire. */
	hasSnoozedItems(): boolean {
		const now = new Date().toISOString();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
			const snooze = fm?.["inbox-snooze"];
			if (typeof snooze === "string" && snooze > now) return true;
		}
		return false;
	}
}

// Suppress unused-import warning — moment is used for type inference in consumers.
void (moment as unknown);

