# SubtitleCat Provider

An IINA subtitle provider that searches [subtitlecat.com](https://www.subtitlecat.com) for subtitles and presents all available language options directly in IINA's subtitle picker.

## What it does

- Derives番号-style keywords (e.g. `ABF-153`) from the currently loaded video filename and searches SubtitleCat automatically.
- Prompts for a manual keyword when auto-detection fails.
- Fetches every subtitle result and expands it into individual per-language entries.
- Sorts results so your preferred language appears first, followed by all other languages alphabetically.
- Downloads the selected subtitle to `@tmp/<keyword>.<lang>.srt`.

## Requirements

- IINA 1.4.0 or newer.
- Network (`network-request`) and OSD (`show-osd`) permissions declared in `Info.json` must remain enabled in IINA's plugin preferences.

## Preferences

Open *IINA → Preferences → Plugins → SubtitleCat Chinese → Preferences* to configure:

| Setting | Default | Description |
|---|---|---|
| Preferred Language | Traditional Chinese (zh-TW) | Results matching this language are sorted to the top of the list. |

## Installing for development

1. Clone this repository locally.
2. Symlink the directory into IINA's plugin sandbox with the `.iinaplugin-dev` suffix:
   ```sh
   ln -s "$(pwd)" \
     "$HOME/Library/Application Support/com.colliderli.iina/plugins/SubtitleCatProvider.iinaplugin-dev"
   ```
3. Restart IINA → Preferences → Plugins, enable **SubtitleCat Chinese**, and allow the requested permissions.
4. Play a video and choose *Subtitles ▸ Find Online Subtitles ▸ SubtitleCat Chinese* to trigger a search.

## Usage notes

- The plugin logs to IINA's plugin console with the `[SubtitleCat]` prefix. Open it while developing or debugging.
- SubtitleCat may rate-limit rapid searches; wait a few seconds if you hit HTTP errors.
- After IINA prompts to save the downloaded subtitle, choose "Save As…" to place it beside the media file.

## Packaging for distribution

```sh
iina-plugin pack SubtitleCatProvider
```

This produces `SubtitleCatProvider.iinaplgz`, which users can install through IINA's plugin manager.
