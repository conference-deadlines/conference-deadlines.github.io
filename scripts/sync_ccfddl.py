#!/usr/bin/env python3
"""Regenerate _data/conferences.yml and the iCal feeds from ccfddl/ccf-deadlines.

Upstream (https://github.com/ccfddl/ccf-deadlines, MIT) keeps one YAML file per
conference under conference/<AREA>/. We take the areas listed in AREAS, pick the
most relevant edition of each conference, normalise every deadline to an ISO
timestamp with an explicit UTC offset, and write a flat file the Jekyll
templates can render without any timezone logic of their own.

Usage:  python3 scripts/sync_ccfddl.py [--offline path/to/ccf-deadlines]
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import pathlib
import re
import sys
import tarfile
import urllib.request
import zoneinfo

import yaml

TARBALL = "https://codeload.github.com/ccfddl/ccf-deadlines/tar.gz/refs/heads/main"

# Every area directory upstream publishes. The CCF catalogue is used only as
# the reference for which venues and areas exist -- its rankings are not shown
# on the site. Display names come from upstream's types.yml and are written to
# _data/areas.yml so the filter UI stays in sync automatically.
AREAS = ("DS", "NW", "SC", "SE", "DB", "CT", "CG", "AI", "HI", "MX")

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_FILE = REPO_ROOT / "_data" / "conferences.yml"
AREAS_FILE = REPO_ROOT / "_data" / "areas.yml"
ICAL_DIR = REPO_ROOT / "ical"

# Civil-time abbreviations upstream uses that need real DST rules.
NAMED_ZONES = {
    "PT": "America/Los_Angeles",
    "PST": "America/Los_Angeles",
    "PDT": "America/Los_Angeles",
    "ET": "America/New_York",
    "EST": "America/New_York",
    "EDT": "America/New_York",
    "CET": "Europe/Paris",
    "CEST": "Europe/Paris",
    "GMT": "Etc/UTC",
    "CST": "Asia/Shanghai",
    "JST": "Asia/Tokyo",
    "KST": "Asia/Seoul",
}

# Upstream's English area names are long category strings, unwieldy on a filter
# chip; these are the short labels shown in the UI.
AREA_LABELS = {
    "DS": "Architecture & Systems",
    "NW": "Networking",
    "SC": "Security & Privacy",
    "SE": "Software Engineering",
    "DB": "Databases & Data Mining",
    "CT": "Theory",
    "CG": "Graphics & Multimedia",
    "AI": "Artificial Intelligence",
    "HI": "HCI & Ubiquitous Computing",
    "MX": "Interdisciplinary & Emerging",
}

CORE_TAGS = {"A*": "CORE-ASTAR", "A": "CORE-A", "B": "CORE-B", "C": "CORE-C"}

# Cap on how many upcoming rounds of a rolling-deadline venue we render.
MAX_UPCOMING = 3

# Drop a conference once its newest known deadline is this old. Upstream keeps
# entries for venues that stopped being updated years ago (LISA's last record is
# 2021), and a tracker that lists a deadline five years gone is just wrong. A
# year is generous enough to keep venues whose next cycle simply is not
# announced yet.
STALE_AFTER_DAYS = 365


def load_sources(offline: pathlib.Path | None) -> tuple[dict[str, list[tuple[str, str]]], str]:
    """Return ({area: [(filename, yaml_text), ...]}, types_yaml_text)."""
    if offline:
        out = {}
        for area in AREAS:
            files = sorted((offline / "conference" / area).glob("*.yml"))
            out[area] = [(f.name, f.read_text(encoding="utf-8")) for f in files]
        types = (offline / "conference" / "types.yml").read_text(encoding="utf-8")
        return out, types

    print(f"Downloading {TARBALL} ...", file=sys.stderr)
    with urllib.request.urlopen(TARBALL, timeout=120) as resp:
        blob = resp.read()

    out = {area: [] for area in AREAS}
    types = ""
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile() or not member.name.endswith(".yml"):
                continue
            parts = member.name.split("/")
            payload = tar.extractfile(member)
            if payload is None:
                continue
            # <repo>-main/conference/types.yml
            if len(parts) == 3 and parts[1] == "conference" and parts[2] == "types.yml":
                types = payload.read().decode("utf-8")
                continue
            # <repo>-main/conference/<AREA>/<name>.yml
            if len(parts) != 4 or parts[1] != "conference":
                continue
            if parts[2] not in AREAS:
                continue
            out[parts[2]].append((parts[3], payload.read().decode("utf-8")))
    for area in out:
        out[area].sort()
    return out, types


def tzinfo_for(timezone: str | None) -> dt.tzinfo:
    """Map an upstream timezone string to a concrete tzinfo.

    Upstream mostly uses fixed offsets ('UTC-12', 'UTC+8', 'UTC') plus the
    literal 'AoE' (Anywhere on Earth, i.e. UTC-12). A handful of entries use
    civil-time abbreviations such as 'PT', which do observe DST -- those are
    resolved through the tz database so the offset is correct for the actual
    date of each deadline.
    """
    raw = (timezone or "AoE").strip()
    if raw.upper() == "AOE":
        return dt.timezone(dt.timedelta(hours=-12))

    named = NAMED_ZONES.get(raw.upper())
    if named:
        try:
            return zoneinfo.ZoneInfo(named)
        except zoneinfo.ZoneInfoNotFoundError:
            print(f"  ! tz database missing {named}, assuming AoE", file=sys.stderr)
            return dt.timezone(dt.timedelta(hours=-12))

    match = re.fullmatch(r"UTC([+-]\d{1,2})?(?::(\d{2}))?", raw, re.IGNORECASE)
    if not match:
        print(f"  ! unknown timezone {raw!r}, assuming AoE", file=sys.stderr)
        return dt.timezone(dt.timedelta(hours=-12))
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    sign = -1 if hours < 0 else 1
    return dt.timezone(sign * dt.timedelta(hours=abs(hours), minutes=minutes))


def parse_stamp(value, tz: dt.tzinfo) -> str | None:
    """Normalise one upstream deadline into an ISO string with a UTC offset."""
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        text = value.strftime("%Y-%m-%d %H:%M:%S")
    elif isinstance(value, dt.date):
        text = value.strftime("%Y-%m-%d 23:59:59")
    else:
        text = str(value).strip()

    if not text or text.upper() in {"TBD", "TBA", "NONE"}:
        return None

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            parsed = dt.datetime.strptime(text, fmt)
        except ValueError:
            continue
        if fmt == "%Y-%m-%d":
            parsed = parsed.replace(hour=23, minute=59, second=59)
        return parsed.replace(tzinfo=tz).isoformat()

    print(f"  ! unparseable deadline {text!r}", file=sys.stderr)
    return None


def build_deadlines(edition: dict) -> list[dict]:
    tz = tzinfo_for(edition.get("timezone"))
    deadlines = []
    for entry in edition.get("timeline") or []:
        if not isinstance(entry, dict):
            continue
        when = parse_stamp(entry.get("deadline"), tz)
        if when is None:
            continue
        record = {"date": when}
        comment = entry.get("comment")
        if comment:
            record["comment"] = str(comment).strip()
        abstract = parse_stamp(entry.get("abstract_deadline"), tz)
        if abstract:
            # A handful of upstream records have the two dates crossed (often a
            # stale year on one of them). We cannot tell which is right, and a
            # wrong abstract date is worse than none, so drop it.
            if abstract >= when:
                print(
                    f"  ! abstract {abstract} not before deadline {when}; dropping abstract",
                    file=sys.stderr,
                )
            else:
                record["abstract"] = abstract
        deadlines.append(record)
    deadlines.sort(key=lambda d: d["date"])
    return deadlines


def pick_edition(conf: dict, now: dt.datetime) -> tuple[dict, list[dict]] | None:
    """Choose the edition to display: the one with the next upcoming deadline,
    else the most recent edition so the entry still shows as passed."""
    editions = []
    for edition in conf.get("confs") or []:
        if isinstance(edition, dict):
            editions.append((edition, build_deadlines(edition)))
    if not editions:
        return None

    upcoming = []
    for edition, deadlines in editions:
        future = [dt.datetime.fromisoformat(d["date"]) for d in deadlines]
        future = [when for when in future if when > now]
        if future:
            upcoming.append((min(future), edition, deadlines))
    if upcoming:
        # Surface the edition whose next deadline lands soonest.
        upcoming.sort(key=lambda item: item[0])
        _, edition, deadlines = upcoming[0]
        return edition, deadlines

    editions.sort(key=lambda item: item[0].get("year") or 0)
    return editions[-1]


def trim_deadlines(deadlines: list[dict], now: dt.datetime) -> list[dict]:
    """Keep the deadlines worth showing.

    Venues with rolling monthly submission (VLDB, PACMMOD...) list a dozen
    rounds per edition; rendering every one of them buries everything else. We
    show at most MAX_UPCOMING future rounds, and fall back to the single most
    recent round once an edition is entirely in the past.
    """
    future = [d for d in deadlines if dt.datetime.fromisoformat(d["date"]) > now]
    if future:
        return future[:MAX_UPCOMING]
    return deadlines[-1:]


def tags_for(conf: dict) -> list[str]:
    """Rank tags shown on a card. Only the CORE ranking is surfaced -- the CCF
    catalogue is used to decide which venues exist, not to rank them here."""
    rank = conf.get("rank") or {}
    return [CORE_TAGS.get(str(rank.get("core")), "CORE-N")]


def to_record(conf: dict, area: str, now: dt.datetime) -> dict | None:
    chosen = pick_edition(conf, now)
    if chosen is None:
        return None
    edition, deadlines = chosen
    deadlines = trim_deadlines(deadlines, now)
    if not deadlines:
        return None

    # trim_deadlines only falls back to a past deadline when the edition has no
    # future one left, which means the next cycle has not been announced yet.
    # Those are surfaced as TBA rather than dropped -- "we don't know yet" is
    # useful information, and the previous cycle's date shows roughly when to
    # expect the call.
    announced = any(dt.datetime.fromisoformat(d["date"]) > now for d in deadlines)

    record = {
        "name": str(conf.get("title") or "").strip(),
        "description": str(conf.get("description") or "").strip(),
        "year": edition.get("year"),
        "link": edition.get("link"),
        "deadlines": deadlines,
        "areas": [area],
        "tags": tags_for(conf),
    }
    if not announced:
        record["tba"] = True
    if conf.get("dblp"):
        record["dblp"] = f"https://dblp.org/db/conf/{conf['dblp']}/index.html"
    if edition.get("date"):
        record["date"] = str(edition["date"]).strip()
    if edition.get("place"):
        record["place"] = str(edition["place"]).strip()
    return record


def build_records(area_files: dict[str, list[tuple[str, str]]], now: dt.datetime) -> list[dict]:
    records: dict[str, dict] = {}
    for area, files in area_files.items():
        for filename, text in files:
            try:
                parsed = yaml.safe_load(text)
            except yaml.YAMLError as exc:
                print(f"  ! skipping {area}/{filename}: {exc}", file=sys.stderr)
                continue
            for conf in parsed or []:
                if not isinstance(conf, dict):
                    continue
                record = to_record(conf, area, now)
                if not record or not record["name"]:
                    continue
                # Keying on the name alone merged distinct conferences that
                # share an abbreviation -- FSE is both Fast Software Encryption
                # (security) and Foundations of Software Engineering. Include
                # the DBLP id (or the full name) so only genuine cross-listings
                # of the same venue merge.
                key = (
                    record["name"].lower(),
                    (conf.get("dblp") or record["description"]).lower(),
                )
                existing = records.get(key)
                if existing:
                    # Same venue listed under two areas: merge the area tags
                    # rather than emitting a duplicate card.
                    for tag in record["areas"]:
                        if tag not in existing["areas"]:
                            existing["areas"].append(tag)
                    for tag in record["tags"]:
                        if tag not in existing["tags"]:
                            existing["tags"].append(tag)
                    continue
                records[key] = record

    cutoff = now - dt.timedelta(days=STALE_AFTER_DAYS)
    live, stale = [], []
    for record in records.values():
        newest = max(dt.datetime.fromisoformat(d["date"]) for d in record["deadlines"])
        (stale if newest < cutoff else live).append(record)

    if stale:
        print(
            f"  dropped {len(stale)} conferences with no deadline in the last "
            f"{STALE_AFTER_DAYS} days",
            file=sys.stderr,
        )

    return sorted(
        live,
        key=lambda r: dt.datetime.fromisoformat(r["deadlines"][0]["date"]),
    )


def write_areas(types_yaml: str) -> list[dict]:
    """Mirror upstream's area list into _data/areas.yml for the filter UI."""
    parsed = yaml.safe_load(types_yaml) or []
    by_sub = {entry.get("sub"): entry for entry in parsed if isinstance(entry, dict)}
    areas = []
    for sub in AREAS:
        entry = by_sub.get(sub) or {}
        areas.append(
            {
                "tag": sub,
                "label": AREA_LABELS.get(sub, sub),
                "name": str(entry.get("name_en") or sub).strip(),
                "name_zh": str(entry.get("name") or "").strip(),
            }
        )
    header = (
        "# Generated by scripts/sync_ccfddl.py -- do not edit by hand.\n"
        "# Research areas used by the filter UI.\n"
    )
    AREAS_FILE.write_text(
        header + yaml.safe_dump(areas, allow_unicode=True, sort_keys=False, width=1000),
        encoding="utf-8",
    )
    return areas


