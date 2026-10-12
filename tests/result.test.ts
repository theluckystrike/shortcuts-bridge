import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import { applyResult } from '../src/result';
import type { Pending } from '../src/shortcut';

function entry(over: Partial<Pending> = {}): Pending {
	return { id: 'aaaaaaaa', path: 'a.md', output: 'cursor', shortcut: 'Summarise', created: Date.now(), ...over };
}

describe('output cursor and replace, the note is not open in an editor', () => {
	for (const output of ['cursor', 'replace'] as const) {
		it(`${output}: adds the output at the end, keeps the front matter and does not open the note`, async () => {
			const app = App.createConfigured__({ files: { 'a.md': '---\ntags: x\n---\nbody', 'b.md': 'other' } });
			const getLeaf = vi.spyOn(app.workspace, 'getLeaf');
			const msg = await applyResult(app as never, entry({ output }), 'RESULT');
			expect(msg).toBe('The note was not open, so the output of "Summarise" was added at the end of the note.');
			expect(getLeaf).not.toHaveBeenCalled();
			expect(await app.vault.read(app.vault.getFileByPath('a.md') as never)).toBe('---\ntags: x\n---\nbody\nRESULT\n');
		});
	}
});
