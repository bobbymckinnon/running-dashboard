# Running Dashboard for Obsidian

A ready-made running dashboard inside Obsidian. Point it at your running data and get:

- **Totals** for this week, this month, this year and the last 12 months
- **Race readiness**: countdown cards for your next races with training checks, a formula estimate and your best time at that distance
- **Training heatmap**: a calendar of every day you ran
- **Weekly and monthly charts**
- **Route maps**: a heatmap of your home area, your home country and the whole world
- **Race results, shoes and recent activities**
- An optional **coach's note** at the top, written by you or by an AI assistant

Everything runs locally. The plugin makes **no network requests**.

## Data sources

Use any combination. Duplicates (the same run from two sources) are merged automatically.

| Source | How to get it |
| --- | --- |
| **Strava export** | strava.com → Settings → My Account → *Download or Delete Your Account* → *Request your archive*. Unzip it into a folder in your vault (the folder with `activities.csv`). |
| **GPX / TCX / FIT files** | Any folder of activity files, also `.gz`. Works with exports from Garmin, Coros, Suunto and Apple Health apps such as HealthFit or RunGap. |
| **Activities JSON** | A `.json` file in Strava API format, for example written by an AI assistant that has a Strava connection. |

Then run **Running Dashboard: Import activities** from the command palette. Re-run it whenever you add data.

## Races

Run **Running Dashboard: Create races note** and fill in the table:

```markdown
| Date       | Race              | Distance | Start | Link                    |
| ---------- | ----------------- | -------- | ----- | ----------------------- |
| 2026-12-06 | Valencia Marathon | 42.2 km  | 08:15 | https://example.com/    |
```

Runs on a date in this table count as races. Runs whose name contains a race keyword (configurable) count too.

## Coach's note (optional)

Pick any note in the settings. It is shown at the top of the dashboard. Special lines:

```markdown
Updated: Mon 2 Nov 2026
Target: Valencia Marathon = 4:00–4:10
```

`Updated:` is shown as the note's date, and `Target:` lines set the target shown on that race's readiness card.

## Privacy and security

- No network access, no telemetry, no external services.
- Only reads the folders and files you choose in the settings, through Obsidian's vault API. Paths inside data files (such as the `Filename` column of a Strava export) are checked and cannot point outside the export folder.
- Files are treated as untrusted: size limits on every file, a hard cap on decompressed `.gz` data, a bounds-checked FIT parser, and all text is inserted with `textContent` (never as HTML). Links are only allowed for `http(s)` URLs.
- The plugin keeps a cache (`cache.json`) in its own plugin folder inside `.obsidian/plugins/running-dashboard/`. **It contains your GPS tracks**, which can reveal where you live. If you sync your vault or commit it to git, consider excluding that file.

## Development

```bash
npm install
npm run dev        # watch build
npm run build      # type-check + production build
npm run lint       # ESLint with eslint-plugin-obsidianmd
npm run preview    # renders the dashboard in a headless browser from test-data/vault (needs Playwright)
```

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/running-dashboard/` to try it.

## Credits

- Map outlines and place names: [Natural Earth](https://www.naturalearthdata.com/) (public domain).
- Gzip decompression: [fflate](https://github.com/101arrowz/fflate) (MIT).

Not affiliated with or endorsed by Strava, Garmin or Apple.

## License

MIT
