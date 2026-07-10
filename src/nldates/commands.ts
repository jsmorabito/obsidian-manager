import { MarkdownView, Plugin } from "obsidian";
import { generateMarkdownLink, getDateLinkAlias, getSelectedText, adjustCursor } from "./utils";
import type { NLDatesModule } from "./module";
import DatePickerModal from "./modals/date-picker";
import OpenPeriodicNoteModal from "./modals/open-periodic-note";

// ── Internal helpers ──────────────────────────────────────────────────────────

function insertMomentString(nld: NLDatesModule, formatted: string): void {
	const view = nld.app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) return;
	view.editor.replaceSelection(formatted);
}

function runParseCommand(nld: NLDatesModule, mode: "replace" | "link" | "clean" | "time"): void {
	const view = nld.app.workspace.getActiveViewOfType(MarkdownView);
	if (!view) return;

	const editor = view.editor;
	const cursor = editor.getCursor();
	const selectedText = getSelectedText(editor);

	if (mode === "time") {
		const result = nld.parseTime(selectedText);
		if (!result.moment.isValid()) return;
		const newStr = result.formattedString;
		editor.replaceSelection(newStr);
		adjustCursor(editor, cursor, newStr, selectedText);
		editor.focus();
		return;
	}

	const result = nld.parseDate(selectedText);
	if (!result.moment.isValid()) return;

	let newStr: string;
	if (mode === "replace") {
		const alias = getDateLinkAlias(
			nld.settings.defaultAlias,
			(s) => nld.parseDate(s),
			selectedText,
			false
		);
		newStr = generateMarkdownLink(nld.app, result.formattedString, alias);
	} else if (mode === "link") {
		// Standard markdown link: [original text](resolved-date)
		newStr = `[${selectedText}](${result.formattedString})`;
	} else {
		// "clean" — plain text date
		newStr = result.formattedString;
	}

	editor.replaceSelection(newStr);
	adjustCursor(editor, cursor, newStr, selectedText);
	editor.focus();
}

// ── Public registration ───────────────────────────────────────────────────────

/**
 * Registers all NL dates commands on the given plugin.
 * Call this from main.ts onload() after creating the NLDatesModule.
 */
export function registerNLDateCommands(plugin: Plugin, nld: NLDatesModule): void {
	// ── Parse-selection commands ──────────────────────────────────────────────

	plugin.addCommand({
		id: "nld-parse-as-wikilink",
		name: "Natural language date: parse selection as [[wikilink]]",
		callback: () => runParseCommand(nld, "replace"),
	});

	plugin.addCommand({
		id: "nld-parse-as-link",
		name: "Natural language date: parse selection as Markdown link",
		callback: () => runParseCommand(nld, "link"),
	});

	plugin.addCommand({
		id: "nld-parse-as-plain",
		name: "Natural language date: parse selection as plain text",
		callback: () => runParseCommand(nld, "clean"),
	});

	plugin.addCommand({
		id: "nld-parse-as-time",
		name: "Natural language date: parse selection as time",
		callback: () => runParseCommand(nld, "time"),
	});

	// ── Insert current date / time / datetime ─────────────────────────────────

	plugin.addCommand({
		id: "nld-insert-date",
		name: "Natural language date: insert current date",
		callback: () => {
			const { formattedString } = nld.parseDate("today");
			insertMomentString(nld, formattedString);
		},
	});

	plugin.addCommand({
		id: "nld-insert-time",
		name: "Natural language date: insert current time",
		callback: () => {
			const { formattedString } = nld.parseTime("now");
			insertMomentString(nld, formattedString);
		},
	});

	plugin.addCommand({
		id: "nld-insert-datetime",
		name: "Natural language date: insert current date and time",
		callback: () => {
			const { formattedString } = nld.parseDateTime("now");
			insertMomentString(nld, formattedString);
		},
	});

	// ── Modals ────────────────────────────────────────────────────────────────

	plugin.addCommand({
		id: "nld-date-picker",
		name: "Natural language date: open date picker",
		checkCallback: (checking) => {
			const hasView = !!nld.app.workspace.getActiveViewOfType(MarkdownView);
			if (!hasView) return false;
			if (!checking) new DatePickerModal(nld.app, nld).open();
			return true;
		},
	});

	plugin.addCommand({
		id: "nld-open-periodic-note",
		name: "Natural language date: open periodic note",
		callback: () => new OpenPeriodicNoteModal(nld.app, nld).open(),
	});
}
