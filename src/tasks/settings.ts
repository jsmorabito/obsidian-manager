import { AbstractInputSuggest, App, PluginSettingTab, Setting, SettingDefinitionItem, TFile } from "obsidian";
import type { ChainDefinition, FrontmatterRule, LinearWorkspaceConfig } from "./types";
import { buildIconEl, CheckboxStatus, DEFAULT_CHECKBOX_STATUSES } from "./checkboxIcons";
import TaskToolsPlugin from "./main";

export type StatusBarDisplayMode = "filenames" | "dots";
export type ChainBarPosition = "left" | "center" | "right";

export interface TaskToolsSettings {
	taskFrontmatterKey: string;
	taskFrontmatterValue: string;
	taskFolder: string;
	taskTemplatePath: string;
	statusBarChainIdKey: string; // idKey of the chain shown in the status bar
	statusBarDisplayMode: StatusBarDisplayMode;
	statusBarDotsCount: number; // max visible dots at a time
	statusBarMaxItems: number; // max items shown before horizontal scroll kicks in (filenames mode)
	chainBarVisible: boolean;
	chainBarPosition: ChainBarPosition;
	chains: ChainDefinition[];
	// Linear integration
	linearWorkspaces: LinearWorkspaceConfig[];
	linearSyncOnOpen: boolean;
	linearSyncIntervalMinutes: number; // 0 = disabled
	linearIssueFolder: string; // folder where imported issues are created
	linearTemplatePath: string; // optional template applied on top of imported issues
	// Checkbox icons
	enableCheckboxIcons: boolean;
	checkboxStatuses: CheckboxStatus[];
	// Chain view display state: maps chain idKey → "dots" | "list"
	chainViewModes: Record<string, "dots" | "list">;
}

/** Convert a display name to a lowercase kebab-case slug, e.g. "My Chain" → "my-chain". */
export function slugifyChainName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Return the three auto-derived key names for a given chain slug. */
export function derivedChainKeys(slug: string): { idKey: string; positionKey: string; statusKey: string } {
	return { idKey: `${slug}-chain`, positionKey: `${slug}-chain-position`, statusKey: `${slug}-chain-status` };
}

export const DEFAULT_CHAIN: ChainDefinition = {
	name: "Project Chain",
	...derivedChainKeys(slugifyChainName("Project Chain")),
	currentStatusValue: "current",
	completedStatusValue: "done",
	readyStatusValue: "ready",
};

export const DEFAULT_SETTINGS: TaskToolsSettings = {
	taskFrontmatterKey: "type",
	taskFrontmatterValue: "task",
	taskFolder: "",
	taskTemplatePath: "",
	statusBarChainIdKey: "",
	statusBarDisplayMode: "filenames",
	statusBarDotsCount: 7,
	statusBarMaxItems: 5,
	chainBarVisible: true,
	chainBarPosition: "center",
	chains: [DEFAULT_CHAIN],
	linearWorkspaces: [],
	linearSyncOnOpen: true,
	linearSyncIntervalMinutes: 0,
	linearIssueFolder: "Linear",
	linearTemplatePath: "",
	enableCheckboxIcons: false,
	checkboxStatuses: DEFAULT_CHECKBOX_STATUSES,
	chainViewModes: {},
};

class FileSuggest extends AbstractInputSuggest<TFile> {
	getSuggestions(inputStr: string): TFile[] {
		const lower = inputStr.toLowerCase();
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => f.path.toLowerCase().includes(lower))
			.slice(0, 20);
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile): void {
		this.setValue(file.path);
		this.close();
	}
}

export class TaskToolsSettingTab extends PluginSettingTab {
	plugin: TaskToolsPlugin;

