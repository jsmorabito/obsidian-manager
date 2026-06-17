/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
/**
 * Arrow-up / arrow-down navigation between embedded editors.
 *
 * When the cursor is at the first line of an embedded note and the user presses
 * ArrowUp, focus moves to the last line of the preceding embedded note.
 * Likewise ArrowDown from the last line moves to the first line of the next.
 *
 * Usage: call createUpDownNavigationExtension(container) from DailyNoteEditorView
 * where `container` is the scroll container holding all .tm-note-container elements.
 */
import { EditorView, keymap } from "@codemirror/view";
import type { KeyBinding } from "@codemirror/view";

function getEmbeddedEditors(container: HTMLElement): EditorView[] {
	const editors: EditorView[] = [];
	container.querySelectorAll<HTMLElement>(".cm-editor").forEach((el) => {
		// @ts-ignore — CodeMirror attaches its EditorView to the DOM element
		const view: EditorView | undefined = el.cmView?.view ?? el.cmView;
		if (view instanceof EditorView) editors.push(view);
	});
	return editors;
}

function indexOfView(views: EditorView[], view: EditorView): number {
	return views.findIndex((v) => v === view);
}

function moveToPrev(container: HTMLElement, currentView: EditorView): boolean {
	const views = getEmbeddedEditors(container);
	const idx = indexOfView(views, currentView);
	if (idx <= 0) return false;
	const prev = views[idx - 1];
	const lastLine = prev.state.doc.lines;
	const lastPos  = prev.state.doc.line(lastLine).to;
	prev.focus();
	prev.dispatch({ selection: { anchor: lastPos } });
	return true;
}

function moveToNext(container: HTMLElement, currentView: EditorView): boolean {
	const views = getEmbeddedEditors(container);
	const idx = indexOfView(views, currentView);
	if (idx < 0 || idx >= views.length - 1) return false;
	const next = views[idx + 1];
	next.focus();
	next.dispatch({ selection: { anchor: 0 } });
	return true;
}

export function createUpDownNavigationExtension(container: HTMLElement) {
	const bindings: KeyBinding[] = [
		{
			key: "ArrowUp",
			run(view: EditorView) {
				const { state } = view;
				const sel = state.selection.main;
				// Only intercept when cursor is on the very first line.
				if (state.doc.lineAt(sel.head).number !== 1) return false;
				return moveToPrev(container, view);
			},
		},
		{
			key: "ArrowDown",
			run(view: EditorView) {
				const { state } = view;
				const sel = state.selection.main;
				// Only intercept when cursor is on the very last line.
				if (state.doc.lineAt(sel.head).number !== state.doc.lines) return false;
				return moveToNext(container, view);
			},
		},
	];
	return keymap.of(bindings);
}
