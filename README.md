# Research Conference Deadlines

Paper and abstract submission deadline countdowns for computer science
conferences worldwide, across ten research areas — with **abstract deadlines
shown alongside the full-paper deadline**.

Built in the spirit of [sec-deadlines](https://sec-deadlines.github.io/) and
[ai-deadlines](https://aideadlin.es/), but covering every field rather than
just one.

## What it shows

- **348 conferences** across 10 research areas (security, AI, networking,
  architecture, software engineering, databases, theory, graphics, HCI,
  interdisciplinary).
- **Abstract and full-paper deadlines** as separate countdowns. sec-deadlines
  only tracks the paper deadline; here the abstract registration deadline gets
  its own timer, because that is the one people actually miss.
- **[CORE rank](https://portal.core.edu.au/conf-ranks/) (A\*/A/B/C)** on every
  entry.
- Filtering by area and by rank, plus free-text search over name, description
  and location.
- Conferences whose next round has not been announced show **TBA**, with the
  date of their previous round, rather than being hidden.
- **Country filter** — the host country is recovered from upstream's free-text
  location strings ("Salt Lake City, Utah", "MONTREAL, CANADA", "Chania, Greec")
  by [`country_for`](scripts/sync_ccfddl.py), which normalises aliases, US
  states and typos. 301 of 304 resolve; the rest are genuinely virtual or TBD.
- **English / Vietnamese interface** — UI strings live in
  [`_data/i18n.yml`](_data/i18n.yml) and swap client-side, with dates and
  relative times rendered in the matching locale. Conference names,
  descriptions and locations are deliberately left untranslated: they are
  official titles, not prose.
- **Timezone picker** — every date renders in whichever timezone the reader
  picks, defaulting to their own. Anywhere on Earth (AoE), the convention most
  CFPs actually use, is offered at the top of the list. Countdowns are absolute
  durations, so they are unaffected by the choice.
- iCal feeds — one for everything, one per area — under [`ical/`](ical/).
- **Theme control** — Auto / Light / Dark. Auto follows the OS setting; an
  explicit choice overrides it and persists.

Venues with rolling monthly submission (VLDB and friends) show their next three
rounds rather than all twelve.

A conference is dropped entirely once its newest known deadline is more than a
year old: upstream keeps records for venues that stopped being updated years
ago, and a tracker showing a five-year-old deadline is just wrong. Everything
between "announced" and that cutoff shows as TBA.

## How the data works

Deadline dates, timezones, venues, links and CORE rankings all come from
[ccfddl/ccf-deadlines](https://github.com/ccfddl/ccf-deadlines) (MIT), a
community-maintained dataset. [`scripts/sync_ccfddl.py`](scripts/sync_ccfddl.py)
pulls it and writes [`_data/conferences.yml`](_data/conferences.yml),
[`_data/areas.yml`](_data/areas.yml) and the iCal feeds.

The [CCF recommended list](https://ccf.atom.im/) was the starting reference for
*which* venues and research areas to cover — it publishes no deadlines of its
own, and its A/B/C rankings are deliberately **not** shown on the site. CORE is
the only ranking displayed.

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

Then open <http://localhost:4000/>.
The site is plain Jekyll with no custom plugins, so GitHub Pages builds it
as-is.

## Deployment

The repo lives in the `conference-deadlines` organisation as
`conference-deadlines.github.io`, so GitHub Pages serves it as a **user/org**
site at the bare domain:

    https://conference-deadlines.github.io/

`baseurl` is therefore empty in [`_config.yml`](_config.yml).

Enable Pages under **Settings → Pages → Build and deployment → Deploy from a
branch → `main` / `(root)`**, and allow the sync workflow to push its commits
under **Settings → Actions → General → Workflow permissions → Read and write
permissions**.

## Layout

```
_config.yml                        Jekyll config
_data/conferences.yml              generated: conferences + deadlines
_data/areas.yml                    generated: research areas and labels
index.html                         the page (server-rendered card list)
static/css/style.css               styling, light and dark
static/js/main.js                  countdowns, sorting, filtering, timezone, theme
scripts/sync_ccfddl.py             regenerates the data from upstream
ical/                              generated: calendar feeds
.github/workflows/sync-deadlines.yml   daily refresh
```

## Credits

Deadline data from [ccfddl/ccf-deadlines](https://github.com/ccfddl/ccf-deadlines)
(MIT). Rankings from [CORE](https://portal.core.edu.au/conf-ranks/). Concept
from [ai-deadlines](https://aideadlin.es/) and
[sec-deadlines](https://sec-deadlines.github.io/).

Always confirm a deadline against the official call for papers before relying
on it.
