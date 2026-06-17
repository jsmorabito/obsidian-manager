<script lang="ts">
	/**
	 * TargetDatePanel -- left side panel for CalendarGrid.
	 *
	 * Shows all files whose targetDate falls within the currently visible
	 * calendar range. Refreshes whenever anchorDate or viewType changes.
	 */
	import { onDestroy } from "svelte";
	import { Menu, moment } from "obsidian";
	import type TimeManagerPlugin from "../main";
	import type { TFile } from "obsidian";
	import type { ResolvedTargetDate } from "../target-date/types";
	import { labelTargetDate } from "../target-date/target-date-service";
	import Icon from "../utils/Icon.svelte";
	import { setDragPayload } from "./drag-state";
	import { TargetPreviewPopover } from "../target-date/TargetPreviewPopover";

	type NoteStatus = "Backlog" | "Todo" | "In Progress" | "Done" | "Cancelled";

	const STATUS_CYCLE: Array<NoteStatus | null> = [null, "Backlog", "Todo", "In Progress", "Done", "Cancelled"];

	function statusSvg(status: NoteStatus | null): string {
		switch (status) {
			case "Backlog":
				return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="#A1A1A1" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 4"/></svg>`;
			case "Todo":
				return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="#A1A1A1" stroke-width="2" stroke-linecap="round"/></svg>`;
			case "In Progress":
				return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="#BD8E37" stroke-width="2" stroke-linecap="round"/><path d="M12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6V18Z" fill="#BD8E37"/></svg>`;
			case "Done":
				return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2ZM15.707 9.29297C15.3165 8.90244 14.6835 8.90244 14.293 9.29297L11 12.5859L9.70703 11.293C9.31651 10.9024 8.68349 10.9024 8.29297 11.293C7.90244 11.6835 7.90244 12.3165 8.29297 12.707L10.293 14.707C10.6835 15.0976 11.3165 15.0976 11.707 14.707L15.707 10.707C16.0976 10.3165 16.0976 9.68349 15.707 9.29297Z" fill="#8E68F5"/></svg>`;
			case "Cancelled":
				return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2ZM15.707 8.29297C15.3165 7.90244 14.6835 7.90244 14.293 8.29297L12 10.5859L9.70703 8.29297C9.31651 7.90244 8.68349 7.90244 8.29297 8.29297C7.90244 8.68349 7.90244 9.31651 8.29297 9.70703L10.5859 12L8.29297 14.293C7.90244 14.6835 7.90244 15.3165 8.29297 15.707C8.68349 16.0976 9.31651 16.0976 9.70703 15.707L12 13.4141L14.293 15.707C14.6835 16.0976 15.3165 16.0976 15.707 15.707C16.0976 15.3165 16.0976 14.6835 15.707 14.293L13.4141 12L15.707 9.70703C16.0976 9.31651 16.0976 8.68349 15.707 8.29297Z" fill="#A1A1A1"/></svg>`;
			default:
				return "";
		}
	}

	// -- Props -----------------------------------------------------------------

	export let plugin: TimeManagerPlugin;
	export let anchorDate: string;
	export let viewType: "day" | "week" | "month" | "year";

	// -- State -----------------------------------------------------------------

	interface TargetItem {
		file: TFile;
		target: ResolvedTargetDate;
	}

	let items: TargetItem[] = [];

	// -- Derived range ---------------------------------------------------------

	$: anchor = moment(anchorDate, "YYYY-MM-DD");

	$: rangeStart = viewType === "month" ? anchor.clone().startOf("month")
	              : viewType === "week"  ? anchor.clone().startOf("isoWeek")
	              : viewType === "day"   ? anchor.clone().startOf("day")
	              :                        anchor.clone().startOf("year");

	$: rangeEnd = viewType === "month" ? anchor.clone().endOf("month")
	            : viewType === "week"  ? anchor.clone().endOf("isoWeek")
	            : viewType === "day"   ? anchor.clone().endOf("day")
	            :                        anchor.clone().endOf("year");

	// -- Fetch items -----------------------------------------------------------

	$: loadItems(rangeStart, rangeEnd);

	function loadItems(start: ReturnType<typeof moment>, end: ReturnType<typeof moment>): void {
		items = plugin.targetDateService.getFilesWithTargetInRange(start, end);
	}

	// Re-scan on metadata changes (frontmatter edits).
	const unsubMeta = plugin.app.metadataCache.on("changed", () => {
		loadItems(rangeStart, rangeEnd);
	});
	onDestroy(() => {
		plugin.app.metadataCache.offref(unsubMeta);
	});

	// -- Actions ---------------------------------------------------------------

	function previewFile(file: TFile, target: ResolvedTargetDate, anchorEl: EventTarget | null): void {
		if (anchorEl instanceof HTMLElement) {
			TargetPreviewPopover.show(plugin.app, file, target, anchorEl);
		}
	}

	// -- Helpers ---------------------------------------------------------------

	function periodLabel(item: TargetItem): string {
		return labelTargetDate(item.target.raw, item.target.granularity);
	}

	function fileName(file: TFile): string {
		return file.basename;
	}

	function isPast(item: TargetItem): boolean {
		return item.target.endMoment.isBefore(moment(), "day");
	}

	function getStatus(file: TFile): NoteStatus | null {
		const raw = plugin.app.metadataCache.getFileCache(file)?.frontmatter?.["status"];
		if (raw === "Backlog" || raw === "Todo" || raw === "In Progress" || raw === "Done" || raw === "Cancelled") {
			return raw;
		}
		return null;
	}

	async function cycleStatus(e: MouseEvent, file: TFile): Promise<void> {
		e.stopPropagation();
		e.preventDefault();
		const current = getStatus(file);
		const idx = STATUS_CYCLE.indexOf(current);
		const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
		await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			if (next === null) {
				delete fm["status"];
			} else {
				fm["status"] = next;
			}
		});
	}

	function showItemMenu(e: MouseEvent, file: TFile, target: ResolvedTargetDate): void {
		e.preventDefault();
		e.stopPropagation();
		const menu = new Menu();
		const current = getStatus(file);

		const ALL_STATUSES: NoteStatus[] = ["Backlog", "Todo", "In Progress", "Done", "Cancelled"];
		for (const status of ALL_STATUSES) {
			menu.addItem((item) =>
				item
					.setSection("status")
					.setTitle(status)
					.setChecked(current === status)
					.onClick(() => void plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm["status"] = status; }))
			);
		}
		if (current !== null) {
			menu.addItem((item) =>
				item
					.setSection("status")
					.setTitle("Clear status")
					.setIcon("x")
					.onClick(() => void plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { delete fm["status"]; }))
			);
		}

		menu.addItem((item) =>
			item
				.setSection("file")
				.setTitle("Open in new tab")
				.setIcon("arrow-up-right")
				.onClick(() => void plugin.app.workspace.getLeaf("tab").openFile(file))
		);

		menu.addItem((item) =>
			item
				.setSection("danger")
				.setTitle("Remove target date")
				.setIcon("target")
				.onClick(() => void plugin.targetDateService.clearTargetDate(file))
		);
		menu.addItem((item) =>
			item
				.setSection("danger")
				.setTitle("Delete file")
				.setIcon("trash-2")
				.onClick(() => void plugin.app.vault.trash(file, true))
		);

		menu.showAtMouseEvent(e);
	}
