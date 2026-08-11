/**
 * Demo mode — เปิดด้วยการต่อท้าย URL ด้วย ?demo=1
 *
 * แทนที่ MR.API ด้วยข้อมูลจำลองในหน่วยความจำ ทำให้ลองใช้ทุกฟีเจอร์ได้
 * โดยยังไม่ต้องตั้งค่า Google Sheets (ข้อมูลจะหายเมื่อปิดหน้า)
 */
(function (MR) {
  'use strict';

  if (!/[?&]demo=1/.test(location.search)) return;

  var players = ['เอก', 'บอส', 'ซี', 'ดิว', 'เอิร์ธ', 'ฟาง'].map(function (n, i) {
    return { id: 'P' + (i + 1), name: n };
  });

  // สร้างประวัติย้อนหลัง 3 เดือน แบบ zero-sum ทุกวง
  var records = [];
  var seed = 7;
  function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }

  var today = new Date();
  for (var d = 0; d < 24; d++) {
    var day = new Date(today.getTime() - d * 4 * 86400000);
    var date = MR.todayISO(day);
    var joining = players.filter(function () { return rnd() > 0.25; });
    if (joining.length < 3) joining = players.slice(0, 4);

    var nets = joining.map(function () { return Math.round((rnd() * 2400 - 1200) / 20) * 20; });
    var drift = nets.reduce(function (a, b) { return a + b; }, 0);
    nets[0] -= drift;                                   // บังคับให้รวมเป็น 0

    var sid = 'DEMO-' + date;
    joining.forEach(function (p, i) {
      var rebuy = rnd() > 0.6 ? Math.round(rnd() * 3) * 200 : 0;
      records.push({
        sessionId: sid, date: date, player: p.name,
        buyIn: 500, rebuy: rebuy, totalBuyIn: 500 + rebuy,
        cashOut: 500 + rebuy + nets[i], adjust: 0, net: nets[i]
      });
    });
  }

  function delay(value, ms) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(value); }, ms || 220); });
  }

  MR.API = {
    getUrl: function () { return 'demo://in-memory'; },
    setUrl: function () {},
    isConfigured: function () { return true; },

    ping: function () { return delay({ pong: true, demo: true }); },
    cachedPlayers: function () { return players.slice(); },
    getPlayers: function () { return delay(players.slice()); },

    addPlayer: function (name) {
      var n = String(name).trim();
      if (players.some(function (p) { return p.name.toLowerCase() === n.toLowerCase(); })) {
        return Promise.reject(new Error('มีชื่อ "' + n + '" อยู่แล้ว'));
      }
      var p = { id: 'P' + (players.length + 1) + '-' + Date.now(), name: n };
      players.push(p);
      return delay({ id: p.id, name: p.name });
    },

    renamePlayer: function (id, name) {
      var p = players.filter(function (x) { return x.id === id; })[0];
      if (!p) return Promise.reject(new Error('ไม่พบผู้เล่น'));
      records.forEach(function (r) { if (r.player === p.name) r.player = name; });
      p.name = name;
      return delay({ id: id, name: name });
    },

    deletePlayer: function (id) {
      players = players.filter(function (p) { return p.id !== id; });
      return delay({ id: id });
    },

    bootstrap: function () {
      return delay({ players: players.slice(), records: records.slice() }, 400);
    },
    getRecords: function () { return delay(records.slice()); },

    getSession: function (date) {
      var rows = records.filter(function (r) { return r.date === date; });
      if (!rows.length) return delay(null);
      return delay({
        sessionId: rows[0].sessionId, date: date, buyIn: rows[0].buyIn,
        rows: rows.map(function (r) {
          return { player: r.player, buyIn: r.buyIn, rebuy: r.rebuy,
                   cashOut: r.cashOut, adjust: r.adjust, net: r.net };
        })
      });
    },

    saveSession: function (session) {
      var total = session.rows.reduce(function (s, r) { return s + MR.num(r.net); }, 0);
      if (MR.round2(total) !== 0) {
        return Promise.reject(new Error('ยอดสุทธิรวมต้องเท่ากับ 0 (ตอนนี้ ' + MR.round2(total) + ')'));
      }
      records = records.filter(function (r) { return r.date !== session.date; });
      var sid = session.sessionId || 'DEMO-' + session.date;
      session.rows.forEach(function (r) {
        records.push({
          sessionId: sid, date: session.date, player: r.player,
          buyIn: MR.num(r.buyIn), rebuy: MR.num(r.rebuy),
          totalBuyIn: MR.round2(MR.num(r.buyIn) + MR.num(r.rebuy)),
          cashOut: MR.num(r.cashOut), adjust: MR.num(r.adjust), net: MR.num(r.net)
        });
      });
      return delay({ sessionId: sid, date: session.date, saved: session.rows.length, replaced: 0 });
    },

    deleteSession: function (date) {
      var before = records.length;
      records = records.filter(function (r) { return r.date !== date; });
      return delay({ removed: before - records.length, date: date });
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:90;' +
      'background:var(--warn);color:#0b0b0b;text-align:center;font-size:12px;' +
      'font-weight:600;padding:4px 8px';
    bar.textContent = '🧪 โหมดทดลอง — ข้อมูลเป็นของจำลอง ไม่ได้บันทึกลง Google Sheets ' +
                      '(เอา ?demo=1 ออกจาก URL เพื่อใช้งานจริง)';
    document.body.appendChild(bar);

    // ดันแถบสรุปของหน้าบันทึกยอดขึ้นมาไม่ให้ทับกัน
    var sticky = document.querySelector('.sticky-bar');
    if (sticky) sticky.style.bottom = '24px';
  });

})(window.MR);
