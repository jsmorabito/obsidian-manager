/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion */
import "./obsidian-augmentations";
import { App, Editor, MarkdownView, Menu, Modal, Notice, Plugin, Setting, TFile, WorkspaceLeaf, addIcon, moment, setIcon, setTooltip } from "obsidian";
import {
	ManagerSettings,
	DEFAULT_MANAGER_SETTINGS,
	ManagerSettingTab,
	TaskToolsSettings,
} from "./settings";
import {
	TimeManagerSettings,
} from "./time-settings";
import {
	derivedChainKeys,
	slugifyChainName,
} from "./tasks/settings";
import { NLDatesModule } from "./nldates/module";
import { registerNLDateCommands } from "./nldates/commands";
import DateSuggest from "./nldates/suggest";
import { handleNLDateURI } from "./nldates/uri-handler";
import type { Granularity, PeriodicConfig } from "./periodic/types";
import { granularities } from "./periodic/types";
import { registerPeriodicIcons } from "./periodic/icons";
import {
	ensureTodaysDailyNote,
	registerPeriodicCommands,
} from "./periodic/commands";
import { openPeriodicNote } from "./periodic/api";
import { createPeriodicTriggerProvider } from "./periodic/trigger-provider";
import { createDateTriggerProvider } from "./nldates/trigger-provider";
import { TIME_MANAGER_EDITOR_VIEW, DailyNoteView } from "./editor/view";
import { registerFileMenuHandlers } from "./editor/file-menu";
import { installWorkspacePatches } from "./editor/workspace-patches";
import { TIME_MANAGER_TIMELINE_VIEW, TimelineView } from "./periodic/timeline-view";
import { registerQuickSwitchers } from "./periodic/switcher";
import { maybeMigrateFromDailyNotesCore } from "./periodic/migrate";
import { registerLeafNavActions } from "./periodic/nav-actions";
import { TIME_MANAGER_SESSIONS_VIEW, SessionsView } from "./sessions/view";
import { SessionManager } from "./sessions/session-manager";
import {
	VIEW_TYPE_RECENTLY_VIEWED,
	RecentlyViewedView,
} from "./recently-viewed/view";
import { CalendarService } from "./calendar/calendar-service";
import { TIME_MANAGER_AGENDA_VIEW, AgendaView } from "./calendar/AgendaView";
import { TIME_MANAGER_CALENDAR_VIEW, CalendarView } from "./calendar/CalendarView";
import { TIME_MANAGER_INBOX_VIEW, InboxView } from "./inbox/view";
import { registerInboxCommands, addInboxFileMenuItem } from "./inbox/commands";
import { InboxService } from "./editor/InboxService";
import { TargetDateService } from "./target-date/target-date-service";
import { TargetDateModal } from "./target-date/TargetDateModal";
import { ReminderService } from "./reminders/ReminderService";
import { ReminderChipManager } from "./reminders/ReminderChipManager";
import { CHAIN_VIEW_TYPE, ChainView, QuickAddFileModal } from "./tasks/chainView";
import { NewTaskModal } from "./tasks/newTaskModal";
import { ChainSuggestModal } from "./tasks/chainSuggestModal";
import type { ChainDefinition, ChainItem, FrontmatterRule } from "./tasks/types";
import { LinearManager } from "./tasks/linear/manager";
import { LINEAR_VIEW_TYPE, LinearView } from "./tasks/linear/linearView";
import { applyCheckboxIcons, DEFAULT_CHECKBOX_STATUSES, HALF_CIRCLE_SVG } from "./tasks/checkboxIcons";
import { checkboxIconsEditorExtension } from "./tasks/checkboxIconsEditor";

const COMPLETED_DATE_KEY = "completedDate";

// ── Task-only modals ─────────────────────────────────────────────────────────

class NewBlankFileModal extends Modal {
	private plugin: ManagerPlugin;
	private chain: ChainDefinition;
	private name = "";

