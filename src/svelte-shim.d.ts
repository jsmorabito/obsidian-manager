// Allow .svelte imports to resolve in TypeScript. esbuild-svelte handles the
// runtime compilation; this declaration just gives TS something to point at
// for both `import Foo from "./Foo.svelte"` (value) and `view: Foo` (type).
declare module "*.svelte" {
	/* eslint-disable @typescript-eslint/no-explicit-any */
	export default class {
		constructor(opts: { target: HTMLElement; props?: Record<string, any> });
		$set(props: Record<string, any>): void;
		$destroy(): void;
		[key: string]: any;
	}
}
