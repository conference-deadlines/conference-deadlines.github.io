/* Countdown, sorting and filtering for the deadline list.
 *
 * Every deadline is written into the HTML as an ISO 8601 string with an
 * explicit UTC offset (the sync script resolves the conference's timezone,
 * including DST, at build time), so the browser can parse it directly and
 * render it in the viewer's local time without any timezone library. */
(function () {
  'use strict';

  var list = document.getElementById('conf-list');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.conf'));
  var searchBox = document.getElementById('search');
  var hidePast = document.getElementById('hide-past');
  var resetButton = document.getElementById('reset');
  var resultCount = document.getElementById('result-count');
  var emptyNote = document.getElementById('empty');
  var groups = Array.prototype.slice.call(document.querySelectorAll('.filter-group'));

  var tzSelect = document.getElementById('tz-select');
  var tzNote = document.getElementById('tz-note');
  var themeButtons = Array.prototype.slice.call(
    document.querySelectorAll('[data-theme-choice]'));

  var STORE_KEY = 'conference-deadlines-filters';
  var TZ_KEY = 'conference-deadlines-timezone';
  var THEME_KEY = 'conference-deadlines-theme';
  var MINUTE = 60000;

  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* storage blocked */ }
  }

  /* ---------- timezone ---------- */

  var localZone = 'UTC';
  try {
    localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (e) { /* keep UTC */ }

  // 'AoE' is the deadline convention, not an IANA zone. Etc/GMT+12 is the
  // same thing: a fixed UTC-12 with no DST. (The Etc/* sign is inverted.)
  var AOE = 'Etc/GMT+12';

  var currentZone = readStore(TZ_KEY) || localZone;

  function zoneIsValid(zone) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: zone });
      return true;
    } catch (e) { return false; }
  }

  if (!zoneIsValid(currentZone)) currentZone = localZone;

  var dateFormat;

  function buildFormatter() {
    var options = {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    };
    try {
      options.timeZone = currentZone;
      dateFormat = new Intl.DateTimeFormat(undefined, options);
    } catch (e) {
      delete options.timeZone;
      dateFormat = new Intl.DateTimeFormat(undefined, options);
    }
  }

  function offsetOf(zone) {
    try {
      var parts = new Intl.DateTimeFormat('en', {
        timeZone: zone, timeZoneName: 'longOffset'
      }).formatToParts(new Date());
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'timeZoneName') {
          return parts[i].value.replace('GMT', 'UTC').replace(/^UTC$/, 'UTC+00:00');
        }
      }
    } catch (e) { /* longOffset unsupported */ }
    return '';
  }

  function zoneLabel(zone) {
    var offset = offsetOf(zone);
    var name = zone.replace(/_/g, ' ');
    return offset ? name + '  (' + offset + ')' : name;
  }

  function allZones() {
    try {
      if (typeof Intl.supportedValuesOf === 'function') {
        return Intl.supportedValuesOf('timeZone');
      }
    } catch (e) { /* fall through */ }
    // Enough coverage to be useful where supportedValuesOf is missing.
    return [
      'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'America/Chicago',
      'America/Denver', 'America/Los_Angeles', 'America/Mexico_City',
      'America/New_York', 'America/Sao_Paulo', 'America/Toronto',
      'Asia/Bangkok', 'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Jerusalem',
      'Asia/Kolkata', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore',
      'Asia/Tokyo', 'Australia/Melbourne', 'Australia/Sydney', 'Europe/Berlin',
      'Europe/London', 'Europe/Madrid', 'Europe/Moscow', 'Europe/Paris',
      'Europe/Zurich', 'Pacific/Auckland', 'UTC'
    ];
  }

  function buildZonePicker() {
    var frag = document.createDocumentFragment();

    function option(value, text) {
      var el = document.createElement('option');
      el.value = value;
      el.textContent = text;
      return el;
    }

    var common = document.createElement('optgroup');
    common.label = 'Common';
    common.appendChild(option(localZone, 'Your local time — ' + zoneLabel(localZone)));
    common.appendChild(option(AOE, 'Anywhere on Earth (AoE) — the deadline standard'));
    common.appendChild(option('UTC', zoneLabel('UTC')));
    frag.appendChild(common);

    var groups = {};
    var order = [];
    allZones().forEach(function (zone) {
      var region = zone.indexOf('/') === -1 ? 'Other' : zone.slice(0, zone.indexOf('/'));
      if (!groups[region]) {
        groups[region] = document.createElement('optgroup');
        groups[region].label = region;
        order.push(region);
      }
      groups[region].appendChild(option(zone, zoneLabel(zone)));
    });
    order.sort().forEach(function (region) { frag.appendChild(groups[region]); });

    tzSelect.appendChild(frag);
    tzSelect.value = currentZone;
    if (tzSelect.value !== currentZone) {
      // Zone exists but was not in the list; add it so the select reflects it.
      tzSelect.insertBefore(option(currentZone, zoneLabel(currentZone)), tzSelect.firstChild);
      tzSelect.value = currentZone;
    }
  }

  function updateZoneNote() {
    var label = currentZone === AOE
      ? 'Anywhere on Earth (UTC-12)'
      : currentZone.replace(/_/g, ' ');
    var offset = offsetOf(currentZone);
    tzNote.textContent = 'All times are shown in ' + label +
      (offset && currentZone !== AOE ? ', ' + offset : '') +
      (currentZone === localZone ? ' (your local timezone).' : '.');
  }

  /* ---------- model ---------- */

  var entries = cards.map(function (card) {
    var paper = new Date(card.getAttribute('data-deadline'));
    var abstractRaw = card.getAttribute('data-abstract');
    var abstract = abstractRaw ? new Date(abstractRaw) : null;

    return {
      dateNodes: Array.prototype.slice.call(card.querySelectorAll('.dl-date')),
      card: card,
      paper: isNaN(paper) ? null : paper,
      abstract: abstract && !isNaN(abstract) ? abstract : null,
      tags: (card.getAttribute('data-tags') || '').split(/\s+/).filter(Boolean),
      haystack: card.getAttribute('data-search') || '',
      timers: {
        paper: card.querySelector('[data-timer="paper"]'),
        abstract: card.querySelector('[data-timer="abstract"]')
      }
    };
  });

  // Absolute dates depend on the chosen timezone, so they are re-rendered
  // whenever it changes rather than written once at load.
  function renderDates() {
    entries.forEach(function (entry) {
      entry.dateNodes.forEach(function (node) {
        var when = node.getAttribute('data-date') === 'abstract'
          ? entry.abstract : entry.paper;
        if (when) node.textContent = dateFormat.format(when);
      });
    });
  }

  /* ---------- countdowns ---------- */

  function humanize(ms) {
    var seconds = Math.floor(ms / 1000);
    var days = Math.floor(seconds / 86400);
    var hours = Math.floor((seconds % 86400) / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var secs = seconds % 60;

    if (days > 0) return days + 'd ' + hours + 'h ' + minutes + 'm';
    if (hours > 0) return hours + 'h ' + minutes + 'm ' + secs + 's';
    return minutes + 'm ' + secs + 's';
  }

  function passedFor(ms) {
    var days = Math.floor(ms / 86400000);
    if (days >= 365) {
      var years = Math.floor(days / 365);
      return years + (years === 1 ? ' year ago' : ' years ago');
    }
    if (days >= 1) return days + (days === 1 ? ' day ago' : ' days ago');
    return 'today';
  }

  function paintTimer(node, when, now) {
    if (!node || !when) return false;
    var remaining = when - now;
    if (remaining > 0) {
      node.textContent = humanize(remaining);
      node.classList.remove('passed');
      node.classList.toggle('urgent', remaining < 7 * 86400000);
      return true;
    }
    node.textContent = passedFor(now - when);
    node.classList.add('passed');
    node.classList.remove('urgent');
    return false;
  }

  function tick() {
    var now = new Date();
    entries.forEach(function (entry) {
      var paperOpen = paintTimer(entry.timers.paper, entry.paper, now);
      paintTimer(entry.timers.abstract, entry.abstract, now);
      entry.past = !paperOpen;
      entry.card.classList.toggle('past', !paperOpen);
    });
  }

  /* ---------- ordering ---------- */

  function sortCards() {
    var now = new Date();
    var ordered = entries.slice().sort(function (a, b) {
      if (!a.paper) return 1;
      if (!b.paper) return -1;
      var aPast = a.paper < now;
      var bPast = b.paper < now;
      // Upcoming deadlines first (soonest first), then passed ones (most
      // recent first) so a just-missed deadline stays near the top.
      if (aPast !== bPast) return aPast ? 1 : -1;
      return aPast ? b.paper - a.paper : a.paper - b.paper;
    });
    var fragment = document.createDocumentFragment();
    ordered.forEach(function (entry) { fragment.appendChild(entry.card); });
    list.appendChild(fragment);
  }

  /* ---------- filtering ---------- */

  function selectedIn(group) {
    return Array.prototype.slice
      .call(group.querySelectorAll('input:checked'))
      .map(function (input) { return input.value; });
  }

  function applyFilters() {
    var query = searchBox.value.trim().toLowerCase();
    var skipPast = hidePast.checked;
    var selections = groups.map(selectedIn);
    var shown = 0;

    entries.forEach(function (entry) {
      var visible = true;

      if (skipPast && entry.past) visible = false;

      if (visible && query) {
        visible = entry.haystack.indexOf(query) !== -1;
      }

      // Within a group the checkboxes are OR-ed; across groups they are AND-ed.
      if (visible) {
        visible = selections.every(function (picked) {
          if (picked.length === 0) return true;
          return picked.some(function (tag) { return entry.tags.indexOf(tag) !== -1; });
        });
      }

      entry.card.hidden = !visible;
      if (visible) shown++;
    });

    resultCount.textContent =
      shown + (shown === 1 ? ' deadline' : ' deadlines') + ' shown';
    emptyNote.hidden = shown !== 0;
  }

  /* ---------- persistence ---------- */

  function saveState() {
    writeStore(STORE_KEY, JSON.stringify({
      hidePast: hidePast.checked,
      groups: groups.map(selectedIn)
    }));
  }

  function restoreState() {
    var saved = null;
    try {
      saved = JSON.parse(readStore(STORE_KEY) || 'null');
    } catch (err) { saved = null; }
    if (!saved) return;

    if (typeof saved.hidePast === 'boolean') hidePast.checked = saved.hidePast;
    if (!Array.isArray(saved.groups)) return;

    groups.forEach(function (group, i) {
      var picked = saved.groups[i] || [];
      group.querySelectorAll('input').forEach(function (input) {
        input.checked = picked.indexOf(input.value) !== -1;
      });
    });
  }

  /* ---------- theme ---------- */

  function applyTheme(choice) {
    if (choice === 'light' || choice === 'dark') {
      document.documentElement.setAttribute('data-theme', choice);
    } else {
      // 'system': drop the override and let prefers-color-scheme decide.
      document.documentElement.removeAttribute('data-theme');
    }
    themeButtons.forEach(function (button) {
      button.setAttribute(
        'aria-pressed',
        button.getAttribute('data-theme-choice') === choice ? 'true' : 'false');
    });
  }

  var savedTheme = readStore(THEME_KEY);
  if (savedTheme !== 'light' && savedTheme !== 'dark') savedTheme = 'system';

  themeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      var choice = button.getAttribute('data-theme-choice');
      applyTheme(choice);
      writeStore(THEME_KEY, choice);
    });
  });

  /* ---------- wiring ---------- */

  applyTheme(savedTheme);

  buildFormatter();
  buildZonePicker();
  updateZoneNote();
  renderDates();

  tzSelect.addEventListener('change', function () {
    currentZone = tzSelect.value;
    writeStore(TZ_KEY, currentZone);
    buildFormatter();
    updateZoneNote();
    renderDates();
  });

  restoreState();
  tick();
  sortCards();
  applyFilters();

  // Re-tick every minute; deadlines under an hour get a per-second countdown.
  window.setInterval(function () {
    tick();
    applyFilters();
  }, MINUTE);

  window.setInterval(function () {
    var now = new Date();
    entries.forEach(function (entry) {
      if (entry.paper && entry.paper - now > 0 && entry.paper - now < 3600000) {
        paintTimer(entry.timers.paper, entry.paper, now);
      }
      if (entry.abstract && entry.abstract - now > 0 && entry.abstract - now < 3600000) {
        paintTimer(entry.timers.abstract, entry.abstract, now);
      }
    });
  }, 1000);

  searchBox.addEventListener('input', applyFilters);

  hidePast.addEventListener('change', function () {
    saveState();
    applyFilters();
  });

  groups.forEach(function (group) {
    group.addEventListener('change', function () {
      saveState();
      applyFilters();
    });
  });

  resetButton.addEventListener('click', function () {
    searchBox.value = '';
    hidePast.checked = true;
    groups.forEach(function (group) {
      group.querySelectorAll('input').forEach(function (input) { input.checked = false; });
    });
    saveState();
    applyFilters();
  });
})();
