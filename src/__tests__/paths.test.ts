import { describe, it, expect } from "vitest";
import { join, basename } from "../utils/paths";

describe("join", () => {
	it("joins path segments with a single slash", () => {
		expect(join("foo", "bar", "baz.md")).toBe("foo/bar/baz.md");
	});

	it("splits segments that already contain slashes", () => {
		expect(join("foo/bar", "baz.md")).toBe("foo/bar/baz.md");
	});

	it("drops empty and '.' segments", () => {
		expect(join("foo", "", ".", "bar")).toBe("foo/bar");
	});

	it("preserves a leading slash for absolute paths", () => {
		expect(join("/foo", "bar")).toBe("/foo/bar");
	});

	it("returns an empty string when given nothing but empty segments", () => {
		expect(join("", ".")).toBe("");
	});
});

describe("basename", () => {
	it("strips the directory and extension", () => {
		expect(basename("foo/bar/baz.md")).toBe("baz");
	});

	it("returns the whole segment when there is no extension", () => {
		expect(basename("foo/bar/baz")).toBe("baz");
	});

	it("handles a bare filename with no directory", () => {
		expect(basename("baz.md")).toBe("baz");
	});

	it("keeps only the last extension for multi-dot filenames", () => {
		expect(basename("foo/bar.baz.md")).toBe("bar.baz");
	});
});
