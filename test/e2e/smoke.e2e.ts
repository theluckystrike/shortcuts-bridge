import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import { lastNotice, pluginId, reloadPlugin } from './load';

// Real-app checks of Shortcuts Bridge. Apple Shortcuts is never started: window.open is replaced by a recorder,
// so the tests read the exact URL that the plugin builds. The URLs below are written by hand (golden values).
// The plugin gets Mac platform flags through plugin.platformOverride, so the tests also run on Linux CI.
const MAC = { isIosApp: false, isAndroidApp: false, isDesktopApp: true, isMacOS: true, isWin: false, isLinux: false, isTablet: false };
const WINDOWS = { ...MAC, isMacOS: false, isWin: true };

interface Bridge {
	settings: { favourites: string; folderRules: string; maxChars: number; pending: { id: string; created: number }[] };
	pro: { opts: { http: unknown }; refreshNow(): Promise<void>; signOut(): void };
	platformOverride: unknown;
	saveSettings(): Promise<void>;
	refreshFavouriteCommands(warn: boolean): void;
	onCallback(params: Record<string, string>): Promise<void>;
}

/** Records window.open calls, sets the platform and the favourites, and clears old notices. */
async function setup(opts: { favourites?: string; folderRules?: string; platform?: unknown; maxChars?: number } = {}): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, o) => {
			const w = window as unknown as { __opened: string[] };
			w.__opened = [];
			window.open = (u?: string | URL) => {
				w.__opened.push(String(u));
				return null;
			};
			document.querySelectorAll('.notice').forEach((n) => n.remove());
			const p = (app as unknown as { plugins: { plugins: Record<string, Bridge> } }).plugins.plugins[id]!;
			p.platformOverride = o.platform;
			p.settings.favourites = o.favourites ?? '';
			p.settings.folderRules = o.folderRules ?? '';
			p.settings.maxChars = o.maxChars ?? 20000;
			p.settings.pending = [];
			await p.saveSettings();
			p.refreshFavouriteCommands(false);
		},
		pluginId,
		opts,
	);
}

/** Pro on: a stubbed GitHub Sponsors reply ($5 a month) and a fake token, then Refresh. Pro off: sign out. No real request. */
async function setPro(on: boolean): Promise<void> {
	await browser.executeObsidian(
		async ({ app }, id, value) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Bridge> } }).plugins.plugins[id]!;
			if (!value) {
				p.pro.signOut();
				return;
			}
			const reply = { status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } };
			p.pro.opts.http = () => Promise.resolve(reply);
			app.secretStorage.setSecret(`${id}-github-token`, 'gho_' + '0'.repeat(36));
			await p.pro.refreshNow();
		},
		pluginId,
		on,
	);
}

/** Text of the first match in the active tab, or null when there is none. Reads the DOM, so it works for hidden parts too. */
async function domText(selector: string): Promise<string | null> {
	return browser.execute((sel: string) => document.querySelector(`.workspace-leaf.mod-active ${sel}`)?.textContent ?? null, selector);
}

async function opened(): Promise<string[]> {
	return browser.execute(() => (window as unknown as { __opened: string[] }).__opened.slice());
}

async function waitOpened(n: number): Promise<string[]> {
	await browser.waitUntil(async () => (await opened()).length >= n, { timeout: 8000, timeoutMsg: `window.open was not called ${n} time(s)` });
	return opened();
}

async function openNote(path: string, body: string): Promise<void> {
	await obsidianPage.write(path, body);
	await obsidianPage.openFile(path);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, p) => app.workspace.activeEditor?.file?.path === p && !!app.workspace.activeEditor.editor, path), { timeout: 8000 });
}

/** Selects text in the active editor by offsets. */
async function select(from: number, to: number): Promise<void> {
	await browser.executeObsidian(({ app }, a, b) => {
		const ed = app.workspace.activeEditor!.editor!;
		ed.setSelection(ed.offsetToPos(a), ed.offsetToPos(b));
	}, from, to);
}

async function setCursor(offset: number): Promise<void> {
	await browser.executeObsidian(({ app }, o) => {
		const ed = app.workspace.activeEditor!.editor!;
		ed.setCursor(ed.offsetToPos(o));
	}, offset);
}

