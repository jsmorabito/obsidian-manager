/**
 * Periodic-note leaf navigation.
 *
 * When the active leaf contains a periodic note, injects three controls into
 * the leaf's view-actions bar:
 *   ←  previous period note
 *   [date label]  jump to any date via DatePickerModal
 *   →  next period note
 *
 * Controls are removed automatically when the active file changes to a
 * non-periodic note.
 */
import { MarkdownView, setIcon, TFile, WorkspaceLeaf } from "obsidian";
 
import type moment from "moment";
import type TimeManagerPlugin from "../main";
import { findInPeriodic, openPeriodicNote } from "./api";
import { displayConfigs } from "./types";
import { addHalfYears } from "./half-year";
import { DatePickerModal } from "./DatePickerModal";

export function registerLeafNavActions(plugin: TimeManagerPlugin): void {
	// Keep state in a closure so it resets cleanly on each plugin load cycle.
	const state: {
		buttons: HTMLElement[];
		leaf: WorkspaceLeaf | null;
		filePath: string | null;
	} = { buttons: [], leaf: null, filePath: null };

	function removeInjected(): void {
		for (const el of state.buttons) el.remove();
		state.buttons = [];
		state.leaf = null;
		state.filePath = null;
	}

	function injectNavButtons(leaf: WorkspaceLeaf, file: TFile): void {
		const meta = findInPeriodic(plugin, file.path);
		if (!meta) { removeInjected(); return; }

		// Already showing the right buttons for this file — nothing to do.
		if (state.leaf === leaf && state.filePath === file.path) return;

		// Remove stale buttons from a previous leaf/file.
		removeInjected();

		const actionsEl = leaf.view?.containerEl?.querySelector<HTMLElement>(".view-actions");
		if (!actionsEl) return;

		const { granularity, date } = meta;
		const cfg = displayConfigs[granularity];

		// ← Prev button
		const prev = makeIconButton(
			actionsEl.ownerDocument,
			`Open previous ${cfg.periodicity} note`,
			"arrow-left",
			() => {
			const prevDate = granularity === "half-year" ? addHalfYears(date, -1) : date.clone().subtract(1, granularity as moment.unitOfTime.DurationConstructor);
			openPeriodicNote(plugin, granularity, prevDate).catch(console.error);
		}
		);

		// Date label — clicking opens the jump-to-date picker.
		const dateLbl = actionsEl.ownerDocument.createElement("button");
		dateLbl.className = "clickable-icon view-action tm-nav-date-label";
		dateLbl.title = "Jump to date…";
		dateLbl.setAttribute("aria-label", "Jump to date…");
		dateLbl.createSpan({ text: file.basename });
		dateLbl.addEventListener("click", () => {
			new DatePickerModal(plugin.app, granularity, (picked) => {
				openPeriodicNote(plugin, granularity, picked).catch(console.error);
			}).open();
		});

		// → Next button
		const next = makeIconButton(
			actionsEl.ownerDocument,
			`Open next ${cfg.periodicity} note`,
			"arrow-right",
			() => {
			const nextDate = granularity === "half-year" ? addHalfYears(date, 1) : date.clone().add(1, granularity as moment.unitOfTime.DurationConstructor);
			openPeriodicNote(plugin, granularity, nextDate).catch(console.error);
		}
		);

		// ⊞ Open-in-view button — opens the time-notes editor scrolled to this note.
		const openInView = makeIconButton(
			actionsEl.ownerDocument,
			"Open in time notes view",
			"gallery-vertical",
			() => { plugin.openEditorViewAndScrollTo(file, granularity).catch(console.error); }
		);

		// Prepend so they sit at the left of the existing action icons.
		actionsEl.prepend(openInView, next, dateLbl, prev);
		state.buttons = [prev, dateLbl, next, openInView];
		state.leaf = leaf;
		state.filePath = file.path;
	}

	function makeIconButton(
		doc: Document,
		title: string,
		iconId: string,
		onClick: () => void
	): HTMLElement {
		const btn = doc.createElement("button");
		btn.className = "clickable-icon view-action tm-nav-btn";
		btn.title = title;
		btn.setAttribute("aria-label", title);
		setIcon(btn, iconId);
		btn.addEventListener("click", onClick);
		return btn;
	}

	const onLeafChange = () => {
		// Only inject into standard markdown leaves — not our own custom views.
		const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) { removeInjected(); return; }

		const file = view.file;
		if (!file) { removeInjected(); return; }

		injectNavButtons(view.leaf, file);
	};

	plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", onLeafChange));
	plugin.registerEvent(plugin.app.workspace.on("file-open", onLeafChange));
}
