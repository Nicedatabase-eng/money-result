/*******************************************************************************
 * Money Result — Google Apps Script Backend
 * ---------------------------------------------------------------------------
 * ทำหน้าที่เป็น REST-ish API ระหว่าง Frontend (GitHub Pages) กับ Google Sheets
 *
 * วิธีใช้ครั้งแรก:
 *   1) เปิด Google Sheet ใหม่ > Extensions > Apps Script
 *   2) วางไฟล์นี้ทับ Code.gs เดิมทั้งหมด
 *   3) กด Run เลือกฟังก์ชัน `setup` หนึ่งครั้ง (อนุญาตสิทธิ์ตามที่ขึ้น)
 *   4) Deploy > New deployment > Web app
 *        - Execute as        : Me
 *        - Who has access    : Anyone
 *   5) คัดลอก Web app URL (.../exec) ไปใส่ใน js/config.js หรือกดปุ่ม ⚙️ ในเว็บ
 ******************************************************************************/

var CONFIG = {
  // เว้นว่างไว้ = ใช้ Spreadsheet ที่ผูกกับสคริปต์นี้ (แนะนำ — Sheet ID จะได้ไม่ต้องอยู่ในโค้ด)
  // ถ้าจะแยกไฟล์ ให้ใส่ ID ของ Spreadsheet ที่ต้องการ
  SPREADSHEET_ID: '',

  // กันคนที่บังเอิญเจอ URL มายิง API — ต้องตรงกับ API_TOKEN ใน js/config.js
  // เว้นว่าง ('') = ปิดการตรวจสอบ (ใครมี URL ก็เรียกได้)
  // อยากเปลี่ยน token: แก้ทั้งที่นี่และใน js/config.js ให้ตรงกัน แล้ว deploy ใหม่
  API_TOKEN: 'L7PrOxo9f-KiHC81yykGRQ',

  TIMEZONE: 'Asia/Bangkok',
  SHEETS: {
    PLAYERS: 'Players',
    RECORDS: 'Records'
  }
};

var HEADERS = {
  PLAYERS: ['ID', 'Name', 'Active', 'CreatedAt'],
  RECORDS: ['SessionID', 'Date', 'Player', 'BuyIn', 'Rebuy', 'TotalBuyIn',
            'CashOut', 'Adjust', 'Net', 'CreatedAt']
};

/* ============================================================================
 * SETUP — รันครั้งเดียวตอนติดตั้ง
 * ========================================================================== */

function setup() {
  var players = getSheet_(CONFIG.SHEETS.PLAYERS, HEADERS.PLAYERS);
  var records = getSheet_(CONFIG.SHEETS.RECORDS, HEADERS.RECORDS);

  // บังคับให้คอลัมน์ Date เป็น text เพื่อกันปัญหา timezone ของ Google Sheets
  records.getRange('B2:B').setNumberFormat('@');
  players.setColumnWidth(2, 180);
  records.setColumnWidth(3, 160);

  SpreadsheetApp.getActiveSpreadsheet().toast(
    'สร้างชีต Players และ Records เรียบร้อย', 'Money Result', 5);
  return 'OK';
}

/* ============================================================================
 * ROUTER
 * ========================================================================== */

function doGet(e) {
  return route_(mergeParams_({}, e));
}

function doPost(e) {
  var body = {};
  if (e && e.postData && e.postData.contents) {
    try { body = JSON.parse(e.postData.contents) || {}; } catch (err) { body = {}; }
  }
  return route_(mergeParams_(body, e));
}

function mergeParams_(body, e) {
  var p = body || {};
  if (e && e.parameter) {
    for (var k in e.parameter) {
      if (!Object.prototype.hasOwnProperty.call(p, k)) p[k] = e.parameter[k];
    }
  }
  return p;
}

