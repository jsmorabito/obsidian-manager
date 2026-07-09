import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
	test: {
		environment: "jsdom",
		globals: false,
		setupFiles: ["src/__tests__/setup.ts"],
	},
	resolve: {
		alias: [
			{
				find: "obsidian",
				replacement: path.resolve(__dirname, "src/__tests__/__mocks__/obsidian.ts"),
			},
			{
				find: "src",
				replacement: path.resolve(__dirname, "src"),
			},
		],
	},
});
