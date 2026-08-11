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

  /* ---------- init ---------- */

  MR.initShell = function () {
    applyTheme(currentTheme());

    var themeBtn = document.getElementById('themeToggle');
    if (themeBtn) themeBtn.addEventListener('click', cycleTheme);

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
