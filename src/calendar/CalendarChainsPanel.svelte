<script lang="ts">
	/**
	 * CalendarChainsPanel -- embeds the task-tools Chains view as a side panel
	 * inside the CalendarGrid widget.
	 *
	 * Accesses the obsidian-task-tools plugin instance at runtime (no import
	 * dependency). Gracefully shows a "not installed" notice if the plugin isn't
	 * loaded. Re-renders on metadataCache changes so chain state stays live.
	 */
	import { onDestroy } from "svelte";
	import type { App, TFile } from "obsidian";
	import type TimeManagerPlugin from "../main";
	import Icon from "../utils/Icon.svelte";
	import { setDragPayload } from "./drag-state";

	// -- Minimal type shim for task-tools -------------------------------------

	interface ChainDefinition {
		name: string;
		idKey: string;
		positionKey: string;
		statusKey: string;
		currentStatusValue: string;
		completedStatusValue: string;
		readyStatusValue?: string;
	}

	interface ChainItem {
		file: TFile;
		order: number;
		role: "previous" | "current" | "ready" | "next";
	}

	interface TaskToolsPlugin {
		settings: { chains: ChainDefinition[] };
		findCurrentTask(chain: ChainDefinition): TFile | undefined;
		buildChain(currentFile: TFile, chain: ChainDefinition): ChainItem[];
		openFileRespectingPin(file: TFile): Promise<void>;
		advanceChain(chain: ChainDefinition, file: TFile): Promise<void>;
	}

	// -- Props -----------------------------------------------------------------

	export let plugin: TimeManagerPlugin;

	// -- Helpers ---------------------------------------------------------------

	function getTaskTools(): TaskToolsPlugin {
		return {
			settings: plugin.settings.tasks,
			findCurrentTask: (chain) => plugin.findCurrentTask(chain),
			buildChain: (file, chain) => plugin.buildChain(file, chain),
			openFileRespectingPin: (file) => plugin.openFileRespectingPin(file),
			advanceChain: (chain, file) => plugin.advanceChain(chain, file),
		};
	}

	// -- State -----------------------------------------------------------------

	interface ChainSection {
		chain: ChainDefinition;
		currentFile: TFile | undefined;
		items: ChainItem[];
		viewMode: "dots" | "list";
	}

	let sections: ChainSection[] = [];
	// Track which detail item is active per chain (by chain idKey)
	let activeDetail: Map<string, number> = new Map();

	// -- Load ------------------------------------------------------------------

	function load(): void {
		const tt = getTaskTools();

		sections = tt.settings.chains.map((chain) => {
			const currentFile = tt.findCurrentTask(chain);
			const items = currentFile ? tt.buildChain(currentFile, chain) : [];
			const existing = sections.find((s) => s.chain.idKey === chain.idKey);
			return {
				chain,
				currentFile,
				items,
				viewMode: existing?.viewMode ?? "dots",
			};
		});
	}

	load();

	const unsubMeta = plugin.app.metadataCache.on("changed", () => load());
	onDestroy(() => {
		plugin.app.metadataCache.offref(unsubMeta);
	});

	// -- Actions ---------------------------------------------------------------

	async function openItem(item: ChainItem): Promise<void> {
		await getTaskTools().openFileRespectingPin(item.file);
	}

	async function advance(chain: ChainDefinition, file: TFile): Promise<void> {
		await getTaskTools().advanceChain(chain, file);
		load();
	}

	function toggleViewMode(section: ChainSection): void {
		section.viewMode = section.viewMode === "dots" ? "list" : "dots";
		sections = [...sections]; // trigger reactivity
	}

	function toggleDetail(chainIdKey: string, idx: number): void {
		const current = activeDetail.get(chainIdKey);
		if (current === idx) {
			activeDetail.delete(chainIdKey);
		} else {
			activeDetail.set(chainIdKey, idx);
		}
		activeDetail = new Map(activeDetail); // trigger reactivity
	}

	function roleLabel(role: ChainItem["role"]): string {
		return role === "previous" ? "Done" : role === "current" ? "Current" : role === "ready" ? "Ready" : "Todo";
	}
</script>

