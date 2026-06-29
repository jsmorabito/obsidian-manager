import { App, SettingPage } from "obsidian";
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
export type { NLDatesSettings } from "./time-settings";
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

class TaskSettingPage extends SettingPage {
	private taskTab: TaskToolsSettingTab;

	constructor(app: App, plugin: ManagerPlugin) {
		super();
		this.title = "Tasks";
		this.taskTab = new TaskToolsSettingTab(app, plugin);
	}

	display(): void {
		this.taskTab.containerEl = this.containerEl;
		this.taskTab.display();
	}
}

export class ManagerSettingTab extends TimeManagerSettingTab {
	private app2: App;
	private plugin2: ManagerPlugin;

	constructor(app: App, plugin: ManagerPlugin) {
		super(app, plugin);
		this.app2 = app;
		this.plugin2 = plugin;
	}

	getSettingDefinitions() {
		return [
			...super.getSettingDefinitions(),
			{
				type: "page" as const,
				name: "Tasks",
				desc: "Task tracking, chains, and Linear integration.",
				page: () => new TaskSettingPage(this.app2, this.plugin2),
			},
		];
	}
}
