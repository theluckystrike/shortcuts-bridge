import { MarkdownView, TFile, type App, type Editor } from 'obsidian';
import { appendText, type Pending } from './shortcut';

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

async function openEditor(app: App, file: TFile): Promise<Editor | null> {
	const open = editorForPath(app, file.path);
	if (open) return open;
	await app.workspace.getLeaf(false).openFile(file);
	return editorForPath(app, file.path);
}

/**
 * Writes the output of a shortcut where the request said. Returns a short text for the notice.
 * Cursor and replace need an editor. When the note has none, the text goes to the end of the note.
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
	if (entry.output === 'cursor' || entry.output === 'replace') {
		const editor = await openEditor(app, file);
		if (editor) {
			insertAtCursor(editor, result, entry.output === 'replace');
			return `Inserted the output of "${entry.shortcut}".`;
		}
	}
	await app.vault.process(file, (data) => appendText(data, result));
	return `Added the output of "${entry.shortcut}" at the end of the note.`;
}
