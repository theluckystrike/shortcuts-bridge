# Shortcuts Bridge

Runs an Apple Shortcut from a note or a command and passes text to it. For iPhone, iPad and Mac.

<img src="https://raw.githubusercontent.com/theluckystrike/shortcuts-bridge/HEAD/docs/shortcuts-bridge.gif" alt="Favourites in the settings, the shortcut picker, the output of a shortcut inserted below a paragraph, and a code block button" width="720">

Shortcuts Bridge starts a shortcut from the Shortcuts app with the text that you choose: the selection, the current line, the whole note, the title or the path. You give the name of the shortcut and Shortcuts Bridge builds the `shortcuts://` link and opens it. With Pro, the output of the shortcut comes back to Obsidian and goes into the note.

How far this was tested: the links that the plugin builds, and the way it handles the answer, were tested in the Obsidian desktop app on a Mac (versions 1.13.4 and 1.14.4) with a stand-in that records the link instead of opening it. The Shortcuts app did not run in those tests. An iPhone and an iPad were not used. The screenshots show a simulated answer, not a real shortcut.

## Features

### Run a shortcut with your text

Run the command "Run a shortcut". Pick a favourite, or type the name of any shortcut and press Enter.

<img src="https://raw.githubusercontent.com/theluckystrike/shortcuts-bridge/HEAD/docs/picker.png" alt="The Run a shortcut list with four favourites" width="720">

The input is one of these: selection, line, note, title, path, clipboard or none. Selection uses the current line when nothing is selected. Clipboard tells Shortcuts to read its own clipboard. Example: the favourite `Summarise` with a selection of `Hello, world!` opens `shortcuts://run-shortcut?name=Summarise&input=text&text=Hello%2C%20world%21`.

### Favourites as commands

Each line in the settings is a favourite, and each favourite is a command in the command palette. You can give it a hotkey. The command id comes from the letters a to z and the digits of the name, so a hotkey stays when you reorder the list. Names that share those characters, or have none, get ids in list order.

<img src="https://raw.githubusercontent.com/theluckystrike/shortcuts-bridge/HEAD/docs/favourites.png" alt="The settings with the list of favourite shortcuts, the platform line and the folder rules" width="720">

### A clear notice on other platforms

On Windows, Android and Linux, a run stops before it sends anything and shows a notice.

<img src="https://raw.githubusercontent.com/theluckystrike/shortcuts-bridge/HEAD/docs/windows-notice.png" alt="A notice that says Apple Shortcuts does not exist on Windows" width="720">

### Output at the cursor, over the selection or at the end (Pro)

Add an output to a favourite: `cursor`, `replace` or `append`. The link then uses the x-callback-url form, and Shortcuts sends the output back to `obsidian://shortcuts-bridge`. `cursor` inserts the text at the cursor. `replace` writes over the selection when the selection is still there, and inserts at the cursor when it is not. `append` adds the text on a new line at the end of the note. When the note is not open in a tab, `cursor` and `replace` also add the text at the end.

<img src="https://raw.githubusercontent.com/theluckystrike/shortcuts-bridge/HEAD/docs/result-cursor.png" alt="A summary inserted below the selected paragraph, with the notice Inserted the output of Summarise" width="720">

### Output in a note property (Pro)

Use `property:summary` as the output to save the trimmed text in the property `summary` of the note that you started from.

<img src="https://raw.githubusercontent.com/theluckystrike/shortcuts-bridge/HEAD/docs/result-property.png" alt="A note with a new property named filed" width="720">

### Replace the line with the output (Pro)

Use `replace-line` as the output to replace the whole line that holds the cursor. The plugin saves the line number and the text of the line before the shortcut starts. If lines move while the shortcut runs, it finds the line again by its text. If it finds no line or more than one, it adds the output at the end of the note and shows a notice. An output of blanks changes nothing. The note must be open in editing mode, a selection must stay on one line, and a button cannot use it.

<img src="https://raw.githubusercontent.com/theluckystrike/shortcuts-bridge/HEAD/docs/result-replace-line.png" alt="A task line that the output of a shortcut replaced, with the notice Replaced the line with the output of Tidy task" width="720">

### A default shortcut for each folder (Pro)

Write one rule for each folder in the settings. The command "Run the default shortcut of this folder" uses the rule with the longest folder that holds the open note. A folder matches whole names: `Projects` does not match `Projects2/Plan.md`. A rule with `/` as the folder matches the whole vault.

<img src="https://raw.githubusercontent.com/theluckystrike/shortcuts-bridge/HEAD/docs/folder-rules.png" alt="The folder rules setting with two rules" width="720">

### A button in the note (Pro)

Write a code block with the language `shortcut`. The first line is the name of the shortcut. The lines `input:`, `output:` and `label:` are optional. The input of a button is the note by default, and cannot be the selection or the line, because a button has no selection.

