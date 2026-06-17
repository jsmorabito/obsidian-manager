/* eslint-disable obsidianmd/ui/sentence-case */
import { App, Modal, Setting } from "obsidian";

/**
 * Shown when the user clicks "Start session".
 * Both fields are optional — pressing Enter or clicking Start with everything
 * blank starts an unlabelled, untagged session (same as before).
 */
export class StartSessionModal extends Modal {
	private label = "";
	private tags = "";
	private readonly onConfirm: (label: string, tags: string[]) => void;

	constructor(app: App, onConfirm: (label: string, tags: string[]) => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Start session" });

		let labelInput: HTMLInputElement;

		new Setting(contentEl)
			 
			.setName("What are you working on?")
			.setDesc("Optional — saved as the session label and used as the note heading.")
			.addText((t) => {
				labelInput = t.inputEl;
				 
			t.setPlaceholder("Session goal or topic").onChange((v) => (this.label = v));
			});

		new Setting(contentEl)
			.setName("Tags")
			.setDesc("Optional — comma-separated (e.g. work, project-x).")
			.addText((t) =>
				t.setPlaceholder("work, project-x").onChange((v) => (this.tags = v))
			);

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Start")
					.setCta()
					.onClick(() => this.submit())
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.close())
			);

		// Focus the label input and allow Enter to submit.
		window.setTimeout(() => labelInput?.focus(), 50);
		contentEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.submit();
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		const label = this.label.trim();
		const tags = this.tags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		this.onConfirm(label, tags);
		this.close();
	}
}
