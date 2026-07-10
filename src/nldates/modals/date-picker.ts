import { App, MarkdownView, Modal, Setting } from "obsidian";
import { generateMarkdownLink, getDateLinkAlias } from "../utils";
import type { NLDatesModule } from "../module";

/**
 * DatePickerModal — opens a small form where the user types a natural language
 * date, picks an output format, and optionally wraps the result in a link.
 * Submitting inserts the formatted string at the current cursor position.
 */
export default class DatePickerModal extends Modal {
	private readonly nld: NLDatesModule;

	constructor(app: App, nld: NLDatesModule) {
		super(app);
		this.nld = nld;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		let dateInput = "";
		let momentFormat = this.nld.settings.modalMomentFormat;
		let insertAsLink = this.nld.settings.modalToggleLink;
		let previewEl: HTMLElement;

		const buildDateStr = (): string => {
			let input = dateInput;
			let useAlias = false;

			// Trailing "|" signals "keep input text as alias" (Notion-style shortcut).
			if (input.endsWith("|")) {
				useAlias = true;
				input = input.slice(0, -1);
			}

			const result = this.nld.parse(input || "today", momentFormat);
			if (!result.moment.isValid()) return "";

			let out = result.formattedString;
			if (insertAsLink) {
				const alias = getDateLinkAlias(
					this.nld.settings.defaultAlias,
					(s) => this.nld.parseDate(s),
					input,
					useAlias
				);
				out = generateMarkdownLink(this.app, out, alias);
			}
			return out;
		};

		contentEl.createEl("form", {}, (form) => {
			const dateSetting = new Setting(form)
				.setName("Date")
				.setDesc(buildDateStr())
				.addText((text) => {
					text.setPlaceholder("Today");
					text.onChange((value) => {
						dateInput = value;
						previewEl.setText(buildDateStr());
					});
					// Auto-focus so the user can start typing immediately.
					window.setTimeout(() => text.inputEl.focus(), 10);
				});
			previewEl = dateSetting.descEl;

			new Setting(form)
				.setName("Output format")
				.setDesc("Moment.js format string for the inserted date.")
				.addMomentFormat((mf) => {
					mf.setPlaceholder("YYYY-MM-DD HH:mm")
						.setValue(momentFormat)
						.onChange((value) => {
							momentFormat = value.trim() || "YYYY-MM-DD HH:mm";
							this.nld.settings.modalMomentFormat = momentFormat;
							void this.nld.plugin.saveSettings();
							previewEl.setText(buildDateStr());
						});
				});

			new Setting(form).setName("Wrap in link?").addToggle((toggle) => {
				toggle.setValue(insertAsLink).onChange((value) => {
					insertAsLink = value;
					this.nld.settings.modalToggleLink = value;
					void this.nld.plugin.saveSettings();
					previewEl.setText(buildDateStr());
				});
			});

			form.createDiv("modal-button-container", (buttons) => {
				buttons
					.createEl("button", { attr: { type: "button" }, text: "Cancel" })
					.addEventListener("click", () => this.close());
				buttons.createEl("button", {
					attr: { type: "submit" },
					cls: "mod-cta",
					text: "Insert date",
				});
			});

			form.addEventListener("submit", (e: Event) => {
				e.preventDefault();
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view) {
					view.editor.replaceSelection(buildDateStr());
				}
				this.close();
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
