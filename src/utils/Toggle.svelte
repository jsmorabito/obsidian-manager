<script lang="ts">
	import { ToggleComponent } from "obsidian";
	import { onMount, onDestroy } from "svelte";

	export let value: boolean;
	export let onChange: (v: boolean) => void;

	let el: HTMLElement;
	let toggle: ToggleComponent;

	onMount(() => {
		toggle = new ToggleComponent(el);
		toggle.setValue(value);
		toggle.onChange(onChange);
	});

	// Keep the native toggle in sync when the Svelte binding changes externally.
	$: if (toggle) toggle.setValue(value);

	onDestroy(() => {
		if (el) el.empty();
	});
</script>

<span bind:this={el}></span>
