import { parseYaml } from "obsidian";

/** Split raw template file text into a parsed frontmatter object and body string. */
export function parseTemplate(raw: string): { templateFm: Record<string, unknown>; body: string } {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { templateFm: {}, body: raw };

	const fmBlock = match[1] ?? "";
	const body = match[2] ?? "";

	let templateFm: Record<string, unknown> = {};
	try {
		const parsed: unknown = parseYaml(fmBlock);
		if (parsed && typeof parsed === "object") {
			templateFm = parsed as Record<string, unknown>;
		}
	} catch {
		// Malformed template frontmatter — proceed with empty base
	}

	return { templateFm, body };
}
