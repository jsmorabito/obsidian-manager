 
import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
} from "obsidian";
import { generateMarkdownLink, getDateLinkAlias } from "./utils";
import type { NLDatesModule } from "./module";

interface DateCompletion {
	label: string;
}

const DEFAULT_SUGGESTIONS = ["Now", "Today", "Yesterday", "Tomorrow", "In 1 hour", "1 hour ago"];

const TIME_PREFIX_SUGGESTIONS = [
	"time:now",
	"time:+15 minutes",
	"time:+1 hour",
	"time:-15 minutes",
	"time:-1 hour",
];

/**
 * EditorSuggest that fires on the configured trigger phrase (default: "@") and
 * offers natural language date completions.
 *
 * Behaviour:
 *  - Selecting a suggestion inserts a formatted date (as wikilink by default).
 *  - Holding Shift while confirming keeps the typed text as a wikilink alias.
 *  - Typing `@time:...` (when timePrefixEnabled) inserts a formatted time string.
 */
export default class DateSuggest extends EditorSuggest<DateCompletion> {
	private readonly nld: NLDatesModule;
	private _disabled = false;

	/** Call this when another plugin (e.g. obsidian-objects) is handling the trigger. */
	disable(): void {
		this._disabled = true;
	}

	constructor(app: App, nld: NLDatesModule) {
		super(app);
		this.nld = nld;

		// Register Shift+Enter so users can confirm with the alias shortcut.
		this.scope.register(["Shift"], "Enter", (evt: KeyboardEvent) => {
			(
				this as unknown as {
					suggestions: { useSelectedItem(evt: KeyboardEvent): void };
				}
			).suggestions.useSelectedItem(evt);
			return false;
		});

		if (this.nld.settings.autosuggestToggleLink) {
			this.setInstructions([{ command: "Shift ↵", purpose: "Keep text as alias" }]);
		}
	}

	// ── Trigger detection ─────────────────────────────────────────────────────

	onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
		if (this._disabled) return null;
		if (!this.nld.settings.isAutosuggestEnabled) return null;

		const trigger = this.nld.settings.autocompleteTriggerPhrase;
		const startPos = this.context?.start ?? {
			line: cursor.line,
			ch: cursor.ch - trigger.length,
		};

		if (!editor.getRange(startPos, cursor).startsWith(trigger)) return null;

		// Don't fire if the trigger character is part of a word (e.g. inside an email).
		const precedingChar = editor.getRange(
			{ line: startPos.line, ch: startPos.ch - 1 },
			startPos
		);
		if (precedingChar && /[`a-zA-Z0-9]/.test(precedingChar)) return null;

		const query = editor.getRange(startPos, cursor).substring(trigger.length);
		// Dismiss immediately if the user typed a bare space after the trigger.
		if (query === " ") return null;

		return { start: startPos, end: cursor, query };
	}

	// ── Suggestion generation ─────────────────────────────────────────────────

	getSuggestions(ctx: EditorSuggestContext): DateCompletion[] {
		const results = this.buildSuggestions(ctx.query);
		return results.length > 0 ? results : [{ label: ctx.query }];
	}

	/** Public so TriggerProvider wrappers can reuse the same suggestion logic. */
	buildSuggestions(query: string): DateCompletion[] {
		// time: prefix — only when feature toggle is on.
		if (this.nld.settings.timePrefixEnabled && query.match(/^time/i)) {
			return TIME_PREFIX_SUGGESTIONS.map((label) => ({ label })).filter((s) =>
				s.label.toLowerCase().startsWith(query.toLowerCase())
			);
		}

		// next / last / this — offer period completions.
		const relativeKeyword = query.match(/^(next|last|this)/i)?.[1];
		if (relativeKeyword) {
			return [
				"week",
				"month",
				"year",
				"Sunday",
				"Monday",
				"Tuesday",
				"Wednesday",
				"Thursday",
				"Friday",
				"Saturday",
			]
				.map((val) => ({ label: `${relativeKeyword} ${val}` }))
				.filter((s) => s.label.toLowerCase().startsWith(query.toLowerCase()));
		}

		// Numeric delta — "in N ..." or just "N ...".
		const delta = query.match(/^in ([+-]?\d+)/i) ?? query.match(/^([+-]?\d+)/i);
		if (delta) {
			const n = delta[1];
			return [
				{ label: `in ${n} minutes` },
				{ label: `in ${n} hours` },
				{ label: `in ${n} days` },
				{ label: `in ${n} weeks` },
				{ label: `in ${n} months` },
				{ label: `${n} days ago` },
				{ label: `${n} weeks ago` },
				{ label: `${n} months ago` },
			].filter((s) => s.label.toLowerCase().startsWith(query.toLowerCase()));
		}

		// Defaults.
		return DEFAULT_SUGGESTIONS.map((label) => ({ label })).filter((s) =>
			s.label.toLowerCase().startsWith(query.toLowerCase())
		);
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	renderSuggestion(suggestion: DateCompletion, el: HTMLElement): void {
		el.setText(suggestion.label);
	}

	// ── Selection ─────────────────────────────────────────────────────────────

	selectSuggestion(
		suggestion: DateCompletion,
		event: KeyboardEvent | MouseEvent
	): void {
		if (!this.context) return;
		this.applySelection(suggestion.label, event.shiftKey, this.context.editor, this.context.start, this.context.end);
		this.close();
	}

	/**
	 * Public apply method so TriggerProvider wrappers can trigger insertion
	 * without needing access to this.context.
	 */
	applySelection(
		label: string,
		includeAlias: boolean,
		editor: Editor,
		start: EditorPosition,
		end: EditorPosition
	): void {
		let dateStr: string;
		let makeIntoLink = this.nld.settings.autosuggestToggleLink;

		if (label.startsWith("time:")) {
			const timePart = label.substring(5);
			dateStr = this.nld.parseTime(timePart).formattedString;
			makeIntoLink = false;
		} else {
			dateStr = this.nld.parseDateSmart(label).formattedString;
		}

		if (makeIntoLink) {
			const alias = getDateLinkAlias(
				this.nld.settings.defaultAlias,
				(s) => this.nld.parseDate(s),
				label,
				includeAlias
			);
			dateStr = generateMarkdownLink(this.nld.app, dateStr, alias);
		}

		editor.replaceRange(dateStr, start, end);
	}
}
