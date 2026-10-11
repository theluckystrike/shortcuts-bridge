// Pure logic of Shortcuts Bridge. No Obsidian import and no DOM, so Vitest runs it against the golden vectors
// in packages/spec/vectors/shortcuts-bridge.json. Public docs used: the Apple Shortcuts URL scheme
// (shortcuts://run-shortcut and shortcuts://x-callback-url/run-shortcut with name, input, text, x-success,
// x-cancel, x-error) and the Obsidian URI format (obsidian://action?vault=...).

export const INPUT_SOURCES = ['selection', 'line', 'note', 'title', 'path', 'clipboard', 'none'] as const;
export type InputSource = (typeof INPUT_SOURCES)[number];
export type Output = 'none' | 'cursor' | 'replace' | 'append' | `property:${string}`;

export interface Favourite {
	name: string;
	input: InputSource;
	output: Output;
	/** Command name text. Empty means: use the shortcut name. */
	label: string;
}
export interface FolderRule extends Favourite {
	/** Folder path without a slash at either end. Empty string means the whole vault. */
	folder: string;
}
export interface ParseResult<T> {
	items: T[];
	problems: string[];
}

export const PROTOCOL_ACTION = 'shortcuts-bridge';
export const NAME_MAX = 200;
export const PENDING_TTL_MS = 30 * 60 * 1000;
export const PENDING_MAX = 20;

