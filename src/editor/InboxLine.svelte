<script lang="ts">
	import { onMount } from "svelte";
	import type TimeManagerPlugin from "../main";
	import type { InboxInlineItem } from "./InboxService";
	import Icon from "../utils/Icon.svelte";
	// InboxInlineItem is a member of TaggedInboxItem (renamed from InboxItem to avoid collision with src/inbox/types.ts)

	export let plugin: TimeManagerPlugin;
	export let item: InboxInlineItem;
	/** Called after the item is successfully cleared so the parent can refresh. */
	export let onClear: () => void = () => { /* no-op */ };

	let lineText = "";
	let clearing = false;

	onMount(async () => {
		try {
			const content = await plugin.app.vault.cachedRead(item.file);
			const lines = content.split("\n");
			lineText = lines[item.line] ?? "";
		} catch {
			lineText = "";
		}
	});

	function openFile() {
		plugin.app.workspace.openLinkText(item.file.path, "", false, { active: true });
	}

	async function clearItem() {
		if (clearing) return;
		clearing = true;
		try {
			const { InboxService } = await import("./InboxService");
			const svc = new InboxService(plugin.app);
			await svc.clearInlineItem(item);
			onClear();
		} catch (e) {
			console.error("Obsidian Time Tools: failed to clear inbox item", e);
		} finally {
			clearing = false;
		}
	}

	/** Wrap the tag occurrence in a <mark> for highlighting. */
	function highlightTag(text: string, tag: string): string {
		if (!text) return "";
		const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const re = new RegExp(`(${escaped})`, "gi");
		return text.replace(re, `<mark class="tm-tm-inbox-tag-hl">$1</mark>`);
	}
</script>

<div class="tm-tm-inbox-line">
	<div class="tm-tm-inbox-line-meta">
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<span class="tm-tm-inbox-line-filename" on:click={openFile} title={item.file.path}>
			{item.file.basename}
		</span>
		<span class="tm-tm-inbox-line-loc">:{item.line + 1}</span>
	</div>
	<div class="tm-tm-inbox-line-body">
		{#if lineText}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<span class="tm-tm-inbox-line-text">{@html highlightTag(lineText, item.tag)}</span>
		{:else}
			<span class="tm-tm-inbox-line-text tm-tm-inbox-line-text--loading">…</span>
		{/if}
		<div class="tm-tm-inbox-line-actions">
			<button
				class="tm-tm-inbox-btn tm-tm-inbox-btn--jump"
				on:click={openFile}
				title="Open file"
				aria-label="Open file"
			>
				<Icon name="arrow-up-right" size={12} />
			</button>
			<button
				class="tm-tm-inbox-btn tm-tm-inbox-btn--clear"
				on:click={clearItem}
				disabled={clearing}
				title="Remove #inbox tag"
				aria-label="Remove #inbox tag"
			>
				{#if clearing}
					<span class="tm-tm-inbox-spin"><Icon name="loader" size={12} /></span>
				{:else}
					<Icon name="x" size={12} />
				{/if}
			</button>
		</div>
	</div>
</div>

<style>
	.tm-tm-inbox-line {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--background-modifier-border);
		background-color: var(--background-primary);
		transition: background-color 80ms ease;
	}

	.tm-tm-inbox-line:hover {
		background-color: var(--background-primary-alt);
	}

	.tm-tm-inbox-line-meta {
		display: flex;
		align-items: baseline;
		gap: 2px;
	}

	.tm-tm-inbox-line-filename {
		font-size: var(--font-ui-smaller);
		font-weight: 600;
		color: var(--text-accent);
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tm-tm-inbox-line-filename:hover {
		text-decoration: underline;
	}

	.tm-tm-inbox-line-loc {
		font-size: var(--font-ui-smaller);
		color: var(--text-faint);
		flex-shrink: 0;
	}

	.tm-tm-inbox-line-body {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.tm-tm-inbox-line-text {
		flex: 1;
		font-size: var(--font-ui-small);
		color: var(--text-normal);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 1.4;
		min-width: 0;
	}

	.tm-tm-inbox-line-text--loading {
		color: var(--text-faint);
	}

	.tm-tm-inbox-line-actions {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
		opacity: 0;
		transition: opacity 80ms ease;
	}

	.tm-tm-inbox-line:hover .tm-tm-inbox-line-actions {
		opacity: 1;
	}

	.tm-tm-inbox-btn {
		all: unset;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: var(--radius-s);
		cursor: pointer;
		color: var(--text-muted);
		transition: background-color 80ms ease, color 80ms ease;
	}

	.tm-tm-inbox-btn:hover {
		background-color: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.tm-tm-inbox-btn--clear:hover {
		color: var(--text-error);
	}

	.tm-tm-inbox-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	@keyframes tm-spin {
		to { transform: rotate(360deg); }
	}

	.tm-tm-inbox-spin {
		animation: tm-spin 0.7s linear infinite;
	}

	:global(.tm-tm-inbox-tag-hl) {
		background-color: var(--text-highlight-bg);
		color: var(--text-normal);
		border-radius: var(--radius-xs);
		padding: 0 1px;
	}
</style>
