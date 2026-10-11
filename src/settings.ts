import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI, isPro } from './pro';
import { INPUT_SOURCES, normalizePending, parseFavourites, parseFolderRules, platformSupport, type InputSource, type Pending } from './shortcut';
import type ShortcutsBridgePlugin from './main';

export interface ShortcutsBridgeSettings {
	/** One favourite per line: Name | input | output | label. */
	favourites: string;
	/** Pro. One rule per line: Folder | Name | input | output | label. */
	folderRules: string;
	/** Input of the "Run a shortcut" command for a name that is not a favourite. */
	defaultInput: InputSource;
	/** Longest text, in characters, that one run may send. */
	maxChars: number;
	/** Requests that wait for a callback. Not a user setting; it survives an app restart. */
	pending: Pending[];
}

export const MAX_CHARS_MIN = 1000;
export const MAX_CHARS_MAX = 100000;

export const DEFAULT_SETTINGS: ShortcutsBridgeSettings = {
	favourites: '',
	folderRules: '',
	defaultInput: 'selection',
	maxChars: 20000,
	pending: [],
};

/** Fills gaps and drops bad values from saved data, so old or hand-edited data.json never breaks the plugin. */
export function normalizeSettings(saved: Partial<ShortcutsBridgeSettings> | null | undefined): ShortcutsBridgeSettings {
	const s = saved ?? {};
	const max = typeof s.maxChars === 'number' && Number.isFinite(s.maxChars) ? Math.round(s.maxChars) : DEFAULT_SETTINGS.maxChars;
	return {
		favourites: typeof s.favourites === 'string' ? s.favourites : DEFAULT_SETTINGS.favourites,
		folderRules: typeof s.folderRules === 'string' ? s.folderRules : DEFAULT_SETTINGS.folderRules,
		defaultInput: INPUT_SOURCES.includes(s.defaultInput as InputSource) ? (s.defaultInput as InputSource) : DEFAULT_SETTINGS.defaultInput,
		maxChars: Math.min(MAX_CHARS_MAX, Math.max(MAX_CHARS_MIN, max)),
		pending: normalizePending(s.pending),
	};
}

const INPUT_LABELS: Record<InputSource, string> = {
	selection: 'Selection (or the current line)',
	line: 'Current line',
	note: 'Whole note',
	title: 'Note title',
	path: 'Note path',
	clipboard: 'Clipboard (read by Shortcuts)',
	none: 'No input',
};

export class ShortcutsBridgeSettingTab extends PluginSettingTab {
	plugin: ShortcutsBridgePlugin;

	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], plugin: ShortcutsBridgePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const platform = platformSupport(this.plugin.platform());
		const favs = parseFavourites(this.plugin.settings.favourites);
		const rules = parseFolderRules(this.plugin.settings.folderRules);
		const problems = [...favs.problems, ...(isPro() ? rules.problems.map((p) => `Folder rules, ${p}`) : [])];
		return [
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
			{
				name: 'Platform',
				desc: platform.ok ? `Apple Shortcuts is available on ${platform.label}.` : platform.message,
			},
			{
				name: 'Favourite shortcuts',
				desc:
					'One favourite per line: Shortcut name | input | output | command name. Only the name is needed. Input is selection, line, note, title, path, clipboard or none (default selection). Output is none, cursor, replace, append or property:<name> (default none). ' +
					`Each line becomes a command. ${favs.items.length} favourites now.` +
					(problems.length > 0 ? ` Problems: ${problems.join(' ')}` : ''),
				control: { type: 'textarea', key: 'favourites', defaultValue: DEFAULT_SETTINGS.favourites, rows: 6, placeholder: 'Summarise | selection | cursor\nSave to Reminders | title\nTranslate | note | property:translation | Translate this note' },
			},
			{
				name: 'Input for other shortcuts',
				desc: 'What the "Run a shortcut" command sends when you type a name that is not a favourite.',
				control: { type: 'dropdown', key: 'defaultInput', defaultValue: DEFAULT_SETTINGS.defaultInput, options: INPUT_LABELS },
			},
			{
				name: 'Longest text to send',
				desc: `Characters, from ${MAX_CHARS_MIN} to ${MAX_CHARS_MAX}. A longer text is not sent. The limit of the Shortcuts URL on your device was not measured, so raise this with care.`,
				control: { type: 'slider', key: 'maxChars', defaultValue: DEFAULT_SETTINGS.maxChars, min: MAX_CHARS_MIN, max: MAX_CHARS_MAX, step: 1000 },
			},
			{
				name: 'Folder default shortcuts (Pro)',
				desc:
					'One rule per line: Folder | Shortcut name | input | output | command name. The command "Run the default shortcut of this folder" uses the rule with the longest matching folder. Use / for the whole vault.' +
					(isPro() ? ` ${rules.items.length} rules now.` : ' Pro is off, so the command shows a notice only.'),
				control: { type: 'textarea', key: 'folderRules', defaultValue: DEFAULT_SETTINGS.folderRules, rows: 4, placeholder: 'Projects | Summarise | note | property:summary\n/ | Save to Reminders | title' },
			},
		];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		this.plugin.refreshFavouriteCommands(true);
	}
}
