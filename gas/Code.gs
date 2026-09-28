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

var CACHE_SECONDS = 21600;   // 6 ชม. — สูงสุดที่ CacheService รับได้ (ล้างเองทุกครั้งที่มีการเขียน)
var CACHE_CHUNK = 30000;     // ตัวอักษรต่อก้อน — อักษรไทย 1 ตัว = 3 ไบต์ ต้องไม่เกิน 100KB ต่อ key

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

    // ---- เว็บเวอร์ชันปัจจุบันใช้ 2 คำสั่งนี้ (อ่านผ่าน cache) ----
    case 'ledgerInit':    return ledgerInit_(p);
    case 'sync':          return sync_(p);

    // ---- คงไว้ให้เว็บเวอร์ชันเก่าที่ค้างอยู่ในเครื่องใครยังใช้ได้ ----
    case 'bootstrap':     return { players: snapshot_(false).players, records: listRecords_(p) };
    case 'getPlayers':    return snapshot_(false).players;

    case 'addPlayer':     return addPlayer_(p);

    case 'getRecords':    return listRecords_(p);
    case 'getSession':    return getSession_(p);
    case 'saveSession':   return saveSession_(p);

    // ---- คำสั่งที่ถูกถอดออกโดยตั้งใจ (Records และรายชื่อผู้เล่นเป็นแบบเขียนเพิ่มอย่างเดียว) ----
    // ตอบให้ชัดว่าปิดถาวร ไม่ใช่พิมพ์ผิด เผื่อมีเว็บเวอร์ชันเก่าค้างอยู่ในเครื่องใคร
    case 'deleteSession':
    case 'renamePlayer':
    case 'deletePlayer':
      throw new Error('คำสั่งนี้ถูกปิดใช้งานถาวร — ข้อมูลที่บันทึกแล้วแก้หรือลบผ่านแอปไม่ได้');

    default:
      throw new Error('ไม่รู้จักคำสั่ง (action): "' + action + '"');
  }
}

/* ============================================================================
 * PLAYERS
 * ========================================================================== */

/** อ่านรายชื่อจากชีตตรง ๆ — ปกติเรียกผ่าน snapshot_() ที่มี cache */
function readPlayers_() {
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
          markDataChanged_();
          return { id: String(existing[i].ID), name: name, restored: true };
        }
        throw new Error('มีชื่อ "' + name + '" อยู่แล้ว');
      }
    }

    var id = 'P' + stamp_();
    sheet.appendRow([id, name, true, new Date()]);
    markDataChanged_();
    return { id: id, name: name, restored: false };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================================
 * RECORDS / SESSIONS
 * ========================================================================== */

/**
 * อ่าน Records จากชีตตรง ๆ เรียงตามลำดับแถว (เก่า → ใหม่)
 * แต่ละรายการมีเลขแถว `row` ติดไปด้วย ใช้เป็นจุดต่อของการดึงเฉพาะแถวใหม่ (sync)
 * ปกติเรียกผ่าน snapshot_() ที่มี cache
 */
