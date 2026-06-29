/**
 * Lightweight drag-payload singleton shared between the three calendar side
 * panels and CalendarGrid's drop handlers. No Svelte reactivity needed here —
 * dragstart sets it, drop reads it, dragend clears it.
 */

export interface DragPayload {
	/** "file" = whole-file item; "inline" = a single tagged line inside a file; "reminder" = reminder chip. */
	type: "file" | "inline" | "reminder";
	/** Vault-relative path of the source file. */
	filePath: string;
	/** For inline items: 0-based line number of the tag. */
	line?: number;
	/** For inline items: the full tag string (e.g. "#inbox"). */
	tag?: string;
}

let _current: DragPayload | null = null;

export function setDragPayload(p: DragPayload | null): void {
	_current = p;
}

export function getDragPayload(): DragPayload | null {
	return _current;
}
