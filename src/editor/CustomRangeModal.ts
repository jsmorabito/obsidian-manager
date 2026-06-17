import { App, Modal, Notice, Setting } from "obsidian";
import type { CustomRange } from "./types";

export class CustomRangeModal extends Modal {
	private start = "";
	private end   = "";
	private onConfirm: (range: CustomRange) => void;

	constructor(app: App, onConfirm: (range: CustomRange) => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Custom date range" });

		new Setting(contentEl)
			.setName("Start date")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("YYYY-MM-DD")
			.addText((t) =>
				t.setPlaceholder("2025-01-01").onChange((v) => (this.start = v.trim()))
			);

		new Setting(contentEl)
			.setName("End date")
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setDesc("YYYY-MM-DD")
			.addText((t) =>
				t.setPlaceholder("2025-03-31").onChange((v) => (this.end = v.trim()))
			);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Apply")
				.setCta()
				.onClick(() => {
					const ISO = /^\d{4}-\d{2}-\d{2}$/;
					if (!ISO.test(this.start) || !ISO.test(this.end)) {
						// eslint-disable-next-line obsidianmd/ui/sentence-case
						new Notice("Please enter dates in YYYY-MM-DD format.");
						return;
					}
					if (this.start > this.end) {
						new Notice("Start date must be before end date.");
						return;
					}
					this.onConfirm({ start: this.start, end: this.end });
					this.close();
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
