import { MarkdownRenderChild, setIcon } from 'obsidian';
import { isPro, onProChange, proText } from './pro';
import { parseBlock, type Favourite } from './shortcut';

/** Draws a ```shortcut block: a button that runs the shortcut with the note as input. Pro only. */
export class ShortcutButton extends MarkdownRenderChild {
	constructor(
		el: HTMLElement,
		private readonly source: string,
		private readonly sourcePath: string,
		private readonly run: (f: Favourite, path: string) => void,
	) {
		super(el);
	}

	onload(): void {
		this.register(onProChange(() => this.draw()));
		this.draw();
	}

	draw(): void {
		const el = this.containerEl;
		el.empty();
		el.addClass('shortcuts-bridge-block');
		const parsed = parseBlock(this.source);
		if (!parsed.ok) {
			el.createDiv({ cls: 'shortcuts-bridge-problem', text: `Shortcuts Bridge: ${parsed.error}` });
			return;
		}
		const f = parsed.favourite;
		if (!isPro()) {
			el.createDiv({ cls: 'shortcuts-bridge-pro', text: proText(`Shortcut button "${f.name}" is a pro feature.`) });
			return;
		}
		const button = el.createEl('button', { cls: 'mod-cta shortcuts-bridge-button' });
		setIcon(button.createSpan({ cls: 'shortcuts-bridge-icon' }), 'zap');
		button.createSpan({ text: f.label || `Run ${f.name}` });
		button.addEventListener('click', () => this.run(f, this.sourcePath));
	}
}