	constructor(plugin: ManagerPlugin, chain: ChainDefinition) {
		super(plugin.app);
		this.plugin = plugin;
		this.chain = chain;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "New file" });
		new Setting(contentEl).setName("File name").addText((text) => {
			text.setPlaceholder("My new file").onChange((v) => { this.name = v.trim(); });
			text.inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void this.submit(); } });
			setTimeout(() => text.inputEl.focus(), 0);
		});
		new Setting(contentEl).addButton((btn) => btn.setButtonText("Create").setCta().onClick(() => void this.submit()));
	}

	onClose(): void { this.contentEl.empty(); }

	private async submit(): Promise<void> {
		if (!this.name) { new Notice("File name is required."); return; }
		const folder = this.chain.itemFolder ?? this.plugin.taskSettings.taskFolder ?? "";
		const dir = folder ? `${folder}/` : "";
		const path = `${dir}${this.name}.md`;
		try {
			const file = await this.plugin.app.vault.create(path, "");
			await this.plugin.addFileToChain(file, this.chain);
			this.close();
		} catch (err) {
			new Notice(`Could not create file: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}

class ChainMultiSelectModal extends Modal {
	private chains: ChainDefinition[];
	private onConfirm: (selected: ChainDefinition[]) => Promise<void>;
	private selected: Set<string> = new Set();

	constructor(app: App, chains: ChainDefinition[], onConfirm: (selected: ChainDefinition[]) => Promise<void>) {
		super(app);
		this.chains = chains;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Remove from chain" });
		contentEl.createEl("p", { text: "Select the chain(s) to remove this file from.", cls: "chain-create-modal-desc" });
		let confirmBtn: HTMLButtonElement;
		for (const chain of this.chains) {
			const row = contentEl.createDiv({ cls: "chain-multiselect-row" });
			const checkbox = row.createEl("input", { type: "checkbox" });
			checkbox.id = `chain-ms-${chain.idKey}`;
			row.createEl("label", { text: chain.name, attr: { for: checkbox.id } });
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) this.selected.add(chain.idKey);
				else this.selected.delete(chain.idKey);
				confirmBtn.disabled = this.selected.size === 0;
			});
		}
		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText("Remove").setCta().setDisabled(true);
				confirmBtn = btn.buttonEl;
				btn.onClick(async () => { const selected = this.chains.filter((c) => this.selected.has(c.idKey)); this.close(); await this.onConfirm(selected); });
			})
			.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
	}

	onClose(): void { this.contentEl.empty(); }
}

class CreateChainModal extends Modal {
	private onSubmit: (name: string) => Promise<void>;

	constructor(app: App, onSubmit: (name: string) => Promise<void>) { super(app); this.onSubmit = onSubmit; }

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Create a chain" });
		contentEl.createEl("p", { text: "Give your chain a name.", cls: "chain-create-modal-desc" });
		let nameValue = "";
		new Setting(contentEl).setName("Chain name").addText((text) => {
			text.setPlaceholder("E.g. Project alpha");
			text.onChange((v) => { nameValue = v; });
			setTimeout(() => text.inputEl.focus(), 0);
			text.inputEl.addEventListener("keydown", async (e: KeyboardEvent) => { if (e.key === "Enter" && nameValue.trim()) { this.close(); await this.onSubmit(nameValue.trim()); } });
		});
		new Setting(contentEl).addButton((btn) => btn.setButtonText("Create").setCta().onClick(async () => { if (!nameValue.trim()) return; this.close(); await this.onSubmit(nameValue.trim()); }));
	}

	onClose(): void { this.contentEl.empty(); }
}

class LinearPushStateModal extends Modal {
	private onSubmit: (stateName: string) => Promise<void>;

	constructor(app: App, onSubmit: (stateName: string) => Promise<void>) { super(app); this.onSubmit = onSubmit; }

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Push status to linear" });
		let value = "";
		new Setting(contentEl).setName("State name").addText((text) => {
			text.setPlaceholder("In progress");
			text.onChange((v) => { value = v; });
			setTimeout(() => text.inputEl.focus(), 0);
			text.inputEl.addEventListener("keydown", async (e: KeyboardEvent) => { if (e.key === "Enter" && value.trim()) { this.close(); await this.onSubmit(value.trim()); } });
		});
		new Setting(contentEl).addButton((btn) => btn.setButtonText("Push").setCta().onClick(async () => { if (!value.trim()) return; this.close(); await this.onSubmit(value.trim()); }));
	}

	onClose(): void { this.contentEl.empty(); }
}

class LinearOAuthModal extends Modal {
	private workspaceId: string;
	private onToken: (token: string) => Promise<void>;

	constructor(app: App, workspaceId: string, onToken: (token: string) => Promise<void>) { super(app); this.workspaceId = workspaceId; this.onToken = onToken; }

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Connect linear workspace" });
		contentEl.createEl("p", { text: "Paste a personal API key or OAuth access token.", cls: "chain-create-modal-desc" });
		let token = "";
		new Setting(contentEl).setName("Access token").addText((text) => {
			text.inputEl.type = "password";
			text.setPlaceholder("Lin_API_…");
			text.onChange((v) => { token = v; });
			setTimeout(() => text.inputEl.focus(), 0);
		});
		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText("Connect").setCta().onClick(async () => { if (!token.trim()) return; this.close(); await this.onToken(token.trim()); }))
			.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
	}

	onClose(): void { this.contentEl.empty(); }
}

// ── Main plugin class ─────────────────────────────────────────────────────────

export default class ManagerPlugin extends Plugin {
	settings!: ManagerSettings;

	// Time-tools services
	sessionManager!: SessionManager;
	nlDates!: NLDatesModule;
	calendarService!: CalendarService;
	inboxService!: InboxService;
	targetDateService!: TargetDateService;
	reminderService!: ReminderService;
	reminderChipManager!: ReminderChipManager;
	dateSuggest!: DateSuggest;
	private _registeredWithObjects: unknown = null;
	private editorRibbon: HTMLElement | null = null;
	private dailyRibbon: HTMLElement | null = null;
	private inboxRibbon: HTMLElement | null = null;
	private lastCheckedDay = moment().format("YYYY-MM-DD");

	// Task-tools state
	linearManager: LinearManager | null = null;
	private chainStatusBarItem!: HTMLElement;
	private statusBarObserver: ResizeObserver | null = null;
	private linearSyncIntervalId: number | null = null;
	private mainEditorFile: TFile | null = null;
	private chainIndex: Map<string, Set<string>> = new Map();

	/** Task-specific settings — used by task sub-files via this getter. */
	get taskSettings(): TaskToolsSettings { return this.settings.tasks; }

	// PeriodicResolver implementation for time-tools sub-modules.
	getConfig(granularity: Granularity): PeriodicConfig {
		return this.settings.time[granularity];
	}

	async onload(): Promise<void> {
		await this.loadSettings();

		// ── Time-tools ───────────────────────────────────────────────────────
		registerPeriodicIcons();
		this.inboxService = new InboxService(this.app);
		this.targetDateService = new TargetDateService(this.app);
		this.reminderService = new ReminderService(this.app);
		this.reminderChipManager = new ReminderChipManager(this.app, this.reminderService);
		this.calendarService = new CalendarService(this);
		this.sessionManager = new SessionManager(this);

		this.addSettingTab(new ManagerSettingTab(this.app, this));

		installWorkspacePatches(this);

		this.registerView(TIME_MANAGER_EDITOR_VIEW, (leaf: WorkspaceLeaf) => new DailyNoteView(leaf, this));
		this.registerView(TIME_MANAGER_TIMELINE_VIEW, (leaf: WorkspaceLeaf) => new TimelineView(leaf, this));
		this.registerView(TIME_MANAGER_SESSIONS_VIEW, (leaf: WorkspaceLeaf) => new SessionsView(leaf, this));
		this.registerView(VIEW_TYPE_RECENTLY_VIEWED, (leaf: WorkspaceLeaf) => new RecentlyViewedView(leaf, this));
		this.registerView(TIME_MANAGER_INBOX_VIEW, (leaf: WorkspaceLeaf) => new InboxView(leaf, this));
		this.registerView(TIME_MANAGER_AGENDA_VIEW, (leaf: WorkspaceLeaf) => new AgendaView(leaf, this));
		this.registerView(TIME_MANAGER_CALENDAR_VIEW, (leaf: WorkspaceLeaf) => new CalendarView(leaf, this));

		registerPeriodicCommands(this);
		registerQuickSwitchers(this);
		registerLeafNavActions(this);
		registerInboxCommands(this);

		this.nlDates = new NLDatesModule(this);
		registerNLDateCommands(this, this.nlDates);
		this.dateSuggest = new DateSuggest(this.app, this.nlDates);
		this.registerEditorSuggest(this.dateSuggest);
		if (this.settings.time.nlDates.uriHandlerEnabled) {
			this.registerObsidianProtocolHandler("time-tools", (params) => void handleNLDateURI(this.nlDates, params));
		}

		this.addCommand({ id: "open-multi-note-editor", name: "Open timeline view", callback: () => this.openEditorView() });
		this.addCommand({ id: "open-new-time-note-view", name: "Open new time note view", callback: () => this.openNewEditorView() });
		this.addCommand({ id: "open-timeline-sidebar", name: "Open timeline sidebar", callback: () => this.openTimelineView() });
		this.addCommand({ id: "open-calendar-view", name: "Open calendar", callback: () => void this.openCalendarView() });
		this.addCommand({ id: "open-new-calendar-view", name: "Open new calendar in new tab", callback: () => void this.openNewCalendarView() });
		this.addCommand({ id: "open-agenda-view", name: "Open agenda panel", callback: () => void this.openAgendaView() });
		this.addCommand({ id: "open-sessions-view", name: "Open sessions view", callback: () => this.openSessionsView() });
		this.addCommand({
			id: "open-recently-viewed",
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			name: "Open Recently Viewed panel",
			callback: () => this.openRecentlyViewedPanel(),
		});

		this.registerEvent(this.app.workspace.on("file-open", (file) => {
			if (file instanceof TFile) this.trackRecentFile(file);
			this.refreshReminderChip();
		}));
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
			this.refreshReminderChip();
		}));
		this.applyBodyClasses();
		this.configureRibbons();
		addInboxFileMenuItem(this);
		this.registerEvent(this.app.metadataCache.on("changed", (changedFile) => {
			this.refreshAgendaViews();
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view?.file && changedFile.path === view.file.path) {
				this.refreshReminderChip();
			}
		}));
		this.app.workspace.onLayoutReady(() => this.refreshReminderChip());
		registerFileMenuHandlers(this);
		this.registerInterval(window.setInterval(this.checkDayChange.bind(this), 1000 * 60 * 15));
		this.registerEvent(this.app.workspace.on("layout-change", () => this._registerObjectsTrigger()));
		this.registerInterval(window.setInterval(() => this.refreshInboxView(), 1000 * 60));
		this.registerInterval(window.setInterval(() => this.checkReminders(), 1000 * 60));

		// ── Task-tools ───────────────────────────────────────────────────────
		addIcon("linear-logo", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 96 320 320" fill="none"><path fill="currentColor" d="M357.358 374.306c1.758 1.758 4.581 1.866 6.416.189a163.595 163.595 0 0 0 5.316-5.081c62.547-62.547 62.547-163.956 0-226.504-62.548-62.547-163.957-62.547-226.504 0a163.595 163.595 0 0 0-5.081 5.316c-1.677 1.835-1.569 4.658.189 6.416l219.664 219.664Z"/><path fill="currentColor" d="M336.333 394.672c2.627-1.528 3.024-5.118.875-7.267L124.595 174.792c-2.149-2.149-5.739-1.752-7.267.875a158.87 158.87 0 0 0-7.119 13.725c-.811 1.771-.41 3.852.968 5.229l206.201 206.202c1.378 1.378 3.459 1.779 5.23.968a158.87 158.87 0 0 0 13.725-7.119Z"/><path fill="currentColor" d="M286.659 413.348c3.619-.707 4.86-5.136 2.253-7.743L106.395 223.088c-2.607-2.607-7.036-1.366-7.743 2.253a160.813 160.813 0 0 0-2.502 18.462 4.666 4.666 0 0 0 1.366 3.654l167.027 167.027a4.667 4.667 0 0 0 3.654 1.366 160.834 160.834 0 0 0 18.462-2.502Z"/><path fill="currentColor" d="M217.031 411.577c4.45 1.107 7.201-4.155 3.959-7.398L107.821 291.01c-3.243-3.242-8.504-.491-7.398 3.959 6.784 27.279 20.838 53.121 42.163 74.445 21.324 21.324 47.166 35.379 74.445 42.163Z"/></svg>`);

		this.linearManager = new LinearManager(this.app, () => this.settings.tasks, () => this.saveSettings());
		this.linearManager.refreshClients();

		this.registerView(LINEAR_VIEW_TYPE, (leaf) => new LinearView(leaf, this, this.linearManager!));
		this.registerView(CHAIN_VIEW_TYPE, (leaf) => new ChainView(leaf, this));

		this.addRibbonIcon("link", "Open chain view", () => void this.openChainView());
		this.addRibbonIcon("linear-logo", "Open linear panel", () => void this.openLinearView());

		this.chainStatusBarItem = document.body.createDiv({ cls: "chain-status-bar-item" });
		setTooltip(this.chainStatusBarItem, "Click to switch chain", { delay: 0, placement: "top" });
		this.chainStatusBarItem.addEventListener("click", () => this.openStatusBarChainPicker());
		this.register(() => this.chainStatusBarItem.remove());
		this.renderChainBreadcrumb();

		this.app.workspace.onLayoutReady(() => this.setupStatusBarObserver());
		const onResize = () => this.positionChainBar();
		window.addEventListener("resize", onResize);
		this.register(() => window.removeEventListener("resize", onResize));

		this.registerEvent(this.app.metadataCache.on("changed", (file) => { this.updateIndexForFile(file); this.renderChainBreadcrumb(); }));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
			if (file instanceof TFile) { this.removeFileFromIndex(oldPath); this.updateIndexForFile(file); this.renderChainBreadcrumb(); }
		}));
		this.registerEvent(this.app.vault.on("delete", (file) => {
			if (file instanceof TFile) { this.removeFileFromIndex(file.path); this.renderChainBreadcrumb(); }
		}));
		this.registerEvent(this.app.workspace.on("file-open", (file) => { this.mainEditorFile = file ?? null; this.renderChainBreadcrumb(); }));
		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
			if (leaf?.view instanceof MarkdownView) this.mainEditorFile = leaf.view.file;
			this.renderChainBreadcrumb();
		}));

		this.registerMarkdownPostProcessor((element, ctx) => {
			if (!this.taskSettings.enableCheckboxIcons) return;
			applyCheckboxIcons(this, element, ctx);
		});
		this.registerEditorExtension(checkboxIconsEditorExtension(this));

		this.addCommand({
			id: "cycle-task-checkbox-status",
			name: "Cycle task checkbox status",
			editorCallback: (editor: Editor) => {
				const cursor = editor.getCursor();
				const lineText = editor.getLine(cursor.line);
				const TASK_RE = /^(\s*)((?:[-*+]|\d+[.)])\s)(\[(.)\])/;
				const BULLET_RE = /^(\s*)((?:[-*+]|\d+[.)])\s)/;
				const taskMatch = TASK_RE.exec(lineText);
				const statuses = this.taskSettings.checkboxStatuses ?? DEFAULT_CHECKBOX_STATUSES;
				const marks = statuses.map((s) => s.mark);
				if (taskMatch) {
					const mark = taskMatch[4]!;
					const idx = marks.indexOf(mark);
					const checkboxStart = taskMatch[1]!.length + taskMatch[2]!.length;
					const checkboxEnd = checkboxStart + taskMatch[3]!.length;
					if (idx === marks.length - 1) {
						const trailingSpace = lineText[checkboxEnd] === " " ? 1 : 0;
						editor.replaceRange(lineText.substring(0, checkboxStart) + lineText.substring(checkboxEnd + trailingSpace), { line: cursor.line, ch: 0 }, { line: cursor.line, ch: lineText.length });
					} else {
						const next = idx === -1 ? (marks[0] ?? " ") : (marks[idx + 1] ?? marks[0] ?? " ");
						editor.replaceRange(lineText.substring(0, checkboxStart) + `[${next}]` + lineText.substring(checkboxEnd), { line: cursor.line, ch: 0 }, { line: cursor.line, ch: lineText.length });
					}
				} else {
					const bulletMatch = BULLET_RE.exec(lineText);
					if (bulletMatch) {
						const firstMark = marks[0] ?? " ";
						const insertCh = bulletMatch[0]!.length;
						editor.replaceRange(lineText.substring(0, insertCh) + `[${firstMark}] ` + lineText.substring(insertCh), { line: cursor.line, ch: 0 }, { line: cursor.line, ch: lineText.length });
					} else if (lineText.trim() === "") {
						const indent = lineText.match(/^(\s*)/)?.[1] ?? "";
						const newLine = `${indent}- `;
						editor.replaceRange(newLine, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: lineText.length });
						editor.setCursor({ line: cursor.line, ch: newLine.length });
					}
				}
			},
		});

		this.addCommand({ id: "open-linear-view", name: "Open linear panel", callback: () => void this.openLinearView() });
		this.addCommand({
			id: "linear-sync",
			name: "Linear: sync all linked notes",
			callback: async () => {
				if (!this.linearManager?.getConfiguredWorkspaces().length) { new Notice("No linear workspaces configured."); return; }
				const { updated, errors } = await this.linearManager.pullAll();
				new Notice(errors > 0 ? `Linear sync: ${updated} updated, ${errors} errors.` : `Linear sync complete — ${updated} note${updated === 1 ? "" : "s"} updated.`);
			},
		});
		this.addCommand({
			id: "linear-push-issue",
			name: "Linear: push status of active note",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.linearManager?.isLinkedNote(file)) return false;
				if (!checking) new LinearPushStateModal(this.app, async (stateName) => {
					const ok = await this.linearManager!.pushStatusChange(file, stateName);
					if (ok) new Notice(`Pushed status "${stateName}" to Linear.`);
				}).open();
				return true;
			},
		});
		this.addCommand({ id: "new-task", name: "New task", callback: () => new NewTaskModal(this.app, this).open() });
		this.addCommand({
			id: "add-target-date",
			name: "Add target date",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) {
					const existing = this.targetDateService.getTargetDate(file);
					new TargetDateModal(
						this.app,
						existing,
						(date, gran) => void this.targetDateService.setTargetDate(file, date, gran),
						() => void this.targetDateService.clearTargetDate(file)
					).open();
				}
				return true;
			},
		});
		this.addCommand({
			id: "new-chain-item",
			name: "New item for chain…",
			callback: () => {
				const chains = this.taskSettings.chains.filter((c) => c.itemFolder !== undefined || c.itemFrontmatterKey !== undefined || c.itemTemplatePath !== undefined);
				if (chains.length === 0) { new Notice("No chains have item creation config."); return; }
				if (chains.length === 1 && chains[0]) new NewTaskModal(this.app, this, chains[0]).open();
				else new ChainSuggestModal(this.app, chains, (chain) => new NewTaskModal(this.app, this, chain).open()).open();
			},
		});
		this.addCommand({ id: "open-chain-view", name: "Open chain view", callback: () => void this.openChainView() });
		this.addCommand({
			id: "set-current-task",
			name: "Set as current task",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				const chains = this.getChainsForFile(file);
				if (chains.length === 0) return false;
				if (!checking) {
					if (chains.length === 1 && chains[0]) void this.setCurrentTask(file, chains[0]);
					else new ChainSuggestModal(this.app, chains, (chain) => void this.setCurrentTask(file, chain)).open();
				}
				return true;
			},
		});
		this.addCommand({
			id: "advance-chain",
			name: "Advance chain",
			checkCallback: (checking: boolean) => {
				const chain = this.getStatusBarChain();
				if (!chain) return false;
				const current = this.findCurrentTask(chain);
				if (!current) return false;
				if (!checking) void this.advanceChain(chain, current);
				return true;
			},
		});
		this.addCommand({
			id: "check-is-task-file",
			name: "Check if current file is a task file",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) {
					const isTask = this.isTaskFile(file);
					new Notice(isTask ? `"${file.basename}" is a task file.` : `"${file.basename}" is not a task file.`);
				}
				return true;
			},
		});
		this.addCommand({
			id: "reconcile-chain-statuses",
			name: "Reconcile chain statuses",
			callback: async () => { for (const chain of this.taskSettings.chains) await this.reconcileChain(chain); new Notice("Chain statuses reconciled."); },
		});
		this.addCommand({
			id: "toggle-chain-bar",
			name: "Toggle chain bar",
			callback: async () => { this.settings.tasks.chainBarVisible = !this.taskSettings.chainBarVisible; await this.saveSettings(); this.renderChainBreadcrumb(); },
		});
		this.addCommand({
			id: "auto-populate-chains",
			name: "Auto-populate chains…",
			callback: () => {
				const eligible = this.taskSettings.chains.filter((c) => c.autoPopulateEnabled);
				if (eligible.length === 0) { new Notice("No chains have auto-populate enabled."); return; }
				if (eligible.length === 1 && eligible[0]) void this.autoPopulateChain(eligible[0]).then((n) => new Notice(`Auto-populated ${n} file${n === 1 ? "" : "s"} into "${eligible[0]!.name}".`));
				else new ChainSuggestModal(this.app, eligible, (chain) => void this.autoPopulateChain(chain).then((n) => new Notice(`Auto-populated ${n} file${n === 1 ? "" : "s"} into "${chain.name}".`))).open();
			},
		});
		this.addCommand({
			id: "add-to-chain",
			name: "Add to chain…",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || this.taskSettings.chains.length === 0) return false;
				if (!checking) {
					const pickChain = (chain: ChainDefinition) => void this.addFileToChain(file, chain);
					if (this.taskSettings.chains.length === 1 && this.taskSettings.chains[0]) pickChain(this.taskSettings.chains[0]);
					else new ChainSuggestModal(this.app, this.taskSettings.chains, pickChain).open();
				}
				return true;
			},
		});
		this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
			if (!(file instanceof TFile) || this.taskSettings.chains.length === 0) return;
			menu.addItem((item) => item.setTitle("Add to chain…").setIcon("link").onClick(() => {
				const pickChain = (chain: ChainDefinition) => void this.addFileToChain(file, chain);
				if (this.taskSettings.chains.length === 1 && this.taskSettings.chains[0]) pickChain(this.taskSettings.chains[0]);
				else new ChainSuggestModal(this.app, this.taskSettings.chains, pickChain).open();
			}));
		}));
		this.addCommand({
			id: "remove-from-chain",
			name: "Remove active file from chain…",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				const chains = this.getChainsForFile(file);
				if (chains.length === 0) return false;
				if (!checking) {
					if (chains.length === 1 && chains[0]) void this.removeFileFromChain(file, chains[0]);
					else new ChainMultiSelectModal(this.app, chains, async (selected) => { for (const chain of selected) await this.removeFileFromChain(file, chain); }).open();
				}
				return true;
			},
		});

		// ── Layout ready ─────────────────────────────────────────────────────
		this.app.workspace.onLayoutReady(() => { void (async () => {
			this.nlDates.initialize();
			await maybeMigrateFromDailyNotesCore(this);
			await this.sessionManager.initialize();
			this.refreshInboxView();

			if (this.settings.time.createAndOpenEditorOnStartup) {
				await ensureTodaysDailyNote(this);
				if (this.app.workspace.getLeavesOfType(TIME_MANAGER_EDITOR_VIEW).length === 0) await this.openEditorView();
			}

			const g = this.settings.time.openNoteOnStartup;
			if (g && this.settings.time[g].enabled) await openPeriodicNote(this, g, moment()).catch(console.error);

			this._registerObjectsTrigger();

			for (const leaf of this.app.workspace.getLeavesOfType(TIME_MANAGER_CALENDAR_VIEW)) {
				if (leaf.view instanceof CalendarView) leaf.view.refreshGrid();
			}

			// Build chain index once metadata is resolved
			const initChainIndex = () => {
				this.rebuildIndex();
				this.app.workspace.getLeavesOfType(CHAIN_VIEW_TYPE).forEach((leaf) => {
					try { (leaf.view as ChainView).render(); } catch { /* not ready */ }
				});
				this.renderChainBreadcrumb();
			};
			this.registerEvent(this.app.metadataCache.on("resolved", initChainIndex));
			initChainIndex();

			if (this.taskSettings.linearSyncOnOpen && this.linearManager?.getConfiguredWorkspaces().length) {
				void this.linearManager.pullAll().then(({ updated }) => {
					if (updated > 0) new Notice(`Linear: pulled ${updated} update${updated === 1 ? "" : "s"}.`);
				});
			}
			this.rescheduleLinearSync();
		})(); });
	}

	onunload(): void {
		document.body.classList.remove("tm-hide-frontmatter", "tm-hide-backlinks");
		if (this.linearSyncIntervalId !== null) window.clearInterval(this.linearSyncIntervalId);
	}

	// ── Settings ──────────────────────────────────────────────────────────────

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<ManagerSettings> & { migrated?: boolean } | null;
		if (!saved?.migrated) {
			const migrated = await migrateFromLegacyPlugins(this.app, saved);
			this.settings = mergeSettings(DEFAULT_MANAGER_SETTINGS, { ...migrated, migrated: true } as Partial<ManagerSettings>);
			await this.saveData({ ...this.settings, migrated: true });
		} else {
			this.settings = mergeSettings(DEFAULT_MANAGER_SETTINGS, saved);
		}
	}

	async saveSettings(): Promise<void> {
		if (this.settings.time.readTaggedItems.length > 0) {
			this.settings.time.readTaggedItems = this.settings.time.readTaggedItems.filter((key) => {
				const filePath = key.split(":")[0];
				return !!this.app.vault.getAbstractFileByPath(filePath ?? "");
			});
		}
		await this.saveData(this.settings);
		this.applyBodyClasses();
		this.configureRibbons();
		for (const leaf of this.app.workspace.getLeavesOfType(TIME_MANAGER_EDITOR_VIEW)) {
			const v = leaf.view as DailyNoteView;
			if (typeof v.refreshSettings === "function") v.refreshSettings();
		}
	}

	// ── Time-tools methods ────────────────────────────────────────────────────

	private _registerObjectsTrigger(): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
		const objectsPlugin = (this.app as any).plugins?.plugins?.["filtered-file-commands"];
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		if (typeof objectsPlugin?.registerTriggerProvider !== "function") return;
		if (objectsPlugin === this._registeredWithObjects) return;
		this._registeredWithObjects = objectsPlugin;
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		objectsPlugin.registerTriggerProvider(createPeriodicTriggerProvider(this));
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		objectsPlugin.registerTriggerProvider(createDateTriggerProvider(this.dateSuggest));
		this.dateSuggest.disable();
		this.register(() => {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
			objectsPlugin.unregisterTriggerProvider("obsidian-time-tools");
			// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
			objectsPlugin.unregisterTriggerProvider("obsidian-time-tools-dates");
		});
	}

	private configureRibbons(): void {
		this.dailyRibbon?.remove(); this.editorRibbon?.remove(); this.inboxRibbon?.remove();
		this.dailyRibbon = null; this.editorRibbon = null; this.inboxRibbon = null;
		if (this.settings.time.ribbonDaily && this.settings.time.day.enabled) {
			this.dailyRibbon = this.addRibbonIcon("calendar-day", "Open today's daily note", () => openPeriodicNote(this, "day", window.moment()).catch(console.error));
		}
		if (this.settings.time.ribbonEditor) {
			this.editorRibbon = this.addRibbonIcon("calendar-range", "Open timeline view", () => this.openEditorView());
		}
		if (this.settings.time.ribbonInbox) {
			this.inboxRibbon = this.addRibbonIcon("inbox", "Open inbox", () => void this.openInboxView());
		}
	}

	private applyBodyClasses(): void {
		document.body.classList.toggle("tm-hide-frontmatter", this.settings.time.hideFrontmatter);
		document.body.classList.toggle("tm-hide-backlinks", this.settings.time.hideBacklinks);
	}

	async openRecentlyViewedPanel(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_RECENTLY_VIEWED);
		if (existing.length > 0) { workspace.revealLeaf(existing[0]); return; }
		const leaf = workspace.getLeftLeaf(false) ?? workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_TYPE_RECENTLY_VIEWED, active: true });
		workspace.revealLeaf(leaf);
	}

	private trackRecentFile(file: TFile): void {
		const entry = { path: file.path, basename: file.basename, extension: file.extension, viewedAt: Date.now() };
		this.settings.time.recentFiles = this.settings.time.recentFiles.filter((f) => f.path !== file.path);
		this.settings.time.recentFiles.unshift(entry);
		if (this.settings.time.recentFiles.length > this.settings.time.rvMaxItems) {
			this.settings.time.recentFiles = this.settings.time.recentFiles.slice(0, this.settings.time.rvMaxItems);
		}
		void this.saveSettings();
		this.refreshRecentlyViewedPanel();
	}

	refreshRecentlyViewedPanel(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_RECENTLY_VIEWED)) (leaf.view as RecentlyViewedView).render();
	}

	refreshCalendarViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(TIME_MANAGER_TIMELINE_VIEW)) (leaf.view as TimelineView).refresh();
		for (const leaf of this.app.workspace.getLeavesOfType(TIME_MANAGER_EDITOR_VIEW)) (leaf.view as DailyNoteView).refreshCalendar?.();
		for (const leaf of this.app.workspace.getLeavesOfType(TIME_MANAGER_CALENDAR_VIEW)) {
			const view = leaf.view as CalendarView;
			const state = view.getState();
			view.grid?.$set({ anchorDate: state.anchorDate as string });
		}
		this.refreshAgendaViews();
	}

	async openEditorView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(TIME_MANAGER_EDITOR_VIEW);
		const leaf = existing.length > 0 ? existing[0] : workspace.getLeaf(true);
		if (existing.length === 0) await leaf.setViewState({ type: TIME_MANAGER_EDITOR_VIEW });
		workspace.revealLeaf(leaf);
	}

	async openNewEditorView(): Promise<void> {
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: TIME_MANAGER_EDITOR_VIEW });
		this.app.workspace.revealLeaf(leaf);
	}

	async openEditorViewAndScrollTo(file: TFile, granularity: Granularity): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(TIME_MANAGER_EDITOR_VIEW);
		let leaf: WorkspaceLeaf;
		if (existing.length > 0) { leaf = existing[0]; }
		else { leaf = workspace.getLeaf(true); await leaf.setViewState({ type: TIME_MANAGER_EDITOR_VIEW }); }
		workspace.revealLeaf(leaf);
		await (leaf.view as DailyNoteView).scrollToFile(file, granularity);
	}

	async openTimelineView(): Promise<void> {
		const { workspace } = this.app;
		const leaf = this.settings.time.timelineSide === "left"
			? workspace.getLeftLeaf(false) ?? workspace.getLeaf(true)
			: workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
		await leaf.setViewState({ type: TIME_MANAGER_TIMELINE_VIEW });
		workspace.revealLeaf(leaf);
	}

	async openCalendarView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(TIME_MANAGER_CALENDAR_VIEW);
		if (existing.length > 0) {
			workspace.revealLeaf(existing[0]);
			if (existing[0].view instanceof CalendarView) existing[0].view.refreshGrid();
			return;
		}
		const leaf = workspace.getLeaf(true);
		await leaf.setViewState({ type: TIME_MANAGER_CALENDAR_VIEW });
		workspace.revealLeaf(leaf);
	}

	async openNewCalendarView(): Promise<void> {
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({ type: TIME_MANAGER_CALENDAR_VIEW });
		this.app.workspace.revealLeaf(leaf);
	}

	async openAgendaView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(TIME_MANAGER_AGENDA_VIEW);
		if (existing.length > 0) { workspace.revealLeaf(existing[0]); (existing[0].view as AgendaView).refresh(); return; }
		const leaf = this.settings.time.agendaSide === "left"
			? workspace.getLeftLeaf(false) ?? workspace.getLeaf(true)
			: workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
		await leaf.setViewState({ type: TIME_MANAGER_AGENDA_VIEW });
		workspace.revealLeaf(leaf);
	}

	refreshAgendaViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(TIME_MANAGER_AGENDA_VIEW)) (leaf.view as AgendaView).refresh();
	}

	async openSessionsView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(TIME_MANAGER_SESSIONS_VIEW);
		if (existing.length > 0) { workspace.revealLeaf(existing[0]); return; }
		const leaf = workspace.getLeaf(true);
		await leaf.setViewState({ type: TIME_MANAGER_SESSIONS_VIEW });
		workspace.revealLeaf(leaf);
	}

	private async checkDayChange(): Promise<void> {
		const currentDay = moment().format("YYYY-MM-DD");
		if (currentDay === this.lastCheckedDay) return;
		this.lastCheckedDay = currentDay;
		if (this.settings.time.day.enabled) await ensureTodaysDailyNote(this);
		for (const leaf of this.app.workspace.getLeavesOfType(TIME_MANAGER_EDITOR_VIEW)) (leaf.view as DailyNoteView).refreshForNewDay?.();
		for (const leaf of this.app.workspace.getLeavesOfType(TIME_MANAGER_TIMELINE_VIEW)) (leaf.view as TimelineView).refresh?.();
	}

	async openInboxView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(TIME_MANAGER_INBOX_VIEW);
		if (existing.length > 0) { workspace.revealLeaf(existing[0]); return; }
		const leaf = this.settings.time.inboxSide === "right"
			? workspace.getRightLeaf(false) ?? workspace.getLeaf(true)
			: workspace.getLeftLeaf(false) ?? workspace.getLeaf(true);
		await leaf.setViewState({ type: TIME_MANAGER_INBOX_VIEW, active: true });
		workspace.revealLeaf(leaf);
	}

	refreshInboxView(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(TIME_MANAGER_INBOX_VIEW)) {
			if (leaf.view instanceof InboxView) leaf.view.render();
		}
	}

	private refreshReminderChip(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		this.reminderChipManager.update(view?.file ?? null, view?.leaf ?? null);
	}

	private checkReminders(): void {
		const due = this.reminderService.getDueReminders(new Date());
		for (const { file, date, time } of due) {
			const when = time ? `${date} at ${time}` : date;
			const notice = new Notice(`🔔 Reminder: ${file.basename}\n${when}`, 0);
			notice.noticeEl.addEventListener("click", () => {
				void this.app.workspace.getLeaf(false).openFile(file);
				notice.hide();
			});
			void this.reminderService.clearReminder(file);
		}
	}

	// ── Task-tools methods ────────────────────────────────────────────────────

	async openFileRespectingPin(file: TFile): Promise<void> {
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	async openLinearView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(LINEAR_VIEW_TYPE);
		if (existing[0]) { void this.app.workspace.revealLeaf(existing[0]); return; }
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf !== null) { await leaf.setViewState({ type: LINEAR_VIEW_TYPE, active: true }); void this.app.workspace.revealLeaf(leaf); }
	}

	rescheduleLinearSync(): void {
		if (this.linearSyncIntervalId !== null) { window.clearInterval(this.linearSyncIntervalId); this.linearSyncIntervalId = null; }
		const mins = this.taskSettings.linearSyncIntervalMinutes;
		if (mins > 0 && this.linearManager) {
			this.linearSyncIntervalId = window.setInterval(async () => {
				const { updated } = await this.linearManager!.pullAll();
				if (updated > 0) new Notice(`Linear: pulled ${updated} update${updated === 1 ? "" : "s"}.`);
			}, mins * 60 * 1000);
		}
	}

	startLinearOAuth(workspaceId: string): void {
		new LinearOAuthModal(this.app, workspaceId, async (token) => {
			await this.linearManager?.storeOAuthToken(workspaceId, token);
			new Notice("Linear workspace connected.");
			(this.app as { setting?: { open?: () => void } }).setting?.open?.();
			(this.app as { setting?: { openTabById?: (id: string) => void } }).setting?.openTabById?.("obsidian-manager");
		}).open();
	}

	// ── Chain index ───────────────────────────────────────────────────────────

	private indexKey(idKey: string, chainId: string): string { return `${idKey}::${chainId}`; }

	private rebuildIndex(): void {
		this.chainIndex.clear();
		for (const file of this.app.vault.getMarkdownFiles()) this.updateIndexForFile(file);
	}

	private updateIndexForFile(file: TFile): void {
		this.removeFileFromIndex(file.path);
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		if (!fm) return;
		for (const chain of this.taskSettings.chains) {
			const chainId = fm[chain.idKey];
			if (chainId == null) continue;
			const key = this.indexKey(chain.idKey, String(chainId as string | number | boolean));
			if (!this.chainIndex.has(key)) this.chainIndex.set(key, new Set());
			this.chainIndex.get(key)!.add(file.path);
		}
	}

	private removeFileFromIndex(filePath: string): void {
		for (const set of this.chainIndex.values()) set.delete(filePath);
	}

	private resolveFiles(paths: Set<string>): TFile[] {
		const files: TFile[] = [];
		for (const path of paths) { const f = this.app.vault.getFileByPath(path); if (f) files.push(f); }
		return files;
	}

	// ── Public chain API ──────────────────────────────────────────────────────

	getChainInstances(chain: ChainDefinition): { chainId: string; fileCount: number }[] {
		const prefix = `${chain.idKey}::`;
		const result: { chainId: string; fileCount: number }[] = [];
		for (const [key, paths] of this.chainIndex) {
			if (!key.startsWith(prefix)) continue;
			result.push({ chainId: key.slice(prefix.length), fileCount: paths.size });
		}
		result.sort((a, b) => a.chainId.localeCompare(b.chainId));
		return result;
	}

	openAddToChainMenu(e: MouseEvent, chain: ChainDefinition): void {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle("Add current file to chain").setIcon("file-plus").onClick(() => {
			const file = this.app.workspace.getActiveFile();
			if (!file) { new Notice("No active file."); return; }
			void this.addFileToChain(file, chain);
		}));
		menu.addItem((item) => item.setTitle("Add file to chain").setIcon("folder-open").onClick(() => new QuickAddFileModal(this, chain).open()));
		menu.addItem((item) => item.setTitle("Add new file to chain").setIcon("file").onClick(() => new NewBlankFileModal(this, chain).open()));
		menu.addItem((item) => item.setTitle("Add new file with template to chain").setIcon("layout-template").onClick(() => new NewTaskModal(this.app, this, chain).open()));
		menu.showAtMouseEvent(e);
	}

	async addFileToChain(file: TFile, chain: ChainDefinition, silent = false): Promise<void> {
		const instances = this.getChainInstances(chain);
		const chainId = instances[0]?.chainId ?? chain.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
		const peers = this.resolveFiles(this.chainIndex.get(this.indexKey(chain.idKey, chainId)) ?? new Set());
		let maxPos = 0;
		for (const peer of peers) {
			const pos = Number((this.app.metadataCache.getFileCache(peer)?.frontmatter as Record<string, unknown> | undefined)?.[chain.positionKey]);
			if (!isNaN(pos) && pos > maxPos) maxPos = pos;
		}
		const shouldSetCurrent = !this.findCurrentTask(chain);
		await this.app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
			front[chain.idKey] = chainId;
			front[chain.positionKey] = maxPos + 1;
			if (shouldSetCurrent) front[chain.statusKey] = chain.currentStatusValue;
		});
		if (!silent) new Notice(`Added "${file.basename}" to chain "${chainId}" at position ${maxPos + 1}.`);
	}

	async removeFileFromChain(file: TFile, chain: ChainDefinition): Promise<void> {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		if (!fm || fm[chain.idKey] == null) { new Notice(`"${file.basename}" is not in chain "${chain.name}".`); return; }
		const wasCurrent = fm[chain.statusKey] === chain.currentStatusValue;
		if (wasCurrent) {
			const items = this.buildChain(file, chain);
			const currentItem = items.find((i) => i.file.path === file.path);
			const next = currentItem ? items.filter((i) => i.order > currentItem.order).sort((a, b) => a.order - b.order)[0] : undefined;
			if (next) await this.setCurrentTask(next.file, chain);
		}
		await this.app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
			delete front[chain.idKey]; delete front[chain.positionKey];
			if (wasCurrent) delete front[chain.statusKey];
		});
		new Notice(`Removed "${file.basename}" from chain "${chain.name}".`);
	}

	getPeerFiles(chain: ChainDefinition, chainId: string): TFile[] {
		return this.resolveFiles(this.chainIndex.get(this.indexKey(chain.idKey, chainId)) ?? new Set());
	}

	getChainsForFile(file: TFile): ChainDefinition[] {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		if (!fm) return [];
		return this.taskSettings.chains.filter((chain) => fm[chain.idKey] != null);
	}

	async setCurrentTask(file: TFile, chain: ChainDefinition): Promise<void> {
		const chainId = (this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined)?.[chain.idKey];
		if (!chainId) return;
		const siblings = this.resolveFiles(this.chainIndex.get(this.indexKey(chain.idKey, String(chainId as string | number | boolean))) ?? new Set());
		for (const f of siblings) {
			if (f.path === file.path) continue;
			const fm = this.app.metadataCache.getFileCache(f)?.frontmatter as Record<string, unknown> | undefined;
			if (fm?.[chain.statusKey] === chain.currentStatusValue) {
				await this.app.fileManager.processFrontMatter(f, (front: Record<string, unknown>) => { delete front[chain.statusKey]; });
			}
		}
		await this.app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => { front[chain.statusKey] = chain.currentStatusValue; });
	}

	async reconcileChain(chain: ChainDefinition): Promise<void> {
		const currentTask = this.findCurrentTask(chain);
		if (!currentTask) return;
		const items = this.buildChain(currentTask, chain);
		for (const item of items) {
			await this.app.fileManager.processFrontMatter(item.file, (front: Record<string, unknown>) => {
				if (item.role === "previous") front[chain.statusKey] = chain.completedStatusValue;
				else if (item.role === "current") front[chain.statusKey] = chain.currentStatusValue;
				else if (front[chain.statusKey] === chain.completedStatusValue) delete front[chain.statusKey];
			});
		}
	}

	async setItemStatus(file: TFile, chain: ChainDefinition, newStatus: "done" | "todo" | "ready" | "inProgress"): Promise<void> {
		const currentTask = this.findCurrentTask(chain);
		if (!currentTask) return;
		const items = this.buildChain(currentTask, chain);
		const currentItem = items.find((i) => i.role === "current");
		const targetItem = items.find((i) => i.file.path === file.path);
		if (!currentItem || !targetItem) return;

		const needsReposition =
			(newStatus === "done" && targetItem.role !== "previous" && targetItem.role !== "current") ||
			((newStatus === "todo" || newStatus === "ready" || newStatus === "inProgress") && targetItem.role === "previous");

		const applyStatus = (front: Record<string, unknown>) => {
			if (newStatus === "done") { front[chain.statusKey] = chain.completedStatusValue; front[COMPLETED_DATE_KEY] = (window as unknown as { moment: () => { format: (s: string) => string } }).moment().format("YYYY-MM-DD"); }
			else if (newStatus === "ready") { front[chain.statusKey] = chain.readyStatusValue ?? "ready"; delete front[COMPLETED_DATE_KEY]; }
			else if (newStatus === "inProgress") { front[chain.statusKey] = chain.inProgressStatusValue ?? "in-progress"; delete front[COMPLETED_DATE_KEY]; }
			else { delete front[chain.statusKey]; delete front[COMPLETED_DATE_KEY]; }
		};

		if (!needsReposition) {
			await this.app.fileManager.processFrontMatter(file, applyStatus);
			return;
		}

		const without = items.filter((i) => i.file.path !== file.path);
		const currentIdx = without.findIndex((i) => i.role === "current");
		without.splice(newStatus === "done" ? currentIdx : currentIdx + 1, 0, targetItem);

		for (let i = 0; i < without.length; i++) {
			const itm = without[i]!;
			await this.app.fileManager.processFrontMatter(itm.file, (front: Record<string, unknown>) => {
				front[chain.positionKey] = i + 1;
				if (itm.role === "current") front[chain.statusKey] = chain.currentStatusValue;
				else if (itm.file.path === file.path) applyStatus(front);
			});
		}
	}

	async toggleReadyTask(file: TFile, chain: ChainDefinition): Promise<void> {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		const readyValue = chain.readyStatusValue ?? "ready";
		const isAlreadyReady = fm?.[chain.statusKey] === readyValue;
		await this.app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
			if (isAlreadyReady) delete front[chain.statusKey];
			else front[chain.statusKey] = readyValue;
		});
	}

	isTaskFile(file: TFile): boolean {
		const { taskFrontmatterKey, taskFrontmatterValue } = this.taskSettings;
		if (!taskFrontmatterKey) return false;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		if (!fm || !(taskFrontmatterKey in fm)) return false;
		if (taskFrontmatterValue) return String(fm[taskFrontmatterKey]) === taskFrontmatterValue;
		return true;
	}

	findCurrentTask(chain: ChainDefinition): TFile | undefined {
		for (const [key, paths] of this.chainIndex) {
			if (!key.startsWith(`${chain.idKey}::`)) continue;
			for (const f of this.resolveFiles(paths)) {
				const fm = this.app.metadataCache.getFileCache(f)?.frontmatter as Record<string, unknown> | undefined;
				if (fm?.[chain.statusKey] === chain.currentStatusValue) return f;
			}
		}
		return undefined;
	}

	buildChain(currentFile: TFile, chain: ChainDefinition): ChainItem[] {
		const currentFm = this.app.metadataCache.getFileCache(currentFile)?.frontmatter as Record<string, unknown> | undefined;
		const chainId = currentFm?.[chain.idKey];
		const currentOrder = Number(currentFm?.[chain.positionKey]);
		if (!chainId) return [];
		const peers = this.resolveFiles(this.chainIndex.get(this.indexKey(chain.idKey, String(chainId as string | number | boolean))) ?? new Set());
		const items: ChainItem[] = [];
		for (const file of peers) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
			if (!fm) continue;
			const fileOrder = Number(fm[chain.positionKey]);
			if (isNaN(fileOrder)) continue;
			const isCurrent = fm[chain.statusKey] === chain.currentStatusValue;
			const isReady = fm[chain.statusKey] === (chain.readyStatusValue ?? "ready");
			const isInProgress = fm[chain.statusKey] === (chain.inProgressStatusValue ?? "in-progress");
			let role: "previous" | "current" | "ready" | "inProgress" | "next";
			if (isCurrent) role = "current";
			else if (fileOrder < currentOrder) role = "previous";
			else if (isReady) role = "ready";
			else if (isInProgress) role = "inProgress";
			else role = "next";
			items.push({ file, order: fileOrder, role });
		}
		items.sort((a, b) => a.order - b.order);
		return items;
	}

	getStatusBarChain(): ChainDefinition | undefined {
		const { statusBarChainIdKey } = this.taskSettings;
		const preferred = statusBarChainIdKey ? this.taskSettings.chains.find((c) => c.idKey === statusBarChainIdKey) : undefined;
		return (preferred && this.findCurrentTask(preferred) ? preferred : undefined)
			?? this.taskSettings.chains.find((c) => this.findCurrentTask(c) !== undefined);
	}

	async advanceChain(chain: ChainDefinition, currentTask: TFile): Promise<void> {
		const items = this.buildChain(currentTask, chain);
		const currentItem = items.find((i) => i.file.path === currentTask.path);
		if (!currentItem) return;
		const next = items.filter((i) => i.order > currentItem.order).sort((a, b) => a.order - b.order)[0];
		if (!next) { new Notice(`"${chain.name}" chain complete — no next task.`); return; }
		for (const c of this.getChainsForFile(currentTask)) {
			await this.app.fileManager.processFrontMatter(currentTask, (front: Record<string, unknown>) => {
				front[c.statusKey] = c.completedStatusValue;
				front[COMPLETED_DATE_KEY] = (window as unknown as { moment: () => { format: (s: string) => string } }).moment().format("YYYY-MM-DD");
			});
		}
		if (chain.completionChainIdKey) {
			const targetChain = this.taskSettings.chains.find((c) => c.idKey === chain.completionChainIdKey);
			if (targetChain) await this.addFileToChain(currentTask, targetChain);
		}
		await this.setCurrentTask(next.file, chain);
		await this.openFileRespectingPin(next.file);
	}

	private matchesRule(fm: Record<string, unknown>, rule: FrontmatterRule): boolean {
		if (!(rule.key in fm)) return false;
		if (rule.value !== undefined && rule.value !== "") return String(fm[rule.key]) === rule.value;
		return true;
	}

	async autoPopulateChain(chain: ChainDefinition): Promise<number> {
		const include = chain.autoPopulateInclude ?? [];
		const exclude = chain.autoPopulateExclude ?? [];
		if (include.length === 0) { new Notice(`Chain "${chain.name}" has no include rules.`); return 0; }
		let added = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
			if (!fm || fm[chain.idKey] != null) continue;
			if (!include.every((r) => this.matchesRule(fm, r))) continue;
			if (exclude.some((r) => this.matchesRule(fm, r))) continue;
			await this.addFileToChain(file, chain, true);
			added++;
		}
		return added;
	}

	async openChainView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(CHAIN_VIEW_TYPE);
		if (existing[0]) { void this.app.workspace.revealLeaf(existing[0]); return; }
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf !== null) { await leaf.setViewState({ type: CHAIN_VIEW_TYPE, active: true }); void this.app.workspace.revealLeaf(leaf); }
	}

	private openStatusBarChainPicker(): void {
		const active = this.taskSettings.chains.filter((c) => this.findCurrentTask(c) !== undefined);
		if (active.length === 0) { void this.openChainView(); return; }
		new ChainSuggestModal(this.app, active, async (chain) => {
			this.settings.tasks.statusBarChainIdKey = chain.idKey;
			await this.saveSettings();
			this.renderChainBreadcrumb();
		}).open();
	}

	private positionChainBar(): void {
		const el = this.chainStatusBarItem;
		const position = this.taskSettings.chainBarPosition ?? "center";
		el.style.left = "auto"; el.style.right = "auto"; el.style.transform = "";
		if (position === "right") {
			const statusBar = document.querySelector<HTMLElement>(".status-bar");
			if (!statusBar) return;
			el.style.right = `${window.innerWidth - statusBar.getBoundingClientRect().left + 4}px`;
		} else if (position === "center") { el.style.left = "50%"; el.style.transform = "translateX(-50%)"; }
		else { el.style.left = "12px"; }
	}

	private setupStatusBarObserver(): void {
		const statusBar = document.querySelector<HTMLElement>(".status-bar");
		if (!statusBar) return;
		this.statusBarObserver?.disconnect();
		this.statusBarObserver = new ResizeObserver(() => this.positionChainBar());
		this.statusBarObserver.observe(statusBar);
		this.register(() => this.statusBarObserver?.disconnect());
		this.positionChainBar();
	}

	private renderEmptyChainBar(el: HTMLElement): void {
		if (this.taskSettings.chains.length === 0) {
			const iconEl = el.createSpan({ cls: "chain-sb-chain-icon" });
			setIcon(iconEl, "link");
			setTooltip(el, "Start a chain", { delay: 0, placement: "top" });
			const addBtn = el.createSpan({ cls: "chain-sb-add-btn chain-sb-add-btn--start" });
			setIcon(addBtn, "plus");
			addBtn.addEventListener("click", async (e) => {
				e.stopPropagation();
				const file = this.app.workspace.getActiveFile();
				new CreateChainModal(this.app, async (name) => {
					const schema: ChainDefinition = { name, ...derivedChainKeys(slugifyChainName(name) || "chain"), currentStatusValue: "current", completedStatusValue: "done", readyStatusValue: "ready" };
					this.settings.tasks.chains.push(schema);
					await this.saveSettings();
					if (file) await this.addFileToChain(file, schema);
					else new Notice("Chain created. Open a file and click + to add it.");
				}).open();
			});
		} else {
			const iconEl = el.createSpan({ cls: "chain-sb-chain-icon" });
			setIcon(iconEl, "link");
			setTooltip(iconEl, this.taskSettings.chains.length === 1 ? this.taskSettings.chains[0]!.name : "Chains", { delay: 0, placement: "top" });
			setIcon(el.createSpan({ cls: "chain-sb-arrow" }), "chevron-right");
			const addBtn = el.createSpan({ cls: "chain-sb-add-btn" });
			setIcon(addBtn, "plus");
			setTooltip(addBtn, "Add to chain", { delay: 0, placement: "top" });
			addBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				if (this.taskSettings.chains.length === 1 && this.taskSettings.chains[0]) this.openAddToChainMenu(e, this.taskSettings.chains[0]);
				else new ChainSuggestModal(this.app, this.taskSettings.chains, (chain) => this.openAddToChainMenu(e, chain)).open();
			});
		}
	}

	private renderChainBreadcrumb(): void {
		if (!this.chainStatusBarItem) return;
		const el = this.chainStatusBarItem;
		el.empty();

		if (!this.taskSettings.chainBarVisible) { this.positionChainBar(); return; }

		const chainsWithCurrent = this.taskSettings.chains.filter((c) => this.findCurrentTask(c) !== undefined);
		if (chainsWithCurrent.length === 0) { this.renderEmptyChainBar(el); this.positionChainBar(); return; }

		const chain = (this.taskSettings.statusBarChainIdKey ? chainsWithCurrent.find((c) => c.idKey === this.taskSettings.statusBarChainIdKey) : undefined) ?? chainsWithCurrent[0]!;
		const currentTask = this.findCurrentTask(chain);
		if (!currentTask) { this.positionChainBar(); return; }

		const items = this.buildChain(currentTask, chain);
		if (items.length === 0) { this.positionChainBar(); return; }

		const activeFile = this.mainEditorFile;

		const iconEl = el.createSpan({ cls: "chain-sb-chain-icon" });
		setIcon(iconEl, "link");
		setTooltip(iconEl, chain.name, { delay: 0, placement: "top" });
		iconEl.addEventListener("click", (e) => { e.stopPropagation(); this.openStatusBarChainPicker(); });
		setIcon(el.createSpan({ cls: "chain-sb-arrow" }), "chevron-right");

		const scrollEl = el.createDiv({ cls: "chain-sb-scroll" });
		let dragSrcIdx = -1;

		const reorder = async (fromIdx: number, toIdx: number) => {
			if (fromIdx === toIdx) return;
			const reordered = [...items];
			const [moved] = reordered.splice(fromIdx, 1);
			reordered.splice(toIdx, 0, moved!);
			for (let i = 0; i < reordered.length; i++) {
				await this.app.fileManager.processFrontMatter(reordered[i]!.file, (fm: Record<string, unknown>) => { fm[chain.positionKey] = i + 1; });
			}
			this.renderChainBreadcrumb();
		};

		let currentNode: HTMLElement | null = null;
		let openFileNode: HTMLElement | null = null;

		items.forEach((item, idx) => {
			if (idx > 0) setIcon(scrollEl.createSpan({ cls: "chain-sb-arrow" }), "chevron-right");
			const isOpen = activeFile?.path === item.file.path;

			if (item.role === "current") {
				const node = scrollEl.createSpan({ cls: "chain-sb-node chain-sb-node--current" + (isOpen ? "" : " is-away"), text: item.file.basename, attr: { tabindex: "0", role: "button" } });
				currentNode = node;
				if (isOpen) openFileNode = node;
				setTooltip(node, item.file.basename, { delay: 0, placement: "top" });
				node.draggable = true;
				node.addEventListener("dragstart", (e) => { dragSrcIdx = idx; e.dataTransfer?.setData("text/plain", item.file.path); node.addClass("is-dragging"); });
				node.addEventListener("dragend", () => { dragSrcIdx = -1; node.removeClass("is-dragging"); });
				node.addEventListener("click", async (e) => { e.stopPropagation(); await this.openFileRespectingPin(item.file); });
				node.addEventListener("keydown", async (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); await this.openFileRespectingPin(item.file); } });
				node.addEventListener("contextmenu", (e) => {
					e.stopPropagation();
					const menu = new Menu();
					if (items[idx + 1]) menu.addItem((mi) => mi.setTitle("Advance chain").setIcon("arrow-right").onClick(async () => { await this.advanceChain(chain, item.file); }));
					menu.addItem((mi) => mi.setTitle("Open file").setIcon("file-open").onClick(async () => { await this.openFileRespectingPin(item.file); }));
					menu.addItem((mi) => mi.setTitle("Remove from chain").setIcon("trash").onClick(async () => { await this.removeFileFromChain(item.file, chain); }));
					menu.showAtMouseEvent(e);
				});
			} else {
				const node = scrollEl.createSpan({ cls: `chain-sb-node chain-sb-node--${item.role}${isOpen ? " is-open" : ""}`, attr: { tabindex: "0", role: "button" } });
				if (isOpen) openFileNode = node;
				if (item.role === "previous" || item.role === "ready") setIcon(node, "check");
				if (item.role === "inProgress") node.innerHTML = HALF_CIRCLE_SVG;
				setTooltip(node, item.file.basename, { delay: 0, placement: "top" });
				node.draggable = true;
				node.addEventListener("dragstart", (e) => { dragSrcIdx = idx; e.dataTransfer?.setData("text/plain", item.file.path); node.addClass("is-dragging"); });
				node.addEventListener("dragend", () => {
					node.removeClass("is-dragging");
					scrollEl.querySelectorAll(".chain-sb-drop-before, .chain-sb-drop-after").forEach((n) => { n.removeClass("chain-sb-drop-before"); n.removeClass("chain-sb-drop-after"); });
				});
				node.addEventListener("dragover", (e) => {
					e.preventDefault();
					if (dragSrcIdx === idx) return;
					const rect = node.getBoundingClientRect();
					scrollEl.querySelectorAll(".chain-sb-node").forEach((n) => { n.removeClass("chain-sb-drop-before"); n.removeClass("chain-sb-drop-after"); });
					if (e.clientX < rect.left + rect.width / 2) node.addClass("chain-sb-drop-before");
					else node.addClass("chain-sb-drop-after");
				});
				node.addEventListener("dragleave", () => { node.removeClass("chain-sb-drop-before"); node.removeClass("chain-sb-drop-after"); });
				node.addEventListener("drop", async (e) => {
					e.preventDefault();
					node.removeClass("chain-sb-drop-before"); node.removeClass("chain-sb-drop-after");
					if (dragSrcIdx < 0 || dragSrcIdx === idx) return;
					const rect = node.getBoundingClientRect();
					const insertAfter = e.clientX >= rect.left + rect.width / 2;
					let target = idx;
					if (insertAfter && dragSrcIdx < idx) target = idx;
					else if (insertAfter && dragSrcIdx > idx) target = idx + 1;
					else if (!insertAfter && dragSrcIdx < idx) target = idx - 1;
					await reorder(dragSrcIdx, target);
				});
				node.addEventListener("click", async (e) => { e.stopPropagation(); await this.openFileRespectingPin(item.file); });
				node.addEventListener("keydown", async (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); await this.openFileRespectingPin(item.file); } });
				node.addEventListener("contextmenu", (e) => {
					e.stopPropagation();
					const menu = new Menu();
					if (item.role !== "current") menu.addItem((mi) => mi.setTitle("Set as current").setIcon("map-pin").onClick(async () => { await this.setCurrentTask(item.file, chain); }));
					if (item.role !== "ready" && item.role !== "current") menu.addItem((mi) => mi.setTitle("Mark as ready").setIcon("check-circle").onClick(async () => { await this.setItemStatus(item.file, chain, "ready"); }));
					if (item.role !== "previous" && item.role !== "current") menu.addItem((mi) => mi.setTitle("Mark as done").setIcon("check").onClick(async () => { await this.setItemStatus(item.file, chain, "done"); }));
					if (item.role !== "next" && item.role !== "current") menu.addItem((mi) => mi.setTitle("Mark as todo").setIcon("circle").onClick(async () => { await this.setItemStatus(item.file, chain, "todo"); }));
					if (item.role !== "inProgress" && item.role !== "current") menu.addItem((mi) => mi.setTitle("Mark as in progress").setIcon("circle-half").onClick(async () => { await this.setItemStatus(item.file, chain, "inProgress"); }));
					menu.addItem((mi) => mi.setTitle("Open file").setIcon("file-open").onClick(async () => { await this.openFileRespectingPin(item.file); }));
					menu.addItem((mi) => mi.setTitle("Remove from chain").setIcon("trash").onClick(async () => { await this.removeFileFromChain(item.file, chain); }));
					menu.showAtMouseEvent(e);
				});
			}
		});

		requestAnimationFrame(() => {
			const maxVisible = this.taskSettings.statusBarDisplayMode === "filenames"
				? (this.taskSettings.statusBarMaxItems ?? 5)
				: (this.taskSettings.statusBarDotsCount ?? 7);
			const itemNodes = Array.from(scrollEl.querySelectorAll<HTMLElement>(".chain-sb-node"));
			if (itemNodes.length <= maxVisible) return;
			const scrollElLeft = scrollEl.offsetLeft;
			const contentLeft  = (n: HTMLElement) => n.offsetLeft - scrollElLeft;
			const contentRight = (n: HTMLElement) => n.offsetLeft + n.offsetWidth - scrollElLeft;
			const sizeIdx = currentNode ? itemNodes.indexOf(currentNode) : 0;
			const half = Math.floor((maxVisible - 1) / 2);
			let sStart = Math.max(0, sizeIdx - half);
			let sEnd = sStart + maxVisible;
			if (sEnd > itemNodes.length) { sEnd = itemNodes.length; sStart = Math.max(0, sEnd - maxVisible); }
			const sFirstNode = itemNodes[sStart]; const sLastNode = itemNodes[sEnd - 1];
			if (!sFirstNode || !sLastNode) return;
			const windowWidth = contentRight(sLastNode) - contentLeft(sFirstNode);
			scrollEl.style.maxWidth = `${windowWidth}px`;
			const openIdx = openFileNode ? itemNodes.indexOf(openFileNode) : -1;
			const scrollIdx = openIdx >= 0 ? openIdx : sizeIdx;
			let pStart = Math.max(0, scrollIdx - half);
			let pEnd = pStart + maxVisible;
			if (pEnd > itemNodes.length) { pEnd = itemNodes.length; pStart = Math.max(0, pEnd - maxVisible); }
			const pFirstNode = itemNodes[pStart];
			if (!pFirstNode) return;
			const maxScrollLeft = Math.max(0, scrollEl.scrollWidth - windowWidth);
			scrollEl.scrollLeft = Math.max(0, Math.min(contentLeft(pFirstNode), maxScrollLeft));
		});

		setIcon(el.createSpan({ cls: "chain-sb-arrow" }), "chevron-right");
		const addBtn = el.createSpan({ cls: "chain-sb-add-btn" });
		setIcon(addBtn, "plus");
		setTooltip(addBtn, "Add to chain", { delay: 0, placement: "top" });
		addBtn.addEventListener("click", (e) => { e.stopPropagation(); this.openAddToChainMenu(e, chain); });

		this.positionChainBar();
	}
}