function readRecords_() {
  return readObjects_(getSheet_(CONFIG.SHEETS.RECORDS, HEADERS.RECORDS))
    .filter(function (r) { return String(r.Player || '').trim() !== ''; })
    .map(function (r) {
      return {
        row: r._row,
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
    .filter(function (r) { return !!r.date; });
}

/** สำหรับคำสั่งเก่า (bootstrap / getRecords) — กรองช่วงวันที่ เรียงใหม่ → เก่า */
function listRecords_(p) {
  var from = normalizeDate_(p && p.from);
  var to   = normalizeDate_(p && p.to);
  return snapshot_(false).records
    .filter(function (r) {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      return true;
    })
    .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
}

/* ============================================================================
 * SNAPSHOT + CACHE — อ่านชีตครั้งเดียว แล้วตอบจาก cache จนกว่าจะมีการเขียน
 * ========================================================================== */

/**
 * ข้อมูลทั้งหมด { players, records } — อ่านจาก cache ก่อน ถ้าไม่มีค่อยอ่านชีต
 * @param {boolean} fresh true = ข้าม cache อ่านชีตใหม่ (ปุ่ม ↻ — เผื่อมีคนแก้ในชีตด้วยมือ)
 *
 * cache ผูกกับ "เวอร์ชันข้อมูล" ที่เปลี่ยนทุกครั้งที่มีการเขียน (markDataChanged_)
 * ถ้ามีคนอ่านชีตค้างอยู่ระหว่างที่อีกคนบันทึก ผลอ่านเก่าจะถูกเก็บไว้ใต้เวอร์ชันเก่า
 * ซึ่งไม่มีใครเรียกใช้อีก — cache จึงไม่มีทางย้อนไปเป็นข้อมูลเก่า
 */
function snapshot_(fresh) {
  var key = 'snap:' + dataVersion_();
  if (!fresh) {
    var hit = cacheGetJson_(key);
    if (hit) return hit;
  }
  var snap = { players: readPlayers_(), records: readRecords_() };
  cachePutJson_(key, snap);
  return snap;
}

function dataVersion_() {
  return PropertiesService.getScriptProperties().getProperty('dataVersion') || '0';
}

/** เปลี่ยนเฉพาะตอนมีคนแก้ชีตด้วยมือ — เว็บเห็นค่านี้เปลี่ยนแล้วจะโหลดทั้งหมดใหม่ */
function editVersion_() {
  return PropertiesService.getScriptProperties().getProperty('editVersion') || '0';
}

/**
 * เรียกหลังเขียนชีตทุกครั้ง — ทำให้ cache ของเวอร์ชันเดิมใช้ไม่ได้ทันที
 * @param {boolean} manual true = แก้ด้วยมือในชีต (แถวเก่าอาจเปลี่ยน ไม่ใช่แค่เพิ่มแถวใหม่)
 */
function markDataChanged_(manual) {
  SpreadsheetApp.flush();
  var v = String(Date.now()) + Math.floor(Math.random() * 1000);
  var props = { dataVersion: v };
  if (manual) props.editVersion = v;
  PropertiesService.getScriptProperties().setProperties(props);
}

/**
 * Simple trigger — ทำงานเองเมื่อมีคนแก้ค่าในชีตด้วยมือ ให้ cache ถูกล้าง
 * และให้หน้าสรุปผลของทุกคนโหลดทั้งหมดใหม่ในครั้งถัดไป
 * (การลบทั้งแถวไม่ปลุก onEdit — กรณีนั้นให้กด ↻ ที่หน้าสรุปผลหนึ่งครั้ง)
 */
function onEdit() {
  try { markDataChanged_(true); } catch (err) { /* ไม่มีสิทธิ์ใน simple trigger ก็ข้ามไป */ }
}

function cacheGetJson_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get(key + ':n'), 10);
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + ':' + i);
    var got = cache.getAll(keys);
    var s = '';
    for (var j = 0; j < n; j++) {
      if (got[keys[j]] == null) return null;   // มีบางก้อนหลุด — ถือว่าไม่มี cache
      s += got[keys[j]];
    }
    return JSON.parse(s);
  } catch (err) {
    return null;
  }
}

/** ข้อมูลใหญ่เกิน 100KB ต่อ key จึงหั่นเป็นหลายก้อน */
function cachePutJson_(key, value) {
  try {
    var s = JSON.stringify(value);
    var map = {};
    var n = 0;
    for (var i = 0; i < s.length; i += CACHE_CHUNK) map[key + ':' + (n++)] = s.substr(i, CACHE_CHUNK);
    map[key + ':n'] = String(n);
    CacheService.getScriptCache().putAll(map, CACHE_SECONDS);
  } catch (err) {
    // cache เต็มหรือใหญ่เกิน — ไม่เป็นไร ครั้งหน้าอ่านจากชีตแทน
  }
}

/* ============================================================================
 * คำสั่งที่เว็บใช้
 * ========================================================================== */

/** เปิดหน้าบันทึกยอด: รายชื่อ + ข้อมูลของวันที่เลือก ในการเรียกครั้งเดียว */
function ledgerInit_(p) {
  var snap = snapshot_(false);
  return { players: snap.players, session: sessionFrom_(snap.records, normalizeDate_(p && p.date)) };
}

