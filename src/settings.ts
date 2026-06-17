import { App, PluginSettingTab } from "obsidian";
import type ManagerPlugin from "./main";
import {
	TimeManagerSettings,
	TimeManagerSettingTab,
	DEFAULT_SETTINGS as TIME_DEFAULTS,
} from "./time-settings";
import {
	TaskToolsSettings,
	TaskToolsSettingTab,
	DEFAULT_SETTINGS as TASK_DEFAULTS,
} from "./tasks/settings";

export type { TimeManagerSettings, TaskToolsSettings };
export {
	TIME_DEFAULTS,
	TASK_DEFAULTS,
};

export interface ManagerSettings {
	tasks: TaskToolsSettings;
	time: TimeManagerSettings;
}

export const DEFAULT_MANAGER_SETTINGS: ManagerSettings = {
	tasks: TASK_DEFAULTS,
	time: TIME_DEFAULTS,
};

export class ManagerSettingTab extends PluginSettingTab {
	private taskTab: TaskToolsSettingTab;
	private timeTab: TimeManagerSettingTab;

	constructor(app: App, plugin: ManagerPlugin) {
		super(app, plugin);
		this.taskTab = new TaskToolsSettingTab(app, plugin);
		this.timeTab = new TimeManagerSettingTab(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Time" });
		this.timeTab.containerEl = containerEl;
		this.timeTab.display();

		containerEl.createEl("h2", { text: "Tasks" });
		this.taskTab.containerEl = containerEl;
		this.taskTab.display();
	}

	hide(): void {
		this.timeTab.hide?.();
		this.taskTab.hide?.();
	}
}
