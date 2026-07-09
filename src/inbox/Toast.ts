import { Notice } from "obsidian";

/**
 * A toast with an inline action button (e.g. "Undo"), built on Obsidian's own
 * Notice component — Notice accepts a DocumentFragment as its message, so we
 * get native positioning/stacking/dismiss behavior for free instead of
 * reinventing a floating div.
 */
export class Toast {
	private notice: Notice;

	constructor(message: string, actionLabel: string, onAction: () => void, durationMs = 6000) {
		const frag = createFragment((el) => {
			el.createSpan({ text: message + " " });
			const actionBtn = el.createEl("button", { text: actionLabel, cls: "tm-toast-action" });
			actionBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				onAction();
				this.dismiss();
			});
		});
		this.notice = new Notice(frag, durationMs);
	}

	dismiss(): void {
		this.notice.hide();
	}
}
