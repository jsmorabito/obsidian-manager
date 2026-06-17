/* eslint-disable obsidianmd/ui/sentence-case */
import { App, Modal, Setting } from "obsidian";

/**
 * Shown when the user clicks "Stop session".
 * Pre-populated with whatever tags the session already has.
 */
export class StopSessionModal extends Modal {
	private tags: string;
	private readonly onConfirm: (tags: string[]) => void;

	constructor(app: App, currentTags: string[], onConfirm: (tags: string[]) => void) {
		super(app);
		this.tags = currentTags.join(", ");
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Stop session" });

		let tagsInput: HTMLInputElement;

		new Setting(contentEl)
			.setName("Tags")
			.setDesc("Comma-separated tags for this session. Leave blank to keep existing tags.")
			.addText((t) => {
				tagsInput = t.inputEl;
				t.setValue(this.tags)
					.setPlaceholder("work, project-x")
					.onChange((v) => (this.tags = v));
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					 
			.setButtonText("Stop session")
					.setCta()
					.setDestructive()
					.onClick(() => this.submit())
			)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.close())
			);

		window.setTimeout(() => tagsInput?.focus(), 50);
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
		const tags = this.tags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		this.onConfirm(tags);
		this.close();
	}
}
