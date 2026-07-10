// Ported from quorafind/Obsidian-Daily-Notes-Editor (MIT), which in turn
// adapted nothingislost/obsidian-hover-editor (MIT).
//
// This file is the heart of the multi-note editor: each note rendered in the
// scrolling view is backed by a real Obsidian workspace leaf, parked in a
// detached "hover popover" container inside the host view. Modifying this file
// without testing in Obsidian is risky — keep the original behavior unless you
// have a specific bug to fix.
import {
	Component,
	HoverPopover,
	parseLinktext,
	PopoverState,
	requireApiVersion,
	resolveSubpath,
	TFile,
	WorkspaceSplit,
	WorkspaceTabs,
} from "obsidian";
import type {
	EphemeralState,
	MarkdownEditView,
	OpenViewState,
	View,
	Workspace,
	WorkspaceLeaf,
} from "obsidian";

import type TimeManagerPlugin from "../main";
import { genId } from "../utils/id";

// ── Timing constants ──────────────────────────────────────────────────────────
/** How long to wait before showing a popover after the target is hovered. */
const POPOVER_SHOW_DELAY_MS = 300;
/** How long to wait before hiding a popover after the cursor leaves. */
const POPOVER_CLOSE_DELAY_MS = 600;
/** Fixed dimensions for PDF file previews inside the popover. */
const PDF_POPOVER_HEIGHT = "800px";
const PDF_POPOVER_WIDTH  = "600px";

export interface DailyNoteEditorParent {
	hoverPopover: DailyNoteEditor | null;
	containerEl?: HTMLElement;
	view?: View;
	dom?: HTMLElement;
	// Mirror of the upstream "DailyNoteEditor" parent pointer.
	DailyNoteEditor?: DailyNoteEditor | null;
}

const popovers = new WeakMap<Element, DailyNoteEditor>();
type ConstructableWorkspaceSplit = new (
	ws: Workspace,
	dir: "horizontal" | "vertical"
) => WorkspaceSplit;

export function isDailyNoteLeaf(leaf: WorkspaceLeaf): boolean {
	return leaf.containerEl.matches(".tm-editor.tm-leaf-view .workspace-leaf");
}

function nosuper<T>(base: new (...args: never[]) => T): new () => T {
	const derived: unknown = function () {
		return Object.setPrototypeOf(new Component(), (new.target as unknown as { prototype: object }).prototype) as T;
	};
	(derived as { prototype: unknown }).prototype = (base as unknown as { prototype: unknown }).prototype;
	return Object.setPrototypeOf(derived, base) as new () => T;
}

export function spawnLeafView(
	plugin: TimeManagerPlugin,
	initiatingEl?: HTMLElement,
	leaf?: WorkspaceLeaf,
	onShowCallback?: () => unknown
): [WorkspaceLeaf, DailyNoteEditor] {
	let parent = plugin.app.workspace.activeLeaf as unknown as DailyNoteEditorParent;
	if (!parent) parent = leaf as unknown as DailyNoteEditorParent;
	if (!initiatingEl) initiatingEl = parent?.containerEl;

	const editor = new DailyNoteEditor(parent, initiatingEl!, plugin, undefined, onShowCallback);
	return [editor.attachLeaf(), editor];
}

export class DailyNoteEditor extends nosuper(HoverPopover) {
	onTarget: boolean;
	setActive: (event: MouseEvent) => void;

	lockedOut!: boolean;
	abortController? = this.addChild(new Component());
	detaching = false;
	opening = false;

	// @ts-ignore — unofficial constructor signature
	rootSplit: WorkspaceSplit = new (WorkspaceSplit as ConstructableWorkspaceSplit)(
		window.app.workspace,
		"vertical"
	);
	isPinned = true;

	titleEl!: HTMLElement;
	containerEl!: HTMLElement;

	oldPopover: DailyNoteEditor | null | undefined = (this.parent as DailyNoteEditorParent | null)?.DailyNoteEditor;
	document: Document;

	id = genId(8);
	bounce?: number;
	boundOnZoomOut!: () => void;

	originalPath!: string;
	originalLinkText!: string;
	static activePopover?: DailyNoteEditor;

	hoverEl: HTMLElement;

