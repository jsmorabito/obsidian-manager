import { FuzzySuggestModal, normalizePath } from "obsidian";
import type { App, TFile } from "obsidian";

interface CoreTemplatesPlugin {
	enabled: boolean;
	instance?: { options?: { folder?: string } };
}

interface TemplaterPlugin {
	settings?: { templates_folder?: string; template_folder?: string };
}

interface AppPrivateFields {
	internalPlugins?: { plugins?: Record<string, CoreTemplatesPlugin | undefined> };
	plugins?: { plugins?: Record<string, TemplaterPlugin | undefined> };
}

/** Return the configured templates folder, or null if none is set. Checks the
 *  core Templates plugin first, then Templater. */
function getTemplatesFolder(app: App): string | null {
	const { internalPlugins, plugins } = app as unknown as AppPrivateFields;

	const internal = internalPlugins?.plugins?.["templates"];
	const coreFolder = internal?.enabled && internal?.instance?.options?.folder;
	if (coreFolder) return normalizePath(coreFolder);

	const templater = plugins?.plugins?.["templater-obsidian"];
	const templaterFolder = templater?.settings?.templates_folder ?? templater?.settings?.template_folder;
	if (templaterFolder) return normalizePath(templaterFolder);

	return null;
}

export class ExistingNoteSuggestModal extends FuzzySuggestModal<TFile> {
	private _onChoose: (file: TFile) => void;

	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app);
		this._onChoose = onChoose;
		this.setPlaceholder("Choose an existing note…");
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this._onChoose(file);
	}
}

export class TemplateSuggestModal extends FuzzySuggestModal<TFile> {
	private _onChoose: (file: TFile) => void;
	private _folder: string | null;

	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app);
		this._onChoose = onChoose;
		this._folder = getTemplatesFolder(app);
		this.setPlaceholder(
			this._folder ? `Choose a template from ${this._folder}…` : "Choose a template…"
		);
	}

	getItems(): TFile[] {
		const files = this.app.vault.getMarkdownFiles();
		const folder = this._folder;
		const filtered = folder
			? files.filter((f) => f.path.startsWith(folder + "/") || f.path === folder)
			: files;
		return filtered.sort((a, b) => a.path.localeCompare(b.path));
	}

	getItemText(file: TFile): string {
		const folder = this._folder;
		if (folder && file.path.startsWith(folder + "/")) {
			return file.path.slice(folder.length + 1);
		}
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this._onChoose(file);
	}
}
