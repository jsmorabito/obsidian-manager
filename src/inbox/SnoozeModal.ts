import { App, Modal, moment } from "obsidian";

export type SnoozeCallback = (remindAt: string) => void;

interface SnoozePreset {
	label: string;
	sublabel: string;
	getTime: () => string;
}

export class SnoozeModal extends Modal {
	private callback: SnoozeCallback;

	constructor(app: App, callback: SnoozeCallback) {
		super(app);
		this.callback = callback;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tm-inbox-snooze-modal");
		contentEl.createEl("h3", { text: "Snooze until…", cls: "tm-inbox-snooze-title" });

		const presets: SnoozePreset[] = [
			{
				label: "In 1 hour",
				sublabel: moment().add(1, "hour").format("ddd, D MMM, h:mm a"),
				getTime: () => moment().add(1, "hour").toISOString(),
			},
			{
				label: "Later today",
				sublabel: moment().hour(17).minute(0).second(0).format("ddd, D MMM, h:mm a"),
				getTime: () => moment().hour(17).minute(0).second(0).toISOString(),
			},
			{
				label: "Tomorrow morning",
				sublabel: moment().add(1, "day").hour(9).minute(0).second(0).format("ddd, D MMM, h:mm a"),
				getTime: () => moment().add(1, "day").hour(9).minute(0).second(0).toISOString(),
			},
			{
				label: "Next week",
				sublabel: moment().add(1, "week").startOf("isoWeek").hour(9).minute(0).second(0).format("ddd, D MMM, h:mm a"),
				getTime: () =>
					moment().add(1, "week").startOf("isoWeek").hour(9).minute(0).second(0).toISOString(),
			},
			{
				label: "Next month",
				sublabel: moment().add(1, "month").startOf("month").hour(9).minute(0).second(0).format("ddd, D MMM, 9:00 a"),
				getTime: () =>
					moment().add(1, "month").startOf("month").hour(9).minute(0).second(0).toISOString(),
			},
		];

		const list = contentEl.createEl("div", { cls: "tm-inbox-snooze-list" });

		for (const preset of presets) {
			const btn = list.createEl("button", { cls: "tm-inbox-snooze-btn" });
			btn.createEl("span", { text: preset.label, cls: "tm-inbox-snooze-label" });
			btn.createEl("span", { text: preset.sublabel, cls: "tm-inbox-snooze-sublabel" });
			btn.addEventListener("click", () => {
				this.callback(preset.getTime());
				this.close();
			});
		}

		const customBtn = list.createEl("button", { cls: "tm-inbox-snooze-btn tm-inbox-snooze-custom" });
		customBtn.createEl("span", { text: "Custom…", cls: "tm-inbox-snooze-label" });
		customBtn.addEventListener("click", () => {
			this.close();
			new CustomSnoozeModal(this.app, this.callback).open();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class CustomSnoozeModal extends Modal {
	private callback: SnoozeCallback;

	constructor(app: App, callback: SnoozeCallback) {
		super(app);
		this.callback = callback;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("tm-inbox-snooze-modal");
		contentEl.createEl("h3", { text: "Snooze until…", cls: "tm-inbox-snooze-title" });

		const fields = contentEl.createEl("div", { cls: "tm-inbox-custom-fields" });

		const dateLabel = fields.createEl("label", { text: "Date", cls: "tm-inbox-field-label" });
		const dateInput = dateLabel.createEl("input");
		dateInput.type = "date";
		dateInput.value = moment().add(1, "day").format("YYYY-MM-DD");

		const timeLabel = fields.createEl("label", { text: "Time", cls: "tm-inbox-field-label" });
		const timeInput = timeLabel.createEl("input");
		timeInput.type = "time";
		timeInput.value = "09:00";

		const footer = contentEl.createEl("div", { cls: "tm-inbox-modal-footer" });
		const confirmBtn = footer.createEl("button", {
			text: "Snooze",
			cls: "mod-cta",
		});
		confirmBtn.addEventListener("click", () => {
			const dt = moment(`${dateInput.value} ${timeInput.value}`, "YYYY-MM-DD HH:mm");
			if (dt.isValid()) {
				this.callback(dt.toISOString());
				this.close();
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
