// Minimal Obsidian API mock for unit tests.
// Extend as more modules gain test coverage — keep this scoped to what's
// actually imported by code under test, not the full Obsidian API surface.

import moment from "moment";

// moment is a global in real Obsidian; provide it here too so `window.moment`
// and the `moment` import from "obsidian" are the same instance.
(window as unknown as Record<string, unknown>).moment = moment;

export { moment };

export const Platform = {
	isDesktop: true,
	isMobile: false,
	isMacOS: false,
	isWin: false,
	isLinux: false,
	isIosApp: false,
	isAndroidApp: false,
	isPhone: false,
	isTablet: false,
};

export function normalizePath(path: string): string {
	if (path.length === 0) return path;
	const normalized = path
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\//, "")
		.replace(/\/$/, "")
		.trim();
	return normalized.length === 0 ? "/" : normalized;
}

export async function requestUrl(_options: unknown): Promise<{ status: number; text: string }> {
	throw new Error("requestUrl is not implemented in the test mock");
}

export class Notice {
	message: string;
	constructor(message: string) {
		this.message = message;
	}
}

export class App {}
