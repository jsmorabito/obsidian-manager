export type InboxSortOrder = "newest" | "oldest" | "name";

export interface InboxDisplayOptions {
	sortOrder: InboxSortOrder;
	/** Which inbox tags to show. null = show all configured tags. */
	inboxTagFilter: string[] | null;
}

export const DEFAULT_INBOX_DISPLAY: InboxDisplayOptions = {
	sortOrder: "newest",
	inboxTagFilter: null,
};
