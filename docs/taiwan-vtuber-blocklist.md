# Regional VTuber blocklist maintenance

This repository is the canonical source for confirmed Taiwan/Hong Kong VTuber channel filtering.

## Files

- `config/blocked-vtuber-channels.json`: canonical curated list. Edit this file first.
- `assets/blocked-vtuber-channels.js`: generated browser payload. Do not edit by hand.
- `scripts/blocked-vtuber-matcher.js`: Node matcher used by `scripts/update-youtube-ranking.js`.
- `assets/ranking-controls.js`: browser fallback matcher for already published ranking JSON and snapshots.

`Marica7731/daily-song-list` keeps a mirror at `config/blocked-vtuber-channels.json`. The mirror must be synced from this repository, not edited independently.

## Matching Policy

Production blocking only uses confirmed concrete channels:

- exact `channelId`
- normalized exact YouTube handle
- normalized exact YouTube channel URL
- exact normalized channel name or explicit channel alias
- explicit `titleAliases` only for unique channel hashtags or strong source markers

Do not block by broad region or role words such as `Taiwan`, `台灣`, `台V`, `港V`, `VTuber`, `HKVtuber`, `個人勢`, or `Narrator`. If a broad word is useful for manual review, keep it in `unsafeBroadAliases`; runtime matchers ignore that field.

## Workflow

1. Update `config/blocked-vtuber-channels.json`.
2. Run `npm run blocklist:generate`.
3. Update HTML query strings only if the generated asset hash changed.
4. Run:

   ```bash
   npm run blocklist:validate
   npm run blocklist:check-sync
   node --check scripts/update-youtube-ranking.js
   node --check assets/ranking-controls.js
   ```

The validator checks schema, uniqueness, dangerous broad terms, generated asset hash, HTML load order, true-positive samples, false-positive samples, and that the source/client code no longer contains duplicated hard-coded regional VTuber arrays.

## Confirmed Entries Added On 2026-07-14

- `小雪Yukichan Ch.`
  - channel ID: `UCQymE4njJ-t9oahwX9-iC8w`
  - handle: `@yukichanch`
  - URL: `https://www.youtube.com/@yukichanch`
- `羅妲 Rhoda`
  - channel ID: `UC3zo1jR17JMM53_Ru7yDjfA`
  - handle: `@rhoda1126`
  - URL: `https://www.youtube.com/@rhoda1126`

## Daily Song List Sync

From the daily-song-list repository, run the sync script with an explicit source path, for example:

```bash
node scripts/sync-blocked-vtuber-channels.js --source "../youtube_ranking/config/blocked-vtuber-channels.json"
```

Do not commit a local absolute path into scripts, GitHub Actions, or configuration.
