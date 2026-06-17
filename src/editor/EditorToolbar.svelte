<script lang="ts">
	/**
	 * EditorToolbar — toolbar strip for the multi-note editor view.
	 *
	 * All user actions are dispatched as events so the parent
	 * (DailyNoteEditorView.svelte) retains full control of state.
	 */
	import { createEventDispatcher } from "svelte";
	import { Menu, Platform } from "obsidian";
	import Toggle from "../utils/Toggle.svelte";
	import Icon from "../utils/Icon.svelte";
	import type { Granularity } from "../periodic/types";
	import { displayConfigs } from "../periodic/types";
	import type { SelectionMode, TimeField, TimeRange } from "./types";

	// ── Props ────────────────────────────────────────────────────────────────

	export let granularity: Granularity;
	export let selectionMode: SelectionMode;
	export let timeField: TimeField;
	export let selectedRange: TimeRange;
	export let scrollDirection: "vertical" | "horizontal";
	export let hideFrontmatter: boolean;
	export let hideBacklinks: boolean;
	export let showEmptyNotes: boolean;
	export let enabledGranularities: Granularity[];
	export let totalFileCount: number;
	export let inboxItemCount: number;
	export let showEventsPanel: boolean;
	export let calendarSourcesEnabled: boolean;
	export let folderPath: string;
	export let tag: string;
	/** Two-way bound to the parent so filtering reacts immediately. */
	export let searchQuery: string;

	// ── Local state ──────────────────────────────────────────────────────────

	let activeDropdown = "";
	let showSearch = false;
	let searchInputEl: HTMLInputElement;

	// ── Dispatcher ───────────────────────────────────────────────────────────

	const dispatch = createEventDispatcher<{
		"granularity-change": { value: Granularity };
		"sort-change":        { value: string };
		"filter-change":      { value: TimeRange };
		"toggle-frontmatter": void;
		"toggle-backlinks":   void;
		"toggle-empty-notes": void;
		"toggle-scroll-direction": void;
		"toggle-events-panel":     void;
		"back-to-daily":           void;
		"horizon-mode":            void;
	}>();

	// ── Constants ─────────────────────────────────────────────────────────────

	const sortLabels: Record<string, string> = {
		date:         "Date (newest first)",
		dateReverse:  "Date (oldest first)",
		mtime:        "Modified (newest first)",
		mtimeReverse: "Modified (oldest first)",
		ctime:        "Created (newest first)",
		ctimeReverse: "Created (oldest first)",
		name:         "Name (A–Z)",
		nameReverse:  "Name (Z–A)",
	};

	const filterLabels: Record<TimeRange, string> = {
		all:            "All notes",
		week:           "This week",
		month:          "This month",
		quarter:        "This quarter",
		year:           "This year",
		"last-week":    "Last week",
		"last-month":   "Last month",
		"last-quarter": "Last quarter",
		"last-year":    "Last year",
		custom:         "Custom range",
	};

	const filterOrder: TimeRange[] = [
		"all", "week", "month", "quarter", "year",
		"last-week", "last-month", "last-quarter", "last-year",
	];

	// ── Helpers ───────────────────────────────────────────────────────────────

	const isMobile = Platform.isMobile;

	$: isHorizonMode = selectionMode === "horizon";
	$: isInboxMode   = selectionMode === "inbox";

	function closeDropdowns() { activeDropdown = ""; }
	function toggleDropdown(name: string) {
		activeDropdown = activeDropdown === name ? "" : name;
	}

	function clickOutside(node: HTMLElement, { closeSearch = false } = {}) {
		const handle = (e: MouseEvent) => {
			if (!node.contains(e.target as Node)) {
				closeDropdowns();
				if (closeSearch && searchQuery === "") showSearch = false;
			}
		};
		document.addEventListener("click", handle, true);
		return { destroy() { document.removeEventListener("click", handle, true); } };
	}

	function handleGranularityChange(g: Granularity) {
		dispatch("granularity-change", { value: g });
		closeDropdowns();
	}

	function handleSortChange(field: string) {
		dispatch("sort-change", { value: field });
		activeDropdown = "";
	}

	function handleFilterChange(range: TimeRange) {
		dispatch("filter-change", { value: range });
		activeDropdown = "";
	}

	function handleHorizonMode() {
		dispatch("horizon-mode");
		closeDropdowns();
	}

	function capitalize(s: string) {
		return s.charAt(0).toUpperCase() + s.slice(1);
	}

	// ── Mobile overflow menu ──────────────────────────────────────────────────

	function openMobileOverflow(e: MouseEvent) {
		const menu = new Menu();

		// ── Sort ──────────────────────────────────────────────────────────────
		menu.addItem((i) => i.setTitle("Sort").setIcon("arrow-up-down").setDisabled(true));
		for (const [field, label] of Object.entries(sortLabels)) {
			menu.addItem((i) => {
				i.setTitle(label);
				i.setChecked(timeField === field);
				i.onClick(() => dispatch("sort-change", { value: field }));
			});
		}

		menu.addSeparator();

		// ── Filter ────────────────────────────────────────────────────────────
		menu.addItem((i) => i.setTitle("Filter").setIcon("filter").setDisabled(true));
		for (const range of filterOrder) {
			menu.addItem((i) => {
				i.setTitle(filterLabels[range]);
				i.setChecked(selectedRange === range);
				i.onClick(() => dispatch("filter-change", { value: range }));
			});
		}
		menu.addItem((i) => {
			i.setTitle("Custom range…");
			i.setChecked(selectedRange === "custom");
			i.onClick(() => dispatch("filter-change", { value: "custom" as const }));
		});

		menu.addSeparator();

		// ── Options ───────────────────────────────────────────────────────────
		if (selectionMode === "daily") {
			menu.addItem((i) => {
				i.setTitle(hideFrontmatter ? "Show frontmatter" : "Hide frontmatter");
				i.setIcon("align-justify");
				i.onClick(() => dispatch("toggle-frontmatter"));
			});
			menu.addItem((i) => {
				i.setTitle(hideBacklinks ? "Show backlinks" : "Hide backlinks");
				i.setIcon("link");
				i.onClick(() => dispatch("toggle-backlinks"));
			});
			menu.addItem((i) => {
				i.setTitle(showEmptyNotes ? "Hide empty notes" : "Show empty notes");
				i.setIcon("file");
				i.onClick(() => dispatch("toggle-empty-notes"));
			});
		}

		menu.showAtMouseEvent(e);
	}
