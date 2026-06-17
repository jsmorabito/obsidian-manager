<script lang="ts">
	// Ported from quorafind/Obsidian-Daily-Notes-Editor (MIT).
	import type TimeManagerPlugin from "../main";
	import type { WorkspaceLeaf } from "obsidian";
	import { TFile, moment, Platform } from "obsidian";
	import DailyNote from "./DailyNote.svelte";
	import InboxLine from "./InboxLine.svelte";
	import EditorToolbar from "./EditorToolbar.svelte";
	import BreadcrumbBar from "./BreadcrumbBar.svelte";
	import EventsSidePanel from "./EventsSidePanel.svelte";
	import HorizonView from "./HorizonView.svelte";
	import { inview } from "svelte-inview";
	import type { TaggedInboxItem } from "./InboxService";
	import type { CustomRange, SelectionMode, TimeField, TimeRange, BreadcrumbSeg, SubPeriod, IEditorLeafView } from "./types";
	import type { Granularity } from "../periodic/types";
	import { granularities, displayConfigs } from "../periodic/types";
	import { onMount, tick as svelteTick } from "svelte";
	import { FileManager, type FileManagerOptions } from "./file-manager";
	import { getPeriodicNote, createPeriodicNote, getFormat } from "../periodic/api";
	import { startOfHalfYear, endOfHalfYear, addHalfYears, isSameHalfYear, halfOf, parseHalfYear } from "../periodic/half-year";

	// ── Props ────────────────────────────────────────────────────────────────

	export let plugin: TimeManagerPlugin;
	export let leaf: WorkspaceLeaf;
	export let selectedRange: TimeRange = "all";
	export let timeField: TimeField = "mtime";
	export let granularity: Granularity = "day";
	export let selectionMode: SelectionMode = "daily";
	export let folderPath = "";
	export let tag = "";
	export let customRange: CustomRange | undefined = undefined;
	export let scrollDirection: "vertical" | "horizontal" = "vertical";

	/** Number of notes added to the rendered list per infinite-scroll tick. */
	const SCROLL_BATCH_SIZE = 1;

	// ── File list state ───────────────────────────────────────────────────────

	let renderedFiles: TFile[] = [];
	let filteredFiles: TFile[] = [];
	let totalFileCount = 0;
	let visibleNotes: Set<string> = new Set();
	/** File determined to be at the top of the viewport via scroll events. */
	let scrollFocusedFile: TFile | null = null;

	// ── Toolbar / display state ───────────────────────────────────────────────

	let searchQuery = "";
	let hideFrontmatter = plugin.settings.time.hideFrontmatter;
	let hideBacklinks   = plugin.settings.time.hideBacklinks;
	let showEmptyNotes  = true;
	let showEventsPanel = false;

	// ── Scroll DOM refs ───────────────────────────────────────────────────────

	let loaderRef: HTMLDivElement;
	let topLoaderRef: HTMLDivElement;
	let scrollEl: HTMLDivElement;

	// ── Infinite scroll state ─────────────────────────────────────────────────

	let hasMore = true;
	let firstLoaded = true;

	/** Notes newer than renderedFiles[0], oldest-future-first. */
	let futureFiles: TFile[] = [];
	let hasMoreFuture = false;

	/** Blocks prependBatch during initial mount and after any programmatic scroll-to-top. */
	let _prependEnabled = false;
	/**
	 * True only after the user has scrolled DOWN at least 100px.
	 * Ensures prependBatch fires only on an intentional up-scroll.
	 */
	let _wasScrolledDown = false;
	let _prependInProgress = false;

	/** rAF-based fill loop flag — replaces the old 1ms setInterval. */
	let _fillRunning = false;

	// ── Horizontal prepend generation counter ────────────────────────────────

	let _hScrollGen = 0;

	// ── FileManager ───────────────────────────────────────────────────────────

	let fileManager: FileManager;

	$: fileManagerOptions = {
		resolver: plugin,
		app: plugin.app,
		timeRange: selectedRange,
		timeField,
		granularity,
		selectionMode,
		folderPath,
		tag,
		customRange,
	} as FileManagerOptions;

	$: if (
		fileManager &&
		(selectedRange !== fileManager.options.timeRange ||
			timeField !== fileManager.options.timeField ||
			granularity !== fileManager.options.granularity ||
			selectionMode !== fileManager.options.selectionMode ||
			folderPath !== fileManager.options.folderPath ||
			tag !== fileManager.options.tag)
	) {
		fileManager.updateOptions({
			timeRange: selectedRange,
			timeField,
			granularity,
			selectionMode,
			folderPath,
			tag,
			customRange,
		});
		renderedFiles = [];
		visibleNotes.clear();
		futureFiles = []; hasMoreFuture = false;
		filteredFiles = applyEmptyFilter(fileManager.getFilteredFiles());
		totalFileCount = filteredFiles.length;
		hasMore = filteredFiles.length > 0;
		firstLoaded = true;
		startFillViewport();
		updateTitleElement();
	}

	// ── Leaf-view typed accessor (replaces @ts-ignore) ────────────────────────

	function callView(): IEditorLeafView | null {
		return (leaf?.view as unknown as IEditorLeafView) ?? null;
	}

	// ── onMount ───────────────────────────────────────────────────────────────

	onMount(() => {
		// Horizontal scroll is unusable on mobile — silently fall back to vertical.
		if (Platform.isMobile && scrollDirection === "horizontal") {
			scrollDirection = "vertical";
			callView()?.setScrollDirection?.("vertical");
		}

		fileManager = new FileManager(fileManagerOptions);

		if (selectionMode === "daily" && scrollDirection === "vertical") {
			const allFiles = applyEmptyFilter(fileManager.getFilteredFiles());
			totalFileCount = allFiles.length;
			const todayFile = getPeriodicNote(plugin, granularity, moment());
			const idx = todayFile ? allFiles.findIndex((f) => f.path === todayFile.path) : -1;
			const start = idx === -1 ? 0 : idx;
			const LOOK_AHEAD = 10;
			const renderEnd = Math.min(allFiles.length, start + 1 + LOOK_AHEAD);
			futureFiles = allFiles.slice(0, start).reverse();
			hasMoreFuture = futureFiles.length > 0;
			renderedFiles = allFiles.slice(start, renderEnd);
			filteredFiles = allFiles.slice(renderEnd);
			hasMore = filteredFiles.length > 0;
			firstLoaded = false;
			if (todayFile) {
				visibleNotes.add(todayFile.path);
				visibleNotes = visibleNotes;
				scrollFocusedFile = todayFile;
			}
			if (!todayFile) {
				createPeriodicNote(plugin, granularity, moment()).then((newFile) => {
					fileManager.fileCreate(newFile);
					renderedFiles = [newFile, ...renderedFiles];
					visibleNotes.add(newFile.path);
					visibleNotes = visibleNotes;
					scrollFocusedFile = newFile;
					requestAnimationFrame(() => { if (scrollEl) scrollEl.scrollTop = 0; });
				}).catch(console.error);
			}
		} else {
			filteredFiles = applyEmptyFilter(fileManager.getFilteredFiles());
			totalFileCount = filteredFiles.length;
			hasMore = filteredFiles.length > 0;
			firstLoaded = true;
		}

		startFillViewport();
		updateTitleElement();

		// Seed inbox items on entry if already in inbox mode.
		if (selectionMode === "inbox") {
			inboxItems = plugin.inboxService.getInboxItems();
		}

		// Allow upward prepend only after the initial render is stable.
		requestAnimationFrame(() => requestAnimationFrame(() => { _prependEnabled = true; }));
	});

	// ── Search ────────────────────────────────────────────────────────────────

	let _searchGeneration = 0;
	$: if (fileManager) void applySearchQuery(searchQuery);

	let _prevShowEmptyNotes = true;
	$: if (fileManager && showEmptyNotes !== _prevShowEmptyNotes) {
		_prevShowEmptyNotes = showEmptyNotes;
		filteredFiles = applyEmptyFilter(fileManager.getFilteredFiles());
		renderedFiles = [];
		visibleNotes.clear();
		futureFiles = []; hasMoreFuture = false;
		hasMore = filteredFiles.length > 0;
		firstLoaded = true;
		startFillViewport();
	}

	let _lastSearchQuery = "";

	async function applySearchQuery(q: string) {
		const gen = ++_searchGeneration;
		const query = q.trim().toLowerCase();
		const prevQuery = _lastSearchQuery;
		_lastSearchQuery = query;
		if (!query && !prevQuery) return;
		const all = fileManager.getFilteredFiles();

		let matches: TFile[];
		if (!query) {
			matches = all;
		} else {
			const results = await Promise.all(
				all.map(async (f) => {
					if (f.basename.toLowerCase().includes(query)) return f;
					try {
						const content = await plugin.app.vault.cachedRead(f);
						if (content.toLowerCase().includes(query)) return f;
					} catch { /* ignore unreadable files */ }
					return null;
				})
			);
			if (gen !== _searchGeneration) return;
			matches = results.filter((f): f is TFile => f !== null);
		}

		if (gen !== _searchGeneration) return;
		filteredFiles = applyEmptyFilter(matches);
		renderedFiles = [];
		visibleNotes.clear();
		futureFiles = []; hasMoreFuture = false;
		hasMore = filteredFiles.length > 0;
		firstLoaded = true;
		startFillViewport();
	}

	// ── rAF-based viewport fill (replaces 1ms setInterval) ───────────────────

	function startFillViewport() {
		if (_fillRunning) return;
		_fillRunning = true;
		runFillLoop();
	}

	function stopFillViewport() {
		_fillRunning = false;
	}

	function runFillLoop() {
		requestAnimationFrame(() => {
			if (!_fillRunning) return;

			// View not visible yet — keep retrying each frame.
			if (leaf.height === 0) { runFillLoop(); return; }

			if (!fileManager || !hasMore || filteredFiles.length === 0) {
				if (hasMore) hasMore = false;
				_fillRunning = false;
				return;
			}

			// Append one batch.
			infiniteHandler();

			// Check whether the loader sentinel is still in view.
			if (hasMore && loaderRef) {
				const rect  = loaderRef.getBoundingClientRect();
				const cont  = scrollEl ?? (leaf.view as unknown as { contentEl: HTMLElement })?.contentEl;
				if (cont) {
					const cRect = cont.getBoundingClientRect();
					const loaderEdge = scrollDirection === "horizontal" ? rect.left  : rect.top;
					const threshold  = scrollDirection === "horizontal"
						? cRect.right  + 200
						: Math.max(cRect.bottom, window.innerHeight) + 200;
					if (loaderEdge < threshold) {
						runFillLoop();
						return;
					}
				}
			}

			_fillRunning = false; // Viewport satisfied — stop.
		});
	}

	function infiniteHandler() {
		if (leaf.height === 0) return;
		if (!fileManager || !hasMore) return;
		if (filteredFiles.length === 0) {
			hasMore = false;
		} else {
			renderedFiles = [...renderedFiles, ...filteredFiles.splice(0, SCROLL_BATCH_SIZE)];
			if (firstLoaded) firstLoaded = false;
		}
	}

	/** Prepend a batch of newer notes above the current top. */
	async function prependBatch() {
		if (!hasMoreFuture || futureFiles.length === 0 || !scrollEl || _prependInProgress) return;
		_prependInProgress = true;
		try {
			const batch = futureFiles.splice(0, SCROLL_BATCH_SIZE);
			hasMoreFuture = futureFiles.length > 0;
			const toAdd = batch.reverse();
			const prevScrollTop    = scrollEl.scrollTop;
			const prevScrollHeight = scrollEl.scrollHeight;
			renderedFiles = [...toAdd, ...renderedFiles];
			await svelteTick();
			await new Promise<void>((r) => requestAnimationFrame(() => r()));
			scrollEl.scrollTop = prevScrollTop + (scrollEl.scrollHeight - prevScrollHeight);
		} finally {
			_prependInProgress = false;
		}
	}

	// ── Toolbar action handlers ───────────────────────────────────────────────

	async function handleGranularityChange(g: Granularity) {
		if (isHorizonMode) {
			selectionMode = "daily";
			callView()?.setSelectionMode?.("daily");
		}
		granularity = g;
		callView()?.setGranularity?.(g);

		if (selectionMode === "daily" && scrollDirection === "vertical") {
			await svelteTick();
			await svelteTick();
			await navigateToday();
		}
	}

	function handleSortChange(field: string) {
		timeField = field as TimeField;
		callView()?.setTimeField?.(field);
	}

	function handleFilterChange(range: TimeRange) {
		if (range === "custom") {
			callView()?.openCustomRangeModal?.();
			return;
		}
		selectedRange = range;
		callView()?.setSelectedRange?.(range);
	}

	async function toggleHideFrontmatter() {
		hideFrontmatter = !hideFrontmatter;
		plugin.settings.time.hideFrontmatter = hideFrontmatter;
		document.body.classList.toggle("tm-hide-frontmatter", hideFrontmatter);
		await plugin.saveSettings();
	}

	async function toggleHideBacklinks() {
		hideBacklinks = !hideBacklinks;
		plugin.settings.time.hideBacklinks = hideBacklinks;
		document.body.classList.toggle("tm-hide-backlinks", hideBacklinks);
		await plugin.saveSettings();
	}

	function toggleShowEmptyNotes() { showEmptyNotes = !showEmptyNotes; }

	async function toggleScrollDirection() {
		scrollDirection = scrollDirection === "vertical" ? "horizontal" : "vertical";
		callView()?.setScrollDirection?.(scrollDirection);

		if (scrollDirection === "horizontal" && selectionMode === "daily") {
			const gen = ++_hScrollGen;
			timeField = "dateReverse";
			callView()?.setTimeField?.("dateReverse");
			await svelteTick();
			stopFillViewport();

			const todayFile = getPeriodicNote(plugin, granularity, moment());
			const allFiles  = applyEmptyFilter(fileManager.getFilteredFiles());
			const todayIdx  = todayFile
				? allFiles.findIndex((f) => f.path === todayFile.path)
				: allFiles.length - 1;

			const LOOK_BEHIND = 2;
			const windowStart  = Math.max(0, todayIdx - LOOK_BEHIND);
			renderedFiles      = allFiles.slice(windowStart, todayIdx + 1);
			filteredFiles      = allFiles.slice(todayIdx + 1);
			hasMore            = filteredFiles.length > 0;
			firstLoaded        = false;

			await svelteTick();
			await new Promise<void>((r) => requestAnimationFrame(() => r()));

			if (todayFile && scrollEl) {
				for (const el of scrollEl.querySelectorAll<HTMLElement>("[data-path]")) {
					if (el.getAttribute("data-path") === todayFile.path) {
						el.scrollIntoView({ behavior: "instant", inline: "start", block: "nearest" });
						break;
					}
				}
			}

			const olderFiles = allFiles.slice(0, windowStart);
			if (olderFiles.length > 0) void backgroundPrependFiles(olderFiles, gen);

		} else if (scrollDirection === "vertical" && selectionMode === "daily") {
			++_hScrollGen;
			timeField = "date";
			callView()?.setTimeField?.("date");
		}
	}

	async function backgroundPrependFiles(files: TFile[], gen: number) {
		const BATCH = 3;
		let remaining = [...files];

		while (remaining.length > 0) {
			await new Promise<void>((r) => setTimeout(r, 16));
			if (gen !== _hScrollGen || scrollDirection !== "horizontal") return;
			if (!scrollEl) return;

			const batch     = remaining.slice(-BATCH);
			remaining       = remaining.slice(0, -BATCH);
			const prevLeft  = scrollEl.scrollLeft;
			const prevWidth = scrollEl.scrollWidth;
			renderedFiles = [...batch, ...renderedFiles];
			await svelteTick();
			scrollEl.scrollLeft = prevLeft + (scrollEl.scrollWidth - prevWidth);
		}
	}

	// ── Navigation ────────────────────────────────────────────────────────────

	function getDateSortedFiles(): TFile[] {
		const fmt = getFormat(plugin.getConfig(granularity), granularity);
		return [...fileManager.getFilteredFiles()].sort(
			(a, b) => moment(a.basename, fmt).valueOf() - moment(b.basename, fmt).valueOf()
		);
	}

	async function navigatePrev() {
		if (!focusedDate?.isValid() || !fileManager) return;
		const sorted = getDateSortedFiles();
		const idx = sorted.findIndex(f => f.path === focusedFile?.path);
		if (idx > 0) {
			await scrollToFile(sorted[idx - 1], "instant");
		} else {
			const prevDate = granularity === "half-year"
				? addHalfYears(focusedDate, -1)
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				: focusedDate.clone().subtract(1, granularity === "week" ? "week" : granularity as any);
			const newFile = await createPeriodicNote(plugin, granularity, prevDate);
			fileManager.fileCreate(newFile);
			await scrollToFile(newFile, "instant");
		}
	}

	async function navigateNext() {
		if (!focusedDate?.isValid() || !fileManager) return;
		const sorted = getDateSortedFiles();
		const idx = sorted.findIndex(f => f.path === focusedFile?.path);
		if (idx !== -1 && idx < sorted.length - 1) {
			await scrollToFile(sorted[idx + 1], "instant");
		} else {
			const nextDate = granularity === "half-year"
				? addHalfYears(focusedDate, 1)
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				: focusedDate.clone().add(1, granularity === "week" ? "week" : granularity as any);
			const newFile = await createPeriodicNote(plugin, granularity, nextDate);
			fileManager.fileCreate(newFile);
			await scrollToFile(newFile, "instant");
		}
	}

	async function navigateToday() {
		const now = moment();
		let todayFile = getPeriodicNote(plugin, granularity, now);
		if (!todayFile) {
			todayFile = await createPeriodicNote(plugin, granularity, now);
			fileManager.fileCreate(todayFile);
		}

		if (selectionMode === "daily" && scrollDirection === "vertical") {
			const LOOK_AHEAD = 10;
			const allFiles = applyEmptyFilter(fileManager.getFilteredFiles());
			const idx = allFiles.findIndex((f) => f.path === todayFile!.path);
			const start = idx === -1 ? 0 : idx;
			const renderEnd = Math.min(allFiles.length, start + 1 + LOOK_AHEAD);
			futureFiles = allFiles.slice(0, start).reverse();
			hasMoreFuture = futureFiles.length > 0;
			const baseFiles = allFiles.slice(start, renderEnd);
			renderedFiles = baseFiles.some(f => f.path === todayFile!.path)
				? baseFiles
				: [todayFile!, ...baseFiles];
			filteredFiles = allFiles.slice(renderEnd);
			hasMore = filteredFiles.length > 0;
			firstLoaded = false;
			visibleNotes.clear();
			visibleNotes.add(todayFile.path);
			visibleNotes = visibleNotes;
			await svelteTick();
			await new Promise<void>((r) => requestAnimationFrame(() => r()));
			_prependEnabled = false;
			_wasScrolledDown = false;
			if (scrollEl) scrollEl.scrollTop = 0;
			scrollFocusedFile = todayFile;
			requestAnimationFrame(() => requestAnimationFrame(() => { _prependEnabled = true; }));
		} else {
			await scrollToFile(todayFile, "instant");
		}
	}

	// ── Breadcrumb handlers ───────────────────────────────────────────────────

	async function handleBreadcrumbClick(seg: BreadcrumbSeg) {
		if (seg.gran !== granularity) {
			void handleGranularityChange(seg.gran);
			await svelteTick();
			await svelteTick();
		}
		let targetFile = getPeriodicNote(plugin, seg.gran, seg.date);
		if (!targetFile) {
			targetFile = await createPeriodicNote(plugin, seg.gran, seg.date);
			renderedFiles = [targetFile, ...renderedFiles];
			visibleNotes.add(targetFile.path);
			visibleNotes = visibleNotes;
		}
		await scrollToFile(targetFile, "instant");
	}

	async function handleSubPeriodClick(sub: SubPeriod) {
		const targetGran = enabledGranularities.includes(sub.gran) ? sub.gran : granularity;
		if (targetGran !== granularity) {
			void handleGranularityChange(targetGran);
			await svelteTick();
			await svelteTick();
		}
		let targetFile = getPeriodicNote(plugin, targetGran, sub.date);
		if (!targetFile) {
			targetFile = await createPeriodicNote(plugin, targetGran, sub.date);
			renderedFiles = [targetFile, ...renderedFiles];
			visibleNotes.add(targetFile.path);
			visibleNotes = visibleNotes;
		}
		await scrollToFile(targetFile, "instant");
	}

	// ── Horizon mode ──────────────────────────────────────────────────────────

	$: isHorizonMode = selectionMode === "horizon";

	let horizonTick = 0;
	$: horizonFiles = (isHorizonMode && horizonTick >= 0)
		? (Object.fromEntries(
				enabledGranularities.map((g) => [g, getPeriodicNote(plugin, g, moment())])
			) as Partial<Record<Granularity, TFile | null>>)
		: ({} as Partial<Record<Granularity, TFile | null>>);

	function handleHorizonMode() {
		selectionMode = "horizon";
		callView()?.setSelectionMode?.("horizon");
		updateTitleElement();
	}

	async function createHorizonNote(g: Granularity) {
		await createPeriodicNote(plugin, g, moment());
		horizonTick++;
	}

	// ── Inbox mode ────────────────────────────────────────────────────────────

	$: isInboxMode = selectionMode === "inbox";

	let inboxItems: TaggedInboxItem[] = [];

	$: if (isInboxMode && fileManager) {
		inboxItems = plugin.inboxService.getInboxItems();
	}

	export function refreshInbox() {
		if (!isInboxMode) return;
		inboxItems = plugin.inboxService.getInboxItems();
	}

	// ── Breadcrumb state ──────────────────────────────────────────────────────

	$: focusedFile = (scrollFocusedFile && renderedFiles.some(f => f.path === scrollFocusedFile!.path))
		? scrollFocusedFile
		: renderedFiles.find(f => visibleNotes.has(f.path)) ?? renderedFiles[0] ?? null;

	let _lastEmittedFocusPath: string | null = null;
	$: {
		if (focusedFile && focusedFile.path !== _lastEmittedFocusPath) {
			_lastEmittedFocusPath = focusedFile.path;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(plugin.app.workspace as any).trigger("time-tools:focused-note", focusedFile);
		}
	}

	$: focusedDate = (() => {
		if (!focusedFile || selectionMode !== "daily") return null;
		if (granularity === "half-year") return parseHalfYear(focusedFile.basename);
		return moment(focusedFile.basename, getFormat(plugin.getConfig(granularity), granularity));
	})();

	$: isOnToday = (() => {
		if (!focusedDate?.isValid()) return false;
		const now = moment();
		if (granularity === "week")      return focusedDate.isoWeek() === now.isoWeek() && focusedDate.isoWeekYear() === now.isoWeekYear();
		if (granularity === "half-year") return isSameHalfYear(focusedDate, now);
		return focusedDate.isSame(now, granularity);
	})();

	type _BreadcrumbSeg = BreadcrumbSeg; // local alias for template use

	$: breadcrumbSegments = (() => {
		if (!focusedDate?.isValid()) return [] as _BreadcrumbSeg[];
		const y: _BreadcrumbSeg = { label: focusedDate.format("YYYY"),  gran: "year",      date: focusedDate.clone().startOf("year") };
		const q: _BreadcrumbSeg = { label: `Q${focusedDate.quarter()}`, gran: "quarter",   date: focusedDate.clone().startOf("quarter") };
		const h: _BreadcrumbSeg = { label: `H${halfOf(focusedDate)}`,   gran: "half-year", date: startOfHalfYear(focusedDate) };
		const m: _BreadcrumbSeg = { label: focusedDate.format("MMM"),   gran: "month",     date: focusedDate.clone().startOf("month") };
		const w: _BreadcrumbSeg = { label: `W${focusedDate.isoWeek()}`, gran: "week",      date: focusedDate.clone().startOf("isoWeek") };
		const d: _BreadcrumbSeg = { label: focusedDate.format("MMM D"), gran: "day",       date: focusedDate.clone() };
		switch (granularity) {
			case "day":       return [y, q, m, w, d];
			case "week":      return [y, q, w];
			case "month":     return [y, q, m];
			case "quarter":   return [y, q];
			case "half-year": return [y, h];
			case "year":      return [y];
		}
	})();

	// ── Enabled granularities (toolbar prop) ──────────────────────────────────

	export let enabledGranularities: Granularity[] = granularities.filter(
		(g) => g === "day" || plugin.settings[g].enabled
	);

	// ── Scroll helpers ────────────────────────────────────────────────────────

	function handleNoteVisibilityChange(file: TFile, isVisible: boolean) {
		if (isVisible) visibleNotes.add(file.path);
		else visibleNotes.delete(file.path);
		visibleNotes = visibleNotes;
	}

	function updateFocusFromScroll() {
		if (!scrollEl) return;
		if (scrollEl.scrollTop >= 100) {
			_wasScrolledDown = true;
		} else if (_prependEnabled && _wasScrolledDown && hasMoreFuture && !_prependInProgress) {
			_wasScrolledDown = false;
			void prependBatch();
		}
		const listTop = scrollEl.getBoundingClientRect().top;
		for (const el of scrollEl.querySelectorAll<HTMLElement>(".tm-note-wrapper[data-path]")) {
			const rect = el.getBoundingClientRect();
			if (rect.bottom > listTop) {
				const path = el.getAttribute("data-path")!;
				const file = renderedFiles.find(f => f.path === path) ?? null;
				if (file) scrollFocusedFile = file;
				return;
			}
		}
	}

	// ── Title bar ─────────────────────────────────────────────────────────────

	function updateTitleElement() {
		if (!leaf || !leaf.view || !leaf.view.titleEl) return;
		const titleEl = leaf.view.titleEl;
		titleEl.empty();
		let title: string;
		if (selectionMode === "horizon") {
			title = "Horizon";
		} else if (selectionMode === "folder") {
			title = `Folder: ${folderPath || "…"}`;
		} else if (selectionMode === "tag") {
			title = `Tag: ${tag || "…"}`;
		} else {
			const label = displayConfigs[granularity].periodicity;
			const capitalised = label.charAt(0).toUpperCase() + label.slice(1);
			const rangeText = selectedRange !== "all" ? ` · ${selectedRange}` : "";
			title = `${capitalised} notes${rangeText}`;
		}
		titleEl.setText(title);
	}

	// ── Filter helpers ────────────────────────────────────────────────────────

	function isNoteEmpty(f: TFile): boolean {
		if (f.stat.size === 0) return true;
		const cache = plugin.app.metadataCache.getFileCache(f);
		if (!cache) return false;
		const sections = cache.sections ?? [];
		if (sections.length === 0) return true;
		return sections.every((s) => s.type === "yaml");
	}

	function applyEmptyFilter(files: TFile[]): TFile[] {
		if (showEmptyNotes) return files;
		return files.filter((f) => !isNoteEmpty(f));
	}

	// ── Create note prompt ────────────────────────────────────────────────────

	$: showCreatePrompt =
		selectionMode === "daily" &&
		!fileManager?.hasCurrentDayNote() &&
		(selectedRange === "all" || selectedRange === "week" || selectedRange === "month" || selectedRange === "quarter" || selectedRange === "year");

	async function createCurrentPeriodNote() {
		const newNote = await fileManager.createCurrentPeriodNote();
		if (newNote) {
			renderedFiles = [newNote, ...renderedFiles];
			visibleNotes.add(newNote.path);
			visibleNotes = visibleNotes;
		}
	}

	// ── Public API (called by DailyNoteView) ──────────────────────────────────

	export function tick() {
		check();
		renderedFiles = renderedFiles;
	}

	export function check() {
		if (!fileManager) return;
		const hadDailyNote = fileManager.hasCurrentDayNote();
		fileManager.checkCurrentPeriodNote();
		const hasDailyNote = fileManager.hasCurrentDayNote();
		if (hadDailyNote !== hasDailyNote || selectedRange !== "all") {
			filteredFiles = applyEmptyFilter(fileManager.getFilteredFiles());
			totalFileCount = filteredFiles.length;
			renderedFiles = [];
			visibleNotes.clear();
			futureFiles = []; hasMoreFuture = false;
			hasMore = filteredFiles.length > 0;
			firstLoaded = true;
			startFillViewport();
		}
	}

	export function fileCreate(file: TFile) {
		fileManager.fileCreate(file);
		const updated = fileManager.getFilteredFiles();
		if (
			updated.some((f) => f.basename === file.basename) &&
			!renderedFiles.some((f) => f.basename === file.basename)
		) {
			renderedFiles = [file, ...renderedFiles];
			visibleNotes.add(file.path);
			visibleNotes = visibleNotes;
		}
	}

	export function fileDelete(file: TFile) {
		fileManager.fileDelete(file);
		renderedFiles = renderedFiles.filter((n) => n.basename !== file.basename);
		if (visibleNotes.has(file.path)) {
			visibleNotes.delete(file.path);
			visibleNotes = visibleNotes;
		}
	}

	export async function scrollToFile(targetFile: TFile, behavior: ScrollBehavior = "smooth"): Promise<void> {
		searchQuery = "";

		const allFiles = applyEmptyFilter(fileManager.getFilteredFiles());
		const idx = allFiles.findIndex((f) => f.path === targetFile.path);
		if (idx === -1) return;

		const LOOK_AHEAD = 10;
		const renderEnd = Math.min(allFiles.length, idx + 1 + LOOK_AHEAD);
		renderedFiles = allFiles.slice(0, renderEnd);
		filteredFiles = allFiles.slice(renderEnd);
		hasMore = filteredFiles.length > 0;
		firstLoaded = false;

		await svelteTick();
		await new Promise<void>((r) => requestAnimationFrame(() => r()));

		if (!scrollEl) return;
		for (const el of scrollEl.querySelectorAll<HTMLElement>("[data-path]")) {
			if (el.getAttribute("data-path") === targetFile.path) {
				if (scrollDirection === "horizontal") {
					el.scrollIntoView({ behavior, inline: "start", block: "nearest" });
				} else {
					const targetTop = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
					scrollEl.scrollTop = targetTop;
				}
				break;
			}
		}

		scrollFocusedFile = targetFile;
		if (behavior === "instant") {
			await new Promise<void>((r) => requestAnimationFrame(() => r()));
			updateFocusFromScroll();
		}
	}

	export function resetScrollToTop(): void {
		if (!scrollEl) return;
		_prependEnabled = false;
		_wasScrolledDown = false;
		scrollEl.scrollTop = 0;
		requestAnimationFrame(() => requestAnimationFrame(() => { _prependEnabled = true; }));
	}

	export async function scrollToToday(): Promise<void> {
		if (selectionMode !== "daily" || scrollDirection !== "vertical") return;
		if (!fileManager) return;
		if (isOnToday && renderedFiles[0]?.path === focusedFile?.path) return;
		await navigateToday();
	}

	/** Called by DailyNoteView when calendar sources change. */
	export function refreshCalendar() {
		eventsPanel?.refreshCalendar?.();
	}

	// ── EventsSidePanel ref ───────────────────────────────────────────────────

	let eventsPanel: EventsSidePanel | undefined;
