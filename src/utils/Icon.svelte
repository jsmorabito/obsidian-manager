<script lang="ts">
	import { setIcon } from "obsidian";
	import { onMount } from "svelte";

	export let name: string;
	/** Size in px — applied as width/height on the wrapping span. */
	export let size: number | undefined = undefined;

	let el: HTMLElement;

	onMount(() => {
		setIcon(el, name);
	});

	$: if (el) setIcon(el, name);
</script>

<span
	bind:this={el}
	class="tm-icon"
	style={size ? `width:${size}px;height:${size}px;` : ""}
	aria-hidden="true"
></span>

<style>
	.tm-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
</style>