<div class="tm-cal-chains-panel">
	<div class="tm-cal-chains-panel-header">
		<span class="tm-cal-chains-panel-title">Chains</span>
		<span class="tm-cal-chains-panel-count">{sections.length}</span>
	</div>

	<div class="tm-cal-chains-panel-body">
		{#if sections.length === 0}
			<div class="tm-cal-chains-empty">
				<Icon name="link" size={18} />
				<span>No chains defined</span>
			</div>
		{:else}
			{#each sections as section (section.chain.idKey)}
				<div class="tm-cal-chain-section">
					<!-- Section header -->
					<div class="tm-cal-chain-section-header">
						<span class="tm-cal-chain-section-name">{section.chain.name}</span>
						<button
							class="tm-cal-chain-view-btn"
							on:click={() => toggleViewMode(section)}
							title="Switch to {section.viewMode === 'dots' ? 'list' : 'dots'} view"
							aria-label="Toggle view mode"
						>
							<Icon name={section.viewMode === "dots" ? "list" : "more-horizontal"} size={13} />
						</button>
					</div>

					{#if section.items.length === 0}
						<div class="tm-cal-chain-empty-row">No current task</div>
					{:else if section.viewMode === "dots"}
						<!-- Dots view -->
						<div class="tm-cal-chain-dots">
							{#each section.items as item, idx (item.file.path)}
								{@const isActive = activeDetail.get(section.chain.idKey) === idx}
								<button
									class="tm-cal-chain-dot tm-cal-chain-dot--{item.role}"
									class:is-active={isActive}
									draggable={true}
									on:dragstart={(e) => {
											setDragPayload({ type: "file", filePath: item.file.path });
										if (e.dataTransfer) {
											e.dataTransfer.effectAllowed = "copy";
											e.dataTransfer.setData("text/plain", item.file.path);
										}
									}}
									on:dragend={() => setDragPayload(null)}
									on:click={() => toggleDetail(section.chain.idKey, idx)}
									title="{item.file.basename} · {roleLabel(item.role)} · Drag to set target date"
									aria-label="{item.file.basename}"
								></button>
							{/each}
						</div>

						<!-- Detail row -->
						{#if activeDetail.has(section.chain.idKey)}
							{@const activeIdx = activeDetail.get(section.chain.idKey) ?? 0}
							{@const activeItem = section.items[activeIdx]}
							{#if activeItem}
								<div class="tm-cal-chain-detail">
									<!-- svelte-ignore a11y-click-events-have-key-events -->
									<span
										class="tm-cal-chain-detail-name"
										on:click={() => void openItem(activeItem)}
										role="button"
										tabindex="0"
									>{activeItem.file.basename}</span>
									<span class="tm-cal-chain-detail-role">{roleLabel(activeItem.role)}</span>
									{#if activeItem.role === "current" && section.items[activeIdx + 1]}
										<button
											class="tm-cal-chain-advance-btn"
											on:click={() => void advance(section.chain, activeItem.file)}
											title="Mark done and advance"
										>Advance →</button>
									{/if}
								</div>
							{/if}
						{/if}

					{:else}
						<!-- List view -->
						<div class="tm-cal-chain-list">
							{#each section.items as item (item.file.path)}
								<!-- svelte-ignore a11y-click-events-have-key-events -->
								<div
									class="tm-cal-chain-list-row tm-cal-chain-list-row--{item.role}"
									draggable={true}
									on:dragstart={(e) => {
											setDragPayload({ type: "file", filePath: item.file.path });
										if (e.dataTransfer) {
											e.dataTransfer.effectAllowed = "copy";
											e.dataTransfer.setData("text/plain", item.file.path);
										}
									}}
									on:dragend={() => setDragPayload(null)}
									on:click={() => void openItem(item)}
									role="button"
									tabindex="0"
									title="{item.file.basename} · {roleLabel(item.role)} · Drag to set target date"
								>
									<span class="tm-cal-chain-list-dot tm-cal-chain-dot--{item.role}">
										{#if item.role === "previous" || item.role === "ready"}
											<Icon name="check" size={9} />
										{/if}
									</span>
									<span class="tm-cal-chain-list-name"
										class:tm-cal-chain-list-name--current={item.role === "current"}
									>{item.file.basename}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.tm-cal-chains-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		width: 210px;
		flex-shrink: 0;
		border-right: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		overflow: hidden;
	}

	.tm-cal-chains-panel-header {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px 8px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.tm-cal-chains-panel-title {
		font-size: var(--font-ui-small);
		font-weight: 600;
		color: var(--text-normal);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.tm-cal-chains-panel-count {
		font-size: var(--font-ui-smaller);
		font-weight: 600;
		color: var(--text-on-accent);
		background: var(--interactive-accent);
		border-radius: 10px;
		padding: 1px 6px;
		min-width: 18px;
		text-align: center;
	}

	.tm-cal-chains-panel-body {
		flex: 1;
		overflow-y: auto;
		padding: 6px 0;
	}

	.tm-cal-chains-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 32px 12px;
		color: var(--text-faint);
		font-size: var(--font-ui-smaller);
		text-align: center;
	}

	/* -- Chain section -- */
	.tm-cal-chain-section {
		padding: 8px 0 10px;
		border-bottom: 1px solid var(--background-modifier-border);
	}
	.tm-cal-chain-section:last-child {
		border-bottom: none;
	}

	.tm-cal-chain-section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 12px 6px;
	}

	.tm-cal-chain-section-name {
		font-size: var(--font-ui-smaller);
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tm-cal-chain-view-btn {
		all: unset;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-s);
		color: var(--text-faint);
		flex-shrink: 0;
		transition: background 80ms ease, color 80ms ease;
	}
	.tm-cal-chain-view-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.tm-cal-chain-empty-row {
		padding: 0 12px;
		font-size: var(--font-ui-smaller);
		color: var(--text-faint);
	}

	/* -- Dots -- */
	.tm-cal-chain-dots {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		padding: 2px 12px 4px;
	}

	.tm-cal-chain-dot {
		all: unset;
		cursor: grab;
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex-shrink: 0;
		user-select: none;
		-webkit-user-drag: element;
		transition: transform 80ms ease, box-shadow 80ms ease;
	}
	.tm-cal-chain-dot:hover {
		transform: scale(1.25);
	}
	.tm-cal-chain-dot.is-active {
		box-shadow: 0 0 0 2px var(--background-secondary), 0 0 0 3.5px var(--interactive-accent);
	}

	/* Role colours */
	.tm-cal-chain-dot--previous {
		background: var(--text-faint);
		opacity: 0.45;
	}
	.tm-cal-chain-dot--current {
		background: var(--interactive-accent);
	}
	.tm-cal-chain-dot--ready {
		background: color-mix(in srgb, var(--interactive-accent) 55%, transparent);
	}
	.tm-cal-chain-dot--next {
		background: var(--background-modifier-border);
		border: 1.5px solid var(--text-faint);
		opacity: 0.6;
	}

	/* -- Detail row -- */
	.tm-cal-chain-detail {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 12px 0;
		flex-wrap: wrap;
	}

	.tm-cal-chain-detail-name {
		font-size: var(--font-ui-small);
		font-weight: 500;
		color: var(--text-accent);
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 110px;
	}
	.tm-cal-chain-detail-name:hover { text-decoration: underline; }

	.tm-cal-chain-detail-role {
		font-size: var(--font-ui-smaller);
		color: var(--text-faint);
		white-space: nowrap;
	}

	.tm-cal-chain-advance-btn {
		all: unset;
		cursor: pointer;
		font-size: var(--font-ui-smaller);
		font-weight: 500;
		color: var(--interactive-accent);
		white-space: nowrap;
		padding: 1px 6px;
		border-radius: var(--radius-s);
		border: 1px solid color-mix(in srgb, var(--interactive-accent) 40%, transparent);
		transition: background 80ms ease;
	}
	.tm-cal-chain-advance-btn:hover {
		background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
	}

	/* -- List view -- */
	.tm-cal-chain-list {
		display: flex;
		flex-direction: column;
	}

	.tm-cal-chain-list-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 12px;
		cursor: grab;
		user-select: none;
		-webkit-user-drag: element;
		transition: background 80ms ease;
	}
	.tm-cal-chain-list-row:hover {
		background: var(--background-modifier-hover);
	}

	.tm-cal-chain-list-dot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.tm-cal-chain-list-name {
		font-size: var(--font-ui-small);
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tm-cal-chain-list-name--current {
		color: var(--text-normal);
		font-weight: 600;
	}
	.tm-cal-chain-list-row--previous .tm-cal-chain-list-name {
		opacity: 0.5;
	}
</style>
