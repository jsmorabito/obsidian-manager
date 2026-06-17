// Type augmentations for unofficial Obsidian APIs the embedded-leaf editor view
// relies on. Adapted from the upstream Daily Notes Editor's `obsidian.d.ts`,
// trimmed to only what this plugin actually touches.
import "obsidian";
import type {
	Loc,
	Plugin,
	PluginManifest,
	TFile,
	TFolder,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	View,
	WorkspaceItem,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	WorkspaceLeaf,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	WorkspaceSplit,
} from "obsidian";

declare global {
	interface Window {
		activeWindow: Window;
		activeDocument: Document;
		// Obsidian exposes the running App on `window.app` even though it isn't
		// in the public types. We use it inside leafView's WorkspaceSplit
		// constructor where we don't have `this.app` yet.
		app: import("obsidian").App;
	}
}

declare module "obsidian" {
	interface App {
		plugins: {
			manifests: Record<string, PluginManifest>;
			plugins: Record<string, Plugin> & {
				["recent-files-obsidian"]?: Plugin & {
					shouldAddFile(file: TFile): boolean;
				};
			};
			getPlugin(id: string): Plugin | undefined;
		};
		viewRegistry: ViewRegistry;
	}

	interface ViewRegistry {
		typeByExtension: Record<string, string>;
		viewByType: Record<string, (leaf: WorkspaceLeaf) => View>;
	}

	interface WorkspaceLeaf {
		containerEl: HTMLDivElement;
		parentLeaf?: WorkspaceLeaf;
		height: number;
		activeTime?: number;
		pinned?: boolean;
	}

	interface Workspace {
		// `iterateLeaves` is an unofficial overload that accepts (cb, item) —
		// used by the editor view to walk an embedded popover's rootSplit.
		iterateLeaves(
			callback: (item: WorkspaceLeaf) => boolean | void,
			item: WorkspaceItem | WorkspaceItem[]
		): boolean;
		recordMostRecentOpenedFile(file: TFile): void;
		onLayoutChange(): void;
		floatingSplit?: { children: Array<{ doc: Document; win: Window }> };
		createLeafInParent(parent: WorkspaceSplit, index: number): WorkspaceLeaf;
	}

	// `children` / `replaceChild` are private but used by the editor view to
	// flatten an embedded leaf out of an auto-created WorkspaceTabs.
	interface WorkspaceSplit {
		containerEl: HTMLElement;
		children?: unknown[];
		replaceChild(index: number, child: unknown, resize?: boolean): void;
	}

	interface View {
		contentEl: HTMLElement;
		titleEl: HTMLElement;
		headerEl: HTMLElement;
	}

	interface MarkdownEditView {
		editorEl: HTMLElement;
	}

	interface FileManager {
		createNewMarkdownFile(folder: TFolder, fileName: string): Promise<TFile>;
	}

	interface HoverPopover {
		// `parent` is dynamic at runtime — we cast on use.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		parent: any;
		targetEl: HTMLElement;
		hoverEl: HTMLElement;
		state: PopoverState;
		timer: number;
		waitTime: number;
	}

	enum PopoverState {
		Showing = 0,
		Shown = 1,
		Hiding = 2,
		Hidden = 3,
	}

	interface EphemeralState {
		focus?: boolean;
		subpath?: string;
		line?: number;
		startLoc?: Loc;
		endLoc?: Loc;
		scroll?: number;
	}
}

export {};