async function editorText(): Promise<string> {
	return browser.executeObsidian(({ app }) => app.workspace.activeEditor!.editor!.getValue());
}

/** The request id inside the x-success URL of an opened URL. */
function idOf(url: string): string {
	const success = new URL(url).searchParams.get('x-success') ?? '';
	return new URL(success).searchParams.get('id') ?? '';
}

async function callProtocol(params: Record<string, string>): Promise<void> {
	await browser.executeObsidian(async ({ app }, p) => {
		// The same table that Obsidian reads when it opens an obsidian:// URL (app.workspace.protocolHandler).
		const handlers = (app as unknown as Record<'workspace', { protocolHandler: { handlers: Map<string, (q: Record<string, string>) => unknown> } }>).workspace.protocolHandler.handlers;
		await handlers.get('shortcuts-bridge')!({ action: 'shortcuts-bridge', ...p });
	}, params);
}

/** Calls the plugin callback directly and waits for it. Used where the protocol handler is not needed. */
async function callback(params: Record<string, string>): Promise<void> {
	await browser.executeObsidian(async ({ app }, id, p) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, Bridge> } }).plugins.plugins[id]!;
		await plugin.onCallback({ action: 'shortcuts-bridge', ...p });
	}, pluginId, params);
}

describe(`${pluginId} in the real app`, function () {
	before(async function () {
		await setPro(false);
	});
	after(async function () {
		await setPro(false);
		await browser.execute(() => window.location.reload());
	});

	it('is enabled and reloads with no console errors', async function () {
		const state = await reloadPlugin(pluginId);
		expect(state).toEqual({ enabled: true, reloaded: true, errors: [] });
	});

	it('registers the protocol handler through the public API', async function () {
		const kind = await browser.executeObsidian(({ app }) => typeof (app as unknown as Record<'workspace', { protocolHandler: { handlers: Map<string, unknown> } }>).workspace.protocolHandler.handlers.get('shortcuts-bridge'));
		expect(kind).toBe('function');
	});

	it('makes one command for each favourite and removes it when the list changes', async function () {
		await setup({ platform: MAC, favourites: 'Summarise | selection\nAdd to Reminders | title | none | Remind me' });
		const ids = () => browser.executeObsidian(({ app }) => Object.keys((app as unknown as { commands: { commands: Record<string, unknown> } }).commands.commands).filter((c) => c.startsWith('shortcuts-bridge:')).sort());
		expect(await ids()).toEqual(['shortcuts-bridge:fav-add-to-reminders', 'shortcuts-bridge:fav-summarise', 'shortcuts-bridge:run-folder-default', 'shortcuts-bridge:run-shortcut']);
		await setup({ platform: MAC, favourites: 'Summarise | selection' });
		expect(await ids()).toEqual(['shortcuts-bridge:fav-summarise', 'shortcuts-bridge:run-folder-default', 'shortcuts-bridge:run-shortcut']);
	});

	it('sends the selection: exact URL with RFC 3986 encoding', async function () {
		await setup({ platform: MAC, favourites: 'Summarise | selection' });
		const body = "Hello, world! (it's *fine*) & more";
		await openNote('Selection.md', `intro ${body} outro`);
		await select(6, 6 + body.length);
		await browser.executeObsidianCommand(`${pluginId}:fav-summarise`);
		const urls = await waitOpened(1);
		expect(urls).toEqual(['shortcuts://run-shortcut?name=Summarise&input=text&text=Hello%2C%20world%21%20%28it%27s%20%2Afine%2A%29%20%26%20more']);
	});

	it('with nothing selected the selection input uses the current line', async function () {
		await setup({ platform: MAC, favourites: 'Summarise | selection' });
		await openNote('Line.md', 'first line\nsecond line\n');
		await setCursor(14);
		await browser.executeObsidianCommand(`${pluginId}:fav-summarise`);
		expect(await waitOpened(1)).toEqual(['shortcuts://run-shortcut?name=Summarise&input=text&text=second%20line']);
	});

	it('sends the whole note with a line break, accents and the title and path inputs', async function () {
		await setup({ platform: MAC, favourites: 'Whole | note\nTitle | title\nPath | path\nClip | clipboard\nNothing | none' });
		await openNote('Projects/Zażółć.md', 'Zażółć\nline');
		for (const c of ['whole', 'title', 'path', 'clip', 'nothing']) await browser.executeObsidianCommand(`${pluginId}:fav-${c}`);
		expect(await waitOpened(5)).toEqual([
			'shortcuts://run-shortcut?name=Whole&input=text&text=Za%C5%BC%C3%B3%C5%82%C4%87%0Aline',
			'shortcuts://run-shortcut?name=Title&input=text&text=Za%C5%BC%C3%B3%C5%82%C4%87',
			'shortcuts://run-shortcut?name=Path&input=text&text=Projects%2FZa%C5%BC%C3%B3%C5%82%C4%87.md',
			'shortcuts://run-shortcut?name=Clip&input=clipboard',
			'shortcuts://run-shortcut?name=Nothing',
		]);
	});

	it('does not send a text over the limit', async function () {
		await setup({ platform: MAC, favourites: 'Whole | note', maxChars: 1000 });
		await openNote('Long.md', 'x'.repeat(1001));
		await browser.executeObsidianCommand(`${pluginId}:fav-whole`);
		await browser.waitUntil(async () => (await lastNotice()).includes('The limit is 1000'), { timeout: 5000 });
		expect(await opened()).toEqual([]);
	});

	it('on Windows nothing is sent and the notice says why', async function () {
		await setup({ platform: WINDOWS, favourites: 'Summarise | title' });
		await openNote('Win.md', 'text');
		await browser.executeObsidianCommand(`${pluginId}:fav-summarise`);
		await browser.waitUntil(async () => (await lastNotice()).includes('Apple Shortcuts does not exist on Windows'), { timeout: 5000 });
		expect(await opened()).toEqual([]);
	});

	it('free version: the output is not asked for, the URL has no callback and a notice says Pro is needed', async function () {
		await setPro(false);
		await setup({ platform: MAC, favourites: 'Summarise | title | cursor' });
		await openNote('Free.md', 'text');
		await browser.executeObsidianCommand(`${pluginId}:fav-summarise`);
		expect(await waitOpened(1)).toEqual(['shortcuts://run-shortcut?name=Summarise&input=text&text=Free']);
		await browser.waitUntil(async () => (await lastNotice()).includes('runs without the output'), { timeout: 5000 });
		expect(await browser.executeObsidian(({ app }, id) => (app as unknown as { plugins: { plugins: Record<string, Bridge> } }).plugins.plugins[id]!.settings.pending.length, pluginId)).toBe(0);
	});

	it('Pro: the URL is the x-callback form with a one time id, and the request is saved', async function () {
		await setPro(true);
		await setup({ platform: MAC, favourites: 'Summarise | title | cursor' });
		await openNote('Pro One.md', 'text');
		await browser.executeObsidianCommand(`${pluginId}:fav-summarise`);
		const [url] = await waitOpened(1);
		const u = new URL(url!);
		expect(`${u.protocol}//${u.host}${u.pathname}`).toBe('shortcuts://x-callback-url/run-shortcut');
		expect(u.searchParams.get('name')).toBe('Summarise');
		expect(u.searchParams.get('input')).toBe('text');
		expect(u.searchParams.get('text')).toBe('Pro One');
		const vault = await browser.executeObsidian(({ app }) => app.vault.getName());
		const id = idOf(url!);
		expect(id).toMatch(/^[a-z0-9]{16}$/);
		for (const status of ['success', 'cancel', 'error']) {
			expect(u.searchParams.get(`x-${status}`)).toBe(`obsidian://shortcuts-bridge?vault=${encodeURIComponent(vault)}&id=${id}&status=${status}`);
		}
		const saved = await browser.executeObsidian(({ app }, pid) => app.vault.adapter.read(`${app.vault.configDir}/plugins/${pid}/data.json`), pluginId);
		expect(saved).toContain(id);
	});

	it('Pro: the output goes in at the cursor and the cursor moves behind it', async function () {
		await setPro(true);
		await setup({ platform: MAC, favourites: 'Summarise | note | cursor' });
		await openNote('Cursor.md', 'abc def');
		await setCursor(3);
		await browser.executeObsidianCommand(`${pluginId}:fav-summarise`);
		const id = idOf((await waitOpened(1))[0]!);
		await callProtocol({ vault: 'x', id, status: 'success', result: 'XYZ' });
		await browser.waitUntil(async () => (await editorText()) === 'abcXYZ def', { timeout: 5000 });
		const cursor = await browser.executeObsidian(({ app }) => app.workspace.activeEditor!.editor!.getCursor().ch);
		expect(cursor).toBe(6);
	});

	it('Pro: replace puts the output over the selection', async function () {
		await setPro(true);
		await setup({ platform: MAC, favourites: 'Fix | selection | replace' });
		await openNote('Replace.md', 'one two three');
		await select(4, 7);
		await browser.executeObsidianCommand(`${pluginId}:fav-fix`);
		const id = idOf((await waitOpened(1))[0]!);
		await callProtocol({ vault: 'x', id, status: 'success', result: '2' });
		await browser.waitUntil(async () => (await editorText()) === 'one 2 three', { timeout: 5000 });
	});

	it('Pro: append adds the output at the end, a property gets the trimmed text', async function () {
		await setPro(true);
		await setup({ platform: MAC, favourites: 'Tail | title | append\nSum | title | property:summary' });
		await openNote('Targets.md', 'body');
		await browser.executeObsidianCommand(`${pluginId}:fav-tail`);
		await browser.executeObsidianCommand(`${pluginId}:fav-sum`);
		const urls = await waitOpened(2);
		await callProtocol({ vault: 'x', id: idOf(urls[0]!), status: 'success', result: 'line a\nline b\n' });
		await callProtocol({ vault: 'x', id: idOf(urls[1]!), status: 'success', result: '  short text \n' });
		await browser.waitUntil(async () => (await obsidianPage.read('Targets.md')).includes('line b'), { timeout: 5000 });
		const text = await obsidianPage.read('Targets.md');
		expect(text).toContain('summary: short text');
		expect(text).toContain('body\nline a\nline b\n');
	});

	it('Pro: an unknown id, a second use, an old id, cancel and error write nothing', async function () {
		await setPro(true);
		await setup({ platform: MAC, favourites: 'Tail | title | append' });
		await openNote('Safe.md', 'body');
		await browser.executeObsidianCommand(`${pluginId}:fav-tail`);
		const id = idOf((await waitOpened(1))[0]!);
		await callback({ id: 'zzzzzzzzzzzz', status: 'success', result: 'EVIL' });
		await browser.waitUntil(async () => (await lastNotice()).includes('No waiting request'), { timeout: 5000 });
		await callback({ id, status: 'cancel' });
		await browser.waitUntil(async () => (await lastNotice()).includes('was cancelled'), { timeout: 5000 });
		await callback({ id, status: 'success', result: 'EVIL' });
		await browser.waitUntil(async () => (await lastNotice()).includes('No waiting request'), { timeout: 5000 });
		await browser.executeObsidianCommand(`${pluginId}:fav-tail`);
		const id2 = idOf((await waitOpened(2))[1]!);
		await callback({ id: id2, status: 'error', errorMessage: 'boom' });
		await browser.waitUntil(async () => (await lastNotice()).includes('failed: boom'), { timeout: 5000 });
		await browser.executeObsidianCommand(`${pluginId}:fav-tail`);
		const id3 = idOf((await waitOpened(3))[2]!);
		await browser.executeObsidian(({ app }, pid) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, Bridge> } }).plugins.plugins[pid]!;
			for (const e of p.settings.pending) e.created -= 31 * 60 * 1000;
		}, pluginId);
		await callback({ id: id3, status: 'success', result: 'EVIL' });
		await browser.waitUntil(async () => (await lastNotice()).includes('has expired'), { timeout: 5000 });
		expect(await obsidianPage.read('Safe.md')).toBe('body');
	});

	it('Pro: the folder rule with the longest folder wins, and no rule gives a notice', async function () {
		await setPro(true);
		await setup({ platform: MAC, favourites: '', folderRules: 'Projects | Outer | title\nProjects/Work | Inner | title\nProjects2 | Other | title' });
		await openNote('Projects/Work/Plan.md', 'x');
		await browser.executeObsidianCommand(`${pluginId}:run-folder-default`);
		expect(await waitOpened(1)).toEqual(['shortcuts://run-shortcut?name=Inner&input=text&text=Plan']);
		await openNote('Projects/Note.md', 'x');
		await browser.executeObsidianCommand(`${pluginId}:run-folder-default`);
		expect((await waitOpened(2))[1]).toBe('shortcuts://run-shortcut?name=Outer&input=text&text=Note');
		await openNote('Loose.md', 'x');
		await browser.executeObsidianCommand(`${pluginId}:run-folder-default`);
		await browser.waitUntil(async () => (await lastNotice()).includes('No folder rule matches Loose.md'), { timeout: 5000 });
		expect(await opened()).toHaveLength(2);
	});

	it('free version: the folder command only shows a notice', async function () {
		await setPro(false);
		await setup({ platform: MAC, folderRules: '/ | Anything | title' });
		await openNote('Free Folder.md', 'x');
		await browser.executeObsidianCommand(`${pluginId}:run-folder-default`);
		await browser.waitUntil(async () => (await lastNotice()).includes('is a pro feature'), { timeout: 5000 });
		expect(await opened()).toEqual([]);
	});

	it('Pro: the shortcut code block is a button that runs the shortcut with the note path', async function () {
		await setPro(true);
		await setup({ platform: MAC });
		await obsidianPage.write('Block.md', 'Intro\n\n```shortcut\nTag it\ninput: path\n```\n\n```shortcut\nBad\ninput: selection\n```\n');
		await browser.executeObsidian(async ({ app }) => {
			const f = app.vault.getFileByPath('Block.md')!;
			await app.workspace.getLeaf(false).openFile(f, { state: { mode: 'preview' } });
		});
		await browser.waitUntil(async () => (await domText('.shortcuts-bridge-button')) !== null, { timeout: 8000, timeoutMsg: 'no button drawn' });
		expect(await domText('.shortcuts-bridge-button')).toBe('Run Tag it');
		expect(await domText('.shortcuts-bridge-problem')).toContain('A button has no selection');
		await browser.execute(() => document.querySelector<HTMLElement>('.workspace-leaf.mod-active .shortcuts-bridge-button')?.click());
		expect(await waitOpened(1)).toEqual(['shortcuts://run-shortcut?name=Tag%20it&input=text&text=Block.md']);
	});

	it('free version: the code block shows a pro notice and no button', async function () {
		await setPro(false);
		await setup({ platform: MAC });
		await browser.executeObsidian(async ({ app }) => {
			const f = app.vault.getFileByPath('Block.md')!;
			await app.workspace.getLeaf(false).openFile(f, { state: { mode: 'preview' } });
		});
		await browser.waitUntil(async () => (await domText('.shortcuts-bridge-pro')) !== null, { timeout: 8000, timeoutMsg: 'no pro notice drawn' });
		expect(await domText('.shortcuts-bridge-pro')).toContain('is a pro feature');
		expect(await domText('.shortcuts-bridge-button')).toBeNull();
	});

	it('the picker lists the favourites and sends a typed name with the default input', async function () {
		await setup({ platform: MAC, favourites: 'Summarise | title' });
		await openNote('Picker.md', 'x');
		await browser.executeObsidianCommand(`${pluginId}:run-shortcut`);
		const input = await browser.$('.prompt-input');
		await input.waitForExist({ timeout: 5000 });
		await browser.waitUntil(async () => (await browser.$$('.suggestion-item').length) === 1);
		await input.setValue('My Own Shortcut');
		await browser.waitUntil(async () => (await browser.$$('.suggestion-item').length) === 1 && (await browser.$('.suggestion-item').getText()).includes('My Own Shortcut'));
		await browser.keys('Enter');
		expect(await waitOpened(1)).toEqual(['shortcuts://run-shortcut?name=My%20Own%20Shortcut&input=text&text=x']);
	});
});
