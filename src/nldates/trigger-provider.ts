/**
 * trigger-provider.ts
 *
 * Wraps DateSuggest's NL date logic as a TriggerProvider so it can contribute
 * suggestions to the obsidian-objects @ trigger menu alongside object types
 * and periodic notes, rather than competing with them as a separate EditorSuggest.
 */

import type { Editor, EditorPosition } from "obsidian";
import type DateSuggest from "./suggest";

// Duck-typed mirror of TriggerProvider/TriggerItem from obsidian-objects.
interface TriggerItem {
	title: string;
	subtitle?: string;
	data?: unknown;
}

interface TriggerProvider {
	id: string;
	getItems(query: string): TriggerItem[];
	renderItem?(item: TriggerItem, el: HTMLElement): void;
	selectItem(
		item: TriggerItem,
		editor: Editor,
		start: EditorPosition,
		end: EditorPosition
	): void;
}

interface DateItemData {
	label: string;
}

export function createDateTriggerProvider(dateSuggest: DateSuggest): TriggerProvider {
	return {
		id: "obsidian-time-tools-dates",

		getItems(query: string): TriggerItem[] {
			const completions = dateSuggest.buildSuggestions(query);
			// Fall back to the raw query as a suggestion (same as standalone behaviour)
			const results = completions.length > 0
				? completions
				: query.trim() ? [{ label: query }] : [];
			return results.map((c) => ({
				title: c.label,
				data: { label: c.label } satisfies DateItemData,
			}));
		},

		renderItem(item: TriggerItem, el: HTMLElement): void {
			el.createEl("span", { text: item.title, cls: "suggestion-title" });
		},

		selectItem(
			item: TriggerItem,
			editor: Editor,
			start: EditorPosition,
			end: EditorPosition
		): void {
			const { label } = item.data as DateItemData;
			dateSuggest.applySelection(label, false, editor, start, end);
		},
	};
}