def ics_escape(text: str) -> str:
    return (
        str(text)
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def fold(line: str) -> str:
    """RFC 5545 requires content lines to be folded at 75 octets."""
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return line
    chunks, current = [], b""
    for char in line:
        raw = char.encode("utf-8")
        limit = 75 if not chunks else 74
        if len(current) + len(raw) > limit:
            chunks.append(current)
            current = b""
        current += raw
    chunks.append(current)
    return "\r\n ".join(chunk.decode("utf-8") for chunk in chunks)


def write_ical(records: list[dict], path: pathlib.Path, name: str) -> None:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//conference-deadlines//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        fold(f"X-WR-CALNAME:{ics_escape(name)}"),
    ]

    for record in records:
        for index, deadline in enumerate(record["deadlines"]):
            # Both the abstract registration and the full-paper deadline get
            # their own event -- the abstract one is the deadline people
            # actually miss, so it is no use leaving it out of the calendar.
            slots = []
            if deadline.get("abstract"):
                slots.append(("abstract", deadline["abstract"], "abstract deadline"))
            slots.append(("paper", deadline["date"], "deadline"))

            for kind, stamp, noun in slots:
                moment = dt.datetime.fromisoformat(stamp).astimezone(dt.timezone.utc)

                title = f"{record['name']} {record['year']} {noun}"
                if deadline.get("comment"):
                    title += f" ({deadline['comment']})"

                uid = f"{record['name']}-{record['year']}-{index}-{kind}".lower()
                uid = re.sub(r"[^a-z0-9]+", "-", uid).strip("-")

                body = [record.get("description") or "", record.get("link") or ""]
                if record.get("place"):
                    body.append(f"Location: {record['place']}")

                # A deadline is instantaneous, but zero-length events (DTEND ==
                # DTSTART) are mishandled or rejected by several clients, so
                # each one is given a short visible block instead.
                finish = moment + dt.timedelta(minutes=30)

                # DTSTAMP is pinned to the event's own instant rather than
                # "now": a wall-clock value would rewrite every feed on each
                # sync and bury real deadline changes in the diff.
                lines += [
                    "BEGIN:VEVENT",
                    fold(f"UID:{uid}@conference-deadlines"),
                    f"DTSTAMP:{moment.strftime('%Y%m%dT%H%M%SZ')}",
                    f"DTSTART:{moment.strftime('%Y%m%dT%H%M%SZ')}",
                    f"DTEND:{finish.strftime('%Y%m%dT%H%M%SZ')}",
                    "TRANSP:TRANSPARENT",
                    fold(f"SUMMARY:{ics_escape(title)}"),
                    fold(f"DESCRIPTION:{ics_escape(chr(10).join(p for p in body if p))}"),
                ]
                if record.get("link"):
                    lines.append(fold(f"URL:{record['link']}"))
                lines.append("END:VEVENT")

    lines.append("END:VCALENDAR")
    path.write_text("\r\n".join(lines) + "\r\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--offline",
        type=pathlib.Path,
        help="use a local checkout of ccf-deadlines instead of downloading it",
    )
    args = parser.parse_args()

    now = dt.datetime.now(dt.timezone.utc)
    area_files, types_yaml = load_sources(args.offline)
    for area, files in area_files.items():
        print(f"{area}: {len(files)} source files", file=sys.stderr)

    records = build_records(area_files, now)
    print(f"-> {len(records)} conferences", file=sys.stderr)
    if not records:
        print("refusing to write an empty data file", file=sys.stderr)
        return 1

    # Deliberately no sync timestamp: it would change on every run and defeat
    # the workflow's "commit only if something changed" check. The commit date
    # already records when each sync happened.
    header = (
        "# Generated by scripts/sync_ccfddl.py -- do not edit by hand.\n"
        "# Source: https://github.com/ccfddl/ccf-deadlines (MIT)\n"
    )
    body = yaml.safe_dump(records, allow_unicode=True, sort_keys=False, width=1000)
    DATA_FILE.write_text(header + body, encoding="utf-8")
    print(f"wrote {DATA_FILE.relative_to(REPO_ROOT)}", file=sys.stderr)

    areas = write_areas(types_yaml)
    print(f"wrote {AREAS_FILE.relative_to(REPO_ROOT)} ({len(areas)} areas)", file=sys.stderr)

    ICAL_DIR.mkdir(exist_ok=True)
    write_ical(records, ICAL_DIR / "deadlines-all.ics", "Conference Deadlines - All areas")
    labels = {area["tag"]: area["label"] for area in areas}
    for area in AREAS:
        subset = [r for r in records if area in r["areas"]]
        write_ical(
            subset,
            ICAL_DIR / f"deadlines-{area.lower()}.ics",
            f"Conference Deadlines - {labels.get(area, area)}",
        )
    print(f"wrote {len(list(ICAL_DIR.glob('*.ics')))} iCal feeds", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
