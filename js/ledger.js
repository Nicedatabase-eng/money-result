/**
 * Page 1 — Daily Ledger
 *
 * สูตรหลัก:
 *   totalBuyIn(i) = buyIn เริ่มต้น + ผลรวมที่เติมระหว่างเกม
 *   net(i)        = เงินคงเหลือท้ายสุด − totalBuyIn(i) + ค่าปรับเกลี่ย
 *   บันทึกได้เมื่อ Σ net(i) === 0 เท่านั้น
 */
(function (MR) {
  'use strict';

  var CFG = window.APP_CONFIG;
  var LS_DRAFT = 'mr.draft';
  var LS_RECON_OPEN = 'mr.reconOpen';

  var state = {
    date: MR.todayISO(),
    buyIn: CFG.DEFAULT_BUY_IN,
    players: [],          // รายชื่อทั้งหมดจาก DB [{id, name}]
    rows: [],             // ผู้เข้าร่วมของวันนี้
    locked: false,        // ยืนยันผู้เข้าร่วมแล้ว — ซ่อนรายชื่อทั้งหมด กันเผลอกดเอาคนออก
    serverSession: null   // ข้อมูลเดิมของวันที่เลือก (ถ้ามี)
  };

  var playersLoaded = false;   // ได้รายชื่อมาแล้ว (จาก cache หรือ server)

  /* ============================ helpers ============================ */

  function newRow(name) {
    return { name: name, rebuys: [], cashOut: 0, adjust: 0, inRecon: false };
  }

  function rebuyTotal(row) {
    return MR.round2(row.rebuys.reduce(function (s, r) { return s + r.unit * r.count; }, 0));
  }

  function totalBuyIn(row) { return MR.round2(state.buyIn + rebuyTotal(row)); }

  /** สุทธิก่อนเกลี่ย — ใช้ตัดสินว่าใคร "ได้" หรือ "เสีย" จริง */
  function baseNet(row) { return MR.round2(MR.num(row.cashOut) - totalBuyIn(row)); }

  function netOf(row) {
    return MR.round2(MR.num(row.cashOut) - totalBuyIn(row) + MR.num(row.adjust));
  }

  function totalNet() {
    return MR.round2(state.rows.reduce(function (s, r) { return s + netOf(r); }, 0));
  }

  function indexOfPlayer(name) {
    for (var i = 0; i < state.rows.length; i++) if (state.rows[i].name === name) return i;
    return -1;
  }

  /** มีตัวเลขที่กรอกไว้แล้วหรือยัง — ถ้ามี การเอาออกต้องยืนยันก่อน */
  function hasEntries(row) {
    return row.rebuys.length > 0 || MR.num(row.cashOut) !== 0 || MR.num(row.adjust) !== 0;
  }

  /** เรียงตามลำดับรายชื่อหลัก เพื่อให้การปัดเศษ "คนแรก ๆ" คงที่ ไม่ขึ้นกับลำดับที่กด */
  function sortRows() {
    var order = state.players.map(function (p) { return p.name; });
    state.rows.sort(function (a, b) { return order.indexOf(a.name) - order.indexOf(b.name); });
  }

  /* ============================ draft (กันข้อมูลหายตอน refresh) ============================ */

  function saveDraft() {
    try {
      localStorage.setItem(LS_DRAFT, JSON.stringify({
        date: state.date, buyIn: state.buyIn, rows: state.rows, locked: state.locked
      }));
    } catch (e) { /* ignore */ }
  }

  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(LS_DRAFT) || 'null');
      if (!d || !Array.isArray(d.rows) || !d.rows.length) return null;
      return d;
    } catch (e) { return null; }
  }

  function clearDraft() {
    try { localStorage.removeItem(LS_DRAFT); } catch (e) { /* ignore */ }
  }

  /* ============================ เลือกผู้เข้าร่วม ============================ */

  function renderPicker() {
    var host = MR.el('#playerPicker');
    if (!state.rows.length) state.locked = false;
    var locked = state.locked;

    MR.el('#pickerTools').hidden = locked;
    MR.el('#editPlayersBtn').hidden = !locked;
    MR.el('#lockPlayersBtn').hidden = locked;
    MR.el('#lockPlayersBtn').disabled = !state.rows.length;
    MR.el('#pickerHint').innerHTML = locked
      ? 'แตะชื่อเพื่อไปที่การ์ดของคนนั้น'
      : 'เพิ่มชื่อใหม่ได้ที่หน้า <a href="dashboard.html" class="underline">สรุปผล</a>';

    // ---- ยืนยันแล้ว: เหลือแค่คนที่เข้าร่วม กดแล้วเลื่อนไปที่การ์ด ----
    if (locked) {
      host.innerHTML = state.rows.map(function (row, i) {
        return '<button type="button" class="chip chip-jump" data-jump="' + i + '">' +
               MR.escapeHtml(row.name) + '</button>';
      }).join('');
      MR.els('[data-jump]', host).forEach(function (btn) {
        btn.addEventListener('click', function () { jumpTo(parseInt(btn.getAttribute('data-jump'), 10)); });
      });
      return;
    }

    if (!playersLoaded) return;   // คงข้อความ "กำลังโหลดรายชื่อ…" ไว้
    if (!state.players.length) {
      host.innerHTML = '<span class="text-sm text-muted">ยังไม่มีรายชื่อผู้เล่น — ' +
        '<a href="dashboard.html" class="underline">เพิ่มที่หน้าสรุปผล</a></span>';
      return;
    }
    host.innerHTML = state.players.map(function (p) {
      var on = indexOfPlayer(p.name) >= 0;
      return '<button type="button" class="chip" aria-pressed="' + on + '" ' +
             'data-player="' + MR.escapeHtml(p.name) + '">' + MR.escapeHtml(p.name) + '</button>';
    }).join('');

    MR.els('[data-player]', host).forEach(function (btn) {
      btn.addEventListener('click', function () { togglePlayer(btn.getAttribute('data-player')); });
    });
  }

  async function togglePlayer(name) {
    var i = indexOfPlayer(name);
    if (i >= 0) {
      if (hasEntries(state.rows[i])) {
        var ok = await MR.confirm(
          'เอา "' + name + '" ออกจากวงนี้?\n\n' +
          'ยอดเติมเงินและเงินคงเหลือที่กรอกไว้ของคนนี้จะหายไปด้วย',
          { danger: true, okText: 'เอาออก' });
        if (!ok) return;
        i = indexOfPlayer(name);
        if (i < 0) return;
      }
      state.rows.splice(i, 1);
    } else {
      state.rows.push(newRow(name));
    }
    sortRows();
    renderPicker();
    renderRows();
    refresh();
  }

  function setLocked(locked) {
    state.locked = locked;
    renderPicker();
    saveDraft();
  }

  function jumpTo(i) {
    var card = MR.el('article[data-idx="' + i + '"]');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // กะพริบกรอบให้รู้ว่ามาถึงการ์ดไหน (ลบคลาสก่อนเพื่อให้กดซ้ำแล้วเล่นใหม่ได้)
    card.classList.remove('card-flash');
    void card.offsetWidth;
    card.classList.add('card-flash');
  }

  /* ============================ การ์ดผู้เล่น ============================ */

  function renderRows() {
    var wrap = MR.el('#rowsWrap');
    MR.el('#emptyHint').hidden = state.rows.length > 0;
    MR.el('#selectedCount').textContent = state.rows.length;

    wrap.innerHTML = state.rows.map(function (row, i) {
      var safeName = MR.escapeHtml(row.name);
      var mult = CFG.MULTIPLIERS.map(function (m) {
        return '<button type="button" class="btn btn-add" data-add="' + m + '">+' + MR.fmt(m) + '</button>';
      }).join('');

      return '' +
      '<article class="card player-card" data-idx="' + i + '">' +
        '<div class="flex items-start justify-between gap-3">' +
          '<div class="min-w-0">' +
            '<h3 class="font-semibold truncate">' + safeName + '</h3>' +
            '<p class="text-xs text-muted mt-0.5 num" data-buyinfo></p>' +
          '</div>' +
          '<div class="text-right shrink-0">' +
            '<div class="text-[11px] text-muted">สุทธิ</div>' +
            '<div class="text-xl font-semibold num" data-net>0</div>' +
            '<div class="text-[11px] num" data-adjnote hidden></div>' +
          '</div>' +
        '</div>' +

        '<div class="grid gap-2 mt-3" style="grid-template-columns:repeat(auto-fit,minmax(88px,1fr))" ' +
             'role="group" aria-label="เติมเงินระหว่างเกมของ ' + safeName + '">' +
          mult +
        '</div>' +
        '<div class="flex flex-wrap gap-1.5 mt-2" data-chips hidden></div>' +

        '<div class="mt-3 pt-3 border-t border-line flex items-center gap-3">' +
          '<label class="text-xs text-muted shrink-0" for="cash-' + i + '">เงินคงเหลือ<br>ท้ายสุด</label>' +
          '<input id="cash-' + i + '" class="field field-lg num flex-1" data-cashout type="text" ' +
                 'inputmode="decimal" placeholder="0" value="' +
                 (row.cashOut ? MR.round2(row.cashOut) : '') + '">' +
        '</div>' +
      '</article>';
    }).join('');

    MR.els('article[data-idx]', wrap).forEach(bindRow);
    renderReconList();
    state.rows.forEach(function (_, i) { renderChips(i); });
  }

  function bindRow(card) {
    var i = parseInt(card.getAttribute('data-idx'), 10);

    MR.els('[data-add]', card).forEach(function (btn) {
      btn.addEventListener('click', function () {
        addRebuy(i, MR.num(btn.getAttribute('data-add')));
      });
    });

    MR.el('[data-cashout]', card).addEventListener('input', function () {
      state.rows[i].cashOut = MR.num(this.value);
      refresh();
    });
  }

  function addRebuy(i, unit) {
    state.rows[i].rebuys.push({ unit: unit, count: 1 });
    renderChips(i);
    refresh();
  }

  function removeRebuy(i, k) {
    state.rows[i].rebuys.splice(k, 1);
    renderChips(i);
    refresh();
  }

  function renderChips(i) {
    var card = MR.el('article[data-idx="' + i + '"]');
    if (!card) return;
    var host = MR.el('[data-chips]', card);
    var row = state.rows[i];

    host.hidden = !row.rebuys.length;
    // count > 1 มาจากร่างที่บันทึกไว้ตอนยังมีตัวนับจำนวนครั้ง
    host.innerHTML = row.rebuys.map(function (r, k) {
      var label = r.count > 1 ? MR.fmt(r.unit) + '×' + r.count : MR.fmt(r.unit);
      return '<span class="rebuy-chip">+' + label +
             '<button type="button" data-del="' + k + '" aria-label="ลบรายการเติม">×</button></span>';
    }).join('');

    MR.els('[data-del]', host).forEach(function (b) {
      b.addEventListener('click', function () { removeRebuy(i, parseInt(b.getAttribute('data-del'), 10)); });
    });
  }

  /* ============================ เกลี่ยยอด ============================ */

  function renderReconList() {
    var host = MR.el('#reconList');
    host.innerHTML = state.rows.map(function (row, i) {
      var safeName = MR.escapeHtml(row.name);
      return '' +
      '<div class="recon-row flex items-center gap-2" data-recon="' + i + '">' +
        // ห่อ checkbox กับชื่อไว้ใน label เดียวกัน เพื่อให้พื้นที่กดใหญ่พอสำหรับนิ้ว
        '<label class="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer" style="min-height:44px">' +
          '<input type="checkbox" class="w-5 h-5 shrink-0 accent-[var(--accent)]" data-check ' +
                 (row.inRecon ? 'checked' : '') + '>' +
          '<span class="min-w-0">' +
            '<span class="block truncate text-sm">' + safeName + '</span>' +
            '<span class="block text-[11px] font-semibold" data-remark hidden></span>' +
          '</span>' +
        '</label>' +
        '<span class="text-xs text-muted num shrink-0" data-base title="สุทธิก่อนเกลี่ย"></span>' +
        // คีย์แพดตัวเลขของ iOS ไม่มีปุ่มลบ จึงต้องมีปุ่มสลับเครื่องหมายให้
        '<button type="button" class="btn btn-sm shrink-0 !px-2.5" data-sign ' +
                'aria-label="สลับเครื่องหมายบวก/ลบของ ' + safeName + '">±</button>' +
        '<input class="field field-inline num !w-20 text-right shrink-0" data-adj type="text" ' +
               'inputmode="decimal" placeholder="0" value="' +
               (row.adjust ? MR.round2(row.adjust) : '') + '" aria-label="ค่าปรับของ ' + safeName + '">' +
      '</div>';
    }).join('');

    MR.els('[data-recon]', host).forEach(function (el) {
      var i = parseInt(el.getAttribute('data-recon'), 10);
      var adjInput = MR.el('[data-adj]', el);

      MR.el('[data-check]', el).addEventListener('change', function () {
        state.rows[i].inRecon = this.checked;
        saveDraft();
      });

      MR.el('[data-sign]', el).addEventListener('click', function () {
        var v = MR.round2(-MR.num(adjInput.value));
        state.rows[i].adjust = v;
        adjInput.value = v ? v : '';
        refresh();
      });

      adjInput.addEventListener('input', function () {
        state.rows[i].adjust = MR.num(this.value);
        refresh();
      });
    });
  }

  /**
   * คนที่ควรถูกเกลี่ยมากที่สุด (อิงสุทธิก่อนเกลี่ย)
   *   ยอดรวมติดลบ → คนที่ติดลบมากสุด (ควรบวกเพิ่ม)
   *   ยอดรวมเป็นบวก → คนที่บวกมากสุด (ควรหักออก)
   * @returns {number} index ใน state.rows หรือ -1
   */
  function remarkIndex(diff) {
    var pick = -1, pickVal = 0;
    state.rows.forEach(function (row, i) {
      var b = baseNet(row);
      if (diff < 0 ? b < pickVal : diff > 0 ? b > pickVal : false) { pick = i; pickVal = b; }
    });
    return pick;
  }

  /** เกลี่ยส่วนต่างให้คนที่ติ๊กเลือกไว้ */
  function autoReconcile() {
    var selected = [];
    state.rows.forEach(function (r, i) { if (r.inRecon) selected.push(i); });

    if (!selected.length) { MR.toast('ติ๊กเลือกคนที่จะนำมาเกลี่ยก่อน', 'warn'); return; }

    // ล้างค่าเกลี่ยเดิมของคนที่ถูกเลือก แล้วค่อยคำนวณใหม่ (กันการบวกทับซ้ำ)
    selected.forEach(function (i) { state.rows[i].adjust = 0; });

    var diff = totalNet();
    if (diff === 0) { MR.toast('ยอดลงตัวอยู่แล้ว ไม่ต้องเกลี่ย', 'info'); syncAdjustInputs(); refresh(); return; }

    // diff เป็นบวก → ต้องหักออก (ส่ง -diff เข้าไปกระจาย)
    var parts = MR.splitAdjustment(-diff, selected.length);
    selected.forEach(function (rowIdx, k) { state.rows[rowIdx].adjust = parts[k]; });

    syncAdjustInputs();
    refresh();
    MR.toast('เกลี่ยยอดให้ ' + selected.length + ' คนแล้ว', 'success');
  }

  /**
   * ปุ่ม "แนะนำ" — เกลี่ยให้ทั้งกลุ่มที่อยู่ฝั่งเดียวกับส่วนต่าง แบ่งเท่า ๆ กัน
   *   ยอดรวมติดลบ → บวกเพิ่มให้ทุกคนที่ติดลบ
   *   ยอดรวมเป็นบวก → หักออกจากทุกคนที่เป็นบวก
   * เริ่มจากล้างค่าเกลี่ยทุกคนก่อน เพื่อให้คิดจากยอดจริง ไม่ให้ค่าที่ปรับไว้เดิมมาบิดผล
   */
  function recommend() {
    if (state.rows.length < 2) { MR.toast('ต้องมีผู้เล่นอย่างน้อย 2 คน', 'warn'); return; }

    state.rows.forEach(function (r) { r.adjust = 0; r.inRecon = false; });
    var diff = totalNet();

    var group = [];
    if (diff !== 0) {
      state.rows.forEach(function (r, i) {
        var b = baseNet(r);
        if (diff < 0 ? b < 0 : b > 0) group.push(i);
      });
      // Σ base = diff จึงมีคนฝั่งเดียวกับ diff อย่างน้อย 1 คนเสมอ
      var parts = MR.splitAdjustment(-diff, group.length);
      group.forEach(function (rowIdx, k) {
        state.rows[rowIdx].inRecon = true;
        state.rows[rowIdx].adjust = parts[k];
      });
    }

    renderReconList();
    refresh();

    if (diff === 0) MR.toast('ยอดลงตัวอยู่แล้ว ไม่ต้องเกลี่ย', 'info');
    else MR.toast((diff < 0 ? 'บวกเพิ่มให้คนที่ติดลบ ' : 'หักออกจากคนที่เป็นบวก ') +
                  group.length + ' คน คนละเท่า ๆ กัน', 'success');
  }

  function syncAdjustInputs() {
    MR.els('#reconList [data-recon]').forEach(function (el) {
      var i = parseInt(el.getAttribute('data-recon'), 10);
      var v = state.rows[i].adjust;
      MR.el('[data-adj]', el).value = v ? MR.round2(v) : '';
    });
  }

  function clearAdjustments() {
    state.rows.forEach(function (r) { r.adjust = 0; });
    syncAdjustInputs();
    refresh();
  }

  function setReconOpen(open) {
    MR.el('#reconBody').hidden = !open;
    MR.el('#reconToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    try { localStorage.setItem(LS_RECON_OPEN, open ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  function reconOpenPref() {
    try { return localStorage.getItem(LS_RECON_OPEN) === '1'; } catch (e) { return false; }
  }

  /** วัดความสูงแถบล่างจริง แล้วเว้นท้ายหน้า/ยก toast ให้พ้น (แถบขยาย-พับได้ ความสูงจึงไม่คงที่) */
  function trackBottomBar() {
    var bar = MR.el('.sticky-bar');
    if (!bar) return;
    function update() {
      var h = Math.max(0, window.innerHeight - bar.getBoundingClientRect().top);
      document.documentElement.style.setProperty('--bar-h', Math.ceil(h) + 'px');
    }
    update();
    if (window.ResizeObserver) new ResizeObserver(update).observe(bar);
    window.addEventListener('resize', update);
  }

  /* ============================ อัปเดตค่าที่คำนวณได้ ============================ */

  function refresh() {
    var sumBuyIn = 0, sumCashOut = 0;
    var diff = totalNet();
    var remark = remarkIndex(diff);

    state.rows.forEach(function (row, i) {
      var tb = totalBuyIn(row);
      var net = netOf(row);
      sumBuyIn += tb;
      sumCashOut += MR.num(row.cashOut);

      var card = MR.el('article[data-idx="' + i + '"]');
      if (card) {
        var rb = rebuyTotal(row);
        MR.el('[data-buyinfo]', card).textContent =
          'Buy In ' + MR.fmt(state.buyIn) + (rb ? ' + เติม ' + MR.fmt(rb) : '') + ' = ' + MR.fmt(tb);

        var netEl = MR.el('[data-net]', card);
        netEl.textContent = MR.signed(net);
        netEl.style.color = net > 0 ? 'var(--pos-text)' : net < 0 ? 'var(--neg-text)' : 'var(--ink-2)';

        var note = MR.el('[data-adjnote]', card);
        var hasAdj = MR.round2(row.adjust) !== 0;
        note.hidden = !hasAdj;
        if (hasAdj) {
          note.textContent = 'รวมค่าเกลี่ย ' + MR.signed(row.adjust);
          note.style.color = 'var(--muted)';
        }
      }

      var reconRow = MR.el('#reconList [data-recon="' + i + '"]');
      if (reconRow) {
        MR.el('[data-base]', reconRow).textContent = MR.signed(baseNet(row));

        var remarkEl = MR.el('[data-remark]', reconRow);
        var marked = i === remark;
        reconRow.setAttribute('data-remarked', marked ? 'true' : 'false');
        remarkEl.hidden = !marked;
        if (marked) {
          remarkEl.textContent = diff < 0 ? '▲ ควรบวกคนนี้' : '▼ ควรหักคนนี้';
          remarkEl.style.color = diff < 0 ? 'var(--pos-text)' : 'var(--neg-text)';
        }
      }
    });

    MR.el('#sumBuyIn').textContent = MR.fmt(sumBuyIn);
    MR.el('#sumCashOut').textContent = MR.fmt(sumCashOut);

    var diffEl = MR.el('#sumDiff');
    diffEl.textContent = MR.signed(diff);
    diffEl.style.color = diff === 0 ? 'var(--good-text)' : 'var(--neg-text)';

    // ---- แถบสถานะ + ปุ่มบันทึก ----
    var pill = MR.el('#statusPill');
    var saveBtn = MR.el('#saveBtn');
    var enoughPlayers = state.rows.length >= 2;

    if (state.serverSession) {
      // วันนี้บันทึกไปแล้ว — ล็อกไว้ก่อนเงื่อนไขอื่นทั้งหมด
      pill.textContent = '🔒 วันที่นี้บันทึกไปแล้ว — เลือกวันอื่น';
      pill.style.background = 'var(--warn-wash)';
      pill.style.color = 'var(--warn-text)';
      saveBtn.disabled = true;
    } else if (!enoughPlayers) {
      pill.textContent = 'เลือกผู้เข้าร่วมอย่างน้อย 2 คน';
      pill.style.background = 'var(--warn-wash)';
      pill.style.color = 'var(--warn-text)';
      saveBtn.disabled = true;
    } else if (diff !== 0) {
      pill.textContent = 'ยอดยังไม่ลงตัว — ต่างอยู่ ' + MR.signed(diff);
      pill.style.background = 'var(--neg-wash)';
      pill.style.color = 'var(--neg-text)';
      saveBtn.disabled = true;
    } else {
      pill.textContent = '✓ ยอดลงตัว พร้อมบันทึก';
      pill.style.background = 'var(--pos-wash)';
      pill.style.color = 'var(--pos-text)';
      saveBtn.disabled = false;
    }

    // ---- แผงเกลี่ยยอด (แสดงตลอดเมื่อมีผู้เข้าร่วม) ----
    MR.el('#reconSection').hidden = !state.rows.length;

    var summary = MR.el('#reconSummary');
    var info = MR.el('#reconInfo');
    if (diff === 0) {
      summary.textContent = '✓ ลงตัวแล้ว';
      summary.style.color = 'var(--pos-text)';
      info.textContent = 'ยอดรวมสุทธิเป็น 0 แล้ว — ติ๊กเลือกคนแล้วแก้ตัวเลขเองได้ทุกช่อง';
    } else {
      var who = remark >= 0 ? ' · ' + (diff < 0 ? 'ควรบวก ' : 'ควรหัก ') + state.rows[remark].name : '';
      summary.textContent = 'ต่าง ' + MR.signed(diff) + who;
      summary.style.color = 'var(--neg-text)';
      info.textContent = 'ยอดรวม ' + MR.signed(diff) + ' → ต้องกระจาย ' + MR.signed(-diff) +
        (diff > 0 ? ' (หักเงินคนที่เลือกออก)' : ' (เพิ่มเงินให้คนที่เลือก)') +
        ' · แบ่งเท่า ๆ กัน เศษไปคนแรก ๆ';
    }

    MR.el('#saveLabel').textContent = 'บันทึก';
    saveDraft();
  }

  /* ============================ โหลด / บันทึก ============================ */

  async function loadPlayers() {
    var cached = MR.API.cachedPlayers();
    if (cached) { state.players = cached; playersLoaded = true; renderPicker(); }
    try {
      state.players = await MR.API.getPlayers();
      playersLoaded = true;
      renderPicker();
    } catch (err) {
      if (!cached) MR.el('#playerPicker').innerHTML =
        '<span class="text-sm text-neg-text">โหลดรายชื่อไม่สำเร็จ: ' + MR.escapeHtml(err.message) + '</span>';
      else MR.toast('โหลดรายชื่อล่าสุดไม่สำเร็จ ใช้ข้อมูลที่เก็บไว้แทน', 'warn');
    }
  }

  /**
   * ตรวจว่าวันที่เลือกมีข้อมูลอยู่แล้วหรือไม่
   * ถ้ามี = ล็อกไม่ให้บันทึกซ้ำ (ข้อมูลที่บันทึกแล้วเขียนทับไม่ได้)
   */
  async function checkExistingSession() {
    state.serverSession = null;
    MR.el('#editBanner').hidden = true;
    try {
      var session = await MR.API.getSession(state.date);
      state.serverSession = session || null;
      MR.el('#editBanner').hidden = !session;
    } catch (err) {
      // อ่านไม่ได้ก็ให้กรอกต่อได้ — server เป็นด่านตัดสินอยู่แล้ว
    }
    refresh();
  }

  async function save() {
    var diff = totalNet();
    if (diff !== 0) { MR.toast('ยอดรวมสุทธิต้องเท่ากับ 0', 'error'); return; }
    if (state.rows.length < 2) { MR.toast('ต้องมีผู้เล่นอย่างน้อย 2 คน', 'error'); return; }

    if (state.serverSession) {
      MR.toast('วันที่ ' + MR.dateLabel(state.date) + ' บันทึกไปแล้ว — บันทึกซ้ำไม่ได้', 'error');
      return;
    }

    var confirmed = await MR.confirm(
      'บันทึกวันที่ ' + MR.dateLabel(state.date) + ' จำนวน ' + state.rows.length + ' คน\n\n' +
      'เมื่อบันทึกแล้วจะแก้หรือลบผ่านแอปไม่ได้อีก ตรวจตัวเลขให้ครบก่อนกดยืนยัน',
      { okText: 'ยืนยันบันทึก' });
    if (!confirmed) return;

    var btn = MR.el('#saveBtn');
    var label = MR.el('#saveLabel');
    var original = label.textContent;
    btn.disabled = true;
    label.textContent = 'กำลังบันทึก…';

    try {
      var res = await MR.API.saveSession({
        date: state.date,
        sessionId: state.serverSession ? state.serverSession.sessionId : '',
        rows: state.rows.map(function (r) {
          return {
            player: r.name,
            buyIn: state.buyIn,
            rebuy: rebuyTotal(r),
            cashOut: MR.num(r.cashOut),
            adjust: MR.num(r.adjust),
            net: netOf(r)
          };
        })
      });

      clearDraft();
      MR.toast('บันทึก ' + res.saved + ' รายการเรียบร้อย ✓', 'success');
      state.serverSession = { sessionId: res.sessionId, date: res.date, rows: [] };
      MR.el('#editBanner').hidden = false;

      var goto = await MR.confirm('บันทึกสำเร็จ — ไปดูหน้าสรุปผลเลยไหม?',
        { okText: 'ไปหน้าสรุปผล', cancelText: 'อยู่หน้านี้' });
      if (goto) location.href = 'dashboard.html';
    } catch (err) {
      MR.toast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
    } finally {
      label.textContent = original;
      refresh();
    }
  }

  /* ============================ init ============================ */

  function init() {
    MR.initShell();

    var dateInput = MR.el('#dateInput');
    var buyInInput = MR.el('#buyInInput');

    // กู้ร่างที่ค้างไว้
    var draft = loadDraft();
    if (draft) {
      state.date = draft.date || state.date;
      state.buyIn = MR.num(draft.buyIn) || CFG.DEFAULT_BUY_IN;
      state.locked = !!draft.locked;
      state.rows = draft.rows.map(function (r) {
        var row = newRow(r.name);
        row.rebuys = Array.isArray(r.rebuys) ? r.rebuys : [];
        row.cashOut = MR.num(r.cashOut);
        row.adjust = MR.num(r.adjust);
        row.inRecon = !!r.inRecon;
        return row;
      });
    }

    dateInput.value = state.date;
    buyInInput.value = state.buyIn;

    dateInput.addEventListener('change', function () {
      state.date = this.value || MR.todayISO();
      checkExistingSession();
      saveDraft();
    });

    buyInInput.addEventListener('input', function () {
      state.buyIn = MR.num(this.value);
      refresh();
    });

    MR.el('#selectAllBtn').addEventListener('click', function () {
      state.players.forEach(function (p) {
        if (indexOfPlayer(p.name) < 0) state.rows.push(newRow(p.name));
      });
      sortRows();
      renderPicker(); renderRows(); refresh();
    });

    MR.el('#clearAllBtn').addEventListener('click', async function () {
      if (!state.rows.length) return;
      var ok = await MR.confirm('ล้างผู้เข้าร่วมและยอดที่กรอกไว้ทั้งหมด?', { danger: true, okText: 'ล้าง' });
      if (!ok) return;
      state.rows = [];
      state.locked = false;
      clearDraft();
      renderPicker(); renderRows(); refresh();
    });

    MR.el('#lockPlayersBtn').addEventListener('click', function () { setLocked(true); });
    MR.el('#editPlayersBtn').addEventListener('click', function () { setLocked(false); });

    MR.el('#reconToggle').addEventListener('click', function () {
      setReconOpen(MR.el('#reconBody').hidden);
    });
    MR.el('#reconSelectAll').addEventListener('click', function () {
      var allOn = state.rows.every(function (r) { return r.inRecon; });
      state.rows.forEach(function (r) { r.inRecon = !allOn; });
      MR.els('#reconList [data-check]').forEach(function (c) { c.checked = !allOn; });
      saveDraft();
    });

    MR.el('#reconRecommend').addEventListener('click', recommend);
    MR.el('#reconAuto').addEventListener('click', autoReconcile);
    MR.el('#reconClear').addEventListener('click', clearAdjustments);
    MR.el('#saveBtn').addEventListener('click', save);

    setReconOpen(reconOpenPref());
    trackBottomBar();
    renderPicker();
    renderRows();
    refresh();

    if (MR.API.isConfigured()) {
      loadPlayers().then(function () {
        renderPicker();
        checkExistingSession();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  // เปิดให้เรียกจาก console เวลาทดสอบ
  MR._ledger = state;

})(window.MR);