</script>

<div class="tm-cal-target-panel">
	<div class="tm-cal-target-panel-header">
		<span class="tm-cal-target-panel-title">Targets</span>
		<span class="tm-cal-target-panel-count">{items.length}</span>
	</div>

	<div class="tm-cal-target-panel-list">
		{#if items.length === 0}
			<div class="tm-cal-target-panel-empty">
				<Icon name="target" size={18} />
				<span>No targets this period</span>
			</div>
		{:else}
			{#each items as item (item.file.path)}
				{@const itemStatus = getStatus(item.file)}
				<!-- svelte-ignore a11y-click-events-have-key-events -->
				<div
					class="tm-cal-target-item"
					class:tm-cal-target-item--past={isPast(item)}
					draggable={true}
					on:dragstart={(e) => {
						setDragPayload({ type: "file", filePath: item.file.path });
						e.dataTransfer?.setData("text/plain", item.file.path);
					}}
					on:dragend={() => setDragPayload(null)}
					on:click={(e) => previewFile(item.file, item.target, e.currentTarget)}
					on:contextmenu={(e) => showItemMenu(e, item.file, item.target)}
					role="button"
					tabindex="0"
					title="Drag to calendar to update target date · Click to preview · Right-click for options"
				>
					<div class="tm-cal-target-item-name">
						{#if itemStatus}
							<button
								class="tm-cal-target-item-status"
								title={itemStatus}
								on:click={(e) => void cycleStatus(e, item.file)}
							>{@html statusSvg(itemStatus)}</button>
						{/if}
						{fileName(item.file)}
					</div>
					<div class="tm-cal-target-item-date">{periodLabel(item)}</div>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.tm-cal-target-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		width: 200px;
		flex-shrink: 0;
		border-right: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		overflow: hidden;
	}

	.tm-cal-target-panel-header {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px 8px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.tm-cal-target-panel-title {
		font-size: var(--font-ui-small);
		font-weight: 600;
		color: var(--text-normal);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.tm-cal-target-panel-count {
		font-size: var(--font-ui-smaller);
		font-weight: 600;
		color: var(--text-on-accent);
		background: var(--interactive-accent);
		border-radius: 10px;
		padding: 1px 6px;
		min-width: 18px;
		text-align: center;
	}

	.tm-cal-target-panel-list {
		flex: 1;
		overflow-y: auto;
		padding: 6px 0;
	}

	.tm-cal-target-panel-empty {
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

	.tm-cal-target-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 7px 12px;
		cursor: pointer;
		border-left: 3px solid transparent;
		transition: background 80ms ease, border-color 80ms ease;
	}
	.tm-cal-target-item:hover {
		background: var(--background-modifier-hover);
		border-left-color: var(--interactive-accent);
	}

	.tm-cal-target-item--past .tm-cal-target-item-name {
		color: var(--text-muted);
	}
	.tm-cal-target-item--past .tm-cal-target-item-date {
		color: var(--text-error, var(--text-faint));
	}

	.tm-cal-target-item-name {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: var(--font-ui-small);
		font-weight: 500;
		color: var(--text-normal);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tm-cal-target-item-status {
		all: unset;
		display: flex;
		align-items: center;
		flex-shrink: 0;
		cursor: pointer;
		line-height: 0;
		border-radius: 50%;
		transition: transform 80ms ease;
	}
	.tm-cal-target-item-status:hover {
		transform: scale(1.2);
	}

	.tm-cal-target-item-date {
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
