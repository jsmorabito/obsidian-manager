import { App, Modal, moment } from "obsidian";
import { getSnoozePresets } from "./snooze-presets";

export type SnoozeCallback = (remindAt: string) => void;

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

		const presets = getSnoozePresets();

		const list = contentEl.createDiv({ cls: "tm-inbox-snooze-list" });

		for (const preset of presets) {
			const btn = list.createEl("button", { cls: "tm-inbox-snooze-btn" });
			btn.createSpan({ text: preset.label, cls: "tm-inbox-snooze-label" });
			btn.createSpan({ text: preset.sublabel, cls: "tm-inbox-snooze-sublabel" });
			btn.addEventListener("click", () => {
				this.callback(preset.getTime());
				this.close();
			});
		}

		const customBtn = list.createEl("button", { cls: "tm-inbox-snooze-btn tm-inbox-snooze-custom" });
		customBtn.createSpan({ text: "Custom…", cls: "tm-inbox-snooze-label" });
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

		const fields = contentEl.createDiv({ cls: "tm-inbox-custom-fields" });

		const dateLabel = fields.createEl("label", { text: "Date", cls: "tm-inbox-field-label" });
		const dateInput = dateLabel.createEl("input");
		dateInput.type = "date";
		dateInput.value = moment().add(1, "day").format("YYYY-MM-DD");

		const timeLabel = fields.createEl("label", { text: "Time", cls: "tm-inbox-field-label" });
		const timeInput = timeLabel.createEl("input");
		timeInput.type = "time";
		timeInput.value = "09:00";

		const footer = contentEl.createDiv({ cls: "tm-inbox-modal-footer" });
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
