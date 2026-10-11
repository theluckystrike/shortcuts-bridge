import { describe, expect, it } from 'vitest';
import vectors from './vectors/shortcuts-bridge.json';
import { evalVector } from '../src/shortcut';

interface Case {
	name: string;
	fn: string;
	args: unknown[];
	expected: unknown;
}

describe('golden vectors (packages/spec/vectors/shortcuts-bridge.json)', () => {
	it('has at least 100 cases', () => {
		expect(vectors.cases.length).toBeGreaterThanOrEqual(100);
	});
	for (const c of vectors.cases as Case[]) {
		it(c.name, () => {
			expect(evalVector(c.fn, c.args)).toEqual(c.expected);
		});
	}
});
