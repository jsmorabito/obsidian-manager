import { App, Modal, Notice, Setting, moment } from "obsidian";
import type { Granularity } from "./types";
import { HUMANIZE_FORMAT } from "./constants";

export class DatePickerModal extends Modal {
	private input = "";
	private onConfirm: (date: moment.Moment) => void;
	private granularity: Granularity;

	constructor(app: App, granularity: Granularity, onConfirm: (date: moment.Moment) => void) {
		super(app);
		this.granularity = granularity;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Jump to date" });

		const fmt = HUMANIZE_FORMAT[this.granularity];
		new Setting(contentEl)
			.setName("Date")
			.setDesc(`Format: ${fmt}`)
			.addText((t) => {
				t.setPlaceholder(moment().format(fmt));
				t.onChange((v) => (this.input = v.trim()));
				// Submit on Enter.
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") this.submit();
				});
				// Auto-focus.
				setTimeout(() => t.inputEl.focus(), 50);
			});

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Go").setCta().onClick(() => this.submit())
		);
	}

	private submit(): void {
		const fmt = HUMANIZE_FORMAT[this.granularity];
		const parsed = moment(this.input, fmt, true);
		if (!parsed.isValid()) {
			new Notice(`Invalid date. Expected format: ${fmt}`);
			return;
		}
		this.onConfirm(parsed);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
