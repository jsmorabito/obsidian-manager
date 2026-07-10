/**
 * TargetPreviewPopover
 *
 * Shows a positioned preview card when the user clicks a target-date file in
 * the AgendaView or TargetDatePanel.  Looks and feels like a native Obsidian
 * popover: theme-aware colours, box shadow, rounded corners, rendered markdown.
 *
 * Usage:
 *   TargetPreviewPopover.show(app, plugin, file, targetLabel, anchorEl);
 *
 * Only one popover can be open at a time.  Calling show() while one is already
 * visible replaces it.  The popover is dismissed by:
 *   - Clicking outside it
 *   - Pressing Escape
 *   - Clicking the × button
 *   - Clicking the "Open" button
 */

import { App, Component, MarkdownRenderer, TFile, moment, setIcon } from "obsidian";
import { labelTargetDate } from "./target-date-service";
import type { ResolvedTargetDate } from "./types";

const POPOVER_CLASS = "tm-target-preview-popover";
const MAX_PREVIEW_CHARS = 600;

export class TargetPreviewPopover {
	private static _current: TargetPreviewPopover | null = null;

	private _el: HTMLElement;
	private _component: Component;
	private _outsideClickHandler: (e: MouseEvent) => void;
	private _keyHandler: (e: KeyboardEvent) => void;

	private constructor(
		app: App,
		file: TFile,
		target: ResolvedTargetDate,
		anchorEl: HTMLElement
	) {
		this._component = new Component();
		this._component.load();

		// ── Build DOM ──────────────────────────────────────────────────────────
		this._el = document.body.createDiv({ cls: POPOVER_CLASS });

		// Header row: title + close button
		const header = this._el.createDiv({ cls: "tm-target-preview-header" });
		const titleWrap = header.createDiv({ cls: "tm-target-preview-title-wrap" });
		const fileIcon = titleWrap.createSpan({ cls: "tm-target-preview-file-icon" });
		setIcon(fileIcon, "file-text");
		titleWrap.createSpan({
			text: file.basename,
			cls: "tm-target-preview-title",
		});

		const closeBtn = header.createEl("button", {
			cls: "tm-target-preview-close clickable-icon",
			attr: { "aria-label": "Close preview" },
		});
		setIcon(closeBtn, "x");
		closeBtn.addEventListener("click", () => this._dismiss());

		// Date badge
		const dateBadge = this._el.createSpan({
			text: labelTargetDate(target.raw, target.granularity),
			cls: "tm-target-preview-date",
		});

		// Overdue badge
		if (target.endMoment.isBefore(moment(), "day")) {
			dateBadge.classList.add("tm-target-preview-date--overdue");
		}

		// Content preview (async)
		const previewEl = this._el.createDiv({ cls: "tm-target-preview-content" });
		app.vault.cachedRead(file).then((raw) => {
			// Strip YAML frontmatter before rendering
			const stripped = raw.replace(/^---[\s\S]*?---\n?/, "").trimStart();
			const excerpt = stripped.slice(0, MAX_PREVIEW_CHARS);
			void MarkdownRenderer.render(
				app,
				excerpt || "*No content*",
				previewEl,
				file.path,
				this._component
			);
		}).catch(() => {
			previewEl.createSpan({ text: "Could not load content.", cls: "tm-target-preview-empty" });
		});

		// Footer: Open button
		const footer = this._el.createDiv({ cls: "tm-target-preview-footer" });
		const openBtn = footer.createEl("button", {
			cls: "tm-target-preview-open mod-cta",
			text: "Open",
		});
		openBtn.addEventListener("click", () => {
			void app.workspace.getLeaf(false).openFile(file);
			this._dismiss();
		});

		// ── Position ───────────────────────────────────────────────────────────
		this._position(anchorEl);

		// ── Outside-click dismiss ──────────────────────────────────────────────
		this._outsideClickHandler = (e: MouseEvent) => {
			if (!this._el.contains(e.target as Node | null)) {
				this._dismiss();
			}
		};
		// Delay so the triggering click doesn't immediately close the popover.
		window.setTimeout(() => {
			document.addEventListener("mousedown", this._outsideClickHandler, { capture: true });
		}, 0);

		// ── Escape dismiss ─────────────────────────────────────────────────────
		this._keyHandler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				this._dismiss();
			}
		};
		document.addEventListener("keydown", this._keyHandler);
	}

	/** Show a preview popover for `file`, positioned near `anchorEl`. */
	static show(
		app: App,
		file: TFile,
		target: ResolvedTargetDate,
		anchorEl: HTMLElement
	): void {
		TargetPreviewPopover._current?._dismiss();
		TargetPreviewPopover._current = new TargetPreviewPopover(app, file, target, anchorEl);
	}

	/** Dismiss the currently open popover (if any). */
	static dismiss(): void {
		TargetPreviewPopover._current?._dismiss();
	}

	private _dismiss(): void {
		if (TargetPreviewPopover._current === this) {
			TargetPreviewPopover._current = null;
		}
		document.removeEventListener("mousedown", this._outsideClickHandler, { capture: true });
		document.removeEventListener("keydown", this._keyHandler);
		this._component.unload();
		this._el.remove();
	}

	/** Position the popover near `anchor`, keeping it inside the viewport. */
	private _position(anchor: HTMLElement): void {
		const rect = anchor.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		// Temporarily make visible off-screen to measure height.
		this._el.setCssProps({ visibility: "hidden", left: "0px", top: "0px" });

		const popW = this._el.offsetWidth || 280;
		const popH = this._el.offsetHeight || 300;

		let left = rect.right + 8;
		let top  = rect.top;

		// If it overflows the right edge, try placing it to the left.
		if (left + popW > vw - 8) {
			left = rect.left - popW - 8;
		}
		// If still off-screen (narrow viewport), fall back to centered below.
		if (left < 8) {
			left = Math.max(8, rect.left);
			top  = rect.bottom + 8;
		}

		// Clamp vertically.
		if (top + popH > vh - 8) {
			top = Math.max(8, vh - popH - 8);
		}
		if (top < 8) top = 8;

		this._el.setCssProps({ left: `${left}px`, top: `${top}px`, visibility: "" });
	}
}
