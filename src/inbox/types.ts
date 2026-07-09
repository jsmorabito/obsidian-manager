export type InboxSortOrder = "newest" | "oldest" | "name";
export type InboxTypeFilter = "all" | "file" | "inline";
export type InboxReadFilter = "all" | "unread" | "read";

export interface InboxDisplayOptions {
	sortOrder: InboxSortOrder;
	/** Which inbox tags to show. null = show all configured tags. */
	inboxTagFilter: string[] | null;
	/** Whole-file items vs inline tag occurrences. */
	typeFilter: InboxTypeFilter;
	/** Read-tracking status. */
	readFilter: InboxReadFilter;
	/** Restrict to a single folder path. null = all folders. Root folder is "". */
	folderFilter: string | null;
}

export const DEFAULT_INBOX_DISPLAY: InboxDisplayOptions = {
	sortOrder: "newest",
	inboxTagFilter: null,
	typeFilter: "all",
	readFilter: "all",
	folderFilter: null,
};
