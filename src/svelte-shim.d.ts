// Allow .svelte imports to resolve in TypeScript. esbuild-svelte handles the
// runtime compilation; this declaration just gives TS something to point at
// for both `import Foo from "./Foo.svelte"` (value) and `view: Foo` (type).
declare module "*.svelte" {
	import { SvelteComponent } from "svelte";
	// SvelteComponent's own typings use `any` for props/events/slots by design —
	// component shape is inherently generic at this level.
	export default class extends SvelteComponent {}
}
