/**
 * TargetDateModal
 *
 * Linear-style date picker with granularity tabs (Day / Month / Quarter /
 * Half-year / Year).  Shows 4 years of chips (prev, current, next, next+1)
 * for the sub-year granularities, a flat chip grid for Year, and a native
 * date input for Day.
 *
 * Usage:
 *   new TargetDateModal(app, current, onChoose, onClear).open();
 *
 * `current` is the existing TargetDate (or null for a fresh pick).
 * `onChoose` is called with the selected moment + granularity.
 * `onClear`  is called when the user clicks "Clear".
 */

import { App, Modal, moment } from "obsidian";
// eslint-disable-next-line no-restricted-imports
import type { Moment } from "moment";
import type { TargetGranularity, TargetDate } from "./types";
import { formatTargetDate, labelTargetDate, targetDateToEndMoment } from "./target-date-service";

const GRANS: TargetGranularity[] = ["day", "week", "month", "quarter", "half-year", "year"];
const GRAN_LABELS: Record<TargetGranularity, string> = {
	day: "Day",
	week: "Week",
	month: "Month",
	quarter: "Quarter",
	"half-year": "Half-year",
	year: "Year",
};

export class TargetDateModal extends Modal {
	private selectedDate: Moment;
	private selectedGran: TargetGranularity;
	private readonly onChoose: (date: Moment, gran: TargetGranularity) => void;
	private readonly onClear: () => void;

	constructor(
		app: App,
		current: TargetDate | null,
		onChoose: (date: Moment, gran: TargetGranularity) => void,
		onClear: () => void
	) {
		super(app);
		// Resolve initial selected date from the stored raw value if available.
		if (current) {
			const end = targetDateToEndMoment(current.raw, current.granularity);
			this.selectedDate = end ? end.clone().startOf("month") : moment();
			this.selectedGran = current.granularity;
		} else {
			this.selectedDate = moment();
			this.selectedGran = "month";
		}
		this.onChoose = onChoose;
		this.onClear = onClear;
	}

	onOpen(): void {
		this.modalEl.addClass("tm-target-date-modal");
		this.titleEl.setText("Set target date");
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	// ── Render ──────────────────────────────────────────────────────────────────

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("tm-tdm");

		// ── Preview ──────────────────────────────────────────────────────────────
		const previewWrap = contentEl.createDiv({ cls: "tm-tdm-preview" });
		previewWrap.createEl("span", {
			text: labelTargetDate(formatTargetDate(this.selectedDate, this.selectedGran), this.selectedGran),
			cls: "tm-tdm-preview-text",
		});

		// ── Granularity tabs ─────────────────────────────────────────────────────
		const tabs = contentEl.createDiv({ cls: "tm-tdm-tabs" });
		for (const g of GRANS) {
			const isActive = g === this.selectedGran;
			const tab = tabs.createEl("button", {
				text: GRAN_LABELS[g],
				cls: isActive ? "tm-tdm-tab tm-tdm-tab--active" : "tm-tdm-tab",
			});
			tab.addEventListener("click", () => {
				this.selectedGran = g;
				this.render();
			});
		}

		// ── Picker grid ──────────────────────────────────────────────────────────
		const grid = contentEl.createDiv({ cls: "tm-tdm-grid" });
		this.renderGrid(grid);

		// ── Footer ───────────────────────────────────────────────────────────────
		const footer = contentEl.createDiv({ cls: "tm-tdm-footer" });

		const clearBtn = footer.createEl("button", {
			text: "Clear",
			cls: "tm-tdm-btn tm-tdm-btn--ghost",
		});
		clearBtn.addEventListener("click", () => {
			this.onClear();
			this.close();
		});

		const setBtn = footer.createEl("button", {
			text: "Set target",
			cls: "tm-tdm-btn tm-tdm-btn--primary",
		});
		setBtn.addEventListener("click", () => {
			this.onChoose(this.selectedDate.clone(), this.selectedGran);
			this.close();
		});
	}

	// ── Grid renderers ───────────────────────────────────────────────────────────

	private renderGrid(container: HTMLElement): void {
		if (this.selectedGran === "day") {
			this.renderDayGrid(container);
			return;
		}
		if (this.selectedGran === "year") {
			this.renderYearGrid(container);
			return;
		}

		const currentYear = moment().year();
		const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

		for (const year of years) {
			const section = container.createDiv({ cls: "tm-tdm-year-section" });
			const isCurrentYear = year === currentYear;
			section.createDiv({
				text: String(year),
				cls: isCurrentYear ? "tm-tdm-year-label tm-tdm-year-label--current" : "tm-tdm-year-label",
			});
			const chips = section.createDiv({ cls: "tm-tdm-chips" });

			if (this.selectedGran === "month") this.renderMonthChips(chips, year);
			else if (this.selectedGran === "week") this.renderWeekChips(chips, year);
			else if (this.selectedGran === "quarter") this.renderQuarterChips(chips, year);
			else if (this.selectedGran === "half-year") this.renderHalfYearChips(chips, year);
		}
	}