	constructor(
		parent: DailyNoteEditorParent,
		public targetEl: HTMLElement,
		public plugin: TimeManagerPlugin,
		waitTime?: number,
		public onShowCallback?: () => unknown
	) {
		super();
		if (waitTime === undefined) waitTime = POPOVER_SHOW_DELAY_MS;
		this.onTarget = true;

		this.parent = parent;
		this.waitTime = waitTime;
		this.state = PopoverState.Showing;

		this.document =
			this.targetEl?.ownerDocument ?? window.activeDocument ?? window.document;
		this.hoverEl = this.document.defaultView!.createDiv({
			cls: "tm-editor tm-leaf-view",
			attr: { id: "tm-" + this.id },
		});

		this.abortController!.load();
		this.timer = window.setTimeout(this.show.bind(this), waitTime);
		this.setActive = this._setActive.bind(this);
		this.hoverEl.addEventListener("mousedown", this.setActive);

		popovers.set(this.hoverEl, this);
		this.hoverEl.addClass("tm-editor");
		this.containerEl = this.hoverEl.createDiv("tm-content");
		this.buildWindowControls();
		this.setInitialDimensions();
	}

	static activeWindows(): Window[] {
		const windows: Window[] = [window];
		const { floatingSplit } = window.app.workspace;
		if (floatingSplit) {
			for (const split of floatingSplit.children) {
				if (split.win) windows.push(split.win);
			}
		}
		return windows;
	}

	static containerForDocument(plugin: TimeManagerPlugin, doc: Document) {
		if (doc !== document && plugin.app.workspace.floatingSplit) {
			for (const container of plugin.app.workspace.floatingSplit.children) {
				if (container.doc === doc) return container;
			}
		}
		return plugin.app.workspace.rootSplit;
	}

	static activePopovers(): DailyNoteEditor[] {
		return this.activeWindows().flatMap((win) => this.popoversForWindow(win));
	}

	static popoversForWindow(win?: Window): DailyNoteEditor[] {
		return (
			Array.prototype.slice.call(
				win?.document?.body.querySelectorAll(".tm-leaf-view") ?? []
			) as HTMLElement[]
		)
			.map((el) => popovers.get(el)!)
			.filter((he) => he);
	}

	static forLeaf(leaf: WorkspaceLeaf | undefined): DailyNoteEditor | undefined {
		// @ts-ignore — matchParent is on prototype but not typed in 1.x
		const el = leaf && document.body.matchParent.call(leaf.containerEl, ".tm-leaf-view");
		return el ? popovers.get(el) : undefined;
	}

	static iteratePopoverLeaves(
		ws: Workspace,
		cb: (leaf: WorkspaceLeaf) => boolean | void
	): boolean {
		for (const popover of this.activePopovers()) {
			if (popover.rootSplit && ws.iterateLeaves(cb, popover.rootSplit)) return true;
		}
		return false;
	}

	_setActive(evt: MouseEvent) {
		evt.preventDefault();
		evt.stopPropagation();
		this.plugin.app.workspace.setActiveLeaf(this.leaves()[0], { focus: true });
	}

	getDefaultMode() {
		return "source";
	}

	updateLeaves() {
		if (this.onTarget && this.targetEl && !this.document.contains(this.targetEl)) {
			this.onTarget = false;
			this.transition();
		}
		let leafCount = 0;
		this.plugin.app.workspace.iterateLeaves(() => {
			leafCount++;
		}, this.rootSplit);

		if (leafCount === 0) this.hide();
		this.hoverEl.setAttribute("data-leaf-count", leafCount.toString());
	}

	leaves(): WorkspaceLeaf[] {
		const leaves: WorkspaceLeaf[] = [];
		this.plugin.app.workspace.iterateLeaves((leaf) => {
			leaves.push(leaf);
		}, this.rootSplit);
		return leaves;
	}

	setInitialDimensions() {
		this.hoverEl.setCssStyles({ height: "auto", width: "100%" });
	}

	transition() {
		if (this.shouldShow()) {
			if (this.state === PopoverState.Hiding) {
				this.state = PopoverState.Shown;
				window.clearTimeout(this.timer);
			}
		} else if (this.state === PopoverState.Showing) {
			this.hide();
		} else if (this.state === PopoverState.Shown) {
			this.state = PopoverState.Hiding;
			this.timer = window.setTimeout(() => {
				if (this.shouldShow()) this.transition();
				else this.hide();
			}, this.waitTime);
		}
	}

	buildWindowControls() {
		this.titleEl = this.document.defaultView!.createDiv("popover-titlebar");
		this.titleEl.createDiv("popover-title");
		this.containerEl.prepend(this.titleEl);
	}

