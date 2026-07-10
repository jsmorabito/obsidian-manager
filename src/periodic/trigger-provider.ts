/**
 * trigger-provider.ts
 *
 * Contributes periodic notes (today, this week, etc.) into the obsidian-objects
 * @ trigger menu when that plugin is installed alongside this one.
 *
 * This file does NOT import anything from obsidian-objects at build time —
 * the TriggerProvider interface is duck-typed here to avoid a hard dependency.
 * Integration is purely runtime, guarded by a presence check in main.ts.
 */

import { moment } from "obsidian";
import type { Editor, EditorPosition } from "obsidian";
import { getPeriodicNote, createPeriodicNote, getFormat } from "./api";
import { displayConfigs, granularities } from "./types";
import type TimeManagerPlugin from "../main";

// ── Duck-typed mirror of TriggerProvider / TriggerItem from obsidian-objects ──
// Keep these in sync if obsidian-objects' trigger-registry.ts ever changes.

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

// ── Internal payload ───────────────────────────────────────────────────────────

interface PeriodicItemData {
	granularity: (typeof granularities)[number];
	basename: string;
}

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * Returns a TriggerProvider that surfaces the current periodic note for each
 * enabled granularity (day, week, month, quarter, year).
 *
 * Items look like:
 *   "Today"        2026-05-27
 *   "This week"    2026-W22
 *   "This month"   2026-05
 *
 * Selecting an item inserts [[basename]] and ensures the note file exists.
 */
export function createPeriodicTriggerProvider(
	plugin: TimeManagerPlugin
): TriggerProvider {
	return {
		id: "obsidian-time-tools",

		getItems(query: string): TriggerItem[] {
			const now = moment();
			const items: TriggerItem[] = [];

			for (const g of granularities) {
				const config = plugin.getConfig(g);
				if (!config.enabled) continue;

				const cfg = displayConfigs[g];
				const format = getFormat(config, g);
				const basename = now.format(format);

				// "today" → "Today", "this week" → "This week", …
				const title =
					cfg.relativeUnit.charAt(0).toUpperCase() +
					cfg.relativeUnit.slice(1);
				const subtitle = basename;

				if (
					!query ||
					title.toLowerCase().includes(query) ||
					subtitle.toLowerCase().includes(query) ||
					cfg.periodicity.toLowerCase().includes(query)
				) {
					items.push({
						title,
						subtitle,
						data: { granularity: g, basename } satisfies PeriodicItemData,
					});
				}
			}

			return items;
		},

		renderItem(item: TriggerItem, el: HTMLElement): void {
			const row = el.createDiv({ cls: "tt-trigger-item" });
			row.createSpan({ text: item.title, cls: "suggestion-title" });
			if (item.subtitle) {
				row.createSpan({ text: item.subtitle, cls: "suggestion-note" });
			}
		},

		selectItem(
			item: TriggerItem,
			editor: Editor,
			start: EditorPosition,
			end: EditorPosition
		): void {
			const { granularity, basename } = item.data as PeriodicItemData;

			// Insert the wikilink immediately (synchronous)
			editor.replaceRange(`[[${basename}]]`, start, end);

			// Ensure the note file exists in the background
			const now = moment();
			const existing = getPeriodicNote(plugin, granularity, now);
			if (!existing) {
				createPeriodicNote(plugin, granularity, now).catch((err) =>
					console.error("[time-tools] Failed to create periodic note:", err)
				);
			}
		},
	};
}
