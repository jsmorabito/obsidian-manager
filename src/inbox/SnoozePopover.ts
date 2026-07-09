/**
 * SnoozePopover
 *
 * Quick-snooze dropdown anchored to a clock-icon button, offering the same
 * presets as SnoozeModal without the modal overlay — click the clock, pick a
 * time, done. "Custom…" hands off to the full SnoozeModal for a date/time
 * picker. Only one popover can be open at a time.
 */
import { TFile } from "obsidian";
import type TimeManagerPlugin from "../main";
import { SnoozeModal } from "./SnoozeModal";
import { getSnoozePresets } from "./snooze-presets";

const POPOVER_CLASS = "tm-inbox-snooze-popover";

export class SnoozePopover {
	private static _current: SnoozePopover | null = null;

	private _el: HTMLElement;
	private _outsideClickHandler: (e: MouseEvent) => void;
	private _keyHandler: (e: KeyboardEvent) => void;

	private constructor(
		plugin: TimeManagerPlugin,
		file: TFile,
		anchorEl: HTMLElement,
		onSnoozed: () => void,
	) {
		this._el = document.body.createDiv({ cls: POPOVER_CLASS });
		this._el.createEl("div", { text: "Snooze until…", cls: "tm-inbox-snooze-popover-title" });

		const list = this._el.createDiv({ cls: "tm-inbox-snooze-popover-list" });

		for (const preset of getSnoozePresets()) {
			const btn = list.createEl("button", { cls: "tm-inbox-snooze-popover-btn" });
			btn.createEl("span", { text: preset.label, cls: "tm-inbox-snooze-popover-label" });
			btn.createEl("span", { text: preset.sublabel, cls: "tm-inbox-snooze-popover-sublabel" });
			btn.addEventListener("click", () => {
				void plugin.inboxService.snoozeItem(file, preset.getTime()).then(() => {
					this._dismiss();
					onSnoozed();
				});
			});
		}

		const customBtn = list.createEl("button", { cls: "tm-inbox-snooze-popover-btn tm-inbox-snooze-popover-custom" });
		customBtn.createEl("span", { text: "Custom…", cls: "tm-inbox-snooze-popover-label" });
		customBtn.addEventListener("click", () => {
			this._dismiss();
			new SnoozeModal(plugin.app, (remindAt) => {
				void plugin.inboxService.snoozeItem(file, remindAt).then(onSnoozed);
			}).open();
		});

		this._position(anchorEl);

		this._outsideClickHandler = (e: MouseEvent) => {
			if (!this._el.contains(e.target as Node | null)) this._dismiss();
		};
		setTimeout(() => {
			document.addEventListener("mousedown", this._outsideClickHandler, { capture: true });
		}, 0);

		this._keyHandler = (e: KeyboardEvent) => {
			if (e.key === "Escape") this._dismiss();
		};
		document.addEventListener("keydown", this._keyHandler);
	}

	/** Show a snooze popover for `file`, anchored near `anchorEl`. */
	static show(
		plugin: TimeManagerPlugin,
		file: TFile,
		anchorEl: HTMLElement,
		onSnoozed: () => void,
	): void {
		SnoozePopover._current?._dismiss();
		SnoozePopover._current = new SnoozePopover(plugin, file, anchorEl, onSnoozed);
	}

	static dismiss(): void {
		SnoozePopover._current?._dismiss();
	}

	private _dismiss(): void {
		if (SnoozePopover._current === this) SnoozePopover._current = null;
		document.removeEventListener("mousedown", this._outsideClickHandler, { capture: true });
		document.removeEventListener("keydown", this._keyHandler);
		this._el.remove();
	}

	/** Position the popover near `anchor`, keeping it inside the viewport. */
	private _position(anchor: HTMLElement): void {
		const rect = anchor.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		this._el.setCssProps({ visibility: "hidden", left: "0px", top: "0px" });

		const popW = this._el.offsetWidth || 220;
		const popH = this._el.offsetHeight || 260;

		let left = rect.right - popW;
		let top = rect.bottom + 6;

		if (left < 8) left = 8;
		if (left + popW > vw - 8) left = vw - popW - 8;

		if (top + popH > vh - 8) top = Math.max(8, rect.top - popH - 6);

		this._el.setCssProps({ left: `${left}px`, top: `${top}px`, visibility: "" });
	}
}
