// Ported from quorafind/Obsidian-Daily-Notes-Editor (MIT).
//
// These workspace patches let the embedded leaves inside the editor view
// behave correctly with respect to activeLeaf, layout iteration, and pinning.
// Without them the multi-note view either steals focus oddly or fails to
// render.
//
// Also patches the community "recent-files-obsidian" plugin (if installed) so
// that files opened inside our editor view don't pollute the recent-files list.
//
import { around } from "monkey-around";
import {
	Constructor,
	MarkdownFileInfo,
	OpenViewState,
	Plugin,
	requireApiVersion,
	TFile,
	View,
	Workspace,
	WorkspaceContainer,
	WorkspaceItem,
	WorkspaceLeaf,
} from "obsidian";
import { DailyNoteEditor, isDailyNoteLeaf } from "./leafView";
import { DailyNoteView } from "./view";

export function installWorkspacePatches(plugin: Plugin): void {
	let layoutChanging = false;

	plugin.register(
		around(Workspace.prototype, {
			getActiveViewOfType(next) {
				const wrapped = function (this: Workspace, t: Constructor<View>): View | null {
					const result = next.call(this, t);
					if (!result && (t as unknown as { VIEW_TYPE?: string })?.VIEW_TYPE === "markdown") {
						const activeLeaf = this.activeLeaf;
						if (activeLeaf?.view instanceof DailyNoteView) {
							// The embedded editor's editMode stands in for a real MarkdownView here —
							// callers only touch members the two shapes share at runtime.
							return (activeLeaf.view as unknown as { editMode?: View }).editMode ?? null;
						}
					}
					return result;
				};
				return wrapped as typeof next;
			},
			changeLayout(old) {
				return async function (this: Workspace, workspace: unknown) {
					layoutChanging = true;
					try {
						await old.call(this, workspace);
					} finally {
						layoutChanging = false;
					}
				};
			},
			iterateLeaves(old) {
				type leafIterator = (item: WorkspaceLeaf) => boolean | void;
				const wrapped = function (this: Workspace, arg1: unknown, arg2: unknown) {
					if ((old as unknown as (a: unknown, b: unknown) => boolean).call(this, arg1, arg2)) return true;
					const cb: leafIterator =
						typeof arg1 === "function" ? (arg1 as leafIterator) : (arg2 as leafIterator);
					const parent: WorkspaceItem =
						typeof arg1 === "function" ? (arg2 as WorkspaceItem) : (arg1 as WorkspaceItem);

					if (!parent) return false;
					if (layoutChanging) return false;

					if (!requireApiVersion("0.15.0")) {
						if (
							parent === this.rootSplit ||
							(WorkspaceContainer && parent instanceof WorkspaceContainer)
						) {
							for (const popover of DailyNoteEditor.popoversForWindow(
								(parent as WorkspaceContainer).win
							)) {
								if (old.call(this, cb, popover.rootSplit)) return true;
							}
						}
					}
					return false;
				};
				return wrapped as typeof old;
			},
			setActiveLeaf(nextRaw) {
				// Narrow to the (leaf, params?) overload — the only one this patch calls.
				const next = nextRaw as (leaf: WorkspaceLeaf, params?: { focus?: boolean }) => void;
				const wrapped = function (this: Workspace, e: WorkspaceLeaf, t?: { focus?: boolean }) {
					if (e.parentLeaf) {
						e.parentLeaf.activeTime = 1700000000000;
						next.call(this, e.parentLeaf, t);
						if ((e.view as unknown as { editMode?: unknown }).editMode) {
							// e.view stands in for a MarkdownFileInfo here — runtime duck-typing,
							// same as the editMode substitution in getActiveViewOfType above.
							this.activeEditor = e.view as unknown as MarkdownFileInfo;
							(e.parentLeaf.view as unknown as { editMode: unknown }).editMode = e.view;
						}
						return;
					}
					return next.call(this, e, t);
				};
				return wrapped as typeof nextRaw;
			},
		})
	);

	plugin.register(
		around(WorkspaceLeaf.prototype, {
			getRoot(old) {
				const wrapped = function (this: WorkspaceLeaf): WorkspaceItem {
					const top = old.call(this) as WorkspaceLeaf;
					return top?.getRoot === this.getRoot ? top : top?.getRoot();
				};
				return wrapped as typeof old;
			},
			setPinned(old) {
				const wrapped = function (this: WorkspaceLeaf, pinned: boolean) {
					old.call(this, pinned);
					if (isDailyNoteLeaf(this) && !pinned) this.setPinned(true);
				};
				return wrapped as typeof old;
			},
			openFile(old) {
				const wrapped = function (this: WorkspaceLeaf, file: TFile, openState?: OpenViewState) {
					if (isDailyNoteLeaf(this)) {
						// Suppress Obsidian's built-in recent-opened-file tracking.
						window.setTimeout(
							around(Workspace.prototype, {
								recordMostRecentOpenedFile(recordOld) {
									return function (this: Workspace, _file: TFile) {
										if (_file !== file) return recordOld.call(this, _file);
									};
								},
							}),
							1
						);

						// "recent-files-obsidian" is a third-party community plugin with no
						// published types; its handleOpen method isn't part of our own
						// public-API augmentations above.
						const recentFilesPlugin = plugin.app.plugins?.plugins?.[
							"recent-files-obsidian"
						] as { handleOpen?: (f: TFile) => void } | undefined;
						if (recentFilesPlugin?.handleOpen) {
							const origHandleOpen = recentFilesPlugin.handleOpen.bind(recentFilesPlugin);
							recentFilesPlugin.handleOpen = (f: TFile) => {
								if (f === file) return;
								origHandleOpen(f);
							};
							window.setTimeout(() => {
								recentFilesPlugin.handleOpen = origHandleOpen;
							}, 50);
						}
					}
					return old.call(this, file, openState);
				};
				return wrapped as typeof old;
			},
		})
	);
}
