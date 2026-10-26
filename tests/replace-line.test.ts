import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import type { Editor } from 'obsidian';
import ShortcutsBridgePlugin from '../src/main';
import { bindPro, resetPro } from '../src/pro';
import { applyResult } from '../src/result';
import type { Pending } from '../src/shortcut';
import manifest from '../manifest.json';

const MAC = { isIosApp: false, isAndroidApp: false, isDesktopApp: true, isMacOS: true, isWin: false, isLinux: false, isTablet: false };

function entry(over: Partial<Pending> = {}): Pending {
	return { id: 'aaaaaaaa', path: 'a.md', output: 'replace-line', shortcut: 'Quote', created: Date.now(), line: 1, lineText: 'two', ...over };
}

async function setup(content: string) {
	const app = App.createConfigured__({ files: { 'a.md': content } });
	const plugin = new ShortcutsBridgePlugin(app as never, manifest as never);
	await plugin.loadSettings();
	plugin.platformOverride = MAC;
	return { app, plugin };
}

/** A small editor with the methods that main.ts and the plugin read: one text, one cursor, one selection. */
function fakeEditor(text: string, cursor: { line: number; ch: number }, selectionEnd?: { line: number; ch: number }) {
	const lines = text.split('\n');
	return {
		getValue: () => text,
		getLine: (n: number) => lines[n] ?? '',
		getCursor: (which?: string) => (which === 'to' ? (selectionEnd ?? cursor) : cursor),
		getSelection: () => '',
	} as unknown as Editor;
}

describe('output replace-line, the note is not open in an editor', () => {
	it('replaces the saved line', async () => {
		const { app } = await setup('one\ntwo\nthree');
		const msg = await applyResult(app as never, entry(), 'TWO');
		expect(msg).toBe('Replaced the line with the output of "Quote".');
		expect(await app.vault.read(app.vault.getFileByPath('a.md') as never)).toBe('one\nTWO\nthree');
	});

	it('finds the line again when text was added above it', async () => {
		const { app } = await setup('new\none\ntwo\nthree');
		await applyResult(app as never, entry(), 'TWO');
		expect(await app.vault.read(app.vault.getFileByPath('a.md') as never)).toBe('new\none\nTWO\nthree');
	});

	it('adds the output at the end when the line is gone, and says so', async () => {
		const { app } = await setup('one\nthree');
		const msg = await applyResult(app as never, entry(), 'TWO');
		expect(msg).toContain('was not replaced');
		expect(await app.vault.read(app.vault.getFileByPath('a.md') as never)).toBe('one\nthree\nTWO\n');
	});

	it('adds the output at the end when the note changes between the read and the write', async () => {
		const { app } = await setup('one\nthree');
		vi.spyOn(app.vault, 'read').mockResolvedValueOnce('one\ntwo\nthree');
		const msg = await applyResult(app as never, entry(), 'TWO');
		expect(msg).toContain('was not replaced');
		expect(await app.vault.read(app.vault.getFileByPath('a.md') as never)).toBe('one\nthree\nTWO\n');
	});

	it('does not change the note for an empty output', async () => {
		const { app } = await setup('one\ntwo\nthree');
		await expect(applyResult(app as never, entry(), '\n  \n')).rejects.toThrow('is empty');
		expect(await app.vault.read(app.vault.getFileByPath('a.md') as never)).toBe('one\ntwo\nthree');
	});
});

describe('output replace-line, the request', () => {
	afterEach(() => {
		resetPro();
		vi.unstubAllGlobals();
	});

	function pro(on: boolean): void {
		bindPro({ isPro: () => on, onChange: () => () => undefined, getState: () => ({ status: 'signed-out', lastAttemptAt: 0 }), hasToken: () => false, config: { sponsorLogin: 'theluckystrike' } } as never);
	}

	it('saves the cursor line number and its text, then opens the link', async () => {
		pro(true);
		const { app, plugin } = await setup('one\ntwo\nthree');
		const open = vi.fn();
		vi.stubGlobal('window', { open });
		const file = app.vault.getFileByPath('a.md');
		const url = await plugin.runFavourite({ name: 'Quote', input: 'line', output: 'replace-line', label: '' }, { file: file as never, editor: fakeEditor('one\ntwo\nthree', { line: 1, ch: 2 }) });
		expect(url).toContain('shortcuts://x-callback-url/run-shortcut?');
		expect(open).toHaveBeenCalledOnce();
		expect(plugin.settings.pending).toHaveLength(1);
		expect(plugin.settings.pending[0]).toMatchObject({ output: 'replace-line', line: 1, lineText: 'two', path: 'a.md', shortcut: 'Quote' });
	});

	it('stops without an editor and sends nothing', async () => {
		pro(true);
		const { app, plugin } = await setup('one\ntwo');
		const open = vi.fn();
		vi.stubGlobal('window', { open });
		const url = await plugin.runFavourite({ name: 'Quote', input: 'title', output: 'replace-line', label: '' }, { file: app.vault.getFileByPath('a.md') as never, editor: null });
		expect(url).toBeNull();
		expect(open).not.toHaveBeenCalled();
		expect(plugin.settings.pending).toEqual([]);
	});

	it('stops in reading mode, where the cursor line cannot be seen', async () => {
		pro(true);
		const { app, plugin } = await setup('one\ntwo');
		const open = vi.fn();
		vi.stubGlobal('window', { open });
		const editor = fakeEditor('one\ntwo', { line: 0, ch: 0 });
		vi.spyOn(app.workspace, 'getActiveViewOfType').mockReturnValue({ editor, getMode: () => 'preview' } as never);
		const url = await plugin.runFavourite({ name: 'Quote', input: 'title', output: 'replace-line', label: '' }, { file: app.vault.getFileByPath('a.md') as never, editor });
		expect(url).toBeNull();
		expect(open).not.toHaveBeenCalled();
		expect(plugin.settings.pending).toEqual([]);
	});

	it('stops when the selection covers more than one line', async () => {
		pro(true);
		const { app, plugin } = await setup('one\ntwo\nthree');
		const open = vi.fn();
		vi.stubGlobal('window', { open });
		const editor = fakeEditor('one\ntwo\nthree', { line: 0, ch: 0 }, { line: 1, ch: 3 });
		const url = await plugin.runFavourite({ name: 'Quote', input: 'title', output: 'replace-line', label: '' }, { file: app.vault.getFileByPath('a.md') as never, editor });
		expect(url).toBeNull();
		expect(open).not.toHaveBeenCalled();
	});

	it('without Pro the shortcut runs with no callback and nothing is saved', async () => {
		pro(false);
		const { app, plugin } = await setup('one\ntwo');
		const open = vi.fn();
		vi.stubGlobal('window', { open });
		const url = await plugin.runFavourite({ name: 'Quote', input: 'line', output: 'replace-line', label: '' }, { file: app.vault.getFileByPath('a.md') as never, editor: fakeEditor('one\ntwo', { line: 1, ch: 0 }) });
		expect(url).toBe('shortcuts://run-shortcut?name=Quote&input=text&text=two');
		expect(plugin.settings.pending).toEqual([]);
	});
});
