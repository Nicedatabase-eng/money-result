/**
 * Page 2 — Dashboard & Player Management
 */
(function (MR) {
  'use strict';

  var state = {
    players: [],
    records: [],        // ทุกแถวจาก Sheet
    months: [],         // ['2026-08', ...] เรียงใหม่ไปเก่า
    selected: null      // Set ของเดือนที่เลือก; null = ทั้งหมด
  };

  /* ============================ การรวมข้อมูล ============================ */

  function visibleRecords() {
    if (!state.selected || !state.selected.size) return state.records;
    var sel = state.selected;
    return state.records.filter(function (r) { return sel.has(MR.monthKey(r.date)); });
  }

  function aggregate(records) {
    var map = {};
    records.forEach(function (r) {
      var p = map[r.player];
      if (!p) {
        p = map[r.player] = {
          name: r.player, sessions: 0, net: 0, wins: 0, losses: 0,
          best: null, worst: null
        };
      }
      p.sessions++;
      p.net += r.net;
      if (r.net > 0) p.wins++;
      else if (r.net < 0) p.losses++;
      if (p.best === null || r.net > p.best) p.best = r.net;
      if (p.worst === null || r.net < p.worst) p.worst = r.net;
    });

    return Object.keys(map).map(function (k) {
      var p = map[k];
      p.net = MR.round2(p.net);
      p.avg = MR.round2(p.net / p.sessions);
      return p;
    }).sort(function (a, b) { return b.net - a.net; });
  }

  function groupSessions(records) {
    var map = {};
    records.forEach(function (r) {
      (map[r.date] || (map[r.date] = [])).push(r);
    });
    return Object.keys(map).sort().reverse().map(function (date) {
      var rows = map[date].slice().sort(function (a, b) { return b.net - a.net; });
      return {
        date: date,
        rows: rows,
        pot: MR.round2(rows.reduce(function (s, r) { return s + r.totalBuyIn; }, 0))
      };
    });
  }

  /* ============================ ตัวกรองเดือน ============================ */

  function renderMonthPicker() {
    var host = MR.el('#monthPicker');
    if (!state.months.length) {
      host.innerHTML = '<span class="text-sm text-muted">ยังไม่มีข้อมูลการเล่น</span>';
      return;
    }
    host.innerHTML = state.months.map(function (m) {
      var on = !state.selected || state.selected.has(m);
      return '<button type="button" class="chip" aria-pressed="' + on + '" data-month="' + m + '">' +
             MR.monthLabel(m) + '</button>';
    }).join('');

    MR.els('[data-month]', host).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var m = btn.getAttribute('data-month');
        // ครั้งแรกที่กด: เปลี่ยนจาก "ทั้งหมด" เป็นเลือกเฉพาะเดือนนั้น
        if (!state.selected) state.selected = new Set([m]);
        else if (state.selected.has(m)) state.selected.delete(m);
        else state.selected.add(m);

        if (state.selected && state.selected.size === 0) state.selected = null;
        renderMonthPicker();
        renderAll();
      });
    });
  }

  /* ============================ Stat tiles ============================ */

  function renderStats(records, agg) {
    var dates = {};
    var volume = 0;
    records.forEach(function (r) {
      dates[r.date] = true;
      if (r.net > 0) volume += r.net;
    });

    MR.el('#statSessions').textContent = Object.keys(dates).length;
    MR.el('#statPlayers').textContent = agg.length;
    MR.el('#statVolume').textContent = CURRENCY + MR.fmt(volume);

    var leader = agg[0];
    MR.el('#statLeader').textContent = leader ? leader.name : '–';
    var netEl = MR.el('#statLeaderNet');
    if (leader) {
      netEl.textContent = MR.signed(leader.net);
      netEl.style.color = leader.net > 0 ? 'var(--pos-text)' : leader.net < 0 ? 'var(--neg-text)' : 'var(--ink-2)';
    } else {
      netEl.textContent = '–';
      netEl.style.color = 'var(--ink-2)';
    }
  }

  var CURRENCY = (window.APP_CONFIG && window.APP_CONFIG.CURRENCY) || '';

  /* ============================ กราฟแท่งแบบสองขั้ว ============================ */

  var RADIUS = 4;       // มุมโค้งเฉพาะฝั่งปลายแท่ง
  var PAD_TOP = 6;
  var PAD_BOTTOM = 10;

  /**
   * สัดส่วนของกราฟตามความกว้างจอ
   * บนมือถือต้องบีบช่องชื่อ/ช่องตัวเลขลง ไม่งั้นพื้นที่วาดแท่งจะแทบไม่เหลือ
   * และเพิ่มความสูงต่อแถวให้แตะด้วยนิ้วได้ง่ายขึ้น
   */
  function chartMetrics(W) {
    var narrow = W < 480;
    return {
      nameW:     narrow ? 66 : 92,
      // ต้องกว้างพอสำหรับ ระยะห่าง 8px + ป้ายยาวสุด 6 ตัวอักษร
      labelPad:  narrow ? 54 : 58,
      band:      narrow ? 34 : 30,
      bar:       narrow ? 22 : 20,   // ยังไม่เกิน 24 ตามสเปก
      nameChars: narrow ? 8 : 13,
      fontSize:  narrow ? 11 : 12
    };
  }

  /** สร้าง path สี่เหลี่ยมที่โค้งเฉพาะด้านปลาย (ฝั่งเส้นศูนย์เป็นมุมฉาก) */
  function barPath(xBase, xEnd, y, h, r) {
    var len = Math.abs(xEnd - xBase);
    if (len < 0.5) return '';
    var rr = Math.max(0, Math.min(r, len, h / 2));
    var dir = xEnd >= xBase ? 1 : -1;
    var tip = xEnd;
    var pre = xEnd - dir * rr;
    return 'M' + xBase + ',' + y +
           ' H' + pre +
           ' Q' + tip + ',' + y + ' ' + tip + ',' + (y + rr) +
           ' V' + (y + h - rr) +
           ' Q' + tip + ',' + (y + h) + ' ' + pre + ',' + (y + h) +
           ' H' + xBase + ' Z';
  }

  /**
   * สร้าง SVG จากข้อมูลล้วน ๆ (ไม่แตะ DOM) — แยกออกมาเพื่อให้ทดสอบเรขาคณิตได้
   * @param {Array} agg รายการผู้เล่นที่เรียงแล้ว
   * @param {number} W  ความกว้างที่จะวาด
   */
  function buildChartSVG(agg, W) {
    if (!agg.length) return '';
    var m = chartMetrics(W);
    var H = PAD_TOP + agg.length * m.band + PAD_BOTTOM;
    var plotX0 = m.nameW + m.labelPad;
    var plotX1 = W - m.labelPad;
    var plotW = Math.max(40, plotX1 - plotX0);

    var values = agg.map(function (p) { return p.net; });
    var dMin = Math.min(0, Math.min.apply(null, values));
    var dMax = Math.max(0, Math.max.apply(null, values));
    if (dMin === 0 && dMax === 0) { dMin = -1; dMax = 1; }
    var span = dMax - dMin || 1;

    var x = function (v) { return plotX0 + ((v - dMin) / span) * plotW; };
    var zeroX = x(0);

    var parts = [];

    // เส้นฐานที่ศูนย์ — hairline 1px สีจาง
    parts.push('<line x1="' + zeroX + '" y1="' + PAD_TOP + '" x2="' + zeroX + '" y2="' + (H - PAD_BOTTOM) +
               '" stroke="var(--axis)" stroke-width="1" />');

    agg.forEach(function (p, i) {
      var y = PAD_TOP + i * m.band;
      var barY = y + (m.band - m.bar) / 2;
      var midY = y + m.band / 2;
      var color = p.net >= 0 ? 'var(--pos)' : 'var(--neg)';
      var xEnd = x(p.net);

      // พื้นที่รับ hover/แตะ เต็มแถว — ใหญ่กว่าตัวแท่ง
      parts.push('<rect class="chart-hit" x="0" y="' + y + '" width="' + W + '" height="' + m.band +
                 '" data-i="' + i + '"></rect>');

      // ชื่อผู้เล่น (ใช้สีตัวอักษรปกติ ไม่ใช่สีของแท่ง)
      parts.push('<text x="' + (m.nameW - 8) + '" y="' + midY + '" text-anchor="end" ' +
                 'dominant-baseline="central" font-size="' + m.fontSize + '" fill="var(--ink-2)" ' +
                 'style="pointer-events:none">' + MR.escapeHtml(truncate(p.name, m.nameChars)) + '</text>');

      var d = barPath(zeroX, xEnd, barY, m.bar, RADIUS);
      if (d) {
        parts.push('<path class="chart-bar" d="' + d + '" fill="' + color +
                   '" style="pointer-events:none"></path>');
      } else {
        // ยอด 0 — ขีดสั้น ๆ ให้เห็นว่ามีแถวนี้อยู่
        parts.push('<rect x="' + (zeroX - 1) + '" y="' + barY + '" width="2" height="' + m.bar +
                   '" fill="var(--axis)" style="pointer-events:none"></rect>');
      }

      // ตัวเลขที่ปลายแท่ง
      var labelX = p.net >= 0 ? xEnd + 8 : xEnd - 8;
      var anchor = p.net >= 0 ? 'start' : 'end';
      parts.push('<text x="' + labelX + '" y="' + midY + '" text-anchor="' + anchor + '" ' +
                 'dominant-baseline="central" font-size="' + m.fontSize + '" font-weight="600" ' +
                 'fill="var(--ink)" style="pointer-events:none;font-variant-numeric:tabular-nums">' +
                 compactValue(p.net) + '</text>');
    });

    return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H +
      '" role="img" aria-label="ยอดสุทธิสะสมรายคน (ดูตัวเลขทั้งหมดได้ที่ตารางสรุปด้านล่าง)">' +
      parts.join('') + '</svg>';
  }

  function renderChart(agg) {
    var wrap = MR.el('#chartWrap');
    var sub = MR.el('#chartSubtitle');

    if (!agg.length) {
      wrap.innerHTML = '<p class="text-sm text-muted py-8 text-center">ไม่มีข้อมูลในช่วงที่เลือก</p>';
      sub.textContent = '–';
      return;
    }

    sub.textContent = 'เรียงจากมากไปน้อย · ' + agg.length + ' คน · หน่วยเป็นบาท';
    // ขั้นต่ำ 288 เพื่อให้พอดีจอ iPhone รุ่นเล็กโดยไม่ต้องเลื่อนแนวนอน
    wrap.innerHTML = buildChartSVG(agg, Math.max(288, wrap.clientWidth || 640));
    bindChartHover(wrap, agg);
  }

  function truncate(s, n) {
    return String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s);
  }

  /**
   * ย่อตัวเลขสำหรับป้ายที่ปลายแท่ง ให้ยาวไม่เกิน 6 ตัวอักษรเสมอ
   * (ช่องว่างที่กันไว้รับได้ ~6 ตัว — ถ้าไม่ย่อ ยอดหลักหมื่นขึ้นไปจะล้นไปทับชื่อ)
   * ค่าเต็มยังดูได้จาก tooltip และตารางสรุปด้านล่าง
   */
  function compactValue(v) {
    // ต้องปัดเป็นจำนวนเต็ม "ก่อน" เทียบเกณฑ์ ไม่งั้น 9,999.6 จะกลายเป็น "10,000" (7 ตัว)
    var n = Math.round(MR.round2(v));
    var abs = Math.abs(n);
    var sign = n < 0 ? '−' : (n > 0 ? '+' : '');

    function trim(x) {
      var s = x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10);
      return s.replace(/\.0$/, '');
    }

    if (abs >= 1e9) return sign + trim(abs / 1e9) + 'B';
    if (abs >= 1e6) return sign + trim(abs / 1e6) + 'M';
    if (abs >= 1e4) return sign + trim(abs / 1e3) + 'K';
    return MR.signed(n);   // กราฟไม่ต้องละเอียดถึงทศนิยม
  }

  // เก็บไว้ที่ระดับโมดูล เพื่อให้การวาดกราฟใหม่ไม่ทิ้งแท่งที่ค้างสถานะ active ไว้
  var tipActive = null;

  function hideTip() {
    var tip = MR.el('#chartTooltip');
    if (tip) tip.setAttribute('data-show', 'false');
    if (tipActive) { tipActive.removeAttribute('data-active'); tipActive = null; }
  }

  function bindChartHover(wrap, agg) {
    var tip = MR.el('#chartTooltip');

    function show(p, hit) {
      tip.innerHTML =
        '<div style="font-weight:600;margin-bottom:2px">' + MR.escapeHtml(p.name) + '</div>' +
        '<div style="color:var(--ink-2)">สุทธิ <b style="color:' +
          (p.net > 0 ? 'var(--pos-text)' : p.net < 0 ? 'var(--neg-text)' : 'var(--ink)') + '">' +
          MR.signed(p.net) + '</b></div>' +
        '<div style="color:var(--ink-2)">ลงเล่น ' + p.sessions + ' วัน · ได้ ' + p.wins +
          ' · เสีย ' + p.losses + '</div>' +
        '<div style="color:var(--muted)">เฉลี่ย ' + MR.signed(p.avg) + '/วัน</div>';
      tip.setAttribute('data-show', 'true');
      if (tipActive && tipActive !== hit) tipActive.removeAttribute('data-active');
      hit.setAttribute('data-active', 'true');
      tipActive = hit;
    }

    function place(clientX, clientY) {
      var r = tip.getBoundingClientRect();
      var left = Math.min(Math.max(8, clientX + 14), window.innerWidth - r.width - 8);
      var top = clientY - r.height - 14;
      if (top < 8) top = clientY + 22;      // ชนขอบบนแล้วพลิกลงล่าง
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }

    MR.els('.chart-hit', wrap).forEach(function (hit) {
      var p = agg[parseInt(hit.getAttribute('data-i'), 10)];

      // ---- เมาส์ ----
      hit.addEventListener('mouseenter', function () { show(p, hit); });
      hit.addEventListener('mousemove', function (e) { place(e.clientX, e.clientY); });
      hit.addEventListener('mouseleave', hideTip);

      // ---- นิ้ว (iPhone ไม่มี hover จึงต้องใช้การแตะแทน) ----
      hit.addEventListener('touchstart', function (e) {
        if (tipActive === hit) { hideTip(); return; }   // แตะซ้ำที่เดิม = ปิด
        var t = e.touches[0];
        show(p, hit);
        place(t.clientX, t.clientY);
      }, { passive: true });
    });

    // แตะที่อื่นหรือเลื่อนจอ แล้วให้ tooltip หายไป (ผูกครั้งเดียวพอ)
    if (!bindChartHover._global) {
      bindChartHover._global = true;
      document.addEventListener('touchstart', function (e) {
        var t = e.target;
        var isHit = t && t.getAttribute && t.getAttribute('class') === 'chart-hit';
        if (!isHit) hideTip();
      }, { passive: true });
      window.addEventListener('scroll', hideTip, { passive: true });
    }
  }

  /* ============================ ตารางสรุป ============================ */

  function renderTable(agg) {
    var body = MR.el('#summaryBody');
    if (!agg.length) {
      body.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-muted">ไม่มีข้อมูลในช่วงที่เลือก</td></tr>';
      return;
    }
    body.innerHTML = agg.map(function (p) {
      return '<tr class="border-b border-line last:border-0">' +
        '<td class="py-2 pr-3 font-medium">' + MR.escapeHtml(p.name) + '</td>' +
        '<td class="py-2 px-2 text-right num text-ink2">' + p.sessions + '</td>' +
        '<td class="py-2 px-2 text-right num text-ink2">' + p.wins + ' / ' + p.losses + '</td>' +
        '<td class="py-2 px-2 text-right num" style="color:' + netColor(p.avg) + '">' + MR.signed(p.avg) + '</td>' +
        '<td class="py-2 px-2 text-right num text-ink2">' + MR.signed(p.best) + '</td>' +
        '<td class="py-2 px-2 text-right num text-ink2">' + MR.signed(p.worst) + '</td>' +
        '<td class="py-2 pl-2 text-right num font-semibold" style="color:' + netColor(p.net) + '">' +
          MR.signed(p.net) + '</td>' +
      '</tr>';
    }).join('');
  }

  function netColor(n) {
    return n > 0 ? 'var(--pos-text)' : n < 0 ? 'var(--neg-text)' : 'var(--ink-2)';
  }

  /* ============================ ประวัติรายวัน ============================ */

  function renderSessions(records) {
    var host = MR.el('#sessionList');
    var sessions = groupSessions(records);

    if (!sessions.length) {
      host.innerHTML = '<p class="text-sm text-muted py-4 text-center">ไม่มีข้อมูลในช่วงที่เลือก</p>';
      return;
    }

    host.innerHTML = sessions.map(function (s) {
      var chips = s.rows.map(function (r) {
        return '<span class="text-xs num px-1.5 py-0.5 rounded" style="background:' +
               (r.net > 0 ? 'var(--pos-wash)' : r.net < 0 ? 'var(--neg-wash)' : 'transparent') +
               ';color:' + netColor(r.net) + '">' +
               MR.escapeHtml(r.player) + ' ' + MR.signed(r.net) + '</span>';
      }).join('');

      return '<div class="rounded-lg border border-line p-2.5">' +
        '<div class="flex items-baseline justify-between gap-2 mb-1.5">' +
          '<span class="text-sm font-semibold">' + MR.dateLabel(s.date) + '</span>' +
          '<span class="text-xs text-muted shrink-0">' + s.rows.length + ' คน · กองกลาง ' +
            MR.fmt(s.pot) + '</span>' +
        '</div>' +
        '<div class="flex flex-wrap gap-1">' + chips + '</div>' +
      '</div>';
    }).join('');
  }

  /* ============================ จัดการผู้เล่น ============================ */

  function renderPlayerAdmin() {
    var host = MR.el('#playerAdmin');
    if (!state.players.length) {
      host.innerHTML = '<p class="text-sm text-muted py-3 text-center">ยังไม่มีรายชื่อ — เพิ่มคนแรกได้เลย</p>';
      return;
    }

    var counts = {};
    state.records.forEach(function (r) { counts[r.player] = (counts[r.player] || 0) + 1; });

    host.innerHTML = state.players.map(function (p) {
      return '<div class="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5" ' +
                  'data-pid="' + MR.escapeHtml(p.id) + '">' +
        '<span class="flex-1 min-w-0 truncate text-sm">' + MR.escapeHtml(p.name) + '</span>' +
        '<span class="text-xs text-muted num shrink-0">' + (counts[p.name] || 0) + ' วัน</span>' +
        '<button class="btn btn-ghost btn-sm btn-danger shrink-0" data-remove title="เอาออกจากรายชื่อ">🗑</button>' +
      '</div>';
    }).join('');

    MR.els('[data-pid]', host).forEach(function (rowEl) {
      var id = rowEl.getAttribute('data-pid');
      var player = state.players.filter(function (p) { return p.id === id; })[0];
      if (!player) return;

      MR.el('[data-remove]', rowEl).addEventListener('click', async function () {
        var ok = await MR.confirm(
          'เอา "' + player.name + '" ออกจากรายชื่อที่เลือกได้?\n\n' +
          'ประวัติการเล่นที่บันทึกไว้ยังอยู่ครบและยังนับรวมในหน้าสรุปผลเหมือนเดิม',
          { danger: true, okText: 'เอาออก' });
        if (!ok) return;
        try {
          await MR.API.deletePlayer(id);
          state.players = state.players.filter(function (p) { return p.id !== id; });
          renderPlayerAdmin();
          MR.toast('เอา "' + player.name + '" ออกจากรายชื่อแล้ว', 'success');
        } catch (err) {
          MR.toast('เอาออกไม่สำเร็จ: ' + err.message, 'error');
        }
      });
    });
  }

  /* ============================ โหลดข้อมูล ============================ */

  function rebuildMonths() {
    var seen = {};
    state.records.forEach(function (r) {
      var m = MR.monthKey(r.date);
      if (m) seen[m] = true;
    });
    state.months = Object.keys(seen).sort().reverse();
    if (state.selected) {
      // ตัดเดือนที่ไม่มีข้อมูลแล้วออกจากตัวเลือก
      Array.from(state.selected).forEach(function (m) {
        if (!seen[m]) state.selected.delete(m);
      });
      if (!state.selected.size) state.selected = null;
    }
  }

  function renderAll() {
    var records = visibleRecords();
    var agg = aggregate(records);
    renderStats(records, agg);
    renderChart(agg);
    renderTable(agg);
    renderSessions(records);
    renderPlayerAdmin();
  }

  async function load(showToast) {
    var wrap = MR.el('#chartWrap');
    wrap.innerHTML = '<div class="flex items-center justify-center gap-2 py-10 text-sm text-muted">' +
                     '<span class="spinner"></span> กำลังโหลดข้อมูล…</div>';
    try {
      var data = await MR.API.bootstrap();
      state.players = data.players || [];
      state.records = data.records || [];
      rebuildMonths();
      renderMonthPicker();
      renderAll();
      if (showToast) MR.toast('โหลดข้อมูลล่าสุดแล้ว', 'success');
    } catch (err) {
      wrap.innerHTML = '<p class="text-sm py-8 text-center" style="color:var(--neg-text)">' +
        'โหลดข้อมูลไม่สำเร็จ: ' + MR.escapeHtml(err.message) + '</p>';
      MR.toast('โหลดข้อมูลไม่สำเร็จ: ' + err.message, 'error');
    }
  }

  /* ============================ init ============================ */

  function init() {
    MR.initShell();

    MR.el('#filterAll').addEventListener('click', function () {
      state.selected = null;
      renderMonthPicker();
      renderAll();
    });

    MR.el('#filterRecent').addEventListener('click', function () {
      state.selected = new Set(state.months.slice(0, 3));
      if (!state.selected.size) state.selected = null;
      renderMonthPicker();
      renderAll();
    });

    MR.el('#refreshBtn').addEventListener('click', function () { load(true); });

    MR.el('#addPlayerForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var input = MR.el('#newPlayerName');
      var name = input.value.trim();
      if (!name) return;

      var btn = this.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        var res = await MR.API.addPlayer(name);
        state.players.push({ id: res.id, name: res.name });
        state.players.sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
        input.value = '';
        renderPlayerAdmin();
        MR.toast('เพิ่ม "' + res.name + '" แล้ว — ใช้ได้ที่หน้าบันทึกยอดทันที', 'success');
      } catch (err) {
        MR.toast(err.message, 'error');
      } finally {
        btn.disabled = false;
        input.focus();
      }
    });

    // วาดกราฟใหม่เมื่อขนาดจอเปลี่ยน
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { renderChart(aggregate(visibleRecords())); }, 150);
    });

    if (MR.API.isConfigured()) load(false);
    else MR.el('#chartWrap').innerHTML =
      '<p class="text-sm text-muted py-8 text-center">ตั้งค่า API URL ก่อนเพื่อดูข้อมูล</p>';
  }

  document.addEventListener('DOMContentLoaded', init);

  // เปิดส่วนที่คำนวณล้วน ๆ ไว้ให้เทสต์เรียกใช้ได้
  MR._dashboard = {
    buildChartSVG: buildChartSVG,
    aggregate: aggregate,
    groupSessions: groupSessions,
    barPath: barPath,
    compactValue: compactValue,
    chartMetrics: chartMetrics
  };

})(window.MR);
