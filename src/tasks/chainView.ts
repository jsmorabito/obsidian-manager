import { FuzzySuggestModal, ItemView, MarkdownView, Menu, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import TaskToolsPlugin from "./main";
import type { ChainDefinition, ChainItem } from "./types";
import { HALF_CIRCLE_SVG } from "./checkboxIcons";
import { labelTargetDate } from "../target-date/target-date-service";
import { TargetDateModal } from "../target-date/TargetDateModal";

export class QuickAddFileModal extends FuzzySuggestModal<TFile> {
	private plugin: TaskToolsPlugin;
	private chain: ChainDefinition;

	constructor(plugin: TaskToolsPlugin, chain: ChainDefinition) {
		super(plugin.app);
		this.plugin = plugin;
		this.chain = chain;
		this.setPlaceholder("Choose a file to add to the chain…");
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(file: TFile): string {
		return file.basename;
	}

	// eslint-disable-next-line @typescript-eslint/no-misused-promises -- FuzzySuggestModal calls onChooseItem without awaiting; async override is intentional (errors surface via unhandled rejection)
	async onChooseItem(file: TFile): Promise<void> {
		await this.plugin.addFileToChain(file, this.chain);
	}
}

export const CHAIN_VIEW_TYPE = "task-tools-chain-view";

export class ChainView extends ItemView {
	plugin: TaskToolsPlugin;
	private renderDebounceTimer: number | null = null;
	private mainEditorFile: TFile | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: TaskToolsPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return CHAIN_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Chain";
	}

	getIcon(): string {
		return "link";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.addClass("chain-view-container");

		this.mainEditorFile = this.app.workspace.getActiveFile();
		this.render();

		this.registerEvent(
			this.app.metadataCache.on("changed", () => this.debouncedRender())
		);
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				this.mainEditorFile = file ?? null;
				this.debouncedRender();
			})
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.mainEditorFile = leaf.view.file;
				}
				this.debouncedRender();
			})
		);
	}

	private debouncedRender(): void {
		if (this.renderDebounceTimer !== null) {
			window.clearTimeout(this.renderDebounceTimer);
		}
		this.renderDebounceTimer = window.setTimeout(() => {
			this.renderDebounceTimer = null;
			this.render();
		}, 150);
	}

	async onClose(): Promise<void> {}

	render(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();

		const chains = this.plugin.taskSettings.chains;

		if (chains.length === 0) {
			container.createEl("p", {
				text: "No chain schemas defined. Add one in settings.",
				cls: "chain-view-empty",
			});
			return;
		}

		chains.forEach((chain) => {
			this.renderChainSection(container, chain);
		});
	}

	private renderChainSection(container: HTMLElement, chain: ChainDefinition): void {
		const section = container.createDiv({ cls: "chain-view-section" });

		const header = section.createDiv({ cls: "chain-view-section-header-row" });
		header.createDiv({ text: chain.name, cls: "chain-view-section-header" });

		// View toggle buttons + quick-add (left of group)
		const toggleGroup = header.createDiv({ cls: "chain-view-toggle-group" });
		const addBtn = toggleGroup.createEl("button", { cls: "chain-view-toggle-btn chain-view-add-btn", attr: { "aria-label": "Add file to chain" } });
		setIcon(addBtn, "plus");
		addBtn.addEventListener("click", (e) => {
			this.plugin.openAddToChainMenu(e, chain);
		});

		const savedModes = this.plugin.taskSettings.chainViewModes ?? {};
		let mode: "dots" | "list" = savedModes[chain.idKey] ?? "dots";

		const viewToggleBtn = toggleGroup.createEl("button", {
			cls: "chain-view-toggle-btn",
			attr: { "aria-label": mode === "dots" ? "Switch to list view" : "Switch to dots view" },
		});
		setIcon(viewToggleBtn, mode === "dots" ? "list" : "more-horizontal");

		const trackWrapper = section.createDiv();

		const switchMode = async (newMode: "dots" | "list") => {
			mode = newMode;
			if (!this.plugin.taskSettings.chainViewModes) this.plugin.taskSettings.chainViewModes = {};
			this.plugin.taskSettings.chainViewModes[chain.idKey] = newMode;
			await this.plugin.saveSettings();
			setIcon(viewToggleBtn, newMode === "dots" ? "list" : "more-horizontal");
			viewToggleBtn.setAttribute("aria-label", newMode === "dots" ? "Switch to list view" : "Switch to dots view");
			trackWrapper.empty();
			if (currentTask && items.length > 0) {
				if (newMode === "dots") renderDots(trackWrapper);
				else renderList(trackWrapper);
			}
		};

		viewToggleBtn.addEventListener("click", () => { void switchMode(mode === "dots" ? "list" : "dots"); });

		const currentTask = this.plugin.findCurrentTask(chain);

		if (!currentTask) {
			trackWrapper.createEl("p", {
				text: "No current task set.",
				cls: "chain-view-empty chain-view-empty--inline",
			});
			return;
		}

		const items = this.plugin.buildChain(currentTask, chain);

		if (items.length === 0) {
			trackWrapper.createEl("p", {
				text: "Current task is not part of a chain.",
				cls: "chain-view-empty chain-view-empty--inline",
			});
			return;
		}

		const detailEl = section.createDiv({ cls: "chain-view-detail" });

		const renderDots = (parent: HTMLElement) => {
			const trackEl = parent.createDiv({ cls: "chain-view-track" });
			const mainFile = this.mainEditorFile;

			let dragSrcIdx: number | null = null;
			const wrappers: HTMLElement[] = [];

			const clearDropIndicators = () => {
				wrappers.forEach((w) => w.classList.remove("drop-before", "drop-after"));
			};

			items.forEach((item, idx) => {
				const wrapper = trackEl.createDiv({ cls: "chain-view-dot-wrapper" });
				wrapper.draggable = true;
				wrappers.push(wrapper);

				const isOpen = mainFile?.path === item.file.path;
				const dot = wrapper.createDiv({
					cls: `chain-view-dot chain-view-dot--${item.role}${isOpen ? " is-open" : ""}`,
				});

				const tip = document.body.createDiv({
					text: item.file.basename,
					cls: "chain-dot-tip",
				});
				dot.addEventListener("mouseenter", () => {
					const rect = dot.getBoundingClientRect();
					tip.style.left = `${rect.left + rect.width / 2}px`;
					tip.style.top = `${rect.bottom + 6}px`;
					tip.classList.add("chain-dot-tip--visible");
				});
				dot.addEventListener("mouseleave", () => {
					tip.classList.remove("chain-dot-tip--visible");
				});
				this.register(() => tip.remove());

				dot.addEventListener("click", () => {
					const isActive = dot.classList.contains("is-active");
					trackEl.querySelectorAll(".chain-view-dot.is-active").forEach((d) =>
						d.classList.remove("is-active")
					);
					if (isActive) {
						detailEl.empty();
						detailEl.classList.remove("is-visible");
					} else {
						dot.classList.add("is-active");
						this.renderDetailPanel(detailEl, item, idx, items, chain);
						detailEl.classList.add("is-visible");
					}
				});

				wrapper.addEventListener("dragstart", (e) => {
					dragSrcIdx = idx;
					wrapper.classList.add("is-dragging");
					if (e.dataTransfer) {
						e.dataTransfer.effectAllowed = "copyMove";
						// Reorder-within-chain uses dragSrcIdx above, not this payload.
						// This text/plain data is what lets dropping onto a note's
						// editor insert a wikilink at the cursor (CM6's default drop
						// handling inserts text/plain data at the drop position).
						e.dataTransfer.setData("text/plain", `[[${item.file.basename}]]`);
					}
				});
				wrapper.addEventListener("dragend", () => {
					dragSrcIdx = null;
					wrapper.classList.remove("is-dragging");
					clearDropIndicators();
				});
				wrapper.addEventListener("dragover", (e) => {
					e.preventDefault();
					if (dragSrcIdx === null || dragSrcIdx === idx) return;
					if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
					const rect = wrapper.getBoundingClientRect();
					const insertBefore = e.clientX < rect.left + rect.width / 2;
					clearDropIndicators();
					wrapper.classList.add(insertBefore ? "drop-before" : "drop-after");
				});
				wrapper.addEventListener("dragleave", (e) => {
					if (!wrapper.contains(e.relatedTarget as Node)) {
						wrapper.classList.remove("drop-before", "drop-after");
					}
				});
				wrapper.addEventListener("drop", (e) => {
					e.preventDefault();
					if (dragSrcIdx === null || dragSrcIdx === idx) return;
					const rect = wrapper.getBoundingClientRect();
					const insertBefore = e.clientX < rect.left + rect.width / 2;
					const src = dragSrcIdx;
					const draggedItem = items[src];
					if (!draggedItem) return;
					const newOrder = items.filter((_, i) => i !== src);
					const targetIdx = newOrder.indexOf(item);
					newOrder.splice(insertBefore ? targetIdx : targetIdx + 1, 0, draggedItem);
					void (async () => {
						for (let i = 0; i < newOrder.length; i++) {
							const entry = newOrder[i];
							if (!entry) continue;
							await this.app.fileManager.processFrontMatter(entry.file, (front: Record<string, unknown>) => {
								front[chain.positionKey] = i + 1;
							});
						}
					})();
				});
			});
		};

		const renderList = (parent: HTMLElement) => {
			const listEl = parent.createDiv({ cls: "chain-view-list" });
			const mainFile = this.mainEditorFile;

			let dragSrcIdx: number | null = null;
			const rows: HTMLElement[] = [];

			const clearDropIndicators = () => {
				rows.forEach((r) => r.classList.remove("drop-before", "drop-after"));
			};

				// After a drag reorder: reassign positions and statuses based on new order.
				// Explicitly writes status to every item to prevent stale frontmatter.
				const reassignStatuses = async (newItems: ChainItem[], currentWasDragged: boolean) => {
					const currentIdx = newItems.findIndex((i) => i.role === "current");
					// If no current item is found (race condition with metadata cache), bail out
					// rather than deleting all statuses and breaking the chain.
					if (currentIdx === -1) return;
					const readyVal = chain.readyStatusValue ?? "ready";

					// Case A: current dragged EARLIER - done items now appear after it.
					// current becomes done, first todo/ready after it becomes new current.
					const doneAfterCurrent = currentWasDragged &&
						newItems.slice(currentIdx + 1).some((i) => i.role === "previous");

					// Case B: current dragged LATER - todo/ready items now appear before it.
					// last todo/ready before current becomes new current, old current becomes todo.
					const todoBeforeCurrent = currentWasDragged &&
						newItems.slice(0, currentIdx).some(
							(i) => i.role === "next" || i.role === "ready"
						);

					if (doneAfterCurrent) {
						let newCurrentIdx = -1;
						for (let i = currentIdx + 1; i < newItems.length; i++) {
							const r = newItems[i].role;
							if (r === "next" || r === "ready") { newCurrentIdx = i; break; }
						}
						// No next/ready item after current — keep the current item as current
						// rather than marking everything done and leaving no current task.
						if (newCurrentIdx === -1) newCurrentIdx = currentIdx;
						for (let i = 0; i < newItems.length; i++) {
							const itm = newItems[i];
							await this.app.fileManager.processFrontMatter(itm.file, (front: Record<string, unknown>) => {
								front[chain.positionKey] = i + 1;
								if (i < newCurrentIdx) {
									front[chain.statusKey] = chain.completedStatusValue;
								} else if (i === newCurrentIdx) {
									front[chain.statusKey] = chain.currentStatusValue;
								} else {
									if (front[chain.statusKey] !== readyVal) delete front[chain.statusKey];
								}
							});
						}
					} else if (todoBeforeCurrent) {
						// Find the last todo/ready before current - that becomes new current
						let newCurrentIdx = -1;
						for (let i = currentIdx - 1; i >= 0; i--) {
							const r = newItems[i].role;
							if (r === "next" || r === "ready") { newCurrentIdx = i; break; }
						}
						for (let i = 0; i < newItems.length; i++) {
							const itm = newItems[i];
							await this.app.fileManager.processFrontMatter(itm.file, (front: Record<string, unknown>) => {
								front[chain.positionKey] = i + 1;
								if (i < newCurrentIdx) {
									// Preserve: done stays done, todo stays todo
									if (itm.role === "previous") {
										front[chain.statusKey] = chain.completedStatusValue;
									} else {
										if (front[chain.statusKey] !== readyVal) delete front[chain.statusKey];
									}
								} else if (i === newCurrentIdx) {
									front[chain.statusKey] = chain.currentStatusValue;
								} else {
									// Old current and everything after becomes todo
									if (front[chain.statusKey] !== readyVal) delete front[chain.statusKey];
								}
							});
						}
					} else {
						// Normal case: a non-current item was dragged.
						for (let i = 0; i < newItems.length; i++) {
							const itm = newItems[i];
							await this.app.fileManager.processFrontMatter(itm.file, (front: Record<string, unknown>) => {
								front[chain.positionKey] = i + 1;
								if (i < currentIdx) {
									front[chain.statusKey] = chain.completedStatusValue;
								} else if (i === currentIdx) {
									front[chain.statusKey] = chain.currentStatusValue;
								} else {
									if (front[chain.statusKey] !== readyVal) delete front[chain.statusKey];
								}
							});
						}
					}
				};


			items.forEach((item, idx) => {
				const row = listEl.createDiv({ cls: `chain-view-list-row chain-view-list-row--${item.role}` });
				row.draggable = true;
				rows.push(row);

				// Dot
				const isOpen = mainFile?.path === item.file.path;
				const dot = row.createSpan({
					cls: `chain-view-list-dot chain-sb-node--${item.role}${isOpen ? " is-open" : ""}`,
				});
				if (item.role === "previous" || item.role === "ready") setIcon(dot, "check");
				// eslint-disable-next-line no-unsanitized/property -- HALF_CIRCLE_SVG is a hardcoded literal, not user-controlled
				if (item.role === "inProgress") dot.innerHTML = HALF_CIRCLE_SVG;

				// Name
				row.createSpan({
					text: item.file.basename,
					cls: "chain-view-list-name" + (item.role === "current" ? " chain-view-list-name--current" : ""),
				});

				// Target date chip (far right)
				const targetDate = this.plugin.targetDateService.getTargetDate(item.file);
				if (targetDate) {
					const chip = row.createSpan({
						text: labelTargetDate(targetDate.raw, targetDate.granularity),
						cls: "chain-view-list-target-chip",
					});
					chip.addEventListener("click", (e) => {
						e.stopPropagation();
						this.openTargetDateModal(item.file);
					});
				}

				// Click to open
				const open = async () => {
					await this.app.workspace.getLeaf(false).openFile(item.file);
				};
				row.addEventListener("click", () => void open());

				// Drag events
				row.addEventListener("dragstart", (e) => {
					dragSrcIdx = idx;
					row.classList.add("is-dragging");
					if (e.dataTransfer) {
						e.dataTransfer.effectAllowed = "copyMove";
						// Reorder-within-chain uses dragSrcIdx above, not this payload.
						// This text/plain data is what lets dropping onto a note's
						// editor insert a wikilink at the cursor (CM6's default drop
						// handling inserts text/plain data at the drop position).
						e.dataTransfer.setData("text/plain", `[[${item.file.basename}]]`);
					}
				});
				row.addEventListener("dragend", () => {
					dragSrcIdx = null;
					row.classList.remove("is-dragging");
					clearDropIndicators();
				});
				row.addEventListener("dragover", (e) => {
					e.preventDefault();
					if (dragSrcIdx === null || dragSrcIdx === idx) return;
					if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
					clearDropIndicators();
					const rect = row.getBoundingClientRect();
					row.classList.add(e.clientY < rect.top + rect.height / 2 ? "drop-before" : "drop-after");
				});
				row.addEventListener("dragleave", (e) => {
					if (!row.contains(e.relatedTarget as Node)) {
						row.classList.remove("drop-before", "drop-after");
					}
				});
				row.addEventListener("drop", (e) => {
					e.preventDefault();
					if (dragSrcIdx === null || dragSrcIdx === idx) return;
					const src = dragSrcIdx;
					const draggedItem = items[src];
					const rect = row.getBoundingClientRect();
					const insertBefore = e.clientY < rect.top + rect.height / 2;
					const newOrder = items.filter((_, i) => i !== src);
					const targetIdx = newOrder.indexOf(item);
					newOrder.splice(insertBefore ? targetIdx : targetIdx + 1, 0, draggedItem);
					void reassignStatuses(newOrder, draggedItem.role === "current");
				});

				// Right-click context menu — show every status the item isn't currently in
				row.addEventListener("contextmenu", (e) => {
					e.preventDefault();
					const menu = new Menu();

					if (item.role === "current") {
						// Advance chain is the canonical "done + open next" action
						const nextItem = items[idx + 1];
						if (nextItem) {
							menu.addItem((mi) =>
								mi.setTitle("Advance chain").setIcon("arrow-right").onClick(async () => {
									await this.plugin.advanceChain(chain, item.file);
								})
							);
						}
					}

					if (item.role !== "current") {
						menu.addItem((mi) =>
							mi.setTitle("Set as current").setIcon("map-pin").onClick(async () => {
								await this.plugin.setCurrentTask(item.file, chain);
							})
						);
					}

					if (item.role !== "ready" && item.role !== "current") {
						menu.addItem((mi) =>
							mi.setTitle("Mark as ready").setIcon("check-circle").onClick(async () => {
								await this.plugin.setItemStatus(item.file, chain, "ready");
							})
						);
					}

					if (item.role !== "previous" && item.role !== "current") {
						menu.addItem((mi) =>
							mi.setTitle("Mark as done").setIcon("check").onClick(async () => {
								await this.plugin.setItemStatus(item.file, chain, "done");
							})
						);
					}

					if (item.role !== "next" && item.role !== "current") {
						menu.addItem((mi) =>
							mi.setTitle("Mark as todo").setIcon("circle").onClick(async () => {
								await this.plugin.setItemStatus(item.file, chain, "todo");
							})
						);
					}

					if (item.role !== "inProgress" && item.role !== "current") {
						menu.addItem((mi) =>
							mi.setTitle("Mark as in progress").setIcon("circle-half").onClick(async () => {
								await this.plugin.setItemStatus(item.file, chain, "inProgress");
							})
						);
					}

					const existingTarget = this.plugin.targetDateService.getTargetDate(item.file);
					menu.addItem((mi) =>
						mi.setTitle(existingTarget ? "Change target date" : "Set target date")
							.setIcon("target")
							.onClick(() => this.openTargetDateModal(item.file))
					);
					if (existingTarget) {
						menu.addItem((mi) =>
							mi.setTitle("Clear target date").setIcon("x").onClick(async () => {
								await this.plugin.targetDateService.clearTargetDate(item.file);
							})
						);
					}

					menu.addItem((mi) =>
						mi.setTitle("Open file").setIcon("file-open").onClick(open)
					);
					menu.addItem((mi) =>
						mi.setTitle("Remove from chain").setIcon("trash").onClick(async () => {
							await this.plugin.removeFileFromChain(item.file, chain);
						})
					);
					menu.showAtMouseEvent(e);
				});
			});
		};

		// Initial render
		if (mode === "dots") renderDots(trackWrapper);
		else renderList(trackWrapper);
	}

	private renderDetailPanel(
		detailEl: HTMLElement,
		item: ChainItem,
		idx: number,
		items: ChainItem[],
		chain: ChainDefinition
	): void {
		detailEl.empty();

		const nameEl = detailEl.createSpan({
			text: item.file.basename,
			cls: "chain-view-detail__name chain-view-item--clickable",
		});
		nameEl.addEventListener("click", () => {
			void this.app.workspace.getLeaf(false).openFile(item.file);
		});

		const roleLabel = item.role === "previous" ? "Done" : item.role === "current" ? "Current" : item.role === "ready" ? "Ready" : item.role === "inProgress" ? "In Progress" : "Todo";
		detailEl.createSpan({
			text: roleLabel,
			cls: "chain-view-item__role",
		});

		// Reorder buttons
		const reorderEl = detailEl.createSpan({ cls: "chain-view-item__reorder" });

		const upBtn = reorderEl.createEl("button", {
			cls: "chain-view-reorder-btn",
			text: "↑",
			attr: { "aria-label": "Move up" },
		});
		if (idx === 0) upBtn.disabled = true;
		const prevItem = items[idx - 1];
		upBtn.addEventListener("click", () => {
			if (idx > 0 && prevItem) void this.swapOrder(item, prevItem, chain);
		});

		const downBtn = reorderEl.createEl("button", {
			cls: "chain-view-reorder-btn",
			text: "↓",
			attr: { "aria-label": "Move down" },
		});
		if (idx === items.length - 1) downBtn.disabled = true;
		const nextItem = items[idx + 1];
		downBtn.addEventListener("click", () => {
			if (idx < items.length - 1 && nextItem) void this.swapOrder(item, nextItem, chain);
		});

		// Set as current
		if (item.role !== "current") {
			const setBtn = detailEl.createEl("button", {
				cls: "chain-view-set-current-btn",
				text: "Set current",
				attr: { "aria-label": `Set ${item.file.basename} as current task` },
			});
			setBtn.addEventListener("click", () => {
				void this.plugin.setCurrentTask(item.file, chain);
			});
		}

		// Other chains this task belongs to
		const otherChains = this.plugin.getChainsForFile(item.file).filter(
			(c) => c.idKey !== chain.idKey
		);
		if (otherChains.length > 0) {
			const tagsEl = detailEl.createSpan({ cls: "chain-view-item__tags" });
			otherChains.forEach((c) => {
				tagsEl.createSpan({ text: c.name, cls: "chain-view-item__tag" });
			});
		}
	}

	private openTargetDateModal(file: TFile): void {
		const existing = this.plugin.targetDateService.getTargetDate(file);
		new TargetDateModal(
			this.app,
			existing,
			(date, gran) => {
				void this.plugin.targetDateService.setTargetDate(file, date, gran);
			},
			() => {
				void this.plugin.targetDateService.clearTargetDate(file);
			}
		).open();
	}

	private async swapOrder(a: ChainItem, b: ChainItem, chain: ChainDefinition | undefined): Promise<void> {
		if (!chain) return;
		const orderA = a.order;
		const orderB = b.order;

		await this.app.fileManager.processFrontMatter(a.file, (front: Record<string, unknown>) => {
			front[chain.positionKey] = orderB;
		});
		await this.app.fileManager.processFrontMatter(b.file, (front: Record<string, unknown>) => {
			front[chain.positionKey] = orderA;
		});
	}
}