function route_(p) {
  var callback = p.callback ? String(p.callback) : '';
  var out;
  try {
    checkToken_(p);
    out = { ok: true, data: dispatch_(p) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return reply_(out, callback);
}

/** ตรวจ token ทุก request (ยกเว้นตั้ง API_TOKEN เป็นค่าว่าง = ปิดการตรวจ) */
function checkToken_(p) {
  if (!CONFIG.API_TOKEN) return;
  if (String((p && p.token) || '') !== CONFIG.API_TOKEN) {
    throw new Error('ไม่ได้รับอนุญาต — token ไม่ถูกต้องหรือไม่ได้ส่งมา');
  }
}

function reply_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    // JSONP — ใช้เป็นทางสำรองเวลา fetch ติดปัญหา CORS
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function dispatch_(p) {
  var action = String(p.action || '').trim();
  switch (action) {
    case 'ping':          return { pong: true, time: nowIso_(), tz: CONFIG.TIMEZONE };
    case 'bootstrap':     return { players: listPlayers_(), records: listRecords_(p) };

    case 'getPlayers':    return listPlayers_();
    case 'addPlayer':     return addPlayer_(p);
    case 'renamePlayer':  return renamePlayer_(p);
    case 'deletePlayer':  return deletePlayer_(p);

    case 'getRecords':    return listRecords_(p);
    case 'getSession':    return getSession_(p);
    case 'saveSession':   return saveSession_(p);
    case 'deleteSession': return deleteSession_(p);

    default:
      throw new Error('ไม่รู้จักคำสั่ง (action): "' + action + '"');
  }
}

/* ============================================================================
 * PLAYERS
 * ========================================================================== */

function listPlayers_() {
  var rows = readObjects_(getSheet_(CONFIG.SHEETS.PLAYERS, HEADERS.PLAYERS));
  return rows
    .filter(function (r) { return String(r.Name || '').trim() !== ''; })
    .filter(function (r) { return r.Active !== false && String(r.Active).toUpperCase() !== 'FALSE'; })
    .map(function (r) {
      return {
        id: String(r.ID || ''),
        name: String(r.Name).trim(),
        createdAt: r.CreatedAt ? toIso_(r.CreatedAt) : ''
      };
    })
    .sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
}

function addPlayer_(p) {
  var name = String(p.name || '').trim();
  if (!name) throw new Error('กรุณากรอกชื่อผู้เล่น');
  if (name.length > 40) throw new Error('ชื่อยาวเกินไป (สูงสุด 40 ตัวอักษร)');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_(CONFIG.SHEETS.PLAYERS, HEADERS.PLAYERS);
    var existing = readObjects_(sheet);

    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i].Name || '').trim().toLowerCase() === name.toLowerCase()) {
        // ถ้าเคยลบไปแล้ว (Active = FALSE) ให้กู้คืนแทนการสร้างซ้ำ
        if (existing[i].Active === false || String(existing[i].Active).toUpperCase() === 'FALSE') {
          sheet.getRange(existing[i]._row, 3).setValue(true);
          return { id: String(existing[i].ID), name: name, restored: true };
        }
        throw new Error('มีชื่อ "' + name + '" อยู่แล้ว');
      }
    }

    var id = 'P' + stamp_();
    sheet.appendRow([id, name, true, new Date()]);
    return { id: id, name: name, restored: false };
  } finally {
    lock.releaseLock();
  }
}

function renamePlayer_(p) {
  var id = String(p.id || '').trim();
  var name = String(p.name || '').trim();
  if (!id || !name) throw new Error('ต้องระบุ id และ name');

  var sheet = getSheet_(CONFIG.SHEETS.PLAYERS, HEADERS.PLAYERS);
  var rows = readObjects_(sheet);
  var target = null;

  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].ID) === id) target = rows[i];
    else if (String(rows[i].Name || '').trim().toLowerCase() === name.toLowerCase()) {
      throw new Error('มีชื่อ "' + name + '" อยู่แล้ว');
    }
  }
  if (!target) throw new Error('ไม่พบผู้เล่น id: ' + id);

  var oldName = String(target.Name).trim();
  sheet.getRange(target._row, 2).setValue(name);

  // อัปเดตชื่อในประวัติการเล่นให้ตรงกัน
  var rec = getSheet_(CONFIG.SHEETS.RECORDS, HEADERS.RECORDS);
  var last = rec.getLastRow();
  if (last > 1) {
    var range = rec.getRange(2, 3, last - 1, 1);
    var vals = range.getValues();
    var touched = 0;
    for (var j = 0; j < vals.length; j++) {
      if (String(vals[j][0]).trim() === oldName) { vals[j][0] = name; touched++; }
    }
    if (touched) range.setValues(vals);
  }
  return { id: id, name: name, oldName: oldName };
}

