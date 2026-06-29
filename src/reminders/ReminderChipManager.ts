/**
 * ReminderChipManager
 *
 * Injects a reminder chip into the view-header of active MarkdownView leaves.
 * Handles timing issues by deferring DOM injection to the next animation frame.
 */
import { Menu, MarkdownView, WorkspaceLeaf, moment, setIcon } from "obsidian";
import type { App, TFile } from "obsidian";
import type { ReminderService } from "./ReminderService";
import { ReminderModal } from "./ReminderModal";

const CHIP_CLASS = "tm-reminder-chip";

export class ReminderChipManager {
	private chipEl: HTMLElement | null = null;
	private chipFile: TFile | null = null;
	private chipLeaf: WorkspaceLeaf | null = null;
	private rafId: number | null = null;

	constructor(
		private readonly app: App,
		private readonly reminderService: ReminderService,
	) {}

	/** Call whenever the active file or leaf may have changed. */
	update(file: TFile | null, leaf: WorkspaceLeaf | null): void {
		// Cancel any pending deferred injection.
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}

		// Remove chip if the leaf or file changed.
		if (this.chipEl && (leaf !== this.chipLeaf || file !== this.chipFile)) {
			this.removeChip();
		}

		if (!file || !leaf || !(leaf.view instanceof MarkdownView)) {
			this.removeChip();
			return;
		}

		const reminder = this.reminderService.getReminder(file);

		if (!reminder) {
			this.removeChip();
			return;
		}

		// Defer to next frame so the view-header DOM is ready.
		this.rafId = requestAnimationFrame(() => {
			this.rafId = null;
			// Re-read reminder in case it changed.
			const r = this.reminderService.getReminder(file);
			if (!r) { this.removeChip(); return; }

			if (!this.chipEl) {
				this.chipEl = this.injectChip(leaf);
				if (!this.chipEl) return; // DOM not ready yet — will retry on next update
				this.chipFile = file;
				this.chipLeaf = leaf;
			}

			this.updateChipContent(this.chipEl, r.date, r.time);
			this.chipEl.onclick = (e) => this.openMenu(e, file, r.date, r.time);
		});
	}

	removeChip(): void {
		this.chipEl?.remove();
		this.chipEl = null;
		this.chipFile = null;
		this.chipLeaf = null;
	}

	// ── Private ──────────────────────────────────────────────────────────────────

	private injectChip(leaf: WorkspaceLeaf): HTMLElement | null {
		const containerEl = (leaf as unknown as { containerEl: HTMLElement }).containerEl;
		const viewActions = containerEl?.querySelector<HTMLElement>(".view-actions");
		if (!viewActions) return null;

		const chip = createEl("div", { cls: CHIP_CLASS });
		chip.setAttribute("role", "button");
		chip.setAttribute("tabindex", "0");
		chip.setAttribute("aria-label", "Reminder");

		viewActions.insertBefore(chip, viewActions.firstChild);
		return chip;
	}

	private updateChipContent(chip: HTMLElement, date: string, time?: string): void {
		const { label, overdue } = formatReminderLabel(date, time);
		chip.empty();
		chip.toggleClass("tm-reminder-chip--overdue", overdue);
		const iconEl = chip.createSpan({ cls: "tm-reminder-chip-icon" });
		setIcon(iconEl, "alarm-clock");
		chip.createSpan({ cls: "tm-reminder-chip-label", text: label });
	}

	private openMenu(e: MouseEvent, file: TFile, date: string, time: string | undefined): void {
		e.stopPropagation();
		const menu = new Menu();
		menu.addItem((item) => {
			item.setTitle("Reschedule reminder");
			item.setIcon("alarm-clock");
			item.onClick(() => {
				new ReminderModal(this.app, (newDate, newTime) => {
					void this.reminderService.setReminder(file, newDate, newTime);
				}).open();
			});
		});
		menu.addItem((item) => {
			item.setTitle("Cancel reminder");
			item.setIcon("bell-off");
			item.onClick(() => {
				void this.reminderService.clearReminder(file);
			});
		});
		menu.showAtMouseEvent(e);
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatReminderLabel(date: string, time?: string): { label: string; overdue: boolean } {
	const now = moment();
	const target = time
		? moment(`${date} ${time}`, "YYYY-MM-DD HH:mm")
		: moment(date, "YYYY-MM-DD").startOf("day");

	const diffMs = target.diff(now);

	if (diffMs < 0) {
		const daysAgo = now.diff(target, "days");
		if (daysAgo === 0) return { label: "Due today", overdue: true };
		if (daysAgo === 1) return { label: "Due yesterday", overdue: true };
		return { label: `Past due · ${target.format("MMM D")}`, overdue: true };
	}

	const diffMins = Math.round(diffMs / 60000);
	if (diffMins < 60) return { label: `In ${diffMins} min`, overdue: false };
	const diffHours = Math.round(diffMs / 3600000);
	if (diffHours < 24) return { label: `In ${diffHours} hour${diffHours !== 1 ? "s" : ""}`, overdue: false };

	const diffDays = Math.round(diffMs / 86400000);
	if (diffDays === 1) {
		const label = time ? `Tomorrow · ${moment(time, "HH:mm").format("h:mm A")}` : "Tomorrow";
		return { label, overdue: false };
	}
	if (diffDays < 7) {
		const label = time
			? `${target.format("ddd")} · ${moment(time, "HH:mm").format("h:mm A")}`
			: target.format("ddd, MMM D");
		return { label, overdue: false };
	}
	const label = time
		? `${target.format("MMM D")} · ${moment(time, "HH:mm").format("h:mm A")}`
		: target.format("MMM D, YYYY");
	return { label, overdue: false };
}