	private renderDayGrid(container: HTMLElement): void {
		const wrap = container.createDiv({ cls: "tm-tdm-day-wrap" });
		const input = wrap.createEl("input", { cls: "tm-tdm-date-input" });
		input.type = "date";
		input.value = this.selectedDate.format("YYYY-MM-DD");
		input.addEventListener("change", () => {
			if (input.value) {
				this.selectedDate = moment(input.value, "YYYY-MM-DD");
				this.updatePreview();
			}
		});
	}

	private renderYearGrid(container: HTMLElement): void {
		const currentYear = moment().year();
		const years = [
			currentYear - 2,
			currentYear - 1,
			currentYear,
			currentYear + 1,
			currentYear + 2,
			currentYear + 3,
		];
		const chips = container.createDiv({ cls: "tm-tdm-chips tm-tdm-chips--year" });
		for (const year of years) {
			const d = moment({ year, month: 0, date: 1 });
			const isSelected = this.selectedDate.year() === year;
			const isToday = currentYear === year;
			const chip = chips.createEl("button", {
				text: String(year),
				cls: this.chipClass(isSelected, isToday),
			});
			chip.addEventListener("click", () => {
				this.selectedDate = d;
				this.render();
			});
		}
	}

	private renderWeekChips(container: HTMLElement, year: number): void {
		const firstWeek = moment({ year }).startOf("isoWeek");
		const lastWeek  = moment({ year, month: 11, date: 28 }).startOf("isoWeek");
		const todayWeek = moment().startOf("isoWeek");
		const cursor = firstWeek.clone();
		while (cursor.isSameOrBefore(lastWeek)) {
			const d = cursor.clone();
			const isSelected = this.selectedDate.isSame(d, "isoWeek");
			const isToday = todayWeek.isSame(d, "isoWeek");
			const chip = container.createEl("button", {
				text: `W${d.format("W")}`,
				cls: this.chipClass(isSelected, isToday),
			});
			chip.addEventListener("click", () => {
				this.selectedDate = d;
				this.render();
			});
			cursor.add(1, "week");
		}
	}

	private renderMonthChips(container: HTMLElement, year: number): void {
		const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
		const todayYear = moment().year();
		const todayMonth = moment().month();
		for (let m = 0; m < 12; m++) {
			const d = moment({ year, month: m, date: 1 });
			const isSelected = this.selectedDate.year() === year && this.selectedDate.month() === m;
			const isToday = todayYear === year && todayMonth === m;
			const chip = container.createEl("button", {
				text: MONTHS[m],
				cls: this.chipClass(isSelected, isToday),
			});
			chip.addEventListener("click", () => {
				this.selectedDate = d;
				this.render();
			});
		}
	}

	private renderQuarterChips(container: HTMLElement, year: number): void {
		const todayYear = moment().year();
		const todayQ = Math.floor(moment().month() / 3) + 1;
		for (let q = 1; q <= 4; q++) {
			const d = moment({ year, month: (q - 1) * 3, date: 1 });
			const isSelected = this.selectedDate.year() === year && Math.floor(this.selectedDate.month() / 3) + 1 === q;
			const isToday = todayYear === year && todayQ === q;
			const chip = container.createEl("button", {
				text: `Q${q}`,
				cls: this.chipClass(isSelected, isToday),
			});
			chip.addEventListener("click", () => {
				this.selectedDate = d;
				this.render();
			});
		}
	}

	private renderHalfYearChips(container: HTMLElement, year: number): void {
		const todayYear = moment().year();
		const todayH = moment().month() < 6 ? 1 : 2;
		for (let h = 1; h <= 2; h++) {
			const d = moment({ year, month: (h - 1) * 6, date: 1 });
			const selectedH = this.selectedDate.month() < 6 ? 1 : 2;
			const isSelected = this.selectedDate.year() === year && selectedH === h;
			const isToday = todayYear === year && todayH === h;
			const chip = container.createEl("button", {
				text: `H${h}`,
				cls: this.chipClass(isSelected, isToday),
			});
			chip.addEventListener("click", () => {
				this.selectedDate = d;
				this.render();
			});
		}
	}

	// ── Utilities ────────────────────────────────────────────────────────────────

	private chipClass(isSelected: boolean, isToday: boolean): string {
		return [
			"tm-tdm-chip",
			isSelected ? "tm-tdm-chip--selected" : "",
			isToday && !isSelected ? "tm-tdm-chip--today" : "",
		]
			.filter(Boolean)
			.join(" ");
	}

	private updatePreview(): void {
		const el = this.contentEl.querySelector(".tm-tdm-preview-text");
		if (el) {
			el.textContent = labelTargetDate(
				formatTargetDate(this.selectedDate, this.selectedGran),
				this.selectedGran
			);
		}
	}
}