</script>

<div class="tm-toolbar" role="toolbar" aria-label="Note view controls" use:clickOutside>

	<!-- ── Granularity / horizon switcher chip ──────────────────────────── -->
	{#if selectionMode === "daily" || selectionMode === "horizon"}
		<div class="tm-switcher-wrap">
			<button
				class="tm-switcher-btn"
				class:tm-switcher-btn--open={activeDropdown === "granularity"}
				on:click|stopPropagation={() => toggleDropdown("granularity")}
				aria-haspopup="listbox"
				aria-expanded={activeDropdown === "granularity"}
			>
				<Icon name="layout-grid" size={14} />
				<span class="tm-switcher-label">
					{#if isHorizonMode}Horizon{:else}{capitalize(displayConfigs[granularity].periodicity)}{/if}
				</span>
				<Icon name="chevron-down" size={12} />
			</button>
			{#if activeDropdown === "granularity"}
				<div class="tm-switcher-dropdown" role="listbox">
					{#each enabledGranularities as g}
						<button
							class="tm-switcher-option"
							class:tm-switcher-option--active={!isHorizonMode && granularity === g}
							role="option"
							aria-selected={!isHorizonMode && granularity === g}
							on:click={() => handleGranularityChange(g)}
						>
							{#if !isHorizonMode && granularity === g}
								<Icon name="check" size={12} />
							{:else}
								<span class="tm-option-check-spacer"></span>
							{/if}
							{capitalize(displayConfigs[g].periodicity)}
						</button>
					{/each}
					<div class="tm-dropdown-separator"></div>
					<button
						class="tm-switcher-option"
						class:tm-switcher-option--active={isHorizonMode}
						role="option"
						aria-selected={isHorizonMode}
						on:click={handleHorizonMode}
					>
						{#if isHorizonMode}
							<Icon name="check" size={12} />
						{:else}
							<span class="tm-option-check-spacer"></span>
						{/if}
						Horizon
					</button>
				</div>
			{/if}
		</div>
		<div class="tm-toolbar-divider"></div>

	{:else}
		<!-- Mode indicator for folder / tag / inbox -->
		<div class="tm-toolbar-mode-indicator">
			{#if selectionMode === "folder"}
				<Icon name="folder" size={13} />
				<span class="tm-toolbar-mode-label">{folderPath || "folder"}</span>
			{:else if selectionMode === "inbox"}
				<Icon name="inbox" size={13} />
				<span class="tm-toolbar-mode-label">Inbox</span>
			{:else}
				<Icon name="tag" size={13} />
				<span class="tm-toolbar-mode-label">{tag || "tag"}</span>
			{/if}
		</div>
		<div class="tm-toolbar-divider"></div>
	{/if}

	<!-- ── Sort / Filter / Properties / Search — hidden in horizon/inbox mode and on mobile ── -->
	{#if !isHorizonMode && !isMobile}

		<!-- Sort -->
		<div class="tm-switcher-wrap">
			<button
				class="tm-toolbar-action"
				class:tm-toolbar-action--active={activeDropdown === "sort"}
				on:click|stopPropagation={() => toggleDropdown("sort")}
				aria-haspopup="listbox"
				aria-expanded={activeDropdown === "sort"}
			>
				<Icon name="arrow-up-down" size={13} />
				Sort
			</button>
			{#if activeDropdown === "sort"}
				<div class="tm-switcher-dropdown" role="listbox">
					{#each Object.entries(sortLabels) as [field, label]}
						<button
							class="tm-switcher-option"
							class:tm-switcher-option--active={timeField === field}
							role="option"
							aria-selected={timeField === field}
							on:click={() => handleSortChange(field)}
						>
							{#if timeField === field}
								<Icon name="check" size={12} />
							{:else}
								<span class="tm-option-check-spacer"></span>
							{/if}
							{label}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Filter -->
		<div class="tm-switcher-wrap">
			<button
				class="tm-toolbar-action"
				class:tm-toolbar-action--active={activeDropdown === "filter"}
				class:tm-toolbar-action--applied={selectedRange !== "all" || !showEmptyNotes}
				on:click|stopPropagation={() => toggleDropdown("filter")}
				aria-haspopup="listbox"
				aria-expanded={activeDropdown === "filter"}
			>
				<Icon name="filter" size={13} />
				Filter{selectedRange !== "all" ? ` · ${filterLabels[selectedRange] ?? selectedRange}` : ""}
			</button>
			{#if activeDropdown === "filter"}
				<div class="tm-switcher-dropdown" role="listbox">
					{#each filterOrder as range}
						<button
							class="tm-switcher-option"
							class:tm-switcher-option--active={selectedRange === range}
							role="option"
							aria-selected={selectedRange === range}
							on:click={() => handleFilterChange(range)}
						>
							{#if selectedRange === range}
								<Icon name="check" size={12} />
							{:else}
								<span class="tm-option-check-spacer"></span>
							{/if}
							{filterLabels[range]}
						</button>
					{/each}
					<div class="tm-dropdown-separator"></div>
					<button
						class="tm-switcher-option"
						class:tm-switcher-option--active={selectedRange === "custom"}
						role="option"
						aria-selected={selectedRange === "custom"}
						on:click={() => handleFilterChange("custom")}
					>
						{#if selectedRange === "custom"}
							<Icon name="check" size={12} />
						{:else}
							<span class="tm-option-check-spacer"></span>
						{/if}
						Custom range…
					</button>
					{#if selectionMode === "daily"}
						<div class="tm-dropdown-separator"></div>
						<!-- svelte-ignore a11y-label-has-associated-control -->
						<label class="tm-prop-toggle">
							<span class="tm-prop-label">Show empty notes</span>
							<Toggle value={showEmptyNotes} onChange={() => dispatch("toggle-empty-notes")} />
						</label>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Properties (daily mode only) -->
		{#if selectionMode === "daily"}
			<div class="tm-switcher-wrap">
				<button
					class="tm-toolbar-action"
					class:tm-toolbar-action--active={activeDropdown === "properties"}
					class:tm-toolbar-action--applied={hideFrontmatter || hideBacklinks}
					on:click|stopPropagation={() => toggleDropdown("properties")}
					aria-haspopup="dialog"
					aria-expanded={activeDropdown === "properties"}
				>
					<Icon name="align-justify" size={13} />
					Properties
				</button>
				{#if activeDropdown === "properties"}
					<div class="tm-switcher-dropdown tm-props-dropdown">
						<!-- svelte-ignore a11y-label-has-associated-control -->
						<label class="tm-prop-toggle">
							<span class="tm-prop-label">Hide frontmatter</span>
							<Toggle value={hideFrontmatter} onChange={() => dispatch("toggle-frontmatter")} />
						</label>
						<!-- svelte-ignore a11y-label-has-associated-control -->
						<label class="tm-prop-toggle">
							<span class="tm-prop-label">Hide backlinks</span>
							<Toggle value={hideBacklinks} onChange={() => dispatch("toggle-backlinks")} />
						</label>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Scroll direction toggle -->
		<button
			class="tm-toolbar-action"
			class:tm-toolbar-action--applied={scrollDirection === "horizontal"}
			title={scrollDirection === "vertical" ? "Switch to horizontal scroll" : "Switch to vertical scroll"}
			on:click={() => dispatch("toggle-scroll-direction")}
			aria-label={scrollDirection === "vertical" ? "Switch to horizontal scroll" : "Switch to vertical scroll"}
		>
			{#if scrollDirection === "vertical"}
				<Icon name="columns-2" size={13} />
			{:else}
				<Icon name="rows-2" size={13} />
			{/if}
		</button>

		<!-- Search -->
		{#if showSearch}
			<div class="tm-search-wrap" use:clickOutside={{ closeSearch: true }}>
				<Icon name="search" size={13} />
				<input
					bind:this={searchInputEl}
					class="tm-search-input"
					type="text"
					placeholder="Search notes…"
					bind:value={searchQuery}
					on:keydown={(e) => { if (e.key === "Escape") { searchQuery = ""; showSearch = false; } }}
				/>
				{#if searchQuery}
					<button class="tm-search-clear" on:click={() => { searchQuery = ""; searchInputEl?.focus(); }} aria-label="Clear search">✕</button>
				{/if}
			</div>
		{:else}
			<button
				class="tm-toolbar-action"
				class:tm-toolbar-action--applied={searchQuery !== ""}
				on:click={() => { showSearch = true; closeDropdowns(); setTimeout(() => searchInputEl?.focus(), 0); }}
			>
				<Icon name="search" size={13} />
				Search
			</button>
		{/if}

	{/if}<!-- end !isHorizonMode -->

	<!-- Note / item count — pushed right -->
	<span class="tm-toolbar-count" aria-live="polite">
		{#if isHorizonMode}
			{enabledGranularities.length} {enabledGranularities.length === 1 ? "period" : "periods"}
		{:else if isInboxMode}
			{inboxItemCount} {inboxItemCount === 1 ? "item" : "items"}
		{:else}
			{totalFileCount} {totalFileCount === 1 ? "note" : "notes"}
		{/if}
	</span>

	<!-- Mobile: search + overflow menu (replaces the full desktop toolbar controls) -->
	{#if isMobile && !isHorizonMode}
		<button
			class="tm-toolbar-action"
			class:tm-toolbar-action--applied={searchQuery !== ""}
			on:click={() => { showSearch = !showSearch; closeDropdowns(); }}
			aria-label="Search"
		>
			<Icon name="search" size={16} />
		</button>
		<button
			class="tm-toolbar-action"
			on:click={(e) => openMobileOverflow(e)}
			aria-label="More options"
			title="Sort, filter and display options"
		>
			<Icon name="more-horizontal" size={16} />
		</button>
		{#if showSearch}
			<div class="tm-mobile-search-wrap">
				<input
					class="tm-search-input"
					type="text"
					placeholder="Search notes…"
					bind:value={searchQuery}
					on:keydown={(e) => { if (e.key === "Escape") { searchQuery = ""; showSearch = false; } }}
				/>
				{#if searchQuery}
					<button class="tm-search-clear" on:click={() => { searchQuery = ""; }} aria-label="Clear search">✕</button>
				{/if}
			</div>
		{/if}
	{/if}

	<!-- Events panel toggle (daily mode + calendar sources enabled, desktop only) -->
	{#if selectionMode === "daily" && calendarSourcesEnabled && !isMobile}
		<button
			class="tm-toolbar-action"
			class:tm-toolbar-action--active={showEventsPanel}
			on:click={() => dispatch("toggle-events-panel")}
			aria-label="Toggle events panel"
			title="Events"
		>
			<Icon name="calendar-days" size={13} />
		</button>
	{/if}

	<!-- Back to daily (folder / tag / inbox modes) -->
	{#if selectionMode !== "daily" && selectionMode !== "horizon"}
		<button
			class="tm-toolbar-btn tm-toolbar-btn--secondary"
			on:click={() => dispatch("back-to-daily")}
		>
			<Icon name="chevron-left" size={12} />
			Daily
		</button>
	{/if}
</div>

<style>
	/* Toolbar shell */
	.tm-toolbar {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px 8px;
		background-color: var(--background-primary);
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.tm-toolbar-mode-label {
		font-size: var(--font-ui-small);
		color: var(--text-muted);
		margin-right: 4px;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Legacy btn styles — "back to daily" button */
	.tm-toolbar-btn {
		all: unset;
		cursor: pointer;
		padding: 3px 12px;
		border-radius: var(--radius-s);
		font-size: var(--font-ui-small);
		color: var(--text-muted);
		transition: background-color 80ms ease, color 80ms ease;
	}
	.tm-toolbar-btn:hover { background-color: var(--background-modifier-hover); color: var(--text-normal); }
	.tm-toolbar-btn--secondary { color: var(--text-muted); font-size: var(--font-ui-smaller); }

	/* Switcher chip */
	.tm-switcher-wrap { position: relative; }
	.tm-switcher-btn {
		all: unset;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 8px;
		border-radius: var(--radius-s);
		font-size: var(--font-ui-small);
		color: var(--text-muted);
		cursor: pointer;
		transition: background-color 80ms ease, color 80ms ease;
		user-select: none;
	}
	.tm-switcher-btn:hover,
	.tm-switcher-btn--open { background-color: var(--background-modifier-hover); color: var(--text-normal); }

	.tm-switcher-dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: var(--layer-menu);
		min-width: 140px;
		/* Use Obsidian's menu-specific token so themes that customise menu backgrounds work */
		background-color: var(--menu-background, var(--background-primary));
		border: 1px solid var(--divider-color, var(--background-modifier-border));
		border-radius: var(--radius-m);
		box-shadow: var(--shadow-s);
		padding: 4px;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.tm-switcher-option {
		all: unset;
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 5px 10px;
		border-radius: var(--radius-s);
		font-size: var(--font-ui-small);
		color: var(--text-normal);
		cursor: pointer;
		transition: background-color 60ms ease;
	}
	.tm-switcher-option:hover { background-color: var(--menu-item-background-hover, var(--background-modifier-hover)); }
	.tm-switcher-option--active { color: var(--menu-item-color-active, var(--text-accent)); }
	.tm-option-check-spacer { display: inline-block; width: 12px; flex-shrink: 0; }

	/* Action buttons */
	.tm-toolbar-divider { width: 1px; height: 16px; background-color: var(--background-modifier-border); margin: 0 2px; flex-shrink: 0; }
	.tm-toolbar-action {
		all: unset;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 8px;
		border-radius: var(--radius-s);
		font-size: var(--font-ui-small);
		color: var(--text-muted);
		cursor: pointer;
		transition: background-color 80ms ease, color 80ms ease;
		white-space: nowrap;
	}
	.tm-toolbar-action:hover { background-color: var(--background-modifier-hover); color: var(--text-normal); }
	.tm-toolbar-action--active { background-color: var(--background-modifier-hover); color: var(--text-normal); }
	.tm-toolbar-action--applied { color: var(--text-accent); }

	/* Dropdowns */
	.tm-dropdown-separator { height: 1px; background-color: var(--background-modifier-border); margin: 4px 0; }
	.tm-props-dropdown { min-width: 200px; }
	.tm-prop-toggle { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; gap: 16px; cursor: default; }
	.tm-prop-label { font-size: var(--font-ui-small); color: var(--text-normal); }

	/* Search */
	.tm-search-wrap {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: var(--radius-s);
		border: 1px solid var(--background-modifier-border);
		background-color: var(--background-primary);
	}
	.tm-search-input { all: unset; font-size: var(--font-ui-small); color: var(--text-normal); width: 140px; }
	.tm-search-input::placeholder { color: var(--text-faint); }
	.tm-search-clear {
		all: unset;
		cursor: pointer;
		color: var(--text-muted);
		font-size: var(--font-ui-smallest);
		line-height: 1;
		padding: 1px 2px;
		border-radius: var(--radius-xs);
	}
	.tm-search-clear:hover { color: var(--text-normal); background-color: var(--background-modifier-hover); }

	/* Note count */
	.tm-toolbar-count { margin-left: auto; font-size: var(--font-ui-smaller); color: var(--text-faint); white-space: nowrap; padding: 2px 6px; }

	/* Mobile search row — shown below the main toolbar row when search is active */
	.tm-mobile-search-wrap {
		display: flex;
		align-items: center;
		gap: 4px;
		flex: 1;
		min-width: 0;
		padding: 0 4px;
	}

	/* Mode indicator (folder / tag / inbox) */
	.tm-toolbar-mode-indicator {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 8px;
		font-size: var(--font-ui-small);
		color: var(--text-muted);
		max-width: 160px;
		overflow: hidden;
	}
</style>
