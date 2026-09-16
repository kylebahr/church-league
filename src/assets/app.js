/* Progressive enhancement only - every page is fully readable without this. */
(function () {
  'use strict';

  var KEY = 'church-league:me';

  function read() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function save(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) {} }

  /* ---- spotlight your own team across every table + the race chart ---- */
  function applyMe(me) {
    var rows = document.querySelectorAll('tr[data-team]');
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle('me', !!me && rows[i].getAttribute('data-team') === me);
    }
    var sel = document.querySelectorAll('#whoami');
    for (var j = 0; j < sel.length; j++) sel[j].value = me;
    var notes = document.querySelectorAll('#whoami-note');
    for (var k = 0; k < notes.length; k++) notes[k].textContent = me ? 'highlighted everywhere' : '';
    if (me) spotlight(me, true);
  }

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'whoami') {
      var v = e.target.value;
      save(v);
      applyMe(v);
    }
  });

  /* ---- race chart: follow one team ----
     `has-focus` on the svg lets the CSS fade the other 16 lines back, so the
     spotlighted team reads against the field instead of competing with it. */
  var pinned = '';
  function spotlight(team, pin) {
    var lines = document.querySelectorAll('svg.chart .ln[data-team]');
    for (var i = 0; i < lines.length; i++) {
      var on = !!team && lines[i].getAttribute('data-team') === team;
      lines[i].classList.toggle('on', on);
      if (on) lines[i].parentNode.appendChild(lines[i]); // raise above siblings
    }
    var areas = document.querySelectorAll('svg.chart .area[data-team]');
    for (var a = 0; a < areas.length; a++) {
      areas[a].classList.toggle('on', !!team && areas[a].getAttribute('data-team') === team);
    }
    var svgs = document.querySelectorAll('svg.chart');
    for (var s = 0; s < svgs.length; s++) svgs[s].classList.toggle('has-focus', !!team);

    var btns = document.querySelectorAll('.legend button[data-spotlight]');
    for (var j = 0; j < btns.length; j++) {
      btns[j].classList.toggle('on', btns[j].getAttribute('data-spotlight') === team);
    }
    if (pin) pinned = team;
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.legend button[data-spotlight]');
    if (!b) return;
    var t = b.getAttribute('data-spotlight');
    if (pinned === t) { pinned = ''; spotlight('', false); }
    else spotlight(t, true);
  });

  /* ---- render the build timestamp in the reader's own timezone ---- */
  function localTimes() {
    var els = document.querySelectorAll('[data-utc]');
    for (var i = 0; i < els.length; i++) {
      var d = new Date(els[i].getAttribute('data-utc'));
      if (isNaN(d)) continue;
      els[i].textContent = d.toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
    }
  }

  /* ---- click-to-sort ----
     Headers only advertise themselves as sortable once this script has wired
     them up, so the caret and pointer cursor never promise something that is
     not there (the week matrices' headers are links and are skipped). */
  function sortable() {
    var tables = document.querySelectorAll('table.dt');
    for (var t = 0; t < tables.length; t++) wire(tables[t]);
  }

  function wire(table) {
    var tb = table.querySelector('tbody');
    if (!tb) return;

    // The playoff-cut divider is only meaningful in rank order. Remember where
    // it sits so it can be put back when the table returns to '#' ascending.
    var cut = tb.querySelector('tr.cutrow');
    var cutAt = cut ? Array.prototype.indexOf.call(tb.rows, cut) : -1;

    var ths = table.querySelectorAll('thead th');
    var dirs = [];
    for (var i = 0; i < ths.length; i++) {
      if (ths[i].querySelector('a')) continue;   // header is a link, not a sort
      ths[i].classList.add('sortable');
      ths[i].setAttribute('role', 'button');
      ths[i].setAttribute('tabindex', '0');
      bind(ths[i], i);
    }

    function bind(th, idx) {
      dirs[idx] = 1;
      var run = function () {
        var dir = dirs[idx];
        var rows = Array.prototype.slice.call(tb.rows)
          .filter(function (r) { return !r.classList.contains('cutrow'); });

        rows.sort(function (a, b) {
          var av = cellVal(a.cells[idx]), bv = cellVal(b.cells[idx]);
          if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
          return String(av).localeCompare(String(bv)) * dir;
        });

        if (cut && cut.parentNode) cut.parentNode.removeChild(cut);
        for (var r = 0; r < rows.length; r++) tb.appendChild(rows[r]);

        // Rank order restored -> the divider means something again.
        if (cut && idx === 0 && dir === 1 && cutAt >= 0) {
          tb.insertBefore(cut, tb.rows[cutAt] || null);
        }

        th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
        var sibs = th.parentNode.children;
        for (var s = 0; s < sibs.length; s++) {
          if (sibs[s] !== th) sibs[s].removeAttribute('aria-sort');
        }
        dirs[idx] = -dir;
      };

      th.addEventListener('click', run);
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
      });
    }
  }

  function cellVal(td) {
    if (!td) return '';
    var s = (td.textContent || '').replace(/[,$%\s]/g, '').replace(/[–—]/g, '');
    if (s === '' || s === '-') return -Infinity;
    var n = parseFloat(s);
    return isNaN(n) ? (td.textContent || '').trim() : n;
  }

  localTimes();
  sortable();
  applyMe(read());
})();
