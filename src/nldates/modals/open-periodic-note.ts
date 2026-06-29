/* eslint-disable obsidianmd/ui/sentence-case */
import { App, Modal, Notice, Setting, moment } from "obsidian";
import { openPeriodicNote } from "../../periodic/api";
import { granularities, displayConfigs, type Granularity } from "../../periodic/types";
import type { NLDatesModule } from "../module";

/**
 * OpenPeriodicNoteModal — lets the user type a natural language date and pick a
 * granularity, then opens (or creates) the matching periodic note.
 *
 * Extended from the original nldates "Open daily note" modal to cover all five
 * granularities: day, week, month, quarter, year.
 */
export default class OpenPeriodicNoteModal extends Modal {
	private readonly nld: NLDatesModule;

	constructor(app: App, nld: NLDatesModule) {
		super(app);
		this.nld = nld;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Open periodic note" });

		// Default to day; only show granularities that are currently enabled.
		const enabledGranularities = granularities.filter(
			(g) => this.nld.plugin.settings.time[g].enabled
		);

		if (enabledGranularities.length === 0) {
			contentEl.createEl("p", {
				text: "No periodic note granularities are enabled. Enable at least one in Settings.",
			});
			return;
		}

		let selectedGranularity: Granularity = enabledGranularities.includes("day")
			? "day"
			: enabledGranularities[0];

		let dateInput = "";
		let previewEl: HTMLElement;

		const buildPreview = (): string => {
			const input = dateInput.trim() || "today";
			const fmt = this.nld.plugin.settings.time[selectedGranularity].format || "YYYY-MM-DD";
			const result = this.nld.parse(input, fmt);
			return result.moment.isValid() ? result.formattedString : "⚠ Unrecognised date";
		};

		contentEl.createEl("form", {}, (form) => {
			// Granularity picker — only shows enabled granularities.
			new Setting(form)
				.setName("Note type")
				.addDropdown((dd) => {
					for (const g of enabledGranularities) {
						const label = displayConfigs[g].periodicity;
						dd.addOption(g, label.charAt(0).toUpperCase() + label.slice(1));
					}
					dd.setValue(selectedGranularity);
					dd.onChange((value) => {
						selectedGranularity = value as Granularity;
						previewEl.setText(buildPreview());
					});
				});

			// Natural language date input.
			const dateSetting = new Setting(form)
				.setName("Date")
				.setDesc(buildPreview())
				.addText((text) => {
					text.setPlaceholder("today, next friday, last month…");
					text.onChange((value) => {
						dateInput = value;
						previewEl.setText(buildPreview());
					});
					window.setTimeout(() => text.inputEl.focus(), 10);
				});
			previewEl = dateSetting.descEl;

			form.createDiv("modal-button-container", (buttons) => {
				buttons
					.createEl("button", { attr: { type: "button" }, text: "Cancel" })
					.addEventListener("click", () => this.close());
				buttons.createEl("button", {
					attr: { type: "submit" },
					cls: "mod-cta",
					text: "Open note",
				});
			});

			form.addEventListener("submit", (e: Event) => {
				e.preventDefault();
				const input = dateInput.trim() || "today";
				const fmt = this.nld.plugin.settings.time[selectedGranularity].format || "YYYY-MM-DD";
				const result = this.nld.parse(input, fmt);

				if (!result.moment.isValid()) {
					new Notice(`Could not parse "${input}" as a date.`);
					return;
				}

				this.close();
				openPeriodicNote(this.nld.plugin, selectedGranularity, moment(result.date)).catch(
					(err: unknown) => {
						console.error("[time-tools/nldates] Failed to open periodic note:", err);
						new Notice("Could not open the periodic note. Check the console for details.");
					}
				);
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