	attachLeaf(): WorkspaceLeaf {
		this.rootSplit.getRoot = () =>
			// @ts-ignore — unofficial rootSplit/floatingSplit
			this.plugin.app.workspace[this.document === document ? "rootSplit" : "floatingSplit"]!;
		// @ts-ignore — unofficial getContainer; returned shape varies between
		// the host rootSplit and floatingSplit children.
		this.rootSplit.getContainer = () =>
			DailyNoteEditor.containerForDocument(this.plugin, this.document) as unknown as never;

		this.titleEl.insertAdjacentElement("afterend", this.rootSplit.containerEl);
		// @ts-ignore — unofficial createLeafInParent
		const leaf = this.plugin.app.workspace.createLeafInParent(this.rootSplit, 0);

		this.updateLeaves();
		return leaf;
	}

	onload(): void {
		super.onload();
		this.registerEvent(
			this.plugin.app.workspace.on("layout-change", () => this.updateLeaves())
		);
		this.registerEvent(
			this.plugin.app.workspace.on("layout-change", () => {
				this.rootSplit.children?.forEach((item, index) => {
					if (item instanceof WorkspaceTabs) {
						// `children` on WorkspaceTabs isn't part of the public API.
						const tabsChildren = (item as unknown as { children: unknown[] }).children;
						this.rootSplit.replaceChild(index, tabsChildren[0]);
					}
				});
			})
		);
	}

	onShow() {
		window.setTimeout(() => (this.waitTime = POPOVER_CLOSE_DELAY_MS), POPOVER_CLOSE_DELAY_MS);

		this.oldPopover?.hide();
		this.oldPopover = null;

		this.hoverEl.toggleClass("is-new", true);
		this.document.body.addEventListener(
			"click",
			() => this.hoverEl.toggleClass("is-new", false),
			{ once: true, capture: true }
		);

		if (this.parent) (this.parent as DailyNoteEditorParent).DailyNoteEditor = this;

		this.hoverEl.querySelector(".view-header")?.remove();
		const sizer = this.hoverEl.querySelector(".workspace-leaf");
		if (sizer) this.hoverEl.appendChild(sizer);
		this.hoverEl.querySelector(".inline-title")?.remove();

		this.onShowCallback?.();
		this.onShowCallback = undefined;
	}

	detect(el: HTMLElement) {
		const { targetEl } = this;
		if (targetEl) this.onTarget = el === targetEl || targetEl.contains(el);
	}

	shouldShow(): boolean {
		return this.shouldShowSelf() || this.shouldShowChild();
	}

	shouldShowChild(): boolean {
		return DailyNoteEditor.activePopovers().some((popover) => {
			if (popover !== this && popover.targetEl && this.hoverEl.contains(popover.targetEl)) {
				return popover.shouldShow();
			}
			return false;
		});
	}

	shouldShowSelf(): boolean {
		return (
			!this.detaching &&
			!!(
				this.onTarget ||
				this.state === PopoverState.Shown ||
				this.document.querySelector(
					`body>.modal-container, body > #tm${this.id} ~ .menu, body > #tm${this.id} ~ .suggestion-container`
				)
			)
		);
	}

	show() {
		if (!this.targetEl || this.document.body.contains(this.targetEl)) {
			this.state = PopoverState.Shown;
			this.timer = 0;
			this.targetEl.appendChild(this.hoverEl);
			this.onShow();
			this.plugin.app.workspace.onLayoutChange();
			this.load();
		} else {
			this.hide();
		}

		if (this.hoverEl.dataset.imgHeight && this.hoverEl.dataset.imgWidth) {
			this.hoverEl.style.height =
				parseFloat(this.hoverEl.dataset.imgHeight) + this.titleEl.offsetHeight + "px";
			this.hoverEl.style.width = parseFloat(this.hoverEl.dataset.imgWidth) + "px";
		}
	}

	onHide() {
		this.oldPopover = null;
		if ((this.parent as DailyNoteEditorParent)?.DailyNoteEditor === this) {
			(this.parent as DailyNoteEditorParent).DailyNoteEditor = null;
		}
	}

	hide() {
		this.onTarget = false;
		this.detaching = true;

		if (this.timer) {
			window.clearTimeout(this.timer);
			this.timer = 0;
		}
		this.hoverEl.hide();
		if (this.opening) return;

		const leaves = this.leaves();
		if (leaves.length) {
			leaves[0].detach();
		} else {
			this.parent = null;
			this.abortController?.unload();
			this.abortController = undefined;
			return this.nativeHide();
		}
	}