</script>

<div class="tm-shell">
	<!-- ── Toolbar ─────────────────────────────────────────────────────────── -->
	<EditorToolbar
		{granularity}
		{selectionMode}
		{timeField}
		{selectedRange}
		{scrollDirection}
		{hideFrontmatter}
		{hideBacklinks}
		{showEmptyNotes}
		{enabledGranularities}
		{totalFileCount}
		inboxItemCount={inboxItems.length}
		{showEventsPanel}
		calendarSourcesEnabled={plugin.settings.time.calendarSources.some(s => s.enabled)}
		{folderPath}
		{tag}
		bind:searchQuery
		on:granularity-change={e => void handleGranularityChange(e.detail.value)}
		on:sort-change={e => handleSortChange(e.detail.value)}
		on:filter-change={e => handleFilterChange(e.detail.value)}
		on:toggle-frontmatter={() => void toggleHideFrontmatter()}
		on:toggle-backlinks={() => void toggleHideBacklinks()}
		on:toggle-empty-notes={toggleShowEmptyNotes}
		on:toggle-scroll-direction={() => void toggleScrollDirection()}
		on:toggle-events-panel={() => { showEventsPanel = !showEventsPanel; }}
		on:back-to-daily={() => { selectionMode = "daily"; callView()?.setSelectionMode?.("daily"); }}
		on:horizon-mode={handleHorizonMode}
	/>

	<!-- ── Breadcrumb bar (daily mode only) ────────────────────────────────── -->
	{#if selectionMode === "daily" && breadcrumbSegments.length > 0}
		<BreadcrumbBar
			{granularity}
			{breadcrumbSegments}
			{isOnToday}
			{enabledGranularities}
			on:prev={() => void navigatePrev()}
			on:next={() => void navigateNext()}
			on:today={() => void navigateToday()}
			on:breadcrumb-click={e => void handleBreadcrumbClick(e.detail)}
			on:subperiod-click={e => void handleSubPeriodClick(e.detail)}
		/>
	{/if}

	<!-- ── Inbox mode ──────────────────────────────────────────────────────── -->
	{#if isInboxMode}
		<div class="tm-inbox-view">
			{#if inboxItems.length === 0}
				<div class="tm-stock">
					<div class="tm-stock-text">No #inbox items found</div>
				</div>
			{:else}
				{#each inboxItems as item (item.type === "file" ? `file:${item.file.path}` : `inline:${item.file.path}:${item.line}:${item.offset}`)}
					{#if item.type === "file"}
						<div class="tm-note-wrapper" data-path={item.file.path}>
							<DailyNote file={item.file} {plugin} {leaf} shouldRender={true} {granularity} selectionMode="tag" />
						</div>
					{:else}
						<InboxLine {plugin} {item} onClear={refreshInbox} />
					{/if}
				{/each}
			{/if}
		</div>

	<!-- ── Horizon mode ────────────────────────────────────────────────────── -->
	{:else if isHorizonMode}
		<HorizonView
			{plugin}
			{leaf}
			{enabledGranularities}
			{horizonFiles}
			on:create-note={e => void createHorizonNote(e.detail.granularity)}
		/>

	<!-- ── Regular scrolling note list ─────────────────────────────────────── -->
	{:else}
		<div class="tm-content-split" class:tm-content-split--panel-open={showEventsPanel && selectionMode === "daily"}>
			<div
				class="tm-note-view"
				class:tm-note-view--horizontal={scrollDirection === "horizontal"}
				bind:this={scrollEl}
				on:scroll={updateFocusFromScroll}
			>
				<!-- Top sentinel: position marker for prepend guard -->
				<div bind:this={topLoaderRef} class="tm-view-loader tm-view-loader--top" />

				{#if !hasMoreFuture && renderedFiles.length > 0}
					<button class="tm-create-next" on:click={() => void navigateNext()} aria-label="Create next {granularity} note">
						+ Create next {granularity}
					</button>
				{/if}

				{#if renderedFiles.length === 0}
					<div class="tm-stock"><div class="tm-stock-text">No files found</div></div>
				{/if}

				{#if showCreatePrompt}
					<div class="tm-blank-day" on:click={createCurrentPeriodNote} aria-hidden="true">
						<div class="tm-blank-day-text">
							{displayConfigs[granularity].labelOpenPresent.replace("Open", "Create")}
						</div>
					</div>
				{/if}

				{#each renderedFiles as file (file.path)}
					<div
						class="tm-note-wrapper"
						class:tm-note-wrapper--horizontal={scrollDirection === "horizontal"}
						data-path={file.path}
						use:inview={{
							rootMargin: "80%",
							unobserveOnEnter: false,
							root: scrollEl,
						}}
						on:inview_change={({ detail }) => handleNoteVisibilityChange(file, detail.inView)}
					>
						<DailyNote {file} {plugin} {leaf} shouldRender={visibleNotes.has(file.path)} {granularity} {selectionMode} />
					</div>
				{/each}

				<!-- Bottom sentinel — triggers the rAF fill loop -->
				<div
					bind:this={loaderRef}
					class="tm-view-loader"
					use:inview={{ root: scrollEl }}
					on:inview_init={startFillViewport}
					on:inview_change={({ detail }) => { if (detail.inView) startFillViewport(); }}
				/>

				{#if !hasMore}
					<div class="tm-no-more">— No more results —</div>
				{/if}
			</div>

			<!-- Events side panel -->
			{#if showEventsPanel && selectionMode === "daily"}
				<EventsSidePanel
					bind:this={eventsPanel}
					{plugin}
					{focusedDate}
					{granularity}
					on:close={() => { showEventsPanel = false; }}
				/>
			{/if}
		</div>
	{/if}
</div>

<style>
	.tm-shell {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	/* Content split — note list + optional side panel */
	.tm-content-split {
		flex: 1;
		display: flex;
		overflow: hidden;
	}

	.tm-note-view {
		flex: 1;
		overflow-y: auto;
		min-width: 0;
	}

	/* Horizontal scroll layout */
	.tm-note-view--horizontal {
		display: flex;
		flex-direction: row;
		overflow-x: auto;
		overflow-y: hidden;
		align-items: stretch;
		-webkit-overflow-scrolling: touch;
		scroll-snap-type: x proximity;
	}

	.tm-note-wrapper { width: 100%; }

	.tm-note-wrapper--horizontal {
		flex-shrink: 0;
		width: clamp(360px, 45vw, 600px);
		height: 100%;
		overflow-y: auto;
		border-right: 1px solid var(--background-modifier-border);
		scroll-snap-align: start;
	}

	/* Inbox view */
	.tm-inbox-view {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	/* Empty / status states */
	.tm-stock {
		flex: 1;
		min-height: 200px;
		width: 100%;
		display: flex;
		justify-content: center;
		align-items: center;
	}
	.tm-stock-text { text-align: center; }

	.tm-no-more {
		margin-left: auto;
		margin-right: auto;
		text-align: center;
		color: var(--text-muted);
		padding: var(--size-4-4) 0;
	}

	/* "Create next period" button at top of list */
	.tm-create-next {
		all: unset;
		display: block;
		margin-left: auto;
		margin-right: auto;
		text-align: center;
		color: var(--text-faint);
		font-size: var(--font-smallest);
		padding: var(--size-4-1) 0;
		cursor: pointer;
		transition: color 0.15s ease;
	}
	.tm-create-next:hover { color: var(--text-muted); }

	.tm-blank-day {
		display: flex;
		margin-left: auto;
		margin-right: auto;
		max-width: var(--file-line-width);
		color: var(--text-faint);
		padding-top: 20px;
		padding-bottom: 20px;
		transition: color 150ms ease, opacity 150ms ease;
		cursor: pointer;
	}
	.tm-blank-day-text { margin-left: auto; margin-right: auto; text-align: center; }
</style>