// ---------------------------------------------------------------- URL building

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Percent-encodes one query value as RFC 3986 says: only A-Z a-z 0-9 - . _ ~ stay. Line breaks become \n. */
export function encodeParam(value: string): string {
	const clean = value.replace(/\r\n?/g, '\n').replace(LONE_SURROGATE, '�');
	return encodeURIComponent(clean).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Returns an error text when the shortcut name cannot be sent, else null. */
export function nameProblem(name: string): string | null {
	const n = name.trim();
	if (n === '') return 'The shortcut name is empty.';
	if (n.length > NAME_MAX) return `The shortcut name is longer than ${NAME_MAX} characters.`;
	// eslint-disable-next-line no-control-regex -- control characters are the thing to find
	if (/[\u0000-\u001F\u007F]/.test(n)) return 'The shortcut name has a control character.';
	return null;
}

export interface CallbackUrls {
	success: string;
	cancel: string;
	error: string;
}

/** The three obsidian:// URLs that Shortcuts opens at the end. Shortcuts adds result=... to the success URL. */
export function callbackUrls(vault: string, id: string): CallbackUrls {
	const base = `obsidian://${PROTOCOL_ACTION}?vault=${encodeParam(vault)}&id=${encodeParam(id)}&status=`;
	return { success: base + 'success', cancel: base + 'cancel', error: base + 'error' };
}

export interface RunRequest {
	name: string;
	/** text: send `text`. clipboard: Shortcuts reads its clipboard. none: no input. */
	input: 'text' | 'clipboard' | 'none';
	text?: string;
	callback?: CallbackUrls;
}

/** The shortcuts:// URL for a run. With a callback it uses the x-callback-url form. */
export function buildRunUrl(r: RunRequest): string {
	const parts = [`name=${encodeParam(r.name.trim())}`];
	if (r.input === 'text') parts.push('input=text', `text=${encodeParam(r.text ?? '')}`);
	else if (r.input === 'clipboard') parts.push('input=clipboard');
	if (r.callback) {
		parts.push(`x-success=${encodeParam(r.callback.success)}`, `x-cancel=${encodeParam(r.callback.cancel)}`, `x-error=${encodeParam(r.callback.error)}`);
	}
	return `${r.callback ? 'shortcuts://x-callback-url/run-shortcut' : 'shortcuts://run-shortcut'}?${parts.join('&')}`;
}

// ---------------------------------------------------------------- input choice

export interface InputContext {
	selection: string;
	line: string;
	note: string;
	title: string;
	path: string;
}
export type Chosen = { mode: 'text'; text: string } | { mode: 'clipboard' } | { mode: 'none' } | { mode: 'empty'; reason: string };

/** Which text goes to the shortcut. Selection falls back to the current line when nothing is selected. */
export function chooseInput(source: InputSource, ctx: InputContext): Chosen {
	switch (source) {
		case 'clipboard':
			return { mode: 'clipboard' };
		case 'none':
			return { mode: 'none' };
		case 'title':
			return { mode: 'text', text: ctx.title };
		case 'path':
			return { mode: 'text', text: ctx.path };
		case 'note':
			return ctx.note.trim() === '' ? { mode: 'empty', reason: 'The note is empty.' } : { mode: 'text', text: ctx.note };
		case 'line':
			return ctx.line.trim() === '' ? { mode: 'empty', reason: 'The current line is empty.' } : { mode: 'text', text: ctx.line };
		case 'selection':
			if (ctx.selection.trim() !== '') return { mode: 'text', text: ctx.selection };
			return ctx.line.trim() === '' ? { mode: 'empty', reason: 'Nothing is selected and the current line is empty.' } : { mode: 'text', text: ctx.line };
	}
}

/** Returns an error text when the text is longer than the limit, else null. */
export function lengthProblem(text: string, max: number): string | null {
	return text.length > max ? `The text has ${text.length} characters. The limit is ${max}. Select less text or raise the limit in the settings.` : null;
}

// ---------------------------------------------------------------- text lists

const INPUT_SET = new Set<string>(INPUT_SOURCES);

/** Reads one output word. Returns null when the word is not valid. */
export function parseOutput(word: string): Output | null {
	const w = word.trim();
	if (w === '' || w.toLowerCase() === 'none') return 'none';
	const lower = w.toLowerCase();
	if (lower === 'cursor' || lower === 'replace' || lower === 'append') return lower;
	const m = /^property\s*:\s*(.+)$/i.exec(w);
	if (m && m[1] !== undefined) {
		const key = m[1].trim();
		return key === '' || /[\n:]/.test(key) ? null : `property:${key}`;
	}
	return null;
}

function parseInputWord(word: string, fallback: InputSource): InputSource | null {
	const w = word.trim().toLowerCase();
	if (w === '') return fallback;
	return INPUT_SET.has(w) ? (w as InputSource) : null;
}

function fail(problems: string[], message: string): null {
	problems.push(message);
	return null;
}

/** Reads the fields name | input | output | label (the last three are optional). */
function parseFields(parts: string[], where: string, problems: string[]): Favourite | null {
	const name = (parts[0] ?? '').trim();
	const bad = nameProblem(name);
	if (bad) return fail(problems, `${where}: ${bad}`);
	const input = parseInputWord(parts[1] ?? '', 'selection');
	if (input === null) return fail(problems, `${where}: unknown input "${(parts[1] ?? '').trim()}". Use ${INPUT_SOURCES.join(', ')}.`);
	const output = parseOutput(parts[2] ?? '');
	if (output === null) return fail(problems, `${where}: unknown output "${(parts[2] ?? '').trim()}". Use none, cursor, replace, append or property:<name>.`);
	return { name, input, output, label: (parts[3] ?? '').trim() };
}

function dataLines(text: string): { n: number; parts: string[] }[] {
	const out: { n: number; parts: string[] }[] = [];
	text.split(/\r?\n/).forEach((raw, i) => {
		const line = raw.trim();
		if (line === '' || line.startsWith('#')) return;
		out.push({ n: i + 1, parts: line.split('|') });
	});
	return out;
}

/** Favourites from the settings text. One per line: Name | input | output | label. */
export function parseFavourites(text: string): ParseResult<Favourite> {
	const items: Favourite[] = [];
	const problems: string[] = [];
	for (const { n, parts } of dataLines(text)) {
		if (parts.length > 4) {
			problems.push(`Line ${n}: more than 4 fields. Do not use "|" inside a name.`);
			continue;
		}
		const f = parseFields(parts, `Line ${n}`, problems);
		if (f) items.push(f);
	}
	return { items, problems };
}

/** Folder (name) rules from the settings text. One per line: Folder | Name | input | output | label. */
export function parseFolderRules(text: string): ParseResult<FolderRule> {
	const items: FolderRule[] = [];
	const problems: string[] = [];
	for (const { n, parts } of dataLines(text)) {
		if (parts.length > 5 || parts.length < 2) {
			problems.push(`Line ${n}: write Folder | Shortcut name | input | output (2 to 5 fields).`);
			continue;
		}
		const f = parseFields(parts.slice(1), `Line ${n}`, problems);
		if (f) items.push({ ...f, folder: normalizeFolder(parts[0] ?? '') });
	}
	return { items, problems };
}

export function normalizeFolder(folder: string): string {
	const f = folder.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
	return f === '.' ? '' : f;
}

/** The rule with the longest folder that holds the note. A folder matches whole path segments only. */
export function matchFolderRule(rules: FolderRule[], notePath: string): FolderRule | null {
	let best: FolderRule | null = null;
	for (const r of rules) {
		const hit = r.folder === '' || notePath.startsWith(r.folder + '/');
		if (hit && (best === null || r.folder.length > best.folder.length)) best = r;
	}
	return best;
}

// ---------------------------------------------------------------- code block

const BLOCK_KEY = /^(name|input|output|label)\s*:\s*(.*)$/i;

/** Reads the body of a ```shortcut block. First free line is the name; input:, output:, label: lines are optional. */
export function parseBlock(source: string): { ok: true; favourite: Favourite } | { ok: false; error: string } {
	const f = { name: '', input: 'note' as InputSource, output: 'none' as Output, label: '' };
	let inputWord = '';
	let outputWord = '';
	for (const raw of source.split(/\r?\n/)) {
		const line = raw.trim();
		if (line === '') continue;
		const m = BLOCK_KEY.exec(line);
		const key = m?.[1]?.toLowerCase();
		const val = (m?.[2] ?? '').trim();
		if (key === 'input') inputWord = val;
		else if (key === 'output') outputWord = val;
		else if (key === 'label') f.label = val;
		else if (key === 'name' || f.name === '') f.name = key === 'name' ? val : line;
	}
	const bad = nameProblem(f.name);
	if (bad) return { ok: false, error: bad };
	const input = parseInputWord(inputWord, 'note');
	if (input === null) return { ok: false, error: `Unknown input "${inputWord}". Use note, title, path, clipboard or none.` };
	if (input === 'selection' || input === 'line') return { ok: false, error: 'A button has no selection. Use input: note, title, path, clipboard or none.' };
	const output = parseOutput(outputWord);
	if (output === null) return { ok: false, error: `Unknown output "${outputWord}". Use none, cursor, replace, append or property:<name>.` };
	return { ok: true, favourite: { ...f, input, output } };
}

// ---------------------------------------------------------------- callback

export type Callback =
	| { kind: 'success'; id: string; result: string | null }
	| { kind: 'cancel'; id: string }
	| { kind: 'error'; id: string; message: string }
	| { kind: 'invalid'; reason: string };

const ID_PATTERN = /^[a-z0-9]{8,32}$/;

/** Reads the parameters that Obsidian passes to the protocol handler. */
export function parseCallback(params: Record<string, string>): Callback {
	const id = params['id'] ?? '';
	if (!ID_PATTERN.test(id)) return { kind: 'invalid', reason: 'The callback has no valid request id.' };
	const status = params['status'];
	if (status === 'cancel') return { kind: 'cancel', id };
	if (status === 'error') return { kind: 'error', id, message: (params['errorMessage'] ?? params['error'] ?? '').trim() };
	if (status === 'success') return { kind: 'success', id, result: typeof params['result'] === 'string' ? params['result'] : null };
	return { kind: 'invalid', reason: 'The callback status is not success, cancel or error.' };
}

/** A request id with one base 36 character for each byte. Give it random bytes. */
export function idFromBytes(bytes: ArrayLike<number>): string {
	let out = '';
	for (let i = 0; i < bytes.length; i++) out += ((bytes[i] ?? 0) % 36).toString(36);
	return out;
}

// ---------------------------------------------------------------- pending requests

export interface Pending {
	id: string;
	path: string;
	output: Output;
	shortcut: string;
	created: number;
}

/** Keeps only well formed entries from saved data. */
export function normalizePending(raw: unknown): Pending[] {
	if (!Array.isArray(raw)) return [];
	const out: Pending[] = [];
	for (const r of raw as Partial<Pending>[]) {
		if (!r || typeof r.id !== 'string' || !ID_PATTERN.test(r.id) || typeof r.path !== 'string' || typeof r.shortcut !== 'string' || typeof r.created !== 'number') continue;
		const output = parseOutput(typeof r.output === 'string' ? r.output : '');
		if (output === null || output === 'none') continue;
		out.push({ id: r.id, path: r.path, output, shortcut: r.shortcut, created: r.created });
	}
	return out.slice(-PENDING_MAX);
}

function fresh(list: Pending[], now: number): Pending[] {
	return list.filter((p) => now - p.created >= 0 && now - p.created <= PENDING_TTL_MS);
}

/** Adds a request. Drops expired ones and keeps the newest PENDING_MAX. */
export function addPending(list: Pending[], entry: Pending, now: number): Pending[] {
	return [...fresh(list, now).filter((p) => p.id !== entry.id), entry].slice(-PENDING_MAX);
}

/** Takes one request out of the list. A request works once and only inside PENDING_TTL_MS. */
export function takePending(list: Pending[], id: string, now: number): { entry: Pending | null; rest: Pending[]; expired: boolean } {
	const hit = list.find((p) => p.id === id) ?? null;
	const rest = fresh(
		list.filter((p) => p.id !== id),
		now,
	);
	if (!hit) return { entry: null, rest, expired: false };
	const ok = now - hit.created >= 0 && now - hit.created <= PENDING_TTL_MS;
	return { entry: ok ? hit : null, rest, expired: !ok };
}

// ---------------------------------------------------------------- text edits and names

/** Adds text at the end of a note, on its own line. */
export function appendText(doc: string, text: string): string {
	const body = text.replace(/\n+$/, '');
	if (doc === '') return body + '\n';
	return doc + (doc.endsWith('\n') ? '' : '\n') + body + '\n';
}

/** Command id part for a favourite. Ids stay the same when the list is reordered. */
export function commandSlug(name: string): string {
	const s = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/, '');
	return s === '' ? 'shortcut' : s;
}

