import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import ShortcutsBridgePlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { encodeParam } from '../src/shortcut';
import manifest from '../manifest.json';

describe('ShortcutsBridgePlugin', () => {
	it('loads with default settings against an in-memory vault', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new ShortcutsBridgePlugin(app as never, manifest as never);
		await plugin.loadSettings();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('repairs bad saved settings', () => {
		expect(normalizeSettings({ maxChars: 'x' as never, defaultInput: 'everything' as never, favourites: 5 as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ maxChars: 5 }).maxChars).toBe(1000);
		expect(normalizeSettings({ maxChars: 1e9 }).maxChars).toBe(100000);
	});

	it('drops bad pending requests from saved data', () => {
		const good = { id: 'abc12345', path: 'a.md', output: 'cursor', shortcut: 'S', created: 1 };
		const s = normalizeSettings({ pending: [good, { id: 'x' }, null] as never });
		expect(s.pending).toEqual([good]);
	});

	it('does not send anything on Windows and shows the reason', async () => {
		const app = App.createConfigured__({ files: { 'notes/a.md': '# Hello world' } });
		const plugin = new ShortcutsBridgePlugin(app as never, manifest as never);
		await plugin.loadSettings();
		plugin.platformOverride = { isIosApp: false, isAndroidApp: false, isDesktopApp: true, isMacOS: false, isWin: true, isLinux: false, isTablet: false };
		const open = vi.fn();
		vi.stubGlobal('window', { open });
		const sent = await plugin.runFavourite({ name: 'Summarise', input: 'none', output: 'none', label: '' }, { file: null, editor: null });
		vi.unstubAllGlobals();
		expect(sent).toBeNull();
		expect(open).not.toHaveBeenCalled();
	});
});

describe('encodeParam', () => {
	it('replaces a lone surrogate with U+FFFD instead of throwing', () => {
		expect(encodeParam('a\ud800b')).toBe('a%EF%BF%BDb');
		expect(encodeParam('a\udc00b')).toBe('a%EF%BF%BDb');
	});
});
