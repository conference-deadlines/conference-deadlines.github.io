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
- All times rendered in **the viewer's local timezone**.
- iCal feeds — one for everything, one per area — under [`ical/`](ical/).

Venues with rolling monthly submission (VLDB and friends) show their next three
rounds rather than all twelve.

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
_data/areas.yml                    generated: research areas and labels
index.html                         the page (server-rendered card list)
static/css/style.css               styling, light and dark
static/js/main.js                  countdowns, sorting, filtering
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