/** One unique command id for each favourite: fav-<slug>, then fav-<slug>-2 for the next with that slug. */
export function commandIds(favs: Favourite[]): string[] {
	const seen = new Map<string, number>();
	return favs.map((f) => {
		const base = `fav-${commandSlug(f.name)}`;
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		return n === 1 ? base : `${base}-${n}`;
	});
}

// ---------------------------------------------------------------- platform

export interface PlatformFlags {
	isIosApp: boolean;
	isAndroidApp: boolean;
	isDesktopApp: boolean;
	isMacOS: boolean;
	isWin: boolean;
	isLinux: boolean;
	isTablet: boolean;
}
export interface PlatformInfo {
	ok: boolean;
	label: string;
	message: string;
}

/** Apple Shortcuts exists on iOS, iPadOS and macOS only. */
export function platformSupport(p: PlatformFlags): PlatformInfo {
	if (p.isIosApp) return { ok: true, label: p.isTablet ? 'iPadOS' : 'iOS', message: '' };
	if (p.isDesktopApp && p.isMacOS) return { ok: true, label: 'macOS', message: '' };
	const label = p.isWin ? 'Windows' : p.isAndroidApp ? 'Android' : p.isLinux ? 'Linux' : 'this device';
	return { ok: false, label, message: `Apple Shortcuts does not exist on ${label}. Shortcuts Bridge runs on iPhone, iPad and Mac only.` };
}