	nativeHide() {
		const { hoverEl, targetEl } = this;
		this.state = PopoverState.Hidden;
		hoverEl.detach();

		if (targetEl) {
			// @ts-ignore — matchParent on prototype
			const parent = targetEl.matchParent(".tm-leaf-view");
			if (parent) popovers.get(parent)?.transition();
		}

		this.onHide();
		this.unload();
	}

	resolveLink(linkText: string, sourcePath: string): TFile | null {
		const link = parseLinktext(linkText);
		return link
			? this.plugin.app.metadataCache.getFirstLinkpathDest(link.path, sourcePath)
			: null;
	}

	async openLink(
		linkText: string,
		sourcePath: string,
		eState?: EphemeralState,
		createInLeaf?: WorkspaceLeaf
	) {
		let file = this.resolveLink(linkText, sourcePath);
		const link = parseLinktext(linkText);
		if (!file && createInLeaf) {
			const folder = this.plugin.app.fileManager.getNewFileParent(sourcePath);
			// @ts-ignore — unofficial createNewMarkdownFile
			file = await this.plugin.app.fileManager.createNewMarkdownFile(folder, link.path);
		}
		if (!file) return;

		const { viewRegistry } = this.plugin.app;
		const viewType = viewRegistry.typeByExtension[file.extension];
		if (!viewType || !viewRegistry.viewByType[viewType]) return;

		eState = Object.assign(this.buildEphemeralState(file, link), eState);
		const state = this.buildState(this.getDefaultMode(), eState);
		const leaf = await this.openFile(file, state as OpenViewState, createInLeaf);
		const leafViewType = leaf?.view?.getViewType();

		if (leafViewType === "image") {
			if (
				this.parent &&
				Object.prototype.hasOwnProperty.call(this.parent, "editorEl") &&
				(this.parent as unknown as MarkdownEditView).editorEl.hasClass("is-live-preview")
			) {
				this.waitTime = 3000;
			}
			const img = leaf!.view.contentEl.querySelector("img");
			if (img) {
				this.hoverEl.dataset.imgHeight = String(img.naturalHeight);
				this.hoverEl.dataset.imgWidth = String(img.naturalWidth);
				this.hoverEl.dataset.imgRatio = String(img.naturalWidth / img.naturalHeight);
			}
		} else if (leafViewType === "pdf") {
			this.hoverEl.style.height = PDF_POPOVER_HEIGHT;
			this.hoverEl.style.width  = PDF_POPOVER_WIDTH;
		}
		if (state.state?.mode === "source") {
			this.whenShown(() => {
				if (requireApiVersion("1.0")) {
					(leaf?.view as unknown as { editMode?: { reinit?: () => void } })?.editMode?.reinit?.();
				}
				leaf?.view?.setEphemeralState(state.eState);
			});
		}
	}

	whenShown(callback: () => void) {
		if (this.detaching) return;
		const existingCallback = this.onShowCallback;
		this.onShowCallback = () => {
			if (this.detaching) return;
			callback();
			if (typeof existingCallback === "function") existingCallback();
		};
		if (this.state === PopoverState.Shown) {
			this.onShowCallback();
			this.onShowCallback = undefined;
		}
	}

	async openFile(
		file: TFile,
		openState?: OpenViewState,
		useLeaf?: WorkspaceLeaf
	): Promise<WorkspaceLeaf | undefined> {
		if (this.detaching) return;
		const leaf = useLeaf ?? this.attachLeaf();
		this.opening = true;

		try {
			await leaf.openFile(file, openState);
		} catch (e) {
			console.error(e);
		} finally {
			this.opening = false;
			if (this.detaching) this.hide();
		}
		this.plugin.app.workspace.setActiveLeaf(leaf);
		return leaf;
	}

	buildState(parentMode: string, eState?: EphemeralState) {
		return {
			active: false,
			state: { mode: "source" },
			eState,
		};
	}

	buildEphemeralState(file: TFile, link?: { path: string; subpath: string }) {
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const subpath = cache ? resolveSubpath(cache, link?.subpath || "") : undefined;
		const eState: EphemeralState = { subpath: link?.subpath };
		if (subpath) {
			eState.line = subpath.start.line;
			eState.startLoc = subpath.start;
			eState.endLoc = subpath.end || undefined;
		}
		return eState;
	}
}
