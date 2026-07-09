import { describe, it, expect } from "vitest";
import { genId } from "../utils/id";

describe("genId", () => {
	it("returns a string of the requested length", () => {
		expect(genId(8)).toHaveLength(8);
		expect(genId(1)).toHaveLength(1);
		expect(genId(0)).toHaveLength(0);
	});

	it("only contains lowercase hex characters", () => {
		expect(genId(64)).toMatch(/^[0-9a-f]*$/);
	});

	it("produces different ids across calls", () => {
		const ids = new Set(Array.from({ length: 20 }, () => genId(16)));
		expect(ids.size).toBeGreaterThan(1);
	});
});
