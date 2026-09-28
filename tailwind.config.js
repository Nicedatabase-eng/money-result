/**
 * Tailwind — สร้างไฟล์ css/tailwind.css ล่วงหน้า (แทน Play CDN ที่ต้องประมวลผลในเบราว์เซอร์ทุกครั้ง)
 *
 * แก้ class ใน HTML/JS แล้วต้องสั่ง  npm run build:css  แล้ว commit ไฟล์ css/tailwind.css ด้วย
 * (GitHub Pages ไม่มีขั้นตอน build — ไฟล์ที่ commit ไว้คือไฟล์ที่ใช้จริง)
 */
module.exports = {
  content: ['./*.html', './js/**/*.js'],
  corePlugins: { preflight: true },
  theme: {
    extend: {
      colors: {
        page:    'var(--page)',
        surface: 'var(--surface-1)',
        raised:  'var(--surface-2)',
        ink:     'var(--ink)',
        ink2:    'var(--ink-2)',
        muted:   'var(--muted)',
        line:    'var(--border)',
        pos:    { DEFAULT: 'var(--pos)', text: 'var(--pos-text)', wash: 'var(--pos-wash)' },
        neg:    { DEFAULT: 'var(--neg)', text: 'var(--neg-text)', wash: 'var(--neg-wash)' },
        warn:   { DEFAULT: 'var(--warn)', text: 'var(--warn-text)', wash: 'var(--warn-wash)' },
        accent: { DEFAULT: 'var(--accent)', ink: 'var(--accent-ink)', wash: 'var(--accent-wash)' }
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Noto Sans Thai', 'Sarabun', 'sans-serif']
      }
    }
  }
};
