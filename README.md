# CCF Conference Deadlines

Submission deadline countdowns for every conference in the
[CCF recommended list](https://ccf.atom.im/), across all ten research areas —
with **abstract deadlines shown alongside the full-paper deadline**.

Built in the spirit of [sec-deadlines](https://sec-deadlines.github.io/) and
[ai-deadlines](https://aideadlin.es/), but covering the whole CCF catalogue
rather than a single field.

## What it shows

- **348 conferences** across the 10 CCF areas (security, AI, networking,
  architecture, software engineering, databases, theory, graphics, HCI,
  interdisciplinary).
- **Abstract and full-paper deadlines** as separate countdowns. sec-deadlines
  only tracks the paper deadline; here the abstract registration deadline gets
  its own timer, because that is the one people actually miss.
- **CCF rank (A/B/C) and CORE rank (A\*/A/B/C)** on every entry.
- Filtering by area and by either ranking, plus free-text search over name,
  description and location.
- All times rendered in **the viewer's local timezone**.
- iCal feeds — one for everything, one per area — under [`ical/`](ical/).

Venues with rolling monthly submission (VLDB and friends) show their next three
rounds rather than all twelve.

## How the data works

Two upstream sources, neither of them edited by hand here:

| Source | Provides |
| --- | --- |
| [ccf.atom.im](https://ccf.atom.im/) | The CCF catalogue: which venues exist, their area and their CCF rank |
| [ccfddl/ccf-deadlines](https://github.com/ccfddl/ccf-deadlines) (MIT) | The actual deadline dates, timezones, venues and links |

The CCF catalogue itself lists no deadlines, so
[`scripts/sync_ccfddl.py`](scripts/sync_ccfddl.py) pulls the community-maintained
ccfddl data, keeps the areas that make up the CCF conference list, and writes
[`_data/conferences.yml`](_data/conferences.yml) plus the iCal feeds.

For each conference the script picks the edition whose next deadline lands
soonest (falling back to the most recent edition once everything is past), and
normalises every timestamp to an ISO 8601 string with an explicit UTC offset.
Timezones that observe DST — upstream's `PT`, for instance — are resolved
against the tz database for that specific date, so the offset is right in both
summer and winter. Because the offsets are baked in at sync time, the page needs
no timezone library at all; the browser parses the timestamps directly.

`_data/conferences.yml`, `_data/areas.yml` and `ical/` are **generated files** —
do not edit them by hand, they get overwritten on the next sync.

### Refreshing the data

Automatic: [`.github/workflows/sync-deadlines.yml`](.github/workflows/sync-deadlines.yml)
runs daily at 05:00 UTC, regenerates the data and commits only if something
changed. You can also trigger it by hand from the Actions tab.

Manually:

```sh
pip install -r scripts/requirements.txt
python3 scripts/sync_ccfddl.py
```

Or against a local checkout of the upstream repo, without hitting the network:

```sh
python3 scripts/sync_ccfddl.py --offline ../ccf-deadlines
```

### Fixing a wrong deadline

Because the data is generated, corrections belong
[upstream at ccfddl](https://github.com/ccfddl/ccf-deadlines) — a fix there
flows into this site on the next daily sync, and helps everyone else using that
dataset too.

## Running locally

```sh
bundle install
bundle exec jekyll serve
```

Then open <http://localhost:4000/security-privacy-deadlines.github.io/>.
The site is plain Jekyll with no custom plugins, so GitHub Pages builds it
as-is.

## Deployment

The repo is `huuhuannt1998/security-privacy-deadlines.github.io`, which GitHub
serves as a **project** site at:

    https://huuhuannt1998.github.io/security-privacy-deadlines.github.io/

`baseurl` in [`_config.yml`](_config.yml) is set to match. To serve it at the
bare `security-privacy-deadlines.github.io` instead, you would need a GitHub
**organisation** named `security-privacy-deadlines` owning a repo of the same
name — at which point set `baseurl: ""` and `url` to that domain.

Enable Pages under **Settings → Pages → Build and deployment → Deploy from a
branch → `main` / `(root)`**.

## Layout

```
_config.yml                        Jekyll config
_data/conferences.yml              generated: conferences + deadlines
_data/areas.yml                    generated: CCF area codes and labels
index.html                         the page (server-rendered card list)
static/css/style.css               styling, light and dark
static/js/main.js                  countdowns, sorting, filtering
scripts/sync_ccfddl.py             regenerates the data from upstream
ical/                              generated: calendar feeds
.github/workflows/sync-deadlines.yml   daily refresh
```

## Credits

Deadline data from [ccfddl/ccf-deadlines](https://github.com/ccfddl/ccf-deadlines)
(MIT). Conference catalogue from the [CCF recommended list](https://ccf.atom.im/).
Concept from [ai-deadlines](https://aideadlin.es/) and
[sec-deadlines](https://sec-deadlines.github.io/).

Always confirm a deadline against the official call for papers before relying
on it.
