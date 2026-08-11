/**
 * ตั้งค่าโปรเจกต์
 *
 * API_URL / API_TOKEN — ตั้งไว้ตายตัวในไฟล์นี้ที่เดียว
 * ผู้ใช้ปลายทางแก้ผ่านหน้าเว็บไม่ได้ (ไม่มีปุ่มตั้งค่าแล้ว)
 *
 * ถ้าต้องเปลี่ยนปลายทาง ให้แก้ที่นี่แล้ว push ขึ้น GitHub ใหม่
 * และถ้าเปลี่ยน API_TOKEN ต้องแก้ CONFIG.API_TOKEN ใน gas/Code.gs
 * ให้ตรงกัน แล้ว deploy Apps Script ใหม่ด้วย
 */
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycby6PUyoelpeFUccO21SDyK0Gcf4UpuXfsGd6VnMQ4mBiFfoK5q5Q8JYzpTjAlLxpgUl/exec',

  /** ต้องตรงกับ CONFIG.API_TOKEN ใน gas/Code.gs */
  API_TOKEN: 'L7PrOxo9f-KiHC81yykGRQ',

  /** ปุ่มเติม Buy In ระหว่างเกม */
  MULTIPLIERS: [100, 200, 500],

  /** Buy In เริ่มต้นที่ตั้งไว้ให้ทุกคน (แก้ได้ในหน้าเว็บ) */
  DEFAULT_BUY_IN: 200,

  CURRENCY: '฿',

  /** ระยะเวลาที่ยอมให้ใช้ข้อมูล cache ก่อนดึงใหม่ (มิลลิวินาที) */
  CACHE_TTL: 5 * 60 * 1000
};
