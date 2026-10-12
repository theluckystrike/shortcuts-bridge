import { MarkdownView, TFile, type App, type Editor } from 'obsidian';
import { appendText, replaceLineText, type Pending } from './shortcut';

/** The editor of a note that is open in a tab, or null. The active editor is tried first. */
export function editorForPath(app: App, path: string): Editor | null {
	const active = app.workspace.activeEditor;
	if (active?.file?.path === path && active.editor) return active.editor;
	for (const leaf of app.workspace.getLeavesOfType('markdown')) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === path) return view.editor;
	}
	return null;
}

/** Inserts text at the cursor (or over the selection) and puts the cursor after the new text. */
export function insertAtCursor(editor: Editor, text: string, replaceSelection: boolean): void {
	if (replaceSelection && editor.somethingSelected()) {
		const from = editor.getCursor('from');
		const start = editor.posToOffset(from);
		editor.replaceSelection(text);
		editor.setCursor(editor.offsetToPos(start + text.length));
		return;
	}
	const at = editor.getCursor();
	const start = editor.posToOffset(at);
	editor.replaceRange(text, at);
	editor.setCursor(editor.offsetToPos(start + text.length));
}

/** Replaces the line that held the cursor. A note that is open is changed through its editor, so Undo works. */
async function replaceLine(app: App, file: TFile, entry: Pending, result: string): Promise<string> {
	const line = entry.line ?? 0;
	const expected = entry.lineText ?? '';
	const editor = editorForPath(app, file.path);
	const r = replaceLineText(editor ? editor.getValue() : await app.vault.read(file), line, expected, result);
	if (!r.ok) {
		if (r.reason === 'empty') throw new Error(`The output of "${entry.shortcut}" is empty, so the line was not changed.`);
		await app.vault.process(file, (data) => appendText(data, result));
		return `The line changed while "${entry.shortcut}" ran, so it was not replaced. Added the output at the end of the note.`;
	}
	if (editor) {
		editor.replaceRange(r.text, { line: r.line, ch: 0 }, { line: r.line, ch: editor.getLine(r.line).length });
		const parts = r.text.split('\n');
		editor.setCursor({ line: r.line + parts.length - 1, ch: (parts[parts.length - 1] ?? '').length });
	} else {
		// The note can change between the read and the write. Then the output goes to the end, as for a moved line.
		let replaced = false;
		await app.vault.process(file, (data) => {
			const again = replaceLineText(data, line, expected, result);
			replaced = again.ok;
			return again.ok ? again.doc : appendText(data, result);
		});
		if (!replaced) return `The line changed while "${entry.shortcut}" ran, so it was not replaced. Added the output at the end of the note.`;
	}
	return `Replaced the line with the output of "${entry.shortcut}".`;
}

/**
 * Writes the output of a shortcut where the request said. Returns a short text for the notice.
 * Cursor and replace need an editor. When the note has none, the text goes to the end of the note. The note is not
 * opened for this: a note that opens has its cursor at the start, above the front matter, and it takes the place of
 * the note in the active tab.
 */
export async function applyResult(app: App, entry: Pending, result: string): Promise<string> {
	const file = app.vault.getAbstractFileByPath(entry.path);
	if (!(file instanceof TFile)) throw new Error(`The note ${entry.path} no longer exists.`);
	if (entry.output.startsWith('property:')) {
		const key = entry.output.slice('property:'.length);
		await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm[key] = result.trim();
		});
		return `Saved the output of "${entry.shortcut}" in the property ${key}.`;
	}
	if (entry.output === 'replace-line') return replaceLine(app, file, entry, result);
	if (entry.output === 'cursor' || entry.output === 'replace') {
		const editor = editorForPath(app, file.path);
		if (editor) {
			insertAtCursor(editor, result, entry.output === 'replace');
			return `Inserted the output of "${entry.shortcut}".`;
		}
		await app.vault.process(file, (data) => appendText(data, result));
		return `The note was not open, so the output of "${entry.shortcut}" was added at the end of the note.`;
	}
	await app.vault.process(file, (data) => appendText(data, result));
	return `Added the output of "${entry.shortcut}" at the end of the note.`;
}
