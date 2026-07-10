import type { App, TFile } from "obsidian";

export const FM_REMINDER_DATE = "reminderDate";
export const FM_REMINDER_TIME = "reminderTime";

export interface ReminderEntry {
	file: TFile;
	date: string;   // YYYY-MM-DD
	time?: string;  // HH:MM
}

export class ReminderService {
	constructor(private readonly app: App) {}

	async setReminder(file: TFile, date: string, time?: string): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm[FM_REMINDER_DATE] = date;
			if (time) {
				fm[FM_REMINDER_TIME] = time;
			} else {
				delete fm[FM_REMINDER_TIME];
			}
		});
	}

	async clearReminder(file: TFile): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			delete fm[FM_REMINDER_DATE];
			delete fm[FM_REMINDER_TIME];
		});
	}

	getReminder(file: TFile): { date: string; time?: string } | null {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		const rawDate = fm?.[FM_REMINDER_DATE];
		if (!rawDate) return null;

		// Obsidian may auto-parse ISO date strings into Date objects in the metadata cache.
		let date: string;
		if (typeof rawDate === "string") {
			date = rawDate.slice(0, 10); // strip any time component
		} else if (rawDate instanceof Date) {
			date = rawDate.toISOString().slice(0, 10);
		} else if (typeof rawDate === "number" || typeof rawDate === "boolean") {
			date = String(rawDate).slice(0, 10);
		} else {
			return null;
		}
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

		const rawTime = fm?.[FM_REMINDER_TIME];
		const time =
			typeof rawTime === "string" || typeof rawTime === "number" || typeof rawTime === "boolean"
				? String(rawTime)
				: undefined;
		return { date, time };
	}

	/** Files with a reminderDate on a specific YYYY-MM-DD, keyed by date. */
	getFilesWithReminderInRange(startDate: string, endDate: string): Map<string, TFile[]> {
		const result = new Map<string, TFile[]>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const r = this.getReminder(file);
			if (!r) continue;
			if (r.date >= startDate && r.date <= endDate) {
				const arr = result.get(r.date) ?? [];
				arr.push(file);
				result.set(r.date, arr);
			}
		}
		return result;
	}

	/** Files whose reminder datetime has passed and should fire now. */
	getDueReminders(now: Date): ReminderEntry[] {
		const nowMs = now.getTime();
		const results: ReminderEntry[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const r = this.getReminder(file);
			if (!r) continue;
			const dt = r.time
				? new Date(`${r.date}T${r.time}:00`)
				: new Date(`${r.date}T00:00:00`);
			if (dt.getTime() <= nowMs) {
				results.push({ file, date: r.date, time: r.time });
			}
		}
		return results;
	}
}
