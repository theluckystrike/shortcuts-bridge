import { MarkdownView, Notice, Platform, Plugin, type Editor, type ObsidianProtocolData, type TFile } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { ShortcutButton } from './block';
import { ShortcutPicker } from './picker';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { applyResult } from './result';
import { DEFAULT_SETTINGS, ShortcutsBridgeSettingTab, normalizeSettings, type ShortcutsBridgeSettings } from './settings';
import {
	PROTOCOL_ACTION,
	addPending,
	buildRunUrl,
	callbackUrls,
	chooseInput,
	commandIds,
	idFromBytes,
	lengthProblem,
	matchFolderRule,
	nameProblem,
	parseCallback,
	parseFavourites,
	parseFolderRules,
	platformSupport,
	takePending,
	type CallbackUrls,
	type Favourite,
	type InputContext,
	type InputSource,
	type Pending,
	type PlatformFlags,
} from './shortcut';

/** How often to ask the license state whether a check is due. It sends a request only when signed in and due (7 days). */
const PRO_TICK_MS = 6 * 60 * 60 * 1000;
const NEEDS_FILE = new Set<InputSource>(['note', 'title', 'path']);

/** The message for a Pro feature that is off. The word pro is lower case because the sentence case lint wants that. */
function proNotice(feature: string): void {
	new Notice(`${feature} is a pro feature. Sponsor on GitHub, then sign in from the plugin settings.`);
}

export interface RunContext {
	file: TFile | null;
	editor: Editor | null;
}

