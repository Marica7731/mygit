# Taiwan VTuber blocklist maintenance

This repository filters confirmed Taiwan VTuber channels in two places:

- `scripts/update-youtube-ranking.js`: source-side filtering during the GitHub Actions data update.
- `assets/ranking-controls.js`: client-side fallback filtering for already published JSON and old snapshots.

The current sibling project `Marica7731/daily-song-list` keeps its equivalent source filter in `assets/source-filter.js` as `TAIWAN_VTUBER_BLACKLIST`. That format is better for long-term maintenance because every entry can keep `name`, `aliases`, and optional `titleAliases` together.

## Current sync rule

When adding a confirmed Taiwan VTuber to this repository:

1. Add stable channel identifiers to both files:
   - canonical channel name;
   - YouTube handle, including `@handle` and plain `handle`;
   - channel URL fragment such as `youtube.com/@handle`;
   - channel ID when known.
2. Prefer exact channel aliases over broad words. Do not add generic terms such as `Taiwan`, `台灣`, `台V`, `個人勢`, `VTuber`, `HKVtuber`, or `Narrator` to `TAIWAN_VTUBER_BLOCKED_TERMS`; this matcher scans full ranking text and would over-filter unrelated videos.
3. Only add `TAIWAN_VTUBER_PATTERNS` / `DEFAULT_BLOCKED_REGEXPS` rules when the wording is a strong self-identification pattern, not a generic country mention.
4. Bump the `assets/ranking-controls.js?v=...` query string in all HTML entry pages after front-end fallback changes.
5. Verify with:
   - `node --check scripts/update-youtube-ranking.js`
   - `node --check assets/ranking-controls.js`
   - `node scripts/validate-taiwan-vtuber-blocklist.js`

## Newly confirmed entries

Source checked on 2026-07-14 with `yt-dlp`:

- `https://www.youtube.com/@yukichanch`
  - channel name: `小雪Yukichan Ch.`
  - channel ID: `UCQymE4njJ-t9oahwX9-iC8w`
  - stable aliases used here: `小雪Yukichan Ch.`, `小雪Yukichan`, `Yukichan Ch.`, `@yukichanch`, `yukichanch`, `youtube.com/@yukichanch`, `UCQymE4njJ-t9oahwX9-iC8w`
- `https://www.youtube.com/@rhoda1126`
  - channel name: `羅妲 Rhoda`
  - channel ID: `UC3zo1jR17JMM53_Ru7yDjfA`
  - stable aliases used here: `羅妲 Rhoda`, `羅妲`, `@rhoda1126`, `rhoda1126`, `youtube.com/@rhoda1126`, `UC3zo1jR17JMM53_Ru7yDjfA`

## Recommended shared format

To keep `mygit` and `daily-song-list` from drifting, move the curated list to a small shared JSON file in both projects, for example:

```json
[
  {
    "name": "小雪Yukichan Ch.",
    "reason": "confirmed_taiwan_vtuber",
    "channels": [
      {
        "handle": "@yukichanch",
        "channelId": "UCQymE4njJ-t9oahwX9-iC8w",
        "url": "https://www.youtube.com/@yukichanch"
      }
    ],
    "aliases": ["小雪Yukichan Ch.", "小雪Yukichan", "Yukichan Ch."],
    "unsafeBroadAliases": ["台灣Vtuber"]
  }
]
```

Each project can then generate its own runtime matcher:

- `daily-song-list`: keep matching `aliases` only against channel fields and `titleAliases` only against titles.
- `mygit`: flatten `name`, `aliases`, handle, URL fragment, and channel ID into source/client block terms, but skip `unsafeBroadAliases`.

The important rule is that broad self-description terms may be useful for metadata review, but they should not be copied into this repository's full-text blocklist.