<img src="https://raw.githubusercontent.com/theluckystrike/shortcuts-bridge/HEAD/docs/button.png" alt="Reading view with two shortcut buttons" width="720">

Without Pro, the block shows one line that says the button is a Pro feature.

## Install

Open Settings, then Community plugins, then Browse, and search for "Shortcuts Bridge". Select Install, then Enable.

To install by hand, download `main.js`, `manifest.json` and `styles.css` from the latest release. Put the three files in `<vault>/.obsidian/plugins/shortcuts-bridge/`. Restart Obsidian, then turn on Shortcuts Bridge.

You need the Shortcuts app and at least one shortcut. The link scheme has no call to list your shortcuts, so type each name exactly as it shows in the Shortcuts app.

## Usage

1. Open Settings, then Shortcuts Bridge. Write one favourite on each line: `Name | input | output | command name`. Only the name is needed.
2. Select some text in a note.
3. Open the command palette and run your favourite.
4. The Shortcuts app opens and runs the shortcut with your text.

Examples of lines:

```
Summarise | selection | cursor
File this note | note | property:filed
Save to Reminders | title
Translate | selection | replace | Translate selection
Tidy task | line | replace-line
```

A line that starts with `#` is a comment. A line with a problem shows in the settings and as a notice, with its line number. The other lines still work.

## Settings

After a minor or major update, this plugin opens one What's new tab in the background. The tab and settings card suggest other NoteMods plugins and Zovo Chat and link to notemods.com for feedback ([privacy](https://notemods.com/privacy/)). The tab sends no data. Turn the tab off in Settings.

| Setting | Use |
|---|---|
| Favourite shortcuts | One favourite for each line. Each one becomes a command. |
| Input for other shortcuts | The input that "Run a shortcut" uses for a name that is not a favourite. Default: selection. |
| Longest text to send | From 1,000 to 100,000 characters. Default 20,000. A longer text is not sent. The limit of the link on a real device was not measured. |
| Folder default shortcuts (Pro) | One rule for each line: `Folder | Name | input | output | command name`. |
| Pro | Sign in with GitHub to turn Pro on. |

## FAQ

### What happens if Obsidian closes while the shortcut runs?

Before the shortcut starts, the plugin saves the request in its `data.json`. A request is valid for 30 minutes and works once. That the file holds the request was tested. A real restart of the iPhone app during a shortcut was not tested.

### Can another link write into my notes?

A callback works only with the random 16 character id of a request that this plugin made. An unknown id, an id that was used, and an id older than 30 minutes write nothing and show a notice. These cases were tested.

### How is this different from other plugins?

The Actions URI plugin works the other way: Shortcuts calls Obsidian. The Shell commands plugin needs a shell, which iPhone and iPad do not have. It shares no code with any other plugin.

### Does it work in the background?

The link scheme opens the Shortcuts app. Expect that app to come to the front. This was not tested on a device.

## Payment, account and network

The core features are free. Pro features need a GitHub Sponsors sponsorship of theluckystrike: $5 a month or more, or $15 once. A total payment of $15 meets the payment requirement for Pro without further payment. Sign-in and the checks below still apply. Your notes stay readable and editable with or without Pro.

GitHub handles the payment. Sponsor at https://github.com/sponsors/theluckystrike. You need no account for the free features. Pro needs the GitHub account that sponsors.

Until you select "Sign in with GitHub" in the settings, Shortcuts Bridge makes no network requests. Sign in uses the GitHub device flow. Shortcuts Bridge sends its public client ID and the scope `read:user` to `https://github.com/login/device/code` and shows you a code. While you enter the code at https://github.com/login/device, it asks `https://github.com/login/oauth/access_token` every few seconds to check the sign-in status. The scope permits profile reads only. GitHub needs this access to show the sponsorship tier. It grants no repository scope and no write access.

After sign in, Shortcuts Bridge sends one query to `https://api.github.com/graphql`. It checks if the signed-in account sponsors theluckystrike. It asks for the tier and the total payment to theluckystrike. The plugin reuses a successful check for 7 days. Failed checks can retry after 6 hours. Select Refresh to request an earlier check. It sends no note content, file names or other vault data, and it has no telemetry.

After a successful check, Pro can work offline for up to 14 days. Sign out or a negative sponsorship answer turns Pro off. The plugin stores the GitHub token through the secret storage API of Obsidian. It does not put the token in its saved settings or its local sponsorship data. The local storage of this device keeps your GitHub login, the tier and the time of the last check. Sign out clears the token. You can also revoke the access in your GitHub settings, under Applications.

## Support

Report a bug or ask for a feature in the issue tracker of this repository.

```
npm ci
npm run build
npm test
```

## License

MIT

## Community

Questions, bugs or plugin ideas? Talk to me and other Obsidian users in [Zovo Chat](https://t.me/+k2MM-BIc7SQ5OWM0) on Telegram. It has a topic for these plugins. You can also open an issue here.
