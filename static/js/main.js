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

  var STORE_KEY = 'conference-deadlines-filters';
  var MINUTE = 60000;

  var dateFormat = new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });

  /* ---------- model ---------- */

  var entries = cards.map(function (card) {
    var paper = new Date(card.getAttribute('data-deadline'));
    var abstractRaw = card.getAttribute('data-abstract');
    var abstract = abstractRaw ? new Date(abstractRaw) : null;

    // Render the absolute dates once; they never change.
    card.querySelectorAll('.dl-date').forEach(function (node) {
      var when = node.getAttribute('data-date') === 'abstract' ? abstract : paper;
      if (when && !isNaN(when)) node.textContent = dateFormat.format(when);
    });

    return {
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
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({
        hidePast: hidePast.checked,
        groups: groups.map(selectedIn)
      }));
    } catch (err) { /* private mode, or storage disabled -- filters just won't persist */ }
  }

  function restoreState() {
    var saved = null;
    try {
      saved = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null');
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

  /* ---------- wiring ---------- */

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
