# SubtitleCat Chinese Provider

An IINA subtitle provider that scrapes [subtitlecat.com](https://www.subtitlecat.com) for Traditional or Simplified Chinese subtitles and hands them directly to IINA's subtitle workflow.

## What it does

- Derives番号-style keywords (e.g. `JERA-007`) from the currently loaded video filename and searches SubtitleCat automatically.
- Prompts for a manual keyword when auto-detection fails.
- Parses search and detail pages to keep only entries that expose a Chinese (`zh-TW` or `zh-CN`) download link.
- Respects your preferred Chinese variant (Traditional or Simplified), falling back to the other when unavailable.
- Drops the downloaded subtitle into IINA's sandbox (`@tmp`) so it can be saved beside the video afterwards.

## Requirements

- IINA 1.4.0 or newer.
- Network permission (`network-request`) and OSD permission (`show-osd`) are declared in `Info.json` and must remain enabled in IINA's plugin preferences.

## Preferences

Open *IINA → Preferences → Plugins → SubtitleCat Chinese → Preferences* to configure:

| Setting | Default | Description |
|---|---|---|
| Preferred Language | Traditional Chinese (zh-TW) | Which Chinese variant to download when both are available. The other is used as a fallback. |

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

- The plugin logs to IINA's plugin console with the `[SubtitleCat]` prefix. Keep the console open while developing or debugging.
- SubtitleCat may rate-limit bursts of requests; wait a few seconds between searches if you hit HTTP errors.
- Downloads are saved to `@tmp/<video>.<lang>.srt`. When IINA prompts to save the subtitle, choose "Save As…" to copy it next to the media file.

## Packaging for distribution

```sh
iina-plugin pack SubtitleCatProvider
```

This produces `SubtitleCatProvider.iinaplgz`, which users can install through IINA's plugin manager.
