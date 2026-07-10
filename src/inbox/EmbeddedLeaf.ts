import { App, MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import { scrollAndFlashLine } from "./open-item";

/**
 * A lightweight wrapper around a detached WorkspaceLeaf, letting us embed a
 * real, live, editable Obsidian markdown view inside our own DOM instead of
 * a separate workspace pane.
 *
 * `WorkspaceLeaf`'s constructor and `containerEl` are not part of the public
 * API surface, but constructing a leaf outside the root split and attaching
 * its containerEl to a custom parent is an established technique (used by
 * the community Daily Notes Editor plugin, and by jsmorabito/obsidian-dashboards).
 */
export class EmbeddedLeaf {
	private leaf: WorkspaceLeaf;

	constructor(private app: App) {
		const LeafCtor = WorkspaceLeaf as unknown as new (app: App) => WorkspaceLeaf;
		this.leaf = new LeafCtor(this.app);
	}

	private get containerEl(): HTMLElement {
		return (this.leaf as unknown as { containerEl: HTMLElement }).containerEl;
	}

	/** Moves this leaf's DOM into `parent`. Safe to call repeatedly (e.g. after a re-render wipes the old wrapper). */
	attachTo(parent: HTMLElement): void {
		parent.appendChild(this.containerEl);
	}

	/**
	 * Opens `file` for live editing (not read-only reading view). If `line` is
	 * given (an inline #inbox occurrence), places the cursor there and flashes
	 * it, same as opening the item in a real tab does.
	 */
	async openFile(file: TFile, line?: number): Promise<void> {
		await this.leaf.openFile(file, { active: false, state: { mode: "source" } });
		if (line === undefined) return;

		// The editor isn't attached synchronously after openFile resolves — wait a tick.
		await new Promise<void>((r) => window.setTimeout(r, 100));
		const view = this.leaf.view;
		if (!(view instanceof MarkdownView)) return;
		scrollAndFlashLine(view.editor, line);
	}

	detach(): void {
		try {
			this.leaf.detach();
		} catch {
			// Detaching a leaf that was never attached to the workspace tree can
			// throw in some Obsidian versions; the DOM node is removed regardless.
		}
		this.containerEl.remove();
	}
}
