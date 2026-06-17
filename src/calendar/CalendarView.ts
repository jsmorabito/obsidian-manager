/**
 * CalendarView — main editor tab showing a month/week calendar grid.
 *
 * Displays daily note existence dots, ICS calendar event dots, and week
 * number links to weekly notes. Clicking a day opens or creates that
 * day's note directly.
 *
 * View type and anchor date are persisted via getState/setState so the
 * calendar remembers where you were when Obsidian restarts.
 */
import { ItemView, WorkspaceLeaf, moment } from "obsidian";
import type { ViewStateResult } from "obsidian";
import type TimeManagerPlugin from "../main";
import CalendarGrid from "./CalendarGrid.svelte";

export const TIME_MANAGER_CALENDAR_VIEW = "obsidian-time-tools-calendar-view";

/** Svelte instance API — exported functions aren't reflected in generated .d.ts */
interface CalendarGridInstance {
	getViewType(): "day" | "week" | "month" | "year" | "horizon";
	getAnchorDate(): string;
	refresh(): void;
	$set(props: Record<string, unknown>): void;
	$destroy(): void;
}

export class CalendarView extends ItemView {
	plugin: TimeManagerPlugin;
	grid: CalendarGridInstance | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TimeManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return TIME_MANAGER_CALENDAR_VIEW; }
	getDisplayText(): string { return "Calendar"; }
	getIcon(): string { return "calendar"; }

	private _onTitleChange = (t: string): void => {
		// Update the pane header title element directly.
		// getDisplayText() stays "Calendar" so the tab is unaffected.
		const titleEl = this.containerEl.querySelector<HTMLElement>(".view-header-title");
		if (titleEl) titleEl.textContent = t;
	};

	private _makeGrid(target: HTMLElement, viewType: "day" | "week" | "month" | "year" | "horizon", anchorDate: string): CalendarGridInstance {
		return new CalendarGrid({
			target,
			props: { plugin: this.plugin, viewType, anchorDate, onTitleChange: this._onTitleChange },
		}) as unknown as CalendarGridInstance;
	}

	async onOpen(): Promise<void> {
		// Guard: setState may have already created the grid (Obsidian sometimes
		// calls setState before onOpen when restoring a saved workspace). Creating
		// a second grid here would orphan the first one in the DOM and discard the
		// restored viewType/anchorDate, leaving the calendar blank until the user
		// switches views.
		if (this.grid) return;
		this.grid = this._makeGrid(this.contentEl, "month", moment().format("YYYY-MM-DD"));
	}

	async onClose(): Promise<void> {
		this.grid?.$destroy();
		this.grid = null;
	}

	/** Re-fetch events for the currently displayed range. */
	refreshGrid(): void {
		this.grid?.refresh();
	}

	getState(): Record<string, unknown> {
		return {
			...super.getState(),
			viewType:   this.grid?.getViewType()  ?? "month",
			anchorDate: this.grid?.getAnchorDate() ?? moment().format("YYYY-MM-DD"),
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		const s = state as Record<string, unknown>;
		const vt = (s?.viewType  as "month" | "week" | "day" | "year" | "horizon") ?? "month";
		const ad = (s?.anchorDate as string) ?? moment().format("YYYY-MM-DD");
		if (this.grid) {
			// $set may be a no-op if the values haven't changed (e.g. onOpen already
			// passed today's date and setState restores the same date). Always call
			// refresh() afterwards so a fetch fires regardless.
			this.grid.$set({ viewType: vt, anchorDate: ad });
			this.grid.refresh();
		} else {
			// setState called before onOpen — create the grid now.
			this.grid = this._makeGrid(this.contentEl, vt, ad);
		}
	}
}
