/**
 * API client สำหรับคุยกับ Google Apps Script Web App
 *
 * หมายเหตุเรื่อง CORS:
 *  - POST จะ "ไม่ตั้ง header Content-Type" เพื่อให้ browser ส่งเป็น
 *    text/plain;charset=UTF-8 ซึ่งนับเป็น simple request → ไม่เกิด preflight
 *    (GAS ตอบ preflight OPTIONS ไม่ได้ ถ้าโดน preflight จะพังทันที)
 *  - GET ใช้ fetch ก่อน ถ้าล้มเหลวจะ fallback ไป JSONP อัตโนมัติ
 */
window.MR = window.MR || {};

(function (MR) {
  'use strict';

  var LS_URL = 'mr.apiUrl';
  var JSONP_TIMEOUT = 25000;

  function getUrl() {
    var saved = '';
    try { saved = localStorage.getItem(LS_URL) || ''; } catch (e) { /* ignore */ }
    return (saved || (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '').trim();
  }

  function setUrl(url) {
    var u = String(url || '').trim();
    try {
      if (u) localStorage.setItem(LS_URL, u);
      else localStorage.removeItem(LS_URL);
    } catch (e) { /* ignore */ }
  }

  function requireUrl() {
    var u = getUrl();
    if (!/^https:\/\/script\.google\.com\/.+\/exec/.test(u)) {
      if (!u) throw new Error('ยังไม่ได้ตั้งค่า API URL — กดปุ่ม ⚙️ มุมขวาบนเพื่อใส่ลิงก์ Web App');
      throw new Error('API URL ไม่ถูกต้อง ต้องเป็นลิงก์ Google Apps Script ที่ลงท้ายด้วย /exec');
    }
    return u;
  }

  /** แปลง object ให้เป็น query string ที่ GAS อ่านได้ */
  function toQuery(obj) {
    var q = new URLSearchParams();
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k];
      if (v === undefined || v === null) return;
      q.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    });
    return q;
  }

  function unwrap(res) {
    if (!res || typeof res !== 'object') throw new Error('รูปแบบข้อมูลตอบกลับไม่ถูกต้อง');
    if (res.ok !== true) throw new Error(res.error || 'เกิดข้อผิดพลาดที่ฝั่ง Server');
    return res.data;
  }

  /** โหลดผ่าน <script> — ข้ามข้อจำกัด CORS ได้ 100% แต่ใช้ได้เฉพาะ GET */
  function jsonp(params) {
    return new Promise(function (resolve, reject) {
      var name = '__mrcb_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      var script = document.createElement('script');
      var timer = null;

      function cleanup() {
        if (timer) clearTimeout(timer);
        try { delete window[name]; } catch (e) { window[name] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[name] = function (data) { cleanup(); resolve(data); };
      script.onerror = function () { cleanup(); reject(new Error('เชื่อมต่อ API ไม่สำเร็จ (JSONP)')); };
      timer = setTimeout(function () { cleanup(); reject(new Error('API ไม่ตอบสนอง (หมดเวลา)')); }, JSONP_TIMEOUT);

      var q = toQuery(params);
      q.set('callback', name);
      script.src = requireUrl() + '?' + q.toString();
      document.head.appendChild(script);
    });
  }

  async function get(action, params) {
    var url = requireUrl();
    var q = toQuery(Object.assign({ action: action }, params || {}));
    try {
      var res = await fetch(url + '?' + q.toString(), { method: 'GET', redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return unwrap(await res.json());
    } catch (err) {
      // network/CORS พัง → ลอง JSONP ต่อ; ถ้า error มาจาก server เอง ให้โยนออกไปเลย
      if (err && /^(HTTP|เกิดข้อผิดพลาด|ยังไม่ได้ตั้งค่า|API URL)/.test(err.message)) throw err;
      return unwrap(await jsonp(Object.assign({ action: action }, params || {})));
    }
  }

  async function post(action, payload) {
    var url = requireUrl();
    var res = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      // ตั้งใจไม่ใส่ headers — ดูหมายเหตุ CORS ด้านบน
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return unwrap(await res.json());
  }

  /* ---------- cache รายชื่อผู้เล่น เพื่อให้หน้าแรกเปิดได้ทันที ---------- */

  var LS_PLAYERS = 'mr.players';

  function cachedPlayers() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS_PLAYERS) || 'null');
      return raw && Array.isArray(raw.list) ? raw.list : null;
    } catch (e) { return null; }
  }

  function cachePlayers(list) {
    try {
      localStorage.setItem(LS_PLAYERS, JSON.stringify({ at: Date.now(), list: list }));
    } catch (e) { /* ignore */ }
  }

  MR.API = {
    getUrl: getUrl,
    setUrl: setUrl,
    isConfigured: function () { return /^https:\/\/script\.google\.com\/.+\/exec/.test(getUrl()); },

    ping: function () { return get('ping'); },

    getPlayers: async function () {
      var list = await get('getPlayers');
      cachePlayers(list);
      return list;
    },
    cachedPlayers: cachedPlayers,

    addPlayer: function (name) { return post('addPlayer', { name: name }); },
    renamePlayer: function (id, name) { return post('renamePlayer', { id: id, name: name }); },
    deletePlayer: function (id) { return post('deletePlayer', { id: id }); },

    bootstrap: async function () {
      var data = await get('bootstrap');
      if (data && data.players) cachePlayers(data.players);
      return data;
    },
    getRecords: function (range) { return get('getRecords', range || {}); },
    getSession: function (date) { return get('getSession', { date: date }); },
    saveSession: function (session) { return post('saveSession', session); },
    deleteSession: function (date) { return post('deleteSession', { date: date }); }
  };

})(window.MR);
