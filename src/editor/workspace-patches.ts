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
// `this: any` annotations are intentional: monkey-around installs these as
// prototype methods, so `this` is dynamically the host object (Workspace or
// WorkspaceLeaf) rather than something we can name statically without
// dragging private types into the public surface.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { around } from "monkey-around";
import {
	Plugin,
	requireApiVersion,
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
		around(Workspace.prototype as any, {
			getActiveViewOfType: (next: any) =>
				function (this: any, t: any) {
					const result = next.call(this, t);
					if (!result && t?.VIEW_TYPE === "markdown") {
						const activeLeaf = this.activeLeaf;
						if (activeLeaf?.view instanceof DailyNoteView) {
							return activeLeaf.view.editMode;
						}
					}
					return result;
				},
			changeLayout(old: any) {
				return async function (this: any, workspace: unknown) {
					layoutChanging = true;
					try {
						await old.call(this, workspace);
					} finally {
						layoutChanging = false;
					}
				};
			},
			iterateLeaves(old: any) {
				type leafIterator = (item: WorkspaceLeaf) => boolean | void;
				return function (this: any, arg1: any, arg2: any) {
					if (old.call(this, arg1, arg2)) return true;
					const cb: leafIterator =
						typeof arg1 === "function" ? arg1 : arg2;
					const parent: WorkspaceItem =
						typeof arg1 === "function" ? arg2 : arg1;

					if (!parent) return false;
					if (layoutChanging) return false;

					if (!requireApiVersion("0.15.0")) {
						if (
							parent === this.app.workspace.rootSplit ||
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
			},
			setActiveLeaf: (next: any) =>
				function (this: any, e: WorkspaceLeaf, t?: any) {
					if ((e as any).parentLeaf) {
						(e as any).parentLeaf.activeTime = 1700000000000;
						next.call(this, (e as any).parentLeaf, t);
						if ((e.view as any).editMode) {
							this.activeEditor = e.view;
							(e as any).parentLeaf.view.editMode = e.view;
						}
						return;
					}
					return next.call(this, e, t);
				},
		})
	);

	plugin.register(
		around(WorkspaceLeaf.prototype, {
			getRoot(old: any) {
				return function (this: any) {
					const top = old.call(this);
					return top?.getRoot === this.getRoot ? top : top?.getRoot();
				};
			},
			setPinned(old: any) {
				return function (this: any, pinned: boolean) {
					old.call(this, pinned);
					if (isDailyNoteLeaf(this) && !pinned) this.setPinned(true);
				};
			},
			openFile(old: any) {
				return function (this: any, file: any, openState?: any) {
					if (isDailyNoteLeaf(this)) {
						// Suppress Obsidian's built-in recent-opened-file tracking.
						setTimeout(
							around(Workspace.prototype as any, {
								recordMostRecentOpenedFile(old: any) {
									return function (this: any, _file: any) {
										if (_file !== file) return old.call(this, _file);
									};
								},
							}),
							1
						);

						// Suppress the community "recent-files-obsidian" plugin if present.
						const recentFilesPlugin = (plugin.app as any).plugins?.plugins?.[
							"recent-files-obsidian"
						];
						if (recentFilesPlugin?.handleOpen) {
							const origHandleOpen = recentFilesPlugin.handleOpen.bind(recentFilesPlugin);
							recentFilesPlugin.handleOpen = (f: any) => {
								if (f === file) return;
								origHandleOpen(f);
							};
							setTimeout(() => {
								recentFilesPlugin.handleOpen = origHandleOpen;
							}, 50);
						}
					}
					return old.call(this, file, openState);
				};
			},
		})
	);
}