function recordKey_(r) {
  return r.row + '|' + r.sessionId + '|' + r.date + '|' + r.player;
}

/**
 * หน้าสรุปผล: ส่งเฉพาะแถวที่เพิ่มหลัง sinceRow (ชีต Records เขียนเพิ่มอย่างเดียว)
 *
 * เว็บส่ง sinceRow + anchor (คีย์ของแถวสุดท้ายที่มีอยู่) มา
 * ถ้าแถวนั้นยังอยู่ที่เดิมและค่าตรงกัน → ส่งเฉพาะแถวใหม่ (reset: false)
 * ถ้าไม่ตรง (มีคนลบ/แทรกแถวในชีตด้วยมือ) → ส่งทั้งหมด (reset: true) ให้เว็บเริ่มใหม่
 * และถ้ามีการแก้ชีตด้วยมือหลังจากที่เว็บโหลดทั้งหมดครั้งล่าสุด (editVersion ไม่ตรง) ก็ส่งทั้งหมดเช่นกัน
 */
function sync_(p) {
  var snap = snapshot_(String(p.fresh || '') === '1');
  var recs = snap.records;
  var last = recs.length ? recs[recs.length - 1] : null;
  var editVersion = editVersion_();
  var out = {
    players: snap.players,
    lastRow: last ? last.row : 0,
    anchor: last ? recordKey_(last) : '',
    editVersion: editVersion
  };

  var since = parseInt(p.sinceRow, 10) || 0;
  if (since > 0 && String(p.editVersion || '') === editVersion) {
    for (var i = recs.length - 1; i >= 0; i--) {
      if (recs[i].row < since) break;
      if (recs[i].row === since) {
        if (recordKey_(recs[i]) === String(p.anchor || '')) {
          out.reset = false;
          out.records = recs.slice(i + 1);
          return out;
        }
        break;
      }
    }
  }

  out.reset = true;
  out.records = recs;
  return out;
}

function getSession_(p) {
  var date = normalizeDate_(p && p.date);
  if (!date) throw new Error('ต้องระบุวันที่ (date) รูปแบบ YYYY-MM-DD');
  return sessionFrom_(snapshot_(false).records, date);
}

function sessionFrom_(records, date) {
  if (!date) return null;
  var rows = records.filter(function (r) { return r.date === date; });
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

    // ---- กันเขียนทับ: วันไหนบันทึกไปแล้ว บันทึกซ้ำไม่ได้ ----
    // ตรวจในล็อก เพื่อกันกรณีสองเครื่องกดบันทึกวันเดียวกันพร้อมกัน
    // อ่านจากชีตตรง ๆ (ไม่ใช้ cache) แต่อ่านแค่คอลัมน์ Date คอลัมน์เดียว — เร็วกว่าอ่านทั้งชีตมาก
    // ใช้ normalizeDate_ จึงนับถูกแม้เซลล์จะถูกแก้ด้วยมือจนกลายเป็นชนิดวันที่
    var existing = 0;
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      var dates = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
      for (var d = 0; d < dates.length; d++) {
        if (normalizeDate_(dates[d][0]) === date) existing++;
      }
    }
    if (existing) {
      throw new Error('วันที่ ' + date + ' มีข้อมูลบันทึกไว้แล้ว (' + existing +
                      ' แถว) — ข้อมูลที่บันทึกแล้วเขียนทับไม่ได้');
    }

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

    var startRow = lastRow + 1;
    // ตั้งรูปแบบ text ก่อนเขียน — กัน Sheets แปลงวันที่เป็นชนิด Date เอง
    sheet.getRange(startRow, 2, values.length, 1).setNumberFormat('@');
    sheet.getRange(startRow, 1, values.length, HEADERS.RECORDS.length).setValues(values);
    markDataChanged_();

    return { sessionId: sessionId, date: date, saved: values.length };
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

/* หมายเหตุ: ไม่มีฟังก์ชันลบแถวในไฟล์นี้โดยตั้งใจ
   ชีต Records เป็นแบบ append-only — เพิ่มได้อย่างเดียว
   ถ้าจำเป็นต้องแก้/ลบจริง ๆ ต้องเข้าไปทำใน Google Sheet ด้วยมือ */

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