export default class ShortcutsBridgePlugin extends Plugin {
	settings: ShortcutsBridgeSettings = { ...DEFAULT_SETTINGS };
	/** GitHub Sponsors Pro state. Created in onload; null before that. */
	pro: SponsorsManager | null = null;
	/** Test seam: end-to-end tests set this to run the Apple platform code path on any computer. */
	platformOverride: PlatformFlags | null = null;
	private settingTab: ShortcutsBridgeSettingTab | null = null;
	private favouriteCommandIds: string[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();
		// No request here: a request needs a GitHub sign in first (Settings, Pro, Sign in with GitHub).
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS);
		pro.init();
		this.pro = pro;
		bindPro(pro);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.settingTab = new ShortcutsBridgeSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.addCommand({ id: 'run-shortcut', name: 'Run a shortcut', callback: () => this.openPicker() });
		this.addCommand({ id: 'run-folder-default', name: 'Run the default shortcut of this folder', callback: () => void this.runFolderDefault() });
		this.registerObsidianProtocolHandler(PROTOCOL_ACTION, (params) => void this.onCallback(params));
		this.registerMarkdownCodeBlockProcessor('shortcut', (source, el, ctx) => {
			ctx.addChild(new ShortcutButton(el, source, ctx.sourcePath, (f, path) => void this.runFromButton(f, path)));
		});
		this.refreshFavouriteCommands(false);
		this.app.workspace.onLayoutReady(() => {
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), PRO_TICK_MS));
		});
	}

	onunload(): void {
		resetPro();
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings((await this.loadData()) as Partial<ShortcutsBridgeSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** The platform flags that decide whether Apple Shortcuts exists here. */
	platform(): PlatformFlags {
		return (
			this.platformOverride ?? {
				isIosApp: Platform.isIosApp,
				isAndroidApp: Platform.isAndroidApp,
				isDesktopApp: Platform.isDesktopApp,
				isMacOS: Platform.isMacOS,
				isWin: Platform.isWin,
				isLinux: Platform.isLinux,
				isTablet: Platform.isTablet,
			}
		);
	}

	/** One command for each favourite. Command ids come from the shortcut name, so hotkeys survive a reorder. */
	refreshFavouriteCommands(warn: boolean): void {
		for (const id of this.favouriteCommandIds) this.removeCommand(id);
		const { items, problems } = parseFavourites(this.settings.favourites);
		const ids = commandIds(items);
		items.forEach((f, i) => {
			this.addCommand({ id: ids[i] ?? `fav-${i}`, name: f.label || `Run "${f.name}"`, callback: () => void this.runFavourite(f, this.currentContext()) });
		});
		this.favouriteCommandIds = ids;
		if (warn && problems.length > 0) new Notice(`Shortcuts Bridge: ${problems[0] ?? ''}${problems.length > 1 ? ` (${problems.length - 1} more in the settings)` : ''}`);
	}

	private currentContext(): RunContext {
		const active = this.app.workspace.activeEditor;
		return { file: active?.file ?? this.app.workspace.getActiveFile(), editor: active?.editor ?? null };
	}

	private openPicker(): void {
		const ctx = this.currentContext();
		const favs = parseFavourites(this.settings.favourites).items;
		new ShortcutPicker(this.app, favs, this.settings.defaultInput, (f) => void this.runFavourite(f, ctx)).open();
	}

	private async runFromButton(f: Favourite, path: string): Promise<void> {
		await this.runFavourite(f, { file: this.app.vault.getFileByPath(path), editor: null });
	}

	/** Pro: runs the shortcut of the folder rule that matches the open note. */
	async runFolderDefault(): Promise<void> {
		if (!isPro()) {
			proNotice('Folder default shortcuts');
			return;
		}
		const ctx = this.currentContext();
		if (!ctx.file) return void new Notice('Open a note first.');
		const rule = matchFolderRule(parseFolderRules(this.settings.folderRules).items, ctx.file.path);
		if (!rule) return void new Notice(`No folder rule matches ${ctx.file.path}.`);
		await this.runFavourite(rule, ctx);
	}

	private async gather(source: InputSource, ctx: RunContext): Promise<InputContext> {
		const { editor, file } = ctx;
		let note = '';
		if (source === 'note') note = editor ? editor.getValue() : file ? await this.app.vault.cachedRead(file) : '';
		return {
			selection: editor?.getSelection() ?? '',
			line: editor ? editor.getLine(editor.getCursor().line) : '',
			note,
			title: file?.basename ?? '',
			path: file?.path ?? '',
		};
	}

	/** Makes the callback for a favourite that wants the output back. Returns undefined for none, null to stop. */
	private async makeCallback(fav: Favourite, ctx: RunContext): Promise<CallbackUrls | undefined | null> {
		if (fav.output === 'none') return undefined;
		if (!isPro()) {
			proNotice('Getting the output back');
			new Notice('The shortcut runs without the output.');
			return undefined;
		}
		if (!ctx.file) {
			new Notice('Open a note first: the output needs a note to go to.');
			return null;
		}
		const entry: Pending = { id: idFromBytes(crypto.getRandomValues(new Uint8Array(16))), path: ctx.file.path, output: fav.output, shortcut: fav.name, created: Date.now() };
		if (fav.output === 'replace-line') {
			// The line is the one with the cursor now. Its text is saved so that the plugin can find it again after edits.
			const editor = ctx.editor;
			if (!editor) return this.stop('Replace line needs the note open in editing mode, with the cursor on the line.');
			// Reading mode keeps an editor with a cursor that the user cannot see. That line would be a guess.
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view && view.editor === editor && view.getMode() === 'preview') return this.stop('Replace line needs the note open in editing mode, with the cursor on the line.');
			if (editor.getCursor('from').line !== editor.getCursor('to').line) return this.stop('Replace line works on one line. Select text on one line only, or select nothing.');
			entry.line = editor.getCursor().line;
			entry.lineText = editor.getLine(entry.line);
		}
		this.settings.pending = addPending(this.settings.pending, entry, Date.now());
		// Saved before the shortcut starts: on iPhone the app can be closed while the shortcut runs.
		await this.saveSettings();
		return callbackUrls(this.app.vault.getName(), entry.id);
	}

	private stop(message: string): null {
		new Notice(message);
		return null;
	}

	/** Runs one shortcut. Returns the URL that was opened, or null when nothing was sent (a notice says why). */
	async runFavourite(fav: Favourite, ctx: RunContext): Promise<string | null> {
		const info = platformSupport(this.platform());
		if (!info.ok) return this.stop(info.message);
		const bad = nameProblem(fav.name);
		if (bad) return this.stop(bad);
		if (NEEDS_FILE.has(fav.input) && !ctx.file) return this.stop('Open a note first.');
		const chosen = chooseInput(fav.input, await this.gather(fav.input, ctx));
		if (chosen.mode === 'empty') return this.stop(chosen.reason);
		const tooLong = chosen.mode === 'text' ? lengthProblem(chosen.text, this.settings.maxChars) : null;
		if (tooLong) return this.stop(tooLong);
		const callback = await this.makeCallback(fav, ctx);
		if (callback === null) return null;
		const text = chosen.mode === 'text' ? chosen.text : undefined;
		const url = buildRunUrl({ name: fav.name, input: chosen.mode === 'text' || chosen.mode === 'clipboard' ? chosen.mode : 'none', text, callback });
		window.open(url);
		return url;
	}

	/** The obsidian:// callback of Shortcuts (x-success, x-cancel, x-error). Pro. */
	async onCallback(params: ObsidianProtocolData): Promise<void> {
		const cb = parseCallback(params);
		if (cb.kind === 'invalid') return void new Notice(`Shortcuts Bridge: ${cb.reason}`);
		if (!isPro()) return void proNotice('Getting the output of a shortcut');
		const taken = takePending(this.settings.pending, cb.id, Date.now());
		this.settings.pending = taken.rest;
		await this.saveSettings();
		const entry = taken.entry;
		if (!entry) return void new Notice(taken.expired ? 'This shortcut request has expired. Run the shortcut again.' : 'No waiting request matches this callback. It may have been used already.');
		if (cb.kind === 'cancel') return void new Notice(`The shortcut "${entry.shortcut}" was cancelled.`);
		if (cb.kind === 'error') return void new Notice(`The shortcut "${entry.shortcut}" failed${cb.message ? `: ${cb.message}` : '.'}`);
		if (cb.result === null || cb.result === '') return void new Notice(`The shortcut "${entry.shortcut}" finished with no output.`);
		try {
			new Notice(await applyResult(this.app, entry, cb.result));
		} catch (e) {
			new Notice(e instanceof Error ? e.message : 'The output could not be written.');
		}
	}
}