// ── Legacy migration ──────────────────────────────────────────────────────────

async function readLegacyData(app: App, pluginId: string): Promise<Record<string, unknown> | null> {
	try {
		const path = `${app.vault.configDir}/plugins/${pluginId}/data.json`;
		const raw = await app.vault.adapter.read(path);
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return null;
	}
}

async function migrateFromLegacyPlugins(
	app: App,
	existing: Partial<ManagerSettings> | null,
): Promise<Partial<ManagerSettings>> {
	const result: Partial<ManagerSettings> = { ...existing };
	let didMigrate = false;

	if (!existing?.time) {
		const timeData = await readLegacyData(app, "obsidian-time-tools");
		if (timeData) {
			result.time = timeData as unknown as import("./time-settings").TimeManagerSettings;
			didMigrate = true;
		}
	}

	if (!existing?.tasks) {
		const taskData = await readLegacyData(app, "obsidian-task-tools");
		if (taskData) {
			result.tasks = taskData as unknown as TaskToolsSettings;
			didMigrate = true;
		}
	}

	if (didMigrate) {
		new Notice("Manager: settings imported from Time Tools and Task Tools.", 6000);
	}

	return result;
}

// ── Settings merge ────────────────────────────────────────────────────────────

function mergeSettings(defaults: ManagerSettings, saved: Partial<ManagerSettings> | null | undefined): ManagerSettings {
	if (!saved) return JSON.parse(JSON.stringify(defaults)) as ManagerSettings;

	const savedTime: Partial<TimeManagerSettings> = saved.time ?? {};
	const periodicMerge = Object.fromEntries(
		granularities.map((g) => [g, { ...defaults.time[g], ...(savedTime[g] ?? {}) }])
	) as Pick<TimeManagerSettings, typeof granularities[number]>;

	const mergedTime: TimeManagerSettings = {
		...defaults.time, ...savedTime, ...periodicMerge,
		presets:                    savedTime.presets                    ?? defaults.time.presets,
		sessionsFolder:             savedTime.sessionsFolder             ?? defaults.time.sessionsFolder,
		rvMaxItems:                 savedTime.rvMaxItems                 ?? defaults.time.rvMaxItems,
		rvShowTimestamp:            savedTime.rvShowTimestamp            ?? defaults.time.rvShowTimestamp,
		rvShowPath:                 savedTime.rvShowPath                 ?? defaults.time.rvShowPath,
		recentFiles:                savedTime.recentFiles                ?? defaults.time.recentFiles,
		nlDates:                    { ...defaults.time.nlDates, ...(savedTime.nlDates ?? {}) },
		calendarSources:            (savedTime.calendarSources ?? defaults.time.calendarSources).map((s: import("./calendar/types").CalendarSource) => ({ ...s, visible: s.visible ?? true })),
		showTargetFiles:            savedTime.showTargetFiles            ?? defaults.time.showTargetFiles,
		inboxDisplay:               { ...defaults.time.inboxDisplay, ...(savedTime.inboxDisplay ?? {}) },
		inboxTags:                  savedTime.inboxTags                  ?? defaults.time.inboxTags,
		inboxExcludeTags:           savedTime.inboxExcludeTags           ?? defaults.time.inboxExcludeTags,
		readTaggedItems:            savedTime.readTaggedItems             ?? defaults.time.readTaggedItems,
		inboxAutoRemoveDone:        savedTime.inboxAutoRemoveDone        ?? defaults.time.inboxAutoRemoveDone,
		calendarInboxTags:          savedTime.calendarInboxTags          ?? defaults.time.calendarInboxTags,
		calendarInboxExcludeTags:   savedTime.calendarInboxExcludeTags   ?? defaults.time.calendarInboxExcludeTags,
		ribbonDaily:                savedTime.ribbonDaily                ?? defaults.time.ribbonDaily,
		ribbonEditor:               savedTime.ribbonEditor               ?? defaults.time.ribbonEditor,
		ribbonInbox:                savedTime.ribbonInbox                ?? defaults.time.ribbonInbox,
		timelineSide:               savedTime.timelineSide               ?? defaults.time.timelineSide,
		agendaSide:                 savedTime.agendaSide                 ?? defaults.time.agendaSide,
		inboxSide:                  savedTime.inboxSide                  ?? defaults.time.inboxSide,
		agendaWorkSection: (savedTime.agendaWorkSection ?? defaults.time.agendaWorkSection) as "tasks" | "targets",
		agendaTaskFilter:  (savedTime.agendaTaskFilter  ?? defaults.time.agendaTaskFilter)  as "all" | "open" | "done",
	};

	return {
		tasks: { ...defaults.tasks, ...(saved.tasks ?? {}) },
		time: mergedTime,
	};
}

export type { TFile };