	constructor(app: App, plugin: TaskToolsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getControlValue(key: string): unknown {
		return (this.plugin.taskSettings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === "taskFolder" && typeof value === "string") value = value.trim();
		else if (key === "linearIssueFolder" && typeof value === "string") value = value.trim() || "Linear";

		(this.plugin.taskSettings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();

		if (key === "linearSyncIntervalMinutes") this.plugin.rescheduleLinearSync();
		if (key === "statusBarDisplayMode" || key === "enableCheckboxIcons") this.refreshDomState();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const t = this.plugin.taskSettings;

		return [
			{
				type: "group",
				heading: "Task file detection",
				items: [
					{
						name: "Frontmatter key",
						desc: "The frontmatter key used to identify a file as a task.",
						control: { type: "text", key: "taskFrontmatterKey", placeholder: "Type" },
					},
					{
						name: "Frontmatter value",
						desc: "Only files where the key equals this value are treated as tasks. Leave empty to match any file that has the key.",
						control: { type: "text", key: "taskFrontmatterValue", placeholder: "Task" },
					},
					{
						name: "Task folder",
						desc: "Folder where new task files are created. Leave empty for vault root.",
						control: { type: "text", key: "taskFolder", placeholder: "Tasks" },
					},
					{
						name: "Task template",
						desc: "Optional template file. Its content is used as the body of new tasks; its frontmatter is merged with chain frontmatter (plugin keys take precedence).",
						render: (setting) => {
							setting.addText((text) => {
								new FileSuggest(this.app, text.inputEl);
								text
									.setPlaceholder("Templates/task-template.md")
									.setValue(this.plugin.taskSettings.taskTemplatePath)
									.onChange(async (value) => {
										this.plugin.taskSettings.taskTemplatePath = value.trim();
										await this.plugin.saveSettings();
									});
							});
						},
					},
				],
			},
			{
				type: "group",
				heading: "Status bar",
				items: [
					{
						name: "Display mode",
						desc: "How items are shown in the status bar breadcrumb.",
						control: {
							type: "dropdown",
							key: "statusBarDisplayMode",
							options: { filenames: "File names", dots: "Dots" },
						},
					},
					{
						name: "Visible dots",
						desc: "Maximum number of dots shown at once. The window stays centered on the current task.",
						control: { type: "slider", key: "statusBarDotsCount", min: 3, max: 15, step: 2 },
						visible: () => t.statusBarDisplayMode === "dots",
					},
					{
						name: "Max visible items",
						desc: "Number of chain items shown before the bar scrolls horizontally. Increase for wider bars, decrease for a more compact bar.",
						control: { type: "slider", key: "statusBarMaxItems", min: 2, max: 20, step: 1 },
						visible: () => t.statusBarDisplayMode === "filenames",
					},
					{
						name: "Chain bar position",
						desc: "Where the chain breadcrumb bar appears at the bottom of the screen.",
						control: {
							type: "dropdown",
							key: "chainBarPosition",
							options: { left: "Left", center: "Center", right: "Right (next to status bar)" },
						},
					},
				],
			},
			{
				type: "group",
				heading: "Checkbox icons",
				items: [
					{
						name: "Checkbox icons",
						searchable: false,
						render: (setting, group) => {
							setting.settingEl.remove();
							group.listEl.createEl("p", {
								text: "Replace standard checkboxes in reading view with styled icon characters. Click an icon to cycle through statuses.",
								cls: "setting-item-description",
							});
						},
					},
					{
						name: "Enable checkbox icons",
						desc: "Show custom icon characters instead of native checkboxes in reading view.",
						control: { type: "toggle", key: "enableCheckboxIcons" },
					},
					{
						name: "Checkbox status cycle",
						searchable: false,
						visible: () => t.enableCheckboxIcons,
						render: (setting, group) => {
							setting.settingEl.remove();
							this.renderCheckboxStatusList(group.listEl);
						},
					},
				],
			},
			{
				type: "group",
				heading: "Chain schemas",
				items: [
					{
						name: "Chain schemas",
						desc: "Each schema defines a set of frontmatter keys for one chain type. A note participates in a chain by having that schema's keys in its frontmatter.",
						render: (setting, group) => {
							setting.settingEl.remove();
							group.listEl.createEl("p", {
								text: "Each schema defines a set of frontmatter keys for one chain type. A note participates in a chain by having that schema's keys in its frontmatter.",
								cls: "setting-item-description",
							});
							this.plugin.taskSettings.chains.forEach((chain, idx) => {
								this.renderChainSchema(group.listEl, chain, idx);
							});
							new Setting(group.listEl).addButton((btn) =>
								btn
									.setButtonText("Add chain schema")
									.setCta()
									.onClick(async () => {
										const newName = "New Chain";
										this.plugin.taskSettings.chains.push({
											name: newName,
											...derivedChainKeys(slugifyChainName(newName)),
											currentStatusValue: "current",
											completedStatusValue: "done",
											readyStatusValue: "ready",
										});
										await this.plugin.saveSettings();
										this.update();
									})
							);
						},
					},
				],
			},
			{
				type: "group",
				heading: "Linear integration",
				items: [
					{
						name: "Issue folder",
						desc: "Folder where imported linear issues are created.",
						control: { type: "text", key: "linearIssueFolder", placeholder: "Linear" },
					},
					{
						name: "Issue template",
						desc: "Optional template file applied on top of imported linear issues. Its frontmatter is merged with the linear-managed frontmatter (linear keys take precedence); its body replaces the default note body. Supports {{title}}, {{identifier}}, {{url}}, {{status}}, {{priority}}, {{team}}.",
						render: (setting) => {
							setting.addText((text) => {
								new FileSuggest(this.app, text.inputEl);
								text
									.setPlaceholder("Templates/linear-issue-template.md")
									.setValue(this.plugin.taskSettings.linearTemplatePath)
									.onChange(async (value) => {
										this.plugin.taskSettings.linearTemplatePath = value.trim();
										await this.plugin.saveSettings();
									});
							});
						},
					},
					{
						name: "Sync on open",
						desc: "Pull status updates from linear when Obsidian opens.",
						control: { type: "toggle", key: "linearSyncOnOpen" },
					},
					{
						name: "Auto-sync interval (minutes)",
						desc: "Poll linear for updates on this interval. Set to 0 to disable.",
						control: { type: "slider", key: "linearSyncIntervalMinutes", min: 0, max: 120, step: 15 },
					},
				],
			},
			{
				type: "group",
				heading: "Workspaces",
				items: [
					{
						name: "Workspaces",
						desc: "Each workspace connects to one linear organization. You can use a personal API key (paste from linear → settings → API) or OAuth.",
						render: (setting, group) => {
							setting.settingEl.remove();
							group.listEl.createEl("p", {
								text: "Each workspace connects to one linear organization. You can use a personal API key (paste from linear → settings → API) or OAUTH.",
								cls: "setting-item-description",
							});
							const wsContainer = group.listEl.createDiv({ cls: "linear-workspace-list" });
							this.renderWorkspaceList(wsContainer);
							new Setting(group.listEl).addButton((btn) =>
								btn
									.setButtonText("Add workspace")
									.setCta()
									.onClick(async () => {
										this.plugin.taskSettings.linearWorkspaces.push({
											id: `workspace-${Date.now()}`,
											name: "New Workspace",
											authType: "apiKey",
										});
										await this.plugin.saveSettings();
										this.update();
									})
							);
						},
					},
				],
			},
		];
	}

	/**
	 * Imperative fallback, used when this tab is embedded manually (see
	 * TaskSettingPage in ../settings.ts, which calls display() directly
	 * rather than going through Obsidian's own declarative-tab dispatch).
	 * Kept in sync with getSettingDefinitions() above; both render the same
	 * settings via the same private helpers.
	 */
	display(): void {
		const { containerEl } = this;
		const scrollEl = containerEl.closest(".vertical-tab-content");
		const scrollTop = scrollEl?.scrollTop ?? 0;
		containerEl.empty();

		// ── Task file detection ──────────────────────────────────────────────
		new Setting(containerEl).setName("Task file detection").setHeading();

		new Setting(containerEl)
			.setName("Frontmatter key")
			.setDesc("The frontmatter key used to identify a file as a task.")
			.addText((text) =>
				text
					.setPlaceholder("Type")
					.setValue(this.plugin.taskSettings.taskFrontmatterKey)
					.onChange(async (value) => {
						this.plugin.taskSettings.taskFrontmatterKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Frontmatter value")
			.setDesc(
				"Only files where the key equals this value are treated as tasks. Leave empty to match any file that has the key."
			)
			.addText((text) =>
				text
					.setPlaceholder("Task")
					.setValue(this.plugin.taskSettings.taskFrontmatterValue)
					.onChange(async (value) => {
						this.plugin.taskSettings.taskFrontmatterValue = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Task folder")
			.setDesc("Folder where new task files are created. Leave empty for vault root.")
			.addText((text) =>
				text
					.setPlaceholder("Tasks")
					.setValue(this.plugin.taskSettings.taskFolder)
					.onChange(async (value) => {
						this.plugin.taskSettings.taskFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Task template")
			.setDesc(
				"Optional template file. Its content is used as the body of new tasks; its frontmatter is merged with chain frontmatter (plugin keys take precedence)."
			)
			.addText((text) => {
				new FileSuggest(this.app, text.inputEl);
				text
					.setPlaceholder("Templates/task-template.md")
					.setValue(this.plugin.taskSettings.taskTemplatePath)
					.onChange(async (value) => {
						this.plugin.taskSettings.taskTemplatePath = value.trim();
						await this.plugin.saveSettings();
					});
			});

		// ── Status bar ──────────────────────────────────────────────────────
		new Setting(containerEl).setName("Status bar").setHeading();

		let dotsCountSetting: Setting;
		let maxItemsSetting: Setting;

		new Setting(containerEl)
			.setName("Display mode")
			.setDesc("How items are shown in the status bar breadcrumb.")
			.addDropdown((drop) => {
				drop.addOption("filenames", "File names");
				drop.addOption("dots", "Dots");
				drop.setValue(this.plugin.taskSettings.statusBarDisplayMode);
				drop.onChange(async (value) => {
					this.plugin.taskSettings.statusBarDisplayMode = value as "filenames" | "dots";
					await this.plugin.saveSettings();
					dotsCountSetting.settingEl.toggle(value === "dots");
					maxItemsSetting.settingEl.toggle(value === "filenames");
				});
			});

		dotsCountSetting = new Setting(containerEl)
			.setName("Visible dots")
			.setDesc("Maximum number of dots shown at once. The window stays centered on the current task.")
			.addSlider((slider) =>
				slider
					.setLimits(3, 15, 2)
					.setValue(this.plugin.taskSettings.statusBarDotsCount)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.taskSettings.statusBarDotsCount = value;
						await this.plugin.saveSettings();
					})
			);

		dotsCountSetting.settingEl.toggle(this.plugin.taskSettings.statusBarDisplayMode === "dots");

		maxItemsSetting = new Setting(containerEl)
			.setName("Max visible items")
			.setDesc("Number of chain items shown before the bar scrolls horizontally. Increase for wider bars, decrease for a more compact bar.")
			.addSlider((slider) =>
				slider
					.setLimits(2, 20, 1)
					.setValue(this.plugin.taskSettings.statusBarMaxItems)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.taskSettings.statusBarMaxItems = value;
						await this.plugin.saveSettings();
					})
			);

		maxItemsSetting.settingEl.toggle(this.plugin.taskSettings.statusBarDisplayMode === "filenames");

		new Setting(containerEl)
			.setName("Chain bar position")
			.setDesc("Where the chain breadcrumb bar appears at the bottom of the screen.")
			.addDropdown((drop) => {
				drop.addOption("left", "Left");
				drop.addOption("center", "Center");
				drop.addOption("right", "Right (next to status bar)");
				drop.setValue(this.plugin.taskSettings.chainBarPosition);
				drop.onChange(async (value) => {
					this.plugin.taskSettings.chainBarPosition = value as ChainBarPosition;
					await this.plugin.saveSettings();
				});
			});

		// ── Checkbox icons ───────────────────────────────────────────────────
		new Setting(containerEl).setName("Checkbox icons").setHeading();
		containerEl.createEl("p", {
			text: "Replace standard checkboxes in reading view with styled icon characters. Click an icon to cycle through statuses.",
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName("Enable checkbox icons")
			.setDesc("Show custom icon characters instead of native checkboxes in reading view.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.taskSettings.enableCheckboxIcons).onChange(async (value) => {
					this.plugin.taskSettings.enableCheckboxIcons = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		if (this.plugin.taskSettings.enableCheckboxIcons) {
			this.renderCheckboxStatusList(containerEl);
		}

		// ── Chain schemas ────────────────────────────────────────────────────
		new Setting(containerEl).setName("Chain schemas").setHeading();
		containerEl.createEl("p", {
			text: "Each schema defines a set of frontmatter keys for one chain type. A note participates in a chain by having that schema's keys in its frontmatter.",
			cls: "setting-item-description",
		});

		this.plugin.taskSettings.chains.forEach((chain, idx) => {
			this.renderChainSchema(containerEl, chain, idx);
		});

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("Add chain schema")
				.setCta()
				.onClick(async () => {
					const newName = "New Chain";
					this.plugin.taskSettings.chains.push({
						name: newName,
						...derivedChainKeys(slugifyChainName(newName)),
						currentStatusValue: "current",
						completedStatusValue: "done",
						readyStatusValue: "ready",
					});
					await this.plugin.saveSettings();
					this.display();
				})
		);

		// ── Linear integration ───────────────────────────────────────────────
		new Setting(containerEl).setName("Linear integration").setHeading();

		new Setting(containerEl)
			.setName("Issue folder")
			.setDesc("Folder where imported linear issues are created.")
			.addText((text) =>
				text
					.setPlaceholder("Linear")
					.setValue(this.plugin.taskSettings.linearIssueFolder)
					.onChange(async (value) => {
						this.plugin.taskSettings.linearIssueFolder = value.trim() || "Linear";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Issue template")
			.setDesc(
				"Optional template file applied on top of imported linear issues. Its frontmatter is merged with the linear-managed frontmatter (linear keys take precedence); its body replaces the default note body. Supports {{title}}, {{identifier}}, {{url}}, {{status}}, {{priority}}, {{team}}."
			)
			.addText((text) => {
				new FileSuggest(this.app, text.inputEl);
				text
					.setPlaceholder("Templates/linear-issue-template.md")
					.setValue(this.plugin.taskSettings.linearTemplatePath)
					.onChange(async (value) => {
						this.plugin.taskSettings.linearTemplatePath = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Sync on open")
			.setDesc("Pull status updates from linear when Obsidian opens.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.taskSettings.linearSyncOnOpen).onChange(async (value) => {
					this.plugin.taskSettings.linearSyncOnOpen = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Auto-sync interval (minutes)")
			.setDesc("Poll linear for updates on this interval. Set to 0 to disable.")
			.addSlider((slider) =>
				slider
					.setLimits(0, 120, 15)
					.setValue(this.plugin.taskSettings.linearSyncIntervalMinutes)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.taskSettings.linearSyncIntervalMinutes = value;
						await this.plugin.saveSettings();
						this.plugin.rescheduleLinearSync();
					})
			);

		new Setting(containerEl).setName("Workspaces").setHeading();
		containerEl.createEl("p", {
			text: "Each workspace connects to one linear organization. You can use a personal API key (paste from linear → settings → API) or OAUTH.",
			cls: "setting-item-description",
		});

		const wsContainer = containerEl.createDiv({ cls: "linear-workspace-list" });
		this.renderWorkspaceList(wsContainer);

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("Add workspace")
				.setCta()
				.onClick(async () => {
					this.plugin.taskSettings.linearWorkspaces.push({
						id: `workspace-${Date.now()}`,
						name: "New Workspace",
						authType: "apiKey",
					});
					await this.plugin.saveSettings();
					this.display();
				})
		);

		if (scrollEl) scrollEl.scrollTop = scrollTop;
	}

	private renderChainSchema(
		containerEl: HTMLElement,
		chain: ChainDefinition,
		idx: number
	): void {
		const section = containerEl.createDiv({ cls: "chain-schema-section" });

		const headerEl = section.createDiv({ cls: "chain-schema-header" });
		const h3 = new Setting(headerEl).setName("").setHeading();

		const removeBtn = headerEl.createEl("button", {
			text: "Remove",
			cls: "chain-schema-remove-btn",
		});
		removeBtn.addEventListener("click", () => {
			this.plugin.taskSettings.chains.splice(idx, 1);
			void this.plugin.saveSettings().then(() => this.display());
		});

		// Refs to derived-key inputs so we can update them in-place when the name changes
		let idKeyInput: HTMLInputElement | null = null;
		let positionKeyInput: HTMLInputElement | null = null;
		let statusKeyInput: HTMLInputElement | null = null;

		const make = (name: string, desc: string, key: keyof ChainDefinition, placeholder: string) => {
			let inputRef: HTMLInputElement | null = null;
			new Setting(section)
				.setName(name)
				.setDesc(desc)
				.addText((text) => {
					text
						.setPlaceholder(placeholder)
						.setValue((chain[key] as string | undefined) ?? "")
						.onChange(async (value) => {
							(this.plugin.taskSettings.chains[idx] as unknown as Record<string, string | undefined>)[key] =
								value.trim() || undefined;
							await this.plugin.saveSettings();
						});
					inputRef = text.inputEl;
				});
			if (key === "idKey") idKeyInput = inputRef;
			else if (key === "positionKey") positionKeyInput = inputRef;
			else if (key === "statusKey") statusKeyInput = inputRef;
		};

		// Name field: auto-derives idKey/positionKey/statusKey unless they've been manually changed
		new Setting(section)
			.setName("Name")
			.setDesc("Display name for this chain schema.")
			.addText((text) =>
				text
					.setPlaceholder("My chain")
					.setValue(chain.name ?? "")
					.onChange(async (value) => {
						const c = this.plugin.taskSettings.chains[idx];
						if (!c) return;
						const oldSlug = slugifyChainName(c.name ?? "");
						const oldDerived = derivedChainKeys(oldSlug);
						const newSlug = slugifyChainName(value);
						const newDerived = derivedChainKeys(newSlug);
						// Auto-update each key only if it still matches the old derived value; update inputs in-place
						if (c.idKey === oldDerived.idKey) {
							c.idKey = newDerived.idKey;
							if (idKeyInput) idKeyInput.value = newDerived.idKey;
						}
						if (c.positionKey === oldDerived.positionKey) {
							c.positionKey = newDerived.positionKey;
							if (positionKeyInput) positionKeyInput.value = newDerived.positionKey;
						}
						if (c.statusKey === oldDerived.statusKey) {
							c.statusKey = newDerived.statusKey;
							if (statusKeyInput) statusKeyInput.value = newDerived.statusKey;
						}
						c.name = value.trim() || "New Chain";
						// Update header in-place — no full re-render needed
						h3.setName(c.name);
						await this.plugin.saveSettings();
					})
			);
		make("ID key", "Frontmatter key that holds the chain identifier.", "idKey", "chain");
		make("Position key", "Frontmatter key for the numeric position within the chain.", "positionKey", "chain-position");
		make("Status key", "Frontmatter key for the task's status within this chain.", "statusKey", "chain-status");
		make("Current status value", "The value that marks a task as current in this chain.", "currentStatusValue", "current");
		make("Completed status value", "The value written to a task's status key when it is marked done.", "completedStatusValue", "done");
		make("In progress status value", "Optional. The value that marks a task as in progress (shows a half-filled circle). Leave empty to disable.", "inProgressStatusValue", "in-progress");

		section.createEl("p", {
			text: "Item creation (optional) — overrides global task settings when creating new items via this chain.",
			cls: "setting-item-description",
		});
		make("Item folder", "Folder where new items are created. Leave empty to use the vault root.", "itemFolder", "Issues");
		make("Item template", "Template file path for new items. Leave empty to use the global task template.", "itemTemplatePath", "Templates/issue-template.md");
		make("Item frontmatter key", "Frontmatter key added to new items (e.g. type). Leave empty to use the global setting.", "itemFrontmatterKey", "type");
		make("Item frontmatter value", "Value for the frontmatter key above (e.g. issue).", "itemFrontmatterValue", "issue");

		section.createEl("p", {
			text: "Completion routing (optional) — when set, advancing past a task in this chain automatically appends it to the target chain.",
			cls: "setting-item-description",
		});

		new Setting(section)
			.setName("Completion chain")
			.setDesc("The ID key of another chain schema to append completed tasks to. Leave empty to disable.")
			.addDropdown((drop) => {
				drop.addOption("", "— none —");
				for (const other of this.plugin.taskSettings.chains) {
					if (other.idKey !== chain.idKey) {
						drop.addOption(other.idKey, `${other.name} (${other.idKey})`);
					}
				}
				drop.setValue(chain.completionChainIdKey ?? "");
				drop.onChange(async (value) => {
					const c = this.plugin.taskSettings.chains[idx];
					if (c) c.completionChainIdKey = value || undefined;
					await this.plugin.saveSettings();
				});
			});

		// ── Linear workspace binding ─────────────────────────────────────────
		section.createEl("p", {
			text: "Linear (optional) — bind this chain to a specific linear workspace. The linear panel will default to that workspace when this chain is active.",
			cls: "setting-item-description",
		});

		new Setting(section)
			.setName("Linear workspace")
			.setDesc("Restrict this chain's linear panel to one workspace, or leave unset to allow mixed workspaces.")
			.addDropdown((drop) => {
				drop.addOption("", "— any workspace —");
				for (const ws of this.plugin.taskSettings.linearWorkspaces) {
					drop.addOption(ws.id, ws.name);
				}
				drop.setValue(chain.linearWorkspaceId ?? "");
				drop.onChange(async (value) => {
					const c = this.plugin.taskSettings.chains[idx];
					if (c) c.linearWorkspaceId = value || undefined;
					await this.plugin.saveSettings();
				});
			});

		// ── Auto-populate ────────────────────────────────────────────────────
		section.createEl("p", {
			text: "Auto-populate (optional) — automatically add vault files that match frontmatter rules to this chain. Run via the 'auto-populate chains' command.",
			cls: "setting-item-description",
		});

		new Setting(section)
			.setName("Auto-populate enabled")
			.setDesc("When enabled, the 'auto-populate chains' command will scan the vault and add matching files to this chain.")
			.addToggle((toggle) =>
				toggle.setValue(chain.autoPopulateEnabled ?? false).onChange(async (value) => {
					const c = this.plugin.taskSettings.chains[idx];
					if (c) c.autoPopulateEnabled = value || undefined;
					await this.plugin.saveSettings();
				})
			);

		this.renderRuleList(
			section,
			idx,
			"Include rules",
			"Files must match ALL of these rules to be added. At least one rule is required.",
			"autoPopulateInclude"
		);

		this.renderRuleList(
			section,
			idx,
			"Exclude rules",
			"Files matching ANY of these rules are skipped even if they match include rules.",
			"autoPopulateExclude"
		);
	}

	private renderRuleList(
		containerEl: HTMLElement,
		chainIdx: number,
		label: string,
		desc: string,
		field: "autoPopulateInclude" | "autoPopulateExclude"
	): void {
		const chain = this.plugin.taskSettings.chains[chainIdx];
		if (!chain) return;

		const wrapper = containerEl.createDiv({ cls: "chain-rule-list" });
		wrapper.createEl("p", { text: label, cls: "setting-item-name" });
		wrapper.createEl("p", { text: desc, cls: "setting-item-description" });

		const listEl = wrapper.createDiv({ cls: "chain-rule-rows" });

		const refresh = () => {
			listEl.empty();
			const currentRules: FrontmatterRule[] = this.plugin.taskSettings.chains[chainIdx]?.[field] ?? [];
			currentRules.forEach((rule, ruleIdx) => {
				const row = listEl.createDiv({ cls: "chain-rule-row" });

				const keyInput = row.createEl("input", {
					type: "text",
					placeholder: "frontmatter key",
					cls: "chain-rule-input",
				});
				keyInput.value = rule.key;
				keyInput.addEventListener("change", () => {
					const c = this.plugin.taskSettings.chains[chainIdx];
					if (c) {
						if (!c[field]) c[field] = [];
						c[field][ruleIdx].key = keyInput.value.trim();
						void this.plugin.saveSettings();
					}
				});

				const valInput = row.createEl("input", {
					type: "text",
					placeholder: "value (empty = key exists)",
					cls: "chain-rule-input",
				});
				valInput.value = rule.value ?? "";
				valInput.addEventListener("change", () => {
					const c = this.plugin.taskSettings.chains[chainIdx];
					if (c) {
						if (!c[field]) c[field] = [];
						const trimmed = valInput.value.trim();
						c[field][ruleIdx].value = trimmed || undefined;
						void this.plugin.saveSettings();
					}
				});

				const removeBtn = row.createEl("button", { text: "×", cls: "chain-rule-remove" });
				removeBtn.setAttribute("aria-label", "Remove rule");
				removeBtn.addEventListener("click", () => {
					const c = this.plugin.taskSettings.chains[chainIdx];
					if (c) {
						c[field] = (c[field] ?? []).filter((_, i) => i !== ruleIdx);
						void this.plugin.saveSettings().then(refresh);
					}
				});
			});
		};

		refresh();

		const addBtn = wrapper.createEl("button", { text: "+ add rule", cls: "chain-rule-add" });
		addBtn.addEventListener("click", () => {
			const c = this.plugin.taskSettings.chains[chainIdx];
			if (c) {
				if (!c[field]) c[field] = [];
				c[field].push({ key: "" });
				void this.plugin.saveSettings().then(refresh);
			}
		});
	}

	// ── Checkbox status list ─────────────────────────────────────────────────

	private renderCheckboxStatusList(containerEl: HTMLElement): void {
		const wrapper = containerEl.createDiv({ cls: "chain-rule-list checkbox-status-list" });
		wrapper.createEl("p", { text: "Status cycle", cls: "setting-item-name" });
		wrapper.createEl("p", {
			text: "Each row is one step in the click cycle. Mark is the character inside [ ]. For custom marks without a built-in icon, set a fallback text character in the icon field.",
			cls: "setting-item-description",
		});

		const listEl = wrapper.createDiv({ cls: "chain-rule-rows" });

		const refresh = () => {
			listEl.empty();
			const statuses = this.plugin.taskSettings.checkboxStatuses;
			statuses.forEach((status, idx) => {
				const row = listEl.createDiv({ cls: "chain-rule-row checkbox-status-row" });

				// Icon preview (rendered SVG or fallback text — not an input)
				const preview = buildIconEl(status.mark, statuses, "checkbox-status-preview");
				row.appendChild(preview);

				// Mark input
				const markInput = row.createEl("input", {
					type: "text",
					placeholder: "mark",
					cls: "chain-rule-input checkbox-status-mark",
				});
				markInput.value = status.mark;
				markInput.addEventListener("change", () => {
					this.plugin.taskSettings.checkboxStatuses[idx].mark = markInput.value;
					void (async () => {
						await this.plugin.saveSettings();
						// Refresh so the icon preview updates to match the new mark
						refresh();
					})();
				});

				// Label input
				const labelInput = row.createEl("input", {
					type: "text",
					placeholder: "label",
					cls: "chain-rule-input",
				});
				labelInput.value = status.label;
				labelInput.addEventListener("change", () => {
					this.plugin.taskSettings.checkboxStatuses[idx].label = labelInput.value;
					void this.plugin.saveSettings();
				});

				// Remove button
				const removeBtn = row.createEl("button", { text: "×", cls: "chain-rule-remove" });
				removeBtn.setAttribute("aria-label", "Remove status");
				removeBtn.addEventListener("click", () => {
					this.plugin.taskSettings.checkboxStatuses.splice(idx, 1);
					void (async () => {
						await this.plugin.saveSettings();
						refresh();
					})();
				});
			});
		};

		refresh();

		const addBtn = wrapper.createEl("button", { text: "+ add status", cls: "chain-rule-add" });
		addBtn.addEventListener("click", () => {
			this.plugin.taskSettings.checkboxStatuses.push({ mark: "", icon: "", label: "" });
			void (async () => {
				await this.plugin.saveSettings();
				refresh();
			})();
		});

		const resetBtn = wrapper.createEl("button", { text: "Reset to defaults", cls: "chain-rule-add" });
		resetBtn.addClass("chain-rule-reset-btn");
		resetBtn.addEventListener("click", () => {
			this.plugin.taskSettings.checkboxStatuses = [...DEFAULT_CHECKBOX_STATUSES];
			void (async () => {
				await this.plugin.saveSettings();
				refresh();
			})();
		});
	}

	private renderWorkspaceList(container: HTMLElement): void {
		container.empty();
		const workspaces = this.plugin.taskSettings.linearWorkspaces;

		if (workspaces.length === 0) {
			container.createEl("p", {
				cls: "setting-item-description",
				text: "No workspaces configured yet.",
			});
			return;
		}

		workspaces.forEach((ws, idx) => {
			const section = container.createDiv({ cls: "linear-workspace-section" });

			const header = section.createDiv({ cls: "chain-schema-header" });
			new Setting(header).setName("").setHeading();
			const removeBtn = header.createEl("button", { text: "Remove", cls: "chain-schema-remove-btn" });
			removeBtn.addEventListener("click", () => {
				this.plugin.taskSettings.linearWorkspaces.splice(idx, 1);
				void (async () => {
					await this.plugin.saveSettings();
					this.plugin.linearManager?.refreshClients();
					this.display();
				})();
			});

			// Workspace ID
			new Setting(section)
				.setName("ID")
				.setDesc("Short slug used as the frontmatter key (e.g. \"acme\"). Cannot be changed after importing issues.")
				.addText((text) =>
					text
						.setPlaceholder("Acme")
						.setValue(ws.id)
						.onChange(async (value) => {
							this.plugin.taskSettings.linearWorkspaces[idx].id = value.trim() || ws.id;
							await this.plugin.saveSettings();
						})
				);

			// Display name
			new Setting(section)
				.setName("Name")
				.setDesc("Display name shown in the linear panel.")
				.addText((text) =>
					text
						.setPlaceholder("Acme corp")
						.setValue(ws.name)
						.onChange(async (value) => {
							this.plugin.taskSettings.linearWorkspaces[idx].name = value.trim() || "Workspace";
							await this.plugin.saveSettings();
						})
				);

			// Auth type
			new Setting(section)
				.setName("Auth type")
				.setDesc("How to authenticate with this workspace.")
				.addDropdown((drop) => {
					drop.addOption("apiKey", "Personal API key");
					drop.addOption("oauth", "OAUTH");
					drop.setValue(ws.authType);
					drop.onChange(async (value) => {
						this.plugin.taskSettings.linearWorkspaces[idx].authType = value as "apiKey" | "oauth";
						await this.plugin.saveSettings();
						this.plugin.linearManager?.refreshClients();
						this.display();
					});
				});

			if (ws.authType === "apiKey") {
				new Setting(section)
					.setName("API key")
					.setDesc("Personal API key from linear → settings → API.")
					.addText((text) => {
						text.inputEl.type = "password";
						text
							.setPlaceholder("Lin_API_…")
							.setValue(ws.apiKey ?? "")
							.onChange(async (value) => {
								this.plugin.taskSettings.linearWorkspaces[idx].apiKey = value.trim() || undefined;
								await this.plugin.saveSettings();
								this.plugin.linearManager?.refreshClients();
							});
					});
			} else {
				// OAuth
				const oauthSetting = new Setting(section)
					.setName("OAUTH")
					.setDesc(
						ws.oauthToken
							? "Connected. Click to reconnect."
							: "Not connected. Click to start the OAuth flow."
					);
				oauthSetting.addButton((btn) => {
					btn.setButtonText(ws.oauthToken ? "Reconnect" : "Connect with Linear");
					if (ws.oauthToken) btn.setDestructive();
					else btn.setCta();
					btn.onClick(() => {
						this.plugin.startLinearOAuth(ws.id);
					});
				});
				if (ws.oauthToken) {
					oauthSetting.addButton((btn) =>
						btn
							.setButtonText("Disconnect")
							.setDestructive()
							.onClick(async () => {
								this.plugin.taskSettings.linearWorkspaces[idx].oauthToken = undefined;
								this.plugin.taskSettings.linearWorkspaces[idx].oauthRefreshToken = undefined;
								await this.plugin.saveSettings();
								this.plugin.linearManager?.refreshClients();
								this.display();
							})
					);
				}
			}

			// Verify connection button
			new Setting(section).addButton((btn) =>
				btn
					.setButtonText("Test connection")
					.onClick(async () => {
						const client = this.plugin.linearManager?.getClient(ws.id);
						if (!client) {
							new (await import("obsidian")).Notice(
								"No credentials configured for this workspace."
							);
							return;
						}
						try {
							const name = await client.getOrganizationName();
							new (await import("obsidian")).Notice(`Connected to "${name}" ✓`);
						} catch (err) {
							new (await import("obsidian")).Notice(`Connection failed: ${String(err)}`);
						}
					})
			);
		});
	}
}
