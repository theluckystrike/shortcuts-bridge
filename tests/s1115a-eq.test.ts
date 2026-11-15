// s1115a A2. eslint-plugin-obsidianmd 0.6.0 regex-lookbehind (iOS before 16.4 has no lookbehind). Equivalence of the
// rewrite with the old lookbehind expression, on a table of edge cases and on seeded fuzz input (as lanes/R1-A1/eq/eq.mts).
import { describe, expect, it } from 'vitest';
import { replaceLoneSurrogates } from '../src/shortcut';

let seed = 1115;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gen = (alpha: string[], len: number) => Array.from({ length: Math.floor(rnd() * len) }, () => alpha[Math.floor(rnd() * alpha.length)]).join('');
const FUZZ = 20000;
const j = (x: unknown) => JSON.stringify(x);
/** Runs old and new on each input. Returns the inputs where they differ. */
function differ(inputs: string[], oldF: (s: string) => unknown, newF: (s: string) => unknown): string[] {
	return inputs.filter((s) => j(oldF(s)) !== j(newF(s)));
}
const fuzz = (alpha: string[], len: number) => Array.from({ length: FUZZ }, () => gen(alpha, len));

const OLD = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const oldF = (s: string) => s.replace(OLD, '�');
const TABLE = ['', 'a', '😀', '\uD83D', '\uDE00', '\uDE00\uD83D', '\uD83D😀', '😀\uDE00', 'a\uD83Db', '􏿿', '\uD800', '\uDC00\uDC00', '�'];

describe('lone surrogates without lookbehind', () => {
	it('matches the old expression on the table', () => {
		expect(differ(TABLE, oldF, replaceLoneSurrogates)).toEqual([]);
	});
	it('matches the old expression on fuzz input', () => {
		expect(differ(fuzz(['\uD83D', '\uDE00', '\uDBFF', '\uDC00', '\uD800', '\uDFFF', '\uD7FF', '\uE000', 'a', '😀', ' '], 16), oldF, replaceLoneSurrogates)).toEqual([]);
	});
});
