import { SuggestModal, type App } from 'obsidian';
import type { Favourite } from './shortcut';

/** The "Run a shortcut" list: the favourites, then the typed text as a shortcut name. */
export class ShortcutPicker extends SuggestModal<Favourite> {
	constructor(
		app: App,
		private readonly favourites: Favourite[],
		private readonly typedInput: Favourite['input'],
		private readonly onPick: (f: Favourite) => void,
	) {
		super(app);
		this.setPlaceholder('Pick a favourite or type the name of a shortcut');
	}

	getSuggestions(query: string): Favourite[] {
		const q = query.trim().toLowerCase();
		const hits = this.favourites.filter((f) => `${f.label} ${f.name}`.toLowerCase().includes(q));
		const typed = query.trim();
		if (typed !== '' && !this.favourites.some((f) => f.name.toLowerCase() === q)) {
			hits.push({ name: typed, input: this.typedInput, output: 'none', label: '' });
		}
		return hits;
	}

	renderSuggestion(f: Favourite, el: HTMLElement): void {
		el.createDiv({ text: f.label || f.name });
		const out = f.output === 'none' ? '' : `, output: ${f.output}`;
		el.createEl('small', { text: `${f.name} (input: ${f.input}${out})` });
	}

	onChooseSuggestion(f: Favourite): void {
		this.onPick(f);
	}
}
