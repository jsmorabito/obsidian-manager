/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
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
		// eslint-disable-next-line obsidianmd/ui/sentence-case
	return "Recently Viewed";
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
		const header = container.createEl("div", { cls: "rv-header" });
		const titleRow = header.createEl("div", { cls: "rv-title-row" });

		const headerIcon = titleRow.createEl("div", { cls: "rv-header-icon" });
		setIcon(headerIcon, "clock");

		// eslint-disable-next-line obsidianmd/ui/sentence-case
		titleRow.createEl("span", { text: "Recently Viewed", cls: "rv-title" });
		titleRow
			.createEl("span", { cls: "rv-badge" })
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
		const list = container.createEl("div", { cls: "rv-list" });
		const files = this.plugin.settings.time.recentFiles;

		if (files.length === 0) {
			const empty = list.createEl("div", { cls: "rv-empty" });
			const emptyIcon = empty.createEl("div", { cls: "rv-empty-icon" });
			setIcon(emptyIcon, "file-clock");
			empty.createEl("p", { text: "No recently viewed files yet." });
			empty.createEl("p", {
				text: "Open a file to start tracking.",
				cls: "rv-empty-sub",
			});
			return;
		}

		files.forEach((entry: RecentFileEntry, index: number) => {
			const item = list.createEl("div", { cls: "rv-item" });
			item.setAttribute("data-path", entry.path);

			item.createEl("span", { cls: "rv-index", text: String(index + 1) });

			// File icon — respect Iconic plugin if installed.
			const fileIcon = item.createEl("div", { cls: "rv-file-icon" });
			const iconic = (this.app as any).plugins?.plugins?.["iconic"];
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
			const info = item.createEl("div", { cls: "rv-info" });
			const displayName =
				entry.basename +
				(entry.extension && entry.extension !== "md" ? "." + entry.extension : "");
			info.createEl("div", { cls: "rv-name", text: displayName });

			if (this.plugin.settings.time.rvShowPath) {
				const folder = entry.path.includes("/")
					? entry.path.substring(0, entry.path.lastIndexOf("/"))
					: "/";
				info.createEl("div", { cls: "rv-path", text: folder });
			}

			// Timestamp
			if (this.plugin.settings.time.rvShowTimestamp) {
				item.createEl("div", {
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
