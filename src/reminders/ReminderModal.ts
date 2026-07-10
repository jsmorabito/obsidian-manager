import { App, Modal, moment } from "obsidian";

export type ReminderCallback = (date: string, time?: string) => void;

interface ReminderPreset {
	label: string;
	sublabel: string;
	getDateTime: () => { date: string; time?: string };
}

export class ReminderModal extends Modal {
	private callback: ReminderCallback;

	constructor(app: App, callback: ReminderCallback) {
		super(app);
		this.callback = callback;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tm-inbox-snooze-modal");
		contentEl.createEl("h3", { text: "Remind me…", cls: "tm-inbox-snooze-title" });

		const presets: ReminderPreset[] = [
			{
				label: "An hour from now",
				sublabel: moment().add(1, "hour").format("ddd, D MMM, h:mm A"),
				getDateTime: () => ({
					date: moment().add(1, "hour").format("YYYY-MM-DD"),
					time: moment().add(1, "hour").format("HH:mm"),
				}),
			},
			{
				label: "Tomorrow",
				sublabel: moment().add(1, "day").hour(9).minute(0).format("ddd, D MMM, 9:00 AM"),
				getDateTime: () => ({
					date: moment().add(1, "day").format("YYYY-MM-DD"),
					time: "09:00",
				}),
			},
			{
				label: "Next week",
				sublabel: moment().add(1, "week").startOf("isoWeek").hour(9).minute(0).format("ddd, D MMM, 9:00 AM"),
				getDateTime: () => ({
					date: moment().add(1, "week").startOf("isoWeek").format("YYYY-MM-DD"),
					time: "09:00",
				}),
			},
			{
				label: "A month from now",
				sublabel: moment().add(1, "month").hour(9).minute(0).format("ddd, D MMM YYYY, 9:00 AM"),
				getDateTime: () => ({
					date: moment().add(1, "month").format("YYYY-MM-DD"),
					time: "09:00",
				}),
			},
		];

		const list = contentEl.createDiv({ cls: "tm-inbox-snooze-list" });

		for (const preset of presets) {
			const btn = list.createEl("button", { cls: "tm-inbox-snooze-btn" });
			btn.createSpan({ text: preset.label, cls: "tm-inbox-snooze-label" });
			btn.createSpan({ text: preset.sublabel, cls: "tm-inbox-snooze-sublabel" });
			btn.addEventListener("click", () => {
				const { date, time } = preset.getDateTime();
				this.callback(date, time);
				this.close();
			});
		}

		const customBtn = list.createEl("button", { cls: "tm-inbox-snooze-btn tm-inbox-snooze-custom" });
		customBtn.createSpan({ text: "Custom…", cls: "tm-inbox-snooze-label" });
		customBtn.addEventListener("click", () => {
			this.close();
			new CustomReminderModal(this.app, this.callback).open();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class CustomReminderModal extends Modal {
	private callback: ReminderCallback;

	constructor(app: App, callback: ReminderCallback) {
		super(app);
		this.callback = callback;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tm-inbox-snooze-modal");
		contentEl.createEl("h3", { text: "Remind me…", cls: "tm-inbox-snooze-title" });

		const fields = contentEl.createDiv({ cls: "tm-inbox-custom-fields" });

		const dateLabel = fields.createEl("label", { text: "Date", cls: "tm-inbox-field-label" });
		const dateInput = dateLabel.createEl("input");
		dateInput.type = "date";
		dateInput.value = moment().add(1, "day").format("YYYY-MM-DD");

		const timeLabel = fields.createEl("label", { text: "Time (optional)", cls: "tm-inbox-field-label" });
		const timeInput = timeLabel.createEl("input");
		timeInput.type = "time";
		timeInput.value = "09:00";

		const footer = contentEl.createDiv({ cls: "tm-inbox-modal-footer" });
		const confirmBtn = footer.createEl("button", { text: "Set reminder", cls: "mod-cta" });
		confirmBtn.addEventListener("click", () => {
			if (!dateInput.value) return;
			this.callback(dateInput.value, timeInput.value || undefined);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