/** ลบแบบ soft delete — เก็บประวัติการเล่นเดิมไว้ */
function deletePlayer_(p) {
  var id = String(p.id || '').trim();
  if (!id) throw new Error('ต้องระบุ id');

  var sheet = getSheet_(CONFIG.SHEETS.PLAYERS, HEADERS.PLAYERS);
  var rows = readObjects_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].ID) === id) {
      sheet.getRange(rows[i]._row, 3).setValue(false);
      return { id: id, name: String(rows[i].Name) };
    }
  }
  throw new Error('ไม่พบผู้เล่น id: ' + id);
}

/* ============================================================================
 * RECORDS / SESSIONS
 * ========================================================================== */

function listRecords_(p) {
  var from = normalizeDate_(p && p.from);
  var to   = normalizeDate_(p && p.to);
  var rows = readObjects_(getSheet_(CONFIG.SHEETS.RECORDS, HEADERS.RECORDS));

  return rows
    .filter(function (r) { return String(r.Player || '').trim() !== ''; })
    .map(function (r) {
      return {
        sessionId: String(r.SessionID || ''),
        date: normalizeDate_(r.Date),
        player: String(r.Player).trim(),
        buyIn: toNumber_(r.BuyIn),
        rebuy: toNumber_(r.Rebuy),
        totalBuyIn: toNumber_(r.TotalBuyIn),
        cashOut: toNumber_(r.CashOut),
        adjust: toNumber_(r.Adjust),
        net: toNumber_(r.Net)
      };
    })
    .filter(function (r) {
      if (!r.date) return false;
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      return true;
    })
    .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
}

function getSession_(p) {
  var date = normalizeDate_(p && p.date);
  if (!date) throw new Error('ต้องระบุวันที่ (date) รูปแบบ YYYY-MM-DD');

  var rows = listRecords_({ from: date, to: date });
  if (!rows.length) return null;

  return {
    sessionId: rows[0].sessionId,
    date: date,
    // Buy In เริ่มต้นทุกคนเท่ากัน จึงอ่านจากแถวแรกได้
    buyIn: rows[0].buyIn,
    rows: rows.map(function (r) {
      return {
        player: r.player,
        buyIn: r.buyIn,
        rebuy: r.rebuy,
        cashOut: r.cashOut,
        adjust: r.adjust,
        net: r.net
      };
    })
  };
}