// ---------------------------------------------------------------- vector dispatch

const run: Record<string, (a: unknown[]) => unknown> = {
	encodeParam: (a) => encodeParam(...(a as [string])),
	nameProblem: (a) => nameProblem(...(a as [string])),
	callbackUrls: (a) => callbackUrls(...(a as [string, string])),
	buildRunUrl: (a) => buildRunUrl(...(a as [RunRequest])),
	chooseInput: (a) => chooseInput(...(a as [InputSource, InputContext])),
	lengthProblem: (a) => lengthProblem(...(a as [string, number])),
	parseFavourites: (a) => parseFavourites(...(a as [string])),
	parseFolderRules: (a) => parseFolderRules(...(a as [string])),
	matchFolderRule: (a) => matchFolderRule(...(a as unknown as [FolderRule[], string])),
	parseBlock: (a) => parseBlock(...(a as [string])),
	parseCallback: (a) => parseCallback(...(a as [Record<string, string>])),
	idFromBytes: (a) => idFromBytes(...(a as unknown as [number[]])),
	addPending: (a) => addPending(...(a as unknown as [Pending[], Pending, number])),
	takePending: (a) => takePending(...(a as unknown as [Pending[], string, number])),
	normalizePending: (a) => normalizePending(...(a as [unknown])),
	appendText: (a) => appendText(...(a as [string, string])),
	commandIds: (a) => commandIds(...(a as unknown as [Favourite[]])),
	platformSupport: (a) => platformSupport(...(a as [PlatformFlags])),
};

/** Runs one golden vector: fn names an exported function above and args is its argument list. */
export function evalVector(fn: string, args: unknown[]): unknown {
	const f = run[fn];
	if (!f) throw new Error(`unknown vector function ${fn}`);
	return f(args);
}
