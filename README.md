# SubtitleCat Chinese Provider

A first-party IINA subtitle provider that scrapes [subtitlecat.com](https://www.subtitlecat.com) for Simplified or Traditional Chinese subtitles and hands them directly to IINA’s subtitle workflow.

## What it does

- Derives番号-style keywords (e.g. `JERA-007`) from the currently loaded video file and searches SubtitleCat automatically.
- Prompts for a manual keyword when guessing fails or when no Chinese download links are found.
- Parses search and detail pages to keep only entries that actually expose Simplified (`zh-CN`) or Traditional (`zh-TW`) downloads.
- Prioritises Simplified downloads and falls back to Traditional when necessary.
- Drops the downloaded subtitle into IINA’s sandbox (`@tmp`) so it can be saved beside the video afterwards.

## Requirements

- IINA 1.4.0 or newer (for the plugin APIs used here).
- Network permission (`network-request`) and OSD permission (`show-osd`) are declared in `Info.json` and must remain enabled inside IINA’s plugin preferences.

## Installing for development

1. Clone this repository locally.
2. Symlink the provider directory into IINA’s plugin sandbox with the `.iinaplugin-dev` suffix:
   ```sh
   ln -s "$(pwd)/SubtitleCatProvider" \
     "~/Library/Application Support/com.colliderli.iina/plugins/SubtitleCatProvider.iinaplugin-dev"
   ```
3. Restart IINA → Preferences → Plugins, enable **SubtitleCat Chinese**, and allow the requested permissions.
4. Play a video and choose *Subtitles ▸ Find Online Subtitles ▸ SubtitleCat Chinese* to trigger a search.

## Usage notes

- The plugin logs to IINA’s plugin console with the `[SubtitleCat]` prefix. Keep the console open while developing or debugging.
- SubtitleCat rate-limits bursts of requests; wait a few seconds between searches if you hit HTTP errors.
- Downloads are saved to `@tmp/<video>.<lang>.srt`. When IINA prompts to save the subtitle, choose “Save As…” to copy it next to the media file.

## HTTP behaviour

The provider now relies solely on IINA’s built-in `http.get` implementation. Requests are issued with basic desktop browser headers, and every call is wrapped with logging so failures are easy to diagnose from the plugin console.

## Packaging for distribution

When you’re ready to share the plugin, run:

```sh
iina-plugin pack SubtitleCatProvider
```

The command produces `SubtitleCatProvider.iinaplgz`, which you can publish or hand to users for installation through IINA’s plugin manager.
