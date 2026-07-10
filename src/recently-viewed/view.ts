import { ItemView, TFile, WorkspaceLeaf, moment, setIcon } from "obsidian";
import type TimeManagerPlugin from "../main";
import type { RecentFileEntry } from "./types";

export const VIEW_TYPE_RECENTLY_VIEWED = "time-tools-recently-viewed";

export class RecentlyViewedView extends ItemView {
	private plugin: TimeManagerPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: TimeManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_RECENTLY_VIEWED;
	}

	getDisplayText(): string {
		return "Recently viewed";
	}

	getIcon(): string {
		return "clock";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		// nothing to clean up
	}

	render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("rv-container");

		// ── Header ──────────────────────────────────────────────────────────────
		const header = container.createDiv({ cls: "rv-header" });
		const titleRow = header.createDiv({ cls: "rv-title-row" });

		const headerIcon = titleRow.createDiv({ cls: "rv-header-icon" });
		setIcon(headerIcon, "clock");

		 
		titleRow.createSpan({ text: "Recently Viewed", cls: "rv-title" });
		titleRow.createSpan({ cls: "rv-badge" })
			.setText(String(this.plugin.settings.time.recentFiles.length));

		const clearBtn = header.createEl("button", {
			cls: "rv-clear-btn",
			attr: { "aria-label": "Clear history" },
		});
		setIcon(clearBtn, "trash-2");
		clearBtn.addEventListener("click", () => {
			void (async () => {
				this.plugin.settings.time.recentFiles = [];
				await this.plugin.saveSettings();
				this.render();
			})();
		});

		// ── List ────────────────────────────────────────────────────────────────
		const list = container.createDiv({ cls: "rv-list" });
		const files = this.plugin.settings.time.recentFiles;

		if (files.length === 0) {
			const empty = list.createDiv({ cls: "rv-empty" });
			const emptyIcon = empty.createDiv({ cls: "rv-empty-icon" });
			setIcon(emptyIcon, "file-clock");
			empty.createEl("p", { text: "No recently viewed files yet." });
			empty.createEl("p", {
				text: "Open a file to start tracking.",
				cls: "rv-empty-sub",
			});
			return;
		}

		files.forEach((entry: RecentFileEntry, index: number) => {
			const item = list.createDiv({ cls: "rv-item" });
			item.setAttribute("data-path", entry.path);

			item.createSpan({ cls: "rv-index", text: String(index + 1) });

			// File icon — respect Iconic plugin if installed.
			const fileIcon = item.createDiv({ cls: "rv-file-icon" });
			// "iconic" is a third-party community plugin with no published types.
			const iconic = this.app.plugins?.plugins?.["iconic"] as
				| { getFileItem?: (path: string) => { icon?: string; color?: string } | undefined }
				| undefined;
			if (iconic && typeof iconic.getFileItem === "function") {
				const fi = iconic.getFileItem(entry.path);
				if (fi?.icon) {
					setIcon(fileIcon, fi.icon);
					if (fi.color) fileIcon.style.color = fi.color;
				} else {
					setIcon(fileIcon, getFileIcon(entry.extension));
				}
			} else {
				setIcon(fileIcon, getFileIcon(entry.extension));
			}

			// Name + path
			const info = item.createDiv({ cls: "rv-info" });
			const displayName =
				entry.basename +
				(entry.extension && entry.extension !== "md" ? "." + entry.extension : "");
			info.createDiv({ cls: "rv-name", text: displayName });

			if (this.plugin.settings.time.rvShowPath) {
				const folder = entry.path.includes("/")
					? entry.path.substring(0, entry.path.lastIndexOf("/"))
					: "/";
				info.createDiv({ cls: "rv-path", text: folder });
			}

			// Timestamp
			if (this.plugin.settings.time.rvShowTimestamp) {
				item.createDiv({
					cls: "rv-time",
					text: formatRelativeTime(entry.viewedAt),
				});
			}

			// Click to open
			item.addEventListener("click", () => {
				void (async () => {
					const file = this.app.vault.getAbstractFileByPath(entry.path);
					if (file instanceof TFile) {
						const leaf = this.app.workspace.getMostRecentLeaf();
						if (leaf) await leaf.openFile(file);
					}
				})();
			});

			item.setAttribute("title", entry.path);
		});
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFileIcon(extension: string): string {
	const ext = (extension || "").toLowerCase();
	if (ext === "md" || ext === "") return "file-text";
	if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"].includes(ext)) return "image";
	if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "music";
	if (["mp4", "webm", "ogv", "mov"].includes(ext)) return "film";
	if (ext === "pdf") return "file-text";
	if (["js", "ts", "py", "java", "cpp", "c", "css", "html", "json", "yaml"].includes(ext))
		return "code";
	if (["zip", "tar", "gz", "rar"].includes(ext)) return "archive";
	if (["csv", "xlsx", "xls"].includes(ext)) return "table";
	return "file";
}

function formatRelativeTime(timestamp: number): string {
	// moment().from() produces locale-aware relative strings ("2 hours ago", "just now", etc.)
	// consistent with Obsidian's own timestamp formatting.
	return moment(timestamp).fromNow();
}
