/**
 * Utilities — ฟังก์ชันช่วยที่ไม่มี side effect (ยกเว้น toast)
 */
window.MR = window.MR || {};

(function (MR) {
  'use strict';

  /* ---------- ตัวเลข / เงิน ---------- */

  MR.num = function (v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '').trim());
    return isFinite(n) ? n : 0;
  };

  MR.round2 = function (n) {
    return Math.round((MR.num(n) + Number.EPSILON) * 100) / 100;
  };

  /** 1234.5 -> "1,234.50" | 1234 -> "1,234" */
  MR.fmt = function (n) {
    var v = MR.round2(n);
    var decimals = Number.isInteger(v) ? 0 : 2;
    return v.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: 2
    });
  };

  /** ใส่เครื่องหมายหน้าเสมอ: +350 / -120 / 0 */
  MR.signed = function (n) {
    var v = MR.round2(n);
    if (v === 0) return '0';
    return (v > 0 ? '+' : '−') + MR.fmt(Math.abs(v));
  };

  /* ---------- วันที่ ---------- */

  /** YYYY-MM-DD ตามเวลาเครื่อง (ไม่ใช่ UTC) */
  MR.todayISO = function (d) {
    var date = d ? new Date(d) : new Date();
    var t = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return t.toISOString().slice(0, 10);
  };

  MR.monthKey = function (isoDate) {
    return String(isoDate || '').slice(0, 7);
  };

  var TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                   'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  /** "2026-08" -> "ส.ค. 69" */
  MR.monthLabel = function (key) {
    var parts = String(key || '').split('-');
    if (parts.length < 2) return key || '';
    var m = parseInt(parts[1], 10) - 1;
    var buddhistYear = (parseInt(parts[0], 10) + 543) % 100;
    return (TH_MONTHS[m] || parts[1]) + ' ' + String(buddhistYear).padStart(2, '0');
  };

  /** "2026-08-11" -> "11 ส.ค. 69" */
  MR.dateLabel = function (iso) {
    var parts = String(iso || '').split('-');
    if (parts.length < 3) return iso || '';
    var m = parseInt(parts[1], 10) - 1;
    var buddhistYear = (parseInt(parts[0], 10) + 543) % 100;
    return parseInt(parts[2], 10) + ' ' + (TH_MONTHS[m] || parts[1]) + ' ' +
           String(buddhistYear).padStart(2, '0');
  };

  /* ---------- หัวใจของระบบ: การเกลี่ยยอด ---------- */

  /**
   * แบ่งยอดส่วนต่างให้ผู้เล่นที่ถูกเลือก
   *
   * @param {number} total  ยอดที่ต้อง "กระจาย" = -(ผลรวมสุทธิปัจจุบัน)
   *                        เช่น ผลรวมสุทธิ = +20  ->  total = -20 (ต้องหักออก)
   *                             ผลรวมสุทธิ = -20  ->  total = +20 (ต้องเพิ่มให้)
   * @param {number} count  จำนวนคนที่ถูกเลือก
   * @returns {number[]}    ค่าปรับของแต่ละคน เรียงตามลำดับที่ส่งเข้ามา
   *
   * กฎ: แบ่งเท่ากันก่อน ถ้าหารไม่ลงตัวให้ปัดเศษไปที่คนแรก ๆ ตามลำดับ
   *      splitAdjustment(-20, 3)  ->  [-7, -7, -6]
   *      splitAdjustment(+50, 4)  ->  [13, 13, 12, 12]
   *      ผลรวมของ array ที่คืนออกไปจะเท่ากับ total เสมอ
   */
  MR.splitAdjustment = function (total, count) {
    var n = Math.max(0, Math.floor(count));
    if (!n) return [];

    var t = MR.round2(total);
    var sign = t < 0 ? -1 : 1;
    var abs = Math.abs(t);

    // แยกส่วนจำนวนเต็มกับเศษทศนิยม — กระจายจำนวนเต็มก่อน (ตามกฎในโจทย์)
    var whole = Math.floor(abs + 1e-9);
    var frac = MR.round2(abs - whole);

    var base = Math.floor(whole / n);
    var remainder = whole - base * n;   // จำนวนคนแรก ๆ ที่ต้องรับเพิ่มคนละ 1

    var out = [];
    for (var i = 0; i < n; i++) {
      var v = base + (i < remainder ? 1 : 0);
      if (i === 0) v = MR.round2(v + frac);   // เศษทศนิยม (ถ้ามี) ตกที่คนแรก
      out.push(MR.round2(sign * v));
    }
    return out;
  };

  /* ---------- DOM ---------- */

  MR.el = function (sel, root) { return (root || document).querySelector(sel); };
  MR.els = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  MR.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /** คลาสสีสำหรับตัวเลขสุทธิ */
  MR.netClass = function (n) {
    var v = MR.round2(n);
    if (v > 0) return 'text-pos-text';
    if (v < 0) return 'text-neg-text';
    return 'text-ink2';
  };

})(window.MR);
