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
    for (var k = 0; k < notes.length; k++) {
      notes[k].textContent = me ? 'highlighted everywhere' : '';
    }
    if (me) spotlight(me, true);
  }

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'whoami') {
      var v = e.target.value;
      save(v);
      applyMe(v);
    }
  });

  /* ---- race chart: follow one team ---- */
  var pinned = '';
  function spotlight(team, pin) {
    var lines = document.querySelectorAll('svg.chart .ln[data-team]');
    for (var i = 0; i < lines.length; i++) {
      var on = lines[i].getAttribute('data-team') === team;
      lines[i].classList.toggle('on', on);
      if (on) lines[i].parentNode.appendChild(lines[i]); // raise above siblings
    }
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

  /* ---- draw the playoff cut line under the last qualifying row ---- */
  function cutline() {
    var r = document.querySelector('tr[data-cutline]');
    if (r) r.classList.add('cutline-after');
  }

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

  /* ---- click-to-sort on any data table ---- */
  function sortable() {
    var tables = document.querySelectorAll('table.dt');
    for (var t = 0; t < tables.length; t++) {
      (function (table) {
        var ths = table.querySelectorAll('thead th');
        for (var i = 0; i < ths.length; i++) {
          (function (th, idx) {
            if (th.querySelector('a')) return;
            th.style.cursor = 'pointer';
            th.title = 'sort';
            var dir = 1;
            th.addEventListener('click', function () {
              var tb = table.querySelector('tbody');
              if (!tb) return;
              var rows = Array.prototype.slice.call(tb.rows);
              rows.sort(function (a, b) {
                var av = cellVal(a.cells[idx]), bv = cellVal(b.cells[idx]);
                if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
                return String(av).localeCompare(String(bv)) * dir;
              });
              dir = -dir;
              for (var r = 0; r < rows.length; r++) tb.appendChild(rows[r]);
            });
          })(ths[i], i);
        }
      })(tables[t]);
    }
  }
  function cellVal(td) {
    if (!td) return '';
    var s = (td.textContent || '').replace(/[,$%\s]/g, '').replace(/[–—]/g, '');
    if (s === '' || s === '-') return -Infinity;
    var n = parseFloat(s);
    return isNaN(n) ? (td.textContent || '').trim() : n;
  }

  cutline();
  localTimes();
  sortable();
  applyMe(read());
})();
