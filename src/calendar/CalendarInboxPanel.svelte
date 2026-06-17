<script lang="ts">
	/**
	 * CalendarInboxPanel -- left side panel for CalendarGrid.
	 *
	 * Shows items tagged with the calendar inbox tags (configured separately
	 * from the main inbox panel under Settings -> Calendar -> Calendar inbox tags).
	 * Supports both whole-file items and inline tag items.
	 */
	import { onDestroy } from "svelte";
	import type TimeManagerPlugin from "../main";
	import type { TaggedInboxItem, InboxFileItem, InboxInlineItem } from "../editor/InboxService";
	import Icon from "../utils/Icon.svelte";
	import { setDragPayload } from "./drag-state";

	// Props

	export let plugin: TimeManagerPlugin;

	// State

	let items: TaggedInboxItem[] = [];

	// Load items

	function loadItems(): void {
		const tags = plugin.settings.time.calendarInboxTags ?? ["inbox"];
		const exclude = plugin.settings.time.calendarInboxExcludeTags ?? [];
		items = plugin.inboxService.getInboxItems(tags, exclude, false);
	}

	loadItems();

	// Re-scan on metadata changes.
	const unsubMeta = plugin.app.metadataCache.on("changed", () => loadItems());
	onDestroy(() => {
		plugin.app.metadataCache.offref(unsubMeta);
	});

	// Actions

	async function openItem(item: TaggedInboxItem): Promise<void> {
		const leaf = plugin.app.workspace.getLeaf(false);
		await leaf.openFile(item.file);
		if (item.type === "inline") {
			// Scroll to the specific line after opening
			const view = leaf.view as { editor?: { setCursor?: (pos: {line: number; ch: number}) => void; scrollIntoView?: (range: unknown, center?: boolean) => void } } | null;
			if (view?.editor?.setCursor) {
				const pos = { line: item.line, ch: 0 };
				view.editor.setCursor(pos);
				view.editor.scrollIntoView?.({ from: pos, to: pos }, true);
			}
		}
	}

	async function clearItem(e: MouseEvent, item: TaggedInboxItem): Promise<void> {
		e.stopPropagation();
		if (item.type === "file") {
			await plugin.inboxService.clearFileItem(item as InboxFileItem, plugin.settings.time.calendarInboxTags);
		} else {
			await plugin.inboxService.clearInlineItem(item as InboxInlineItem);
		}
		loadItems();
	}

	function onDragStart(_e: DragEvent, item: TaggedInboxItem): void {
		if (item.type === "inline") {
			setDragPayload({ type: "inline", filePath: item.file.path, line: item.line, tag: item.tag });
		} else {
			setDragPayload({ type: "file", filePath: item.file.path });
		}
	}

	// Helpers

	function itemLabel(item: TaggedInboxItem): string {
		return item.file.basename;
	}

	function itemSub(item: TaggedInboxItem): string {
		if (item.type === "inline") return `Line ${item.line + 1} - ${item.tag}`;
		return item.file.parent?.name ?? "";
	}
</script>

<div class="tm-cal-inbox-panel">
	<div class="tm-cal-inbox-panel-header">
		<span class="tm-cal-inbox-panel-title">Inbox</span>
		<span class="tm-cal-inbox-panel-count">{items.length}</span>
	</div>

	<div class="tm-cal-inbox-panel-list">
		{#if items.length === 0}
			<div class="tm-cal-inbox-panel-empty">
				<Icon name="inbox" size={18} />
				<span>Inbox is clear</span>
			</div>
		{:else}
			{#each items as item (item.type === "inline" ? `${item.file.path}:${item.line}` : item.file.path)}
				<!-- svelte-ignore a11y-click-events-have-key-events -->
				<div
					class="tm-cal-inbox-item"
					class:tm-cal-inbox-item--inline={item.type === "inline"}
					draggable={true}
					on:dragstart={(e) => { onDragStart(e, item); e.dataTransfer?.setData("text/plain", item.file.path); }}
					on:dragend={() => setDragPayload(null)}
					on:click={() => void openItem(item)}
					role="button"
					tabindex="0"
					title="Drag to calendar to set target date · Click to open"
				>
					<div class="tm-cal-inbox-item-icon">
						<Icon name={item.type === "file" ? "file-text" : "hash"} size={12} />
					</div>
					<div class="tm-cal-inbox-item-body">
						<div class="tm-cal-inbox-item-name">{itemLabel(item)}</div>
						{#if itemSub(item)}
							<div class="tm-cal-inbox-item-sub">{itemSub(item)}</div>
						{/if}
					</div>
					<button
						class="tm-cal-inbox-item-clear"
						on:click={(e) => void clearItem(e, item)}
						title="Clear from inbox"
						aria-label="Clear from inbox"
					>
						<Icon name="x" size={11} />
					</button>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.tm-cal-inbox-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		width: 200px;
		flex-shrink: 0;
		border-right: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		overflow: hidden;
	}

	.tm-cal-inbox-panel-header {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px 8px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.tm-cal-inbox-panel-title {
		font-size: var(--font-ui-small);
		font-weight: 600;
		color: var(--text-normal);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.tm-cal-inbox-panel-count {
		font-size: var(--font-ui-smaller);
		font-weight: 600;
		color: var(--text-on-accent);
		background: var(--interactive-accent);
		border-radius: 10px;
		padding: 1px 6px;
		min-width: 18px;
		text-align: center;
	}

	.tm-cal-inbox-panel-list {
		flex: 1;
		overflow-y: auto;
		padding: 6px 0;
	}

	.tm-cal-inbox-panel-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 32px 12px;
		color: var(--text-faint);
		font-size: var(--font-ui-smaller);
		text-align: center;
	}

	.tm-cal-inbox-item {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		padding: 6px 12px;
		cursor: pointer;
		border-left: 3px solid transparent;
		transition: background 80ms ease, border-color 80ms ease;
	}
	.tm-cal-inbox-item:hover {
		background: var(--background-modifier-hover);
		border-left-color: var(--interactive-accent);
	}
	.tm-cal-inbox-item--inline {
		opacity: 0.85;
	}

	.tm-cal-inbox-item-icon {
		flex-shrink: 0;
		margin-top: 1px;
		color: var(--text-faint);
	}

	.tm-cal-inbox-item-body {
		flex: 1;
		min-width: 0;
	}

	.tm-cal-inbox-item-name {
		font-size: var(--font-ui-small);
		font-weight: 500;
		color: var(--text-normal);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tm-cal-inbox-item-sub {
		font-size: var(--font-ui-smaller);
		color: var(--text-faint);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-top: 1px;
	}

	.tm-cal-inbox-item-clear {
		all: unset;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: var(--radius-s);
		color: var(--text-faint);
		opacity: 0;
		transition: background 80ms ease, color 80ms ease, opacity 80ms ease;
		cursor: pointer;
	}
	.tm-cal-inbox-item:hover .tm-cal-inbox-item-clear {
		opacity: 1;
	}
	.tm-cal-inbox-item-clear:hover {
		background: var(--background-modifier-error);
		color: var(--text-error);
	}
</style>
