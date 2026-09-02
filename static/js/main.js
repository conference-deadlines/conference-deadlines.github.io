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
  var hideTba = document.getElementById('hide-tba');
  var countrySelect = document.getElementById('country-select');
  var resetButton = document.getElementById('reset');
  var resultCount = document.getElementById('result-count');
  var emptyNote = document.getElementById('empty');
  var groups = Array.prototype.slice.call(document.querySelectorAll('.filter-group'));

  var tzSelect = document.getElementById('tz-select');
  var tzNote = document.getElementById('tz-note');
  var themeButtons = Array.prototype.slice.call(
    document.querySelectorAll('[data-theme-choice]'));

  var LANG_KEY = 'conference-deadlines-lang';
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

  /* ---------- language ----------
   *
   * Only the interface translates. Conference names, descriptions and places
   * stay as published -- they are official titles, not prose, and a machine
   * rendering of "Fast Software Encryption" helps nobody. */

  var TRANSLATIONS = {};
  try {
    TRANSLATIONS = JSON.parse(document.getElementById('i18n-data').textContent);
  } catch (e) { TRANSLATIONS = { en: {} }; }

  var LOCALES = { en: undefined, vi: 'vi-VN' };
  var lang = readStore(LANG_KEY);
  if (!TRANSLATIONS[lang]) lang = 'en';

  function t(key, vars) {
    var table = TRANSLATIONS[lang] || TRANSLATIONS.en || {};
    var text = table[key];
    if (text === undefined) text = (TRANSLATIONS.en || {})[key];
    if (text === undefined) return key;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        text = text.replace('%{' + name + '}', vars[name]);
      });
    }
    return text;
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
    var locale = LOCALES[lang];
    try {
      options.timeZone = currentZone;
      dateFormat = new Intl.DateTimeFormat(locale, options);
    } catch (e) {
      delete options.timeZone;
      dateFormat = new Intl.DateTimeFormat(locale, options);
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

  function rebuildZonePicker() {
    var keep = tzSelect.value;
    tzSelect.textContent = '';
    buildZonePicker();
    if (keep) tzSelect.value = keep;
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
    common.appendChild(option(localZone, t('local_time') + ' — ' + zoneLabel(localZone)));
    common.appendChild(option(AOE, t('aoe')));
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
    if (offset && currentZone !== AOE) label += ', ' + offset;
    tzNote.textContent = t(
      currentZone === localZone ? 'times_local' : 'times_in', { zone: label });
  }

  /* ---------- model ---------- */

  var entries = cards.map(function (card) {
    var paper = new Date(card.getAttribute('data-deadline'));
    var abstractRaw = card.getAttribute('data-abstract');
    var abstract = abstractRaw ? new Date(abstractRaw) : null;

    var isTba = card.getAttribute('data-state') === 'tba';

    return {
      tba: isTba,
      previous: isTba && card.querySelector('.dl-previous')
        ? new Date(card.querySelector('.dl-previous').getAttribute('data-previous'))
        : null,
      dateNodes: Array.prototype.slice.call(card.querySelectorAll('.dl-date')),
      card: card,
      paper: isNaN(paper) ? null : paper,
      abstract: abstract && !isNaN(abstract) ? abstract : null,
      tags: (card.getAttribute('data-tags') || '').split(/\s+/).filter(Boolean),
      country: card.getAttribute('data-country') || '',
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
        if (node.classList.contains('dl-previous')) {
          if (entry.previous && !isNaN(entry.previous)) {
            node.textContent = t('last_round', { date: dateFormat.format(entry.previous) });
          }
          return;
        }
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
      return t(years === 1 ? 'years_ago_one' : 'years_ago_many', { n: years });
    }
    if (days >= 1) return t(days === 1 ? 'days_ago_one' : 'days_ago_many', { n: days });
    return t('today');
  }

  var DAY = 86400000;

  // Graded urgency: the closer a deadline is, the hotter it reads.
  function urgencyClass(remaining) {
    if (remaining < DAY) return 'due-now';
    if (remaining < 3 * DAY) return 'due-soon';
    if (remaining < 14 * DAY) return 'due-near';
    return null;
  }

  function paintTimer(node, when, now) {
    if (!node || !when) return false;
    var remaining = when - now;
    if (remaining > 0) {
      node.textContent = humanize(remaining);
      node.classList.remove('passed', 'due-now', 'due-soon', 'due-near');
      var level = urgencyClass(remaining);
      if (level) node.classList.add(level);
      return true;
    }
    node.textContent = passedFor(now - when);
    node.classList.add('passed');
    node.classList.remove('due-now', 'due-soon', 'due-near');
    return false;
  }

  function tick() {
    var now = new Date();
    entries.forEach(function (entry) {
      if (entry.tba) return;
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
      // Announced deadlines first, soonest first. TBA entries follow, ordered
      // by how recently their last round ran -- the ones most likely to
      // announce next sit at the top of that group.
      if (a.tba !== b.tba) return a.tba ? 1 : -1;
      if (a.tba && b.tba) {
        if (!a.previous) return 1;
        if (!b.previous) return -1;
        return b.previous - a.previous;
      }
      if (!a.paper) return 1;
      if (!b.paper) return -1;
      var aPast = a.paper < now;
      var bPast = b.paper < now;
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
    var skipTba = hideTba.checked;
    var country = countrySelect.value;
    var selections = groups.map(selectedIn);
    var shown = 0;

    entries.forEach(function (entry) {
      var visible = true;

      if (skipTba && entry.tba) visible = false;

      if (visible && country) visible = entry.country === country;

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
      t(shown === 1 ? 'shown_one' : 'shown_many', { count: shown });
    emptyNote.hidden = shown !== 0;
  }

  /* ---------- persistence ---------- */

  function saveState() {
    writeStore(STORE_KEY, JSON.stringify({
      hideTba: hideTba.checked,
      groups: groups.map(selectedIn)
    }));
  }

  function restoreState() {
    var saved = null;
    try {
      saved = JSON.parse(readStore(STORE_KEY) || 'null');
    } catch (err) { saved = null; }
    if (!saved) return;

    if (typeof saved.hideTba === 'boolean') hideTba.checked = saved.hideTba;
    if (typeof saved.country === 'string') countrySelect.value = saved.country;
    if (!Array.isArray(saved.groups)) return;

    groups.forEach(function (group, i) {
      var picked = saved.groups[i] || [];
      group.querySelectorAll('input').forEach(function (input) {
        input.checked = picked.indexOf(input.value) !== -1;
      });
    });
  }

  /* ---------- visitor counter ----------
   *
   * GoatCounter's /counter/TOTAL.json endpoint returns pre-formatted strings,
   * e.g. {"count":"12,481","count_unique":"3,402"}. It only responds when
   * "Allow adding visitor counts on your website" is enabled for the site, so
   * the footer line stays hidden unless real numbers come back -- no "0 views"
   * placeholder on a misconfigured site. */

  function loadStats() {
    var meta = document.querySelector('meta[name="goatcounter-code"]');
    var code = meta && meta.getAttribute('content');
    var row = document.getElementById('stats');
    if (!code || !row || !window.fetch) return;

    fetch('https://' + code + '.goatcounter.com/counter/TOTAL.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.count) return;
        document.getElementById('stats-views').textContent = data.count;
        document.getElementById('stats-visitors').textContent =
          data.count_unique || data.count;
        row.hidden = false;
      })
      .catch(function () { /* blocked or not enabled; leave the line hidden */ });
  }

  loadStats();

  /* ---------- GitHub star count ----------
   *
   * Fetched client-side rather than embedded via the usual ghbtns.com iframe,
   * which cannot inherit this page's theme and would sit there as a white box
   * in dark mode. The unauthenticated API allows 60 requests/hour per IP, and
   * each visitor spends one from their own quota, so the cache below is about
   * courtesy and speed rather than necessity. The link works regardless -- the
   * count is the only thing that depends on the request succeeding. */

  var STAR_KEY = 'conference-deadlines-stars';
  var STAR_TTL = 6 * 60 * 60 * 1000;

  function formatStars(n) {
    if (n >= 10000) return Math.round(n / 1000) + 'k';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function showStars(count) {
    var node = document.getElementById('gh-count');
    if (!node || typeof count !== 'number') return;
    node.textContent = formatStars(count);
    node.hidden = false;
  }

  function loadStars() {
    var link = document.getElementById('gh-star');
    if (!link || !window.fetch) return;

    var repo = link.getAttribute('href').replace(/^https:\/\/github\.com\//, '');

    try {
      var cached = JSON.parse(readStore(STAR_KEY) || 'null');
      if (cached && Date.now() - cached.at < STAR_TTL) {
        showStars(cached.count);
        return;
      }
    } catch (e) { /* fall through to a fresh fetch */ }

    fetch('https://api.github.com/repos/' + repo)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || typeof data.stargazers_count !== 'number') return;
        showStars(data.stargazers_count);
        writeStore(STAR_KEY, JSON.stringify({ count: data.stargazers_count, at: Date.now() }));
      })
      .catch(function () { /* offline or rate-limited; the link still works */ });
  }

  loadStars();

  /* ---------- update check ----------
   *
   * GitHub Pages serves HTML with `cache-control: max-age=600` and gives no way
   * to change that, so a browser can hold a stale page for up to ten minutes --
   * and a tab left open overnight misses the daily data sync entirely. Rather
   * than asking people to hard-refresh, poll a tiny version file and offer a
   * reload when the deployed build id stops matching the one this page was
   * built from. */

  var buildMeta = document.querySelector('meta[name="site-build"]');
  var currentBuild = buildMeta ? buildMeta.getAttribute('content') : null;
  var banner = document.getElementById('update-banner');
  var updateDismissed = false;
  var lastCheck = 0;
  var CHECK_INTERVAL = 15 * MINUTE;

  function checkForUpdate() {
    if (!currentBuild || updateDismissed || !window.fetch) return;

    var now = Date.now();
    if (now - lastCheck < 5 * MINUTE) return;
    lastCheck = now;

    // `no-store` bypasses the browser cache; the query param defeats the CDN
    // edge cache, which would otherwise serve the same stale copy for 10 min.
    fetch('version.json?t=' + now, { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (data && data.build && data.build !== currentBuild) {
          banner.hidden = false;
        }
      })
      .catch(function () { /* offline or blocked; try again next tick */ });
  }

  document.getElementById('update-reload').addEventListener('click', function () {
    window.location.reload();
  });

  document.getElementById('update-dismiss').addEventListener('click', function () {
    banner.hidden = true;
    updateDismissed = true;
  });

  // Check on a timer, and when someone returns to a tab they left open.
  window.setInterval(checkForUpdate, CHECK_INTERVAL);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) checkForUpdate();
  });

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

  /* ---------- applying a language ---------- */

  function applyLanguage(next) {
    lang = TRANSLATIONS[next] ? next : 'en';
    document.documentElement.lang = lang;

    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (node) {
      node.placeholder = t(node.getAttribute('data-i18n-placeholder'));
    });
    document.querySelectorAll('[data-i18n-round]').forEach(function (node) {
      node.textContent = t('round_of', {
        n: node.getAttribute('data-n'), total: node.getAttribute('data-total')
      });
    });

    var summary = document.getElementById('summary-line');
    if (summary) {
      var count = summary.getAttribute('data-count');
      var updated = new Date(summary.getAttribute('data-updated'));
      var shownDate = isNaN(updated) ? '' : new Intl.DateTimeFormat(LOCALES[lang], {
        year: 'numeric', month: 'long', day: 'numeric'
      }).format(updated);
      summary.textContent = t('summary', { count: count }) + ' ' +
        t('updated', { date: shownDate });
    }

    langButtons.forEach(function (button) {
      button.setAttribute('aria-pressed',
        button.getAttribute('data-lang') === lang ? 'true' : 'false');
    });

    // Anything rendered from data rather than markup has to be redrawn.
    buildFormatter();
    rebuildZonePicker();
    updateZoneNote();
    renderDates();
    tick();
    applyFilters();
  }

  var langButtons = Array.prototype.slice.call(document.querySelectorAll('[data-lang]'));
  langButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      var next = button.getAttribute('data-lang');
      writeStore(LANG_KEY, next);
      applyLanguage(next);
    });
  });

  /* ---------- wiring ---------- */

  applyTheme(savedTheme);

  buildFormatter();
  buildZonePicker();
  applyLanguage(lang);

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

  countrySelect.addEventListener('change', function () {
    saveState();
    applyFilters();
  });

  hideTba.addEventListener('change', function () {
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
    hideTba.checked = false;
    countrySelect.value = '';
    groups.forEach(function (group) {
      group.querySelectorAll('input').forEach(function (input) { input.checked = false; });
    });
    saveState();
    applyFilters();
  });
})();