function saveSession_(p) {
  var date = normalizeDate_(p && p.date);
  if (!date) throw new Error('ต้องระบุวันที่ (date) รูปแบบ YYYY-MM-DD');

  var rows = p.rows;
  if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch (e) { rows = null; } }
  if (!rows || !rows.length) throw new Error('ไม่มีข้อมูลผู้เล่นที่จะบันทึก');
  if (rows.length < 2) throw new Error('ต้องมีผู้เล่นอย่างน้อย 2 คน');

  // ---- ตรวจ zero-sum ที่ฝั่ง server ด้วย (กันข้อมูลเพี้ยนเข้า Sheet) ----
  var total = 0;
  var seen = {};
  for (var i = 0; i < rows.length; i++) {
    var name = String(rows[i].player || '').trim();
    if (!name) throw new Error('มีแถวที่ไม่มีชื่อผู้เล่น');
    var key = name.toLowerCase();
    if (seen[key]) throw new Error('ชื่อผู้เล่นซ้ำ: ' + name);
    seen[key] = true;
    total += toNumber_(rows[i].net);
  }
  total = round2_(total);
  if (Math.abs(total) > 0.009) {
    throw new Error('ยอดสุทธิรวมต้องเท่ากับ 0 (ตอนนี้เท่ากับ ' + total + ')');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_(CONFIG.SHEETS.RECORDS, HEADERS.RECORDS);
    var replaced = deleteRowsByDate_(sheet, date);   // บันทึกซ้ำวันเดิม = เขียนทับ

    var sessionId = String(p.sessionId || '').trim() || ('S' + date.replace(/-/g, '') + '-' + stamp_());
    var now = new Date();

    var values = rows.map(function (r) {
      var buyIn   = toNumber_(r.buyIn);
      var rebuy   = toNumber_(r.rebuy);
      var cashOut = toNumber_(r.cashOut);
      var adjust  = toNumber_(r.adjust);
      return [
        sessionId,
        date,
        String(r.player).trim(),
        buyIn,
        rebuy,
        round2_(buyIn + rebuy),
        cashOut,
        adjust,
        round2_(toNumber_(r.net)),
        now
      ];
    });

    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, values.length, HEADERS.RECORDS.length).setValues(values);
    sheet.getRange(startRow, 2, values.length, 1).setNumberFormat('@');

    return { sessionId: sessionId, date: date, saved: values.length, replaced: replaced };
  } finally {
    lock.releaseLock();
  }
}

function deleteSession_(p) {
  var date = normalizeDate_(p && p.date);
  var sessionId = String((p && p.sessionId) || '').trim();
  if (!date && !sessionId) throw new Error('ต้องระบุ date หรือ sessionId');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getSheet_(CONFIG.SHEETS.RECORDS, HEADERS.RECORDS);
    var removed = date
      ? deleteRowsByDate_(sheet, date)
      : deleteRowsWhere_(sheet, function (r) { return String(r.SessionID) === sessionId; });
    if (!removed) throw new Error('ไม่พบข้อมูลที่ต้องการลบ');
    return { removed: removed, date: date, sessionId: sessionId };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================================
 * HELPERS
 * ========================================================================== */

function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('ไม่พบ Spreadsheet — ตั้งค่า CONFIG.SPREADSHEET_ID ก่อน');
  return ss;
}

function getSheet_(name, headers) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
         .setFontWeight('bold').setBackground('#efefec');
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** อ่านทั้งชีตเป็น array ของ object โดยใช้แถวแรกเป็น key (แนบ _row ไว้ด้วย) */
function readObjects_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var values = sheet.getRange(1, 1, last, sheet.getLastColumn()).getValues();
  var header = values[0];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var obj = { _row: i + 1 };
    for (var j = 0; j < header.length; j++) {
      var key = String(header[j]).trim();
      if (key) obj[key] = values[i][j];
    }
    out.push(obj);
  }
  return out;
}

function deleteRowsByDate_(sheet, date) {
  return deleteRowsWhere_(sheet, function (r) { return normalizeDate_(r.Date) === date; });
}

/** ลบจากล่างขึ้นบน เพื่อไม่ให้เลขแถวเลื่อนระหว่างลบ */
function deleteRowsWhere_(sheet, predicate) {
  var rows = readObjects_(sheet);
  var targets = [];
  for (var i = 0; i < rows.length; i++) {
    if (predicate(rows[i])) targets.push(rows[i]._row);
  }
  for (var k = targets.length - 1; k >= 0; k--) sheet.deleteRow(targets[k]);
  return targets.length;
}

function normalizeDate_(value) {
  if (!value && value !== 0) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  var m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}

function toNumber_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var n = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}

function round2_(n) { return Math.round((toNumber_(n) + Number.EPSILON) * 100) / 100; }

function toIso_(d) {
  if (Object.prototype.toString.call(d) === '[object Date]') {
    return Utilities.formatDate(d, CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  }
  return String(d);
}

function nowIso_() { return toIso_(new Date()); }

function stamp_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMddHHmmss') +
         Math.floor(Math.random() * 900 + 100);
}
