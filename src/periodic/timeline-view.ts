 
/* eslint-disable obsidianmd/ui/sentence-case */
/**
 * Timeline sidebar view.
 *
 * Shows a prev/current/next navigation row for every enabled granularity,
 * making it a true temporal context panel. All rows are anchored to a single
 * reference date:
 *  - the active file's date, if it is a periodic note
 *  - today, otherwise
 *
 * The row whose granularity matches the active file is visually highlighted.
 */
import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
// eslint-disable-next-line no-restricted-imports
import type moment from "moment";
import type TimeManagerPlugin from "../main";
import { findInPeriodic, getPeriodicNote, openPeriodicNote } from "./api";
import { displayConfigs, granularities } from "./types";
import { HUMANIZE_FORMAT } from "./constants";
import { addHalfYears, formatHalfYear } from "./half-year";
import type { CalendarEvent } from "../calendar/types";

export const TIME_MANAGER_TIMELINE_VIEW = "obsidian-time-tools-timeline-view";

export class TimelineView extends ItemView {
	plugin: TimeManagerPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: TimeManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return TIME_MANAGER_TIMELINE_VIEW;
	}

	getDisplayText(): string {
		return "Timeline";
	}

	getIcon(): string {
		return "timeline";
	}

	async onOpen(): Promise<void> {
		this.render();

		const handler = () => this.render();
		this.registerEvent(this.app.workspace.on("active-leaf-change", handler));
		this.registerEvent(this.app.vault.on("create", handler));
		this.registerEvent(this.app.vault.on("rename", handler));
		this.registerEvent(this.app.vault.on("delete", handler));
	}

	async onClose(): Promise<void> {
		// Event listeners are deregistered automatically by registerEvent.
	}

	public refresh(): void {
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		const activeFile = this.app.workspace.getActiveFile();

		// Which periodic granularity does the active file belong to (if any)?
		const activeMeta = activeFile ? findInPeriodic(this.plugin, activeFile.path) : null;

		// Anchor all rows to the active note's date, or today for non-periodic files.
		const referenceDate = activeMeta ? activeMeta.date.clone() : window.moment();

		let anyEnabled = false;

		for (const granularity of granularities) {
			const config = this.plugin.getConfig(granularity);
			if (!config.enabled) continue;

			anyEnabled = true;

			const isActiveGranularity = activeMeta?.granularity === granularity;
			const cfg = displayConfigs[granularity];
			const fmt = HUMANIZE_FORMAT[granularity];

			// Use the reference date for this row's "current" period. Because
			// moment arithmetic is unit-aware, formatting any date with a
			// granularity's format string yields the correct period label.
			const date = referenceDate.clone();

			const section = contentEl.createDiv({ cls: "tm-timeline-section" });
			section.createEl("h4", {
				text: cfg.periodicity.charAt(0).toUpperCase() + cfg.periodicity.slice(1),
				cls: isActiveGranularity
					? "tm-timeline-heading tm-timeline-heading--active"
					: "tm-timeline-heading",
			});

			const nav = section.createDiv({ cls: "tm-timeline-nav" });

			const prevDate = granularity === "half-year" ? addHalfYears(date, -1) : date.clone().subtract(1, granularity as moment.unitOfTime.DurationConstructor);
			const prevFile = getPeriodicNote(this.plugin, granularity, prevDate);
			const prevLabel = granularity === "half-year" ? formatHalfYear(prevDate) : prevDate.format(fmt);
			this.renderNavLink(nav, prevFile, prevLabel, "arrow-left", () => {
				openPeriodicNote(this.plugin, granularity, prevDate).catch(console.error);
			});

			const currentLabel = granularity === "half-year" ? formatHalfYear(date) : date.format(fmt);
			const currentEl = nav.createEl("button", {
				text: currentLabel,
				cls: isActiveGranularity
					? "tm-timeline-current tm-timeline-link tm-timeline-current--active"
					: "tm-timeline-current tm-timeline-link",
				attr: { "aria-label": `Open ${date.format(fmt)}` },
			});
			currentEl.setAttribute("aria-label", `Open ${currentLabel}`);
			currentEl.addEventListener("click", () => {
				openPeriodicNote(this.plugin, granularity, date).catch(console.error);
			});

			const nextDate = granularity === "half-year" ? addHalfYears(date, 1) : date.clone().add(1, granularity as moment.unitOfTime.DurationConstructor);
			const nextFile = getPeriodicNote(this.plugin, granularity, nextDate);
			const nextLabel = granularity === "half-year" ? formatHalfYear(nextDate) : nextDate.format(fmt);
			this.renderNavLink(nav, nextFile, nextLabel, "arrow-right", () => {
				openPeriodicNote(this.plugin, granularity, nextDate).catch(console.error);
			});
		}

		if (!anyEnabled) {
			 
			contentEl.createEl("p", {
				text: "No periodic note types are enabled. Enable at least one in Settings.",
				cls: "tm-timeline-empty",
			});
		}

		// ── Calendar events ────────────────────────────────────────────────────
		const sources = this.plugin.settings.time.time.calendarSources.filter((s) => s.enabled);
		if (sources.length > 0) {
			this.renderEventsSection(contentEl, referenceDate);
		}
	}

	private renderEventsSection(
		container: HTMLElement,
		date: ReturnType<typeof window.moment>
	): void {
		const section = container.createDiv({ cls: "tm-timeline-section tm-timeline-events" });

		const heading = section.createEl("h4", {
			cls: "tm-timeline-heading",
		});
		const isToday = date.isSame(window.moment(), "day");
		heading.setText(isToday ? "Events — Today" : `Events — ${date.format("MMM D")}`);

		const listEl = section.createDiv({ cls: "tm-events-list" });
		listEl.createEl("span", { text: "Loading…", cls: "tm-events-loading" });

		this.plugin.calendarService
			.getEventsForDate(date)
			.then((events) => {
				listEl.empty();
				if (events.length === 0) {
					listEl.createEl("span", {
						text: "No events",
						cls: "tm-events-empty",
					});
					return;
				}
				for (const evt of events) {
					this.renderEventRow(listEl, evt);
				}
			})
			.catch((err) => {
				listEl.empty();
				listEl.createEl("span", {
					text: "Failed to load events",
					cls: "tm-events-error",
				});
				console.error("[time-tools] calendar events error:", err);
			});
	}

	private renderEventRow(container: HTMLElement, evt: CalendarEvent): void {
		const row = container.createDiv({ cls: "tm-event-row" });

		// Colour dot
		const dot = row.createEl("span", { cls: "tm-event-dot" });
		if (evt.sourceColor) {
			dot.style.backgroundColor = evt.sourceColor;
		}

		const body = row.createDiv({ cls: "tm-event-body" });
		body.createEl("span", { text: evt.summary, cls: "tm-event-summary" });

		const timeText = evt.allDay
			? "All day"
			: evt.end
			? `${evt.start.format("HH:mm")}–${evt.end.format("HH:mm")}`
			: evt.start.format("HH:mm");

		body.createEl("span", { text: timeText, cls: "tm-event-time" });
	}

	private renderNavLink(
		container: HTMLElement,
		file: TFile | null,
		label: string,
		iconId: string,
		onClick: () => void
	): void {
		const el = container.createEl("button", {
			cls: file ? "tm-timeline-link" : "tm-timeline-link tm-timeline-link--missing",
			title: label,
			attr: { "aria-label": label },
		});
		setIcon(el, iconId);
		el.addEventListener("click", onClick);
	}
}
