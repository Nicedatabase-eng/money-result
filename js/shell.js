/**
 * Shell — ส่วนที่ใช้ร่วมกันทุกหน้า: theme, toast, modal ตั้งค่า API
 */
window.MR = window.MR || {};

(function (MR) {
  'use strict';

  /* ---------- Theme ---------- */

  var LS_THEME = 'mr.theme';

  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === 'dark' || theme === 'light') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');   // 'system'
    try { localStorage.setItem(LS_THEME, theme); } catch (e) { /* ignore */ }
    updateThemeButton(theme);
  }

  function currentTheme() {
    try { return localStorage.getItem(LS_THEME) || 'system'; } catch (e) { return 'system'; }
  }

  function updateThemeButton(theme) {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    var icon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️';
    var label = theme === 'dark' ? 'โหมดมืด' : theme === 'light' ? 'โหมดสว่าง' : 'ตามระบบ';
    btn.textContent = icon;
    btn.title = 'ธีม: ' + label + ' (คลิกเพื่อสลับ)';
    btn.setAttribute('aria-label', 'ธีม: ' + label);
  }

  function cycleTheme() {
    var order = ['system', 'light', 'dark'];
    var next = order[(order.indexOf(currentTheme()) + 1) % order.length];
    applyTheme(next);
  }

  /* ---------- Toast ---------- */

  function host() {
    var h = document.getElementById('toastHost');
    if (!h) {
      h = document.createElement('div');
      h.id = 'toastHost';
      document.body.appendChild(h);
    }
    return h;
  }

  MR.toast = function (message, kind, ms) {
    var node = document.createElement('div');
    node.className = 'toast';
    node.setAttribute('data-kind', kind || 'info');
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    node.textContent = message;
    host().appendChild(node);
    setTimeout(function () {
      node.style.opacity = '0';
      node.style.transition = 'opacity .2s';
      setTimeout(function () { node.remove(); }, 220);
    }, ms || (kind === 'error' ? 5200 : 2800));
  };

  /* ---------- Confirm ที่สวยกว่า window.confirm ---------- */

  MR.confirm = function (message, opts) {
    var o = opts || {};
    return new Promise(function (resolve) {
      var backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal-panel" style="max-width:24rem" role="dialog" aria-modal="true">' +
          '<p class="text-base leading-relaxed mb-4"></p>' +
          '<div class="flex gap-2 justify-end">' +
            '<button class="btn" data-no></button>' +
            '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-yes></button>' +
          '</div>' +
        '</div>';
      backdrop.querySelector('p').textContent = message;
      backdrop.querySelector('[data-no]').textContent = o.cancelText || 'ยกเลิก';
      backdrop.querySelector('[data-yes]').textContent = o.okText || 'ตกลง';

      function close(v) { backdrop.remove(); document.removeEventListener('keydown', onKey); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') close(false); }

      backdrop.querySelector('[data-no]').onclick = function () { close(false); };
      backdrop.querySelector('[data-yes]').onclick = function () { close(true); };
      backdrop.onclick = function (e) { if (e.target === backdrop) close(false); };
      document.addEventListener('keydown', onKey);

      document.body.appendChild(backdrop);
      backdrop.querySelector('[data-yes]').focus();
    });
  };

  /* ---------- Modal ตั้งค่า API URL ---------- */

  function openSettings() {
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML =
      '<div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="setTitle">' +
        '<h2 id="setTitle" class="text-lg font-semibold mb-1">ตั้งค่าการเชื่อมต่อ</h2>' +
        '<p class="text-sm mb-4" style="color:var(--ink-2)">' +
          'วาง <b>Web app URL</b> ที่ได้จากการ Deploy Google Apps Script (ลงท้ายด้วย <code>/exec</code>)' +
        '</p>' +
        '<label class="label" for="apiUrlInput">API URL</label>' +
        '<input id="apiUrlInput" class="field" type="url" spellcheck="false" autocomplete="off" ' +
               'placeholder="https://script.google.com/macros/s/AKfy.../exec">' +
        '<div class="flex flex-wrap gap-2 mt-4 justify-end">' +
          '<button class="btn" data-test>ทดสอบการเชื่อมต่อ</button>' +
          '<button class="btn" data-cancel>ยกเลิก</button>' +
          '<button class="btn btn-primary" data-save>บันทึก</button>' +
        '</div>' +
        '<p class="text-xs mt-3" style="color:var(--muted)">ค่านี้เก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น</p>' +
      '</div>';

    var input = backdrop.querySelector('#apiUrlInput');
    input.value = MR.API.getUrl();

    function close() { backdrop.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }

    backdrop.querySelector('[data-cancel]').onclick = close;
    backdrop.onclick = function (e) { if (e.target === backdrop) close(); };
    document.addEventListener('keydown', onKey);

    backdrop.querySelector('[data-test]').onclick = async function () {
      var btn = this;
      var prev = MR.API.getUrl();
      MR.API.setUrl(input.value);
      btn.disabled = true; btn.textContent = 'กำลังทดสอบ…';
      try {
        await MR.API.ping();
        MR.toast('เชื่อมต่อสำเร็จ ✓', 'success');
      } catch (err) {
        MR.API.setUrl(prev);
        MR.toast('เชื่อมต่อไม่สำเร็จ: ' + err.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'ทดสอบการเชื่อมต่อ';
      }
    };

    backdrop.querySelector('[data-save]').onclick = function () {
      MR.API.setUrl(input.value);
      MR.toast('บันทึกการตั้งค่าแล้ว — กำลังโหลดใหม่', 'success');
      close();
      setTimeout(function () { location.reload(); }, 600);
    };

    document.body.appendChild(backdrop);
    input.focus();
    input.select();
  }

  MR.openSettings = openSettings;

  /* ---------- init ---------- */

  MR.initShell = function () {
    applyTheme(currentTheme());

    var themeBtn = document.getElementById('themeToggle');
    if (themeBtn) themeBtn.addEventListener('click', cycleTheme);

    var setBtn = document.getElementById('settingsBtn');
    if (setBtn) setBtn.addEventListener('click', openSettings);

    // ไฮไลต์เมนูของหน้าปัจจุบัน
    var page = document.body.getAttribute('data-page');
    MR.els('[data-nav]').forEach(function (a) {
      var active = a.getAttribute('data-nav') === page;
      a.setAttribute('aria-current', active ? 'page' : 'false');
      a.style.background = active ? 'var(--accent-wash)' : '';
      a.style.color = active ? 'var(--pos-text)' : 'var(--ink-2)';
      a.style.fontWeight = active ? '600' : '500';
    });

    if (!MR.API.isConfigured()) {
      var banner = document.getElementById('setupBanner');
      if (banner) banner.hidden = false;
    }
  };

})(window.MR);
