 
 
import type { Moment } from "moment";
import { App, TFile } from "obsidian";
import { applyTemplateTransformations, getTemplateContents } from "../utils/template";
import { getNoteCreationPath } from "../utils/paths";
import { DEFAULT_FORMAT } from "./constants";
import { findPeriodicNotes, getPeriodicNoteForDate } from "./discovery";
import type { Granularity, PeriodicConfig } from "./types";
import { granularities } from "./types";
import { formatHalfYear } from "./half-year";

export interface PeriodicResolver {
	app: App;
	getConfig(granularity: Granularity): PeriodicConfig;
}

export function getFormat(config: PeriodicConfig, granularity: Granularity): string {
	return config.format?.trim() ? config.format : DEFAULT_FORMAT[granularity];
}

export function getPeriodicNote(
	resolver: PeriodicResolver,
	granularity: Granularity,
	date: Moment
): TFile | null {
	const config = resolver.getConfig(granularity);
	return getPeriodicNoteForDate(resolver.app, config, granularity, date);
}

export async function createPeriodicNote(
	resolver: PeriodicResolver,
	granularity: Granularity,
	date: Moment
): Promise<TFile> {
	const config = resolver.getConfig(granularity);
	const format = getFormat(config, granularity);
	const filename = granularity === "half-year"
		? formatHalfYear(date)
		: date.format(format);
	const templateContents = await getTemplateContents(resolver.app, config.templatePath);
	const renderedContents = applyTemplateTransformations(
		filename,
		granularity,
		date,
		format,
		templateContents
	);
	const destPath = await getNoteCreationPath(resolver.app, filename, config);
	return resolver.app.vault.create(destPath, renderedContents);
}

export interface OpenOpts {
	inNewSplit?: boolean;
}

export async function openPeriodicNote(
	resolver: PeriodicResolver,
	granularity: Granularity,
	date: Moment,
	opts: OpenOpts = {}
): Promise<TFile> {
	const { workspace } = resolver.app;
	let file = getPeriodicNote(resolver, granularity, date);
	if (!file) {
		file = await createPeriodicNote(resolver, granularity, date);
	}
	const leaf = opts.inNewSplit
		? workspace.getLeaf("split")
		: workspace.getLeaf(false);
	await leaf.openFile(file, { active: true });
	return file;
}

export function findInPeriodic(
	resolver: PeriodicResolver,
	filePath: string
): { granularity: Granularity; date: Moment } | null {
	for (const granularity of granularities) {
		const config = resolver.getConfig(granularity);
		const matches = findPeriodicNotes(resolver.app, config, granularity);
		const match = matches.find((m) => m.file.path === filePath);
		if (match) return { granularity, date: match.date };
	}
	return null;
}
