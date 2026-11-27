/* =========================================================
   1277Foods — script.js
   File này vừa là mã chạy trang web, vừa là Service Worker
   (giúp trang mở được và dùng được khi KHÔNG có mạng).
   ========================================================= */
'use strict';

/* ⬇️ DÁN ĐƯỜNG LINK APPS SCRIPT (URL ứng dụng web, đuôi /exec) VÀO GIỮA HAI DẤU NGOẶC KÉP ⬇️ */
const SCRIPT_URL = "aHR0cHM6Ly9zY3JpcHQuZ29vZ2xlLmNvbS9tYWNyb3Mvcy9BS2Z5Y2J6UU9SZjZ5SVdyN0lxUkw0UE1OeGk5RkwySWdVS0MwcjBocFF0TVdMSlVxR2xXbEU4aDRaU2JPalZabzlTeWRsWS9leGVj";
/* (Có thể dán link thường, hoặc link đã mã hoá Base64 nếu không muốn lộ link.) */

const APP_CACHE = '1277foods-cache-v3';

if (typeof window === 'undefined') {
  /* ================= SERVICE WORKER (chạy nền, offline) ================= */
  const CORE = ['./', './index.html', './style.css', './script.js'];
  const CDN_HOSTS = ['i.ibb.co', 'fonts.googleapis.com', 'fonts.gstatic.com'];

  self.addEventListener('install', (e) => {
    e.waitUntil(
      caches.open(APP_CACHE)
        .then((c) => Promise.all(CORE.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
        .then(() => self.skipWaiting())
    );
  });

  self.addEventListener('activate', (e) => {
    e.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k.startsWith('1277foods-cache') && k !== APP_CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim())
    );
  });

  self.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'precache' && Array.isArray(d.urls)) {
      e.waitUntil(caches.open(APP_CACHE).then((c) => Promise.all(d.urls.map(async (u) => {
        try {
          if (await c.match(u)) return;
          const res = await fetch(u, { mode: 'no-cors' });
          if (res && (res.ok || res.type === 'opaque')) await c.put(u, res);
        } catch (err) { /* bỏ qua */ }
      }))));
    }
  });

  self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    let url;
    try { url = new URL(req.url); } catch (err) { return; }

    /* Lượt truy cập: luôn lấy từ mạng, không lưu cache */
    if (/script\.google(usercontent)?\.com$/.test(url.hostname)) return;

    if (url.origin === self.location.origin) {
      /* File của trang: ưu tiên mạng (để luôn mới), mất mạng thì lấy bản đã lưu */
      e.respondWith(
        fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(APP_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() =>
          caches.match(req, { ignoreSearch: true }).then((r) => r ||
            (req.mode === 'navigate' ? caches.match('./index.html').then((x) => x || caches.match('./')) : Response.error()))
        )
      );
      return;
    }

    /* Ảnh tải kiểu CORS (để tạo ảnh chia sẻ) thì lấy thẳng từ mạng */
    if (url.hostname === 'i.ibb.co' && req.mode === 'cors') return;

    if (CDN_HOSTS.includes(url.hostname)) {
      /* Ảnh món ăn & phông chữ: ưu tiên bản đã lưu (chạy offline) */
      e.respondWith(
        caches.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(APP_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }))
      );
    }
  });

  /* ---------- Dữ liệu đơn hàng dùng chung giữa trang và Service Worker ---------- */
  const DATA_CACHE = '1277foods-data';
  const dataUrl = (name) => new URL(name, self.registration.scope).href;
  const readData = async (name, def) => {
    try { const c = await caches.open(DATA_CACHE); const r = await c.match(dataUrl(name)); return r ? await r.json() : def; } catch (err) { return def; }
  };
  const writeData = async (name, val) => {
    try { const c = await caches.open(DATA_CACHE); await c.put(dataUrl(name), new Response(JSON.stringify(val), { headers: { 'Content-Type': 'application/json' } })); } catch (err) { /* bỏ qua */ }
  };
  /* Đường link đẹp của trang (KHÔNG BAO GIỜ mở script.js) */
  const appUrl = (hash) => self.registration.scope + (hash || '');
  const DEF_TITLE = '1277Foods – Giao hàng thành công ✅';
  /* Nội dung đã được trang soạn sẵn theo ngôn ngữ bạn chọn (đơn cũ: tiếng Việt) */
  const orderNotif = (o, silent) => ({
    body: o.body || `Đơn #${o.code}: ${o.name || 'Món ăn'}${o.more > 0 ? ` và ${o.more} món khác` : ''} đã giao thành công tới Nhà mình. Chúc bạn ngon miệng! 😋`,
    icon: o.img || undefined,
    image: o.img || undefined,
    tag: 'order-' + o.code,
    renotify: !silent,
    silent: !!silent,
    vibrate: silent ? undefined : [120, 60, 120],
    timestamp: o.at,
    data: { url: appUrl('#/order/' + o.code) }
  });

  /* ---------- Thông báo đẩy: hiện cả khi đã thoát trình duyệt ---------- */
  self.addEventListener('push', (e) => {
    e.waitUntil((async () => {
      const raw = await readData('__orders.json', []);
      const orders = (Array.isArray(raw) ? raw : []).filter((o) => o && o.code && typeof o.at === 'number');
      const done = await readData('__notified.json', []);
      const t = Date.now();
      /* 1) Đơn đã tới giờ giao mà chưa báo */
      let due = orders.filter((o) => !done.includes(o.code) && o.at <= t + 30000).sort((a, b) => a.at - b.at);
      let silent = false;
      if (!due.length) {
        /* 2) Đơn vừa giao đã được báo (trang đang mở tự báo rồi) → chỉ thay thế lặng lẽ, không kêu lần 2 */
        const last = orders.filter((o) => o.at <= t + 30000 && t - o.at < 900000).sort((a, b) => b.at - a.at)[0];
        if (last) { due = [last]; silent = true; }
      }
      /* 3) Lệch đồng hồ thiết bị: lấy đơn sắp giao sớm nhất */
      if (!due.length) due = orders.filter((o) => !done.includes(o.code)).sort((a, b) => a.at - b.at).slice(0, 1);
      if (!due.length) {
        const g = await readData('__generic.json', null) || {};
        await self.registration.showNotification(g.title || DEF_TITLE, {
          body: g.body || 'Đơn hàng của bạn đã giao thành công tới Nhà mình. Chúc bạn ngon miệng! 😋',
          tag: '1277foods-order', data: { url: appUrl('#/orders') }
        });
        return;
      }
      for (const o of due) {
        await self.registration.showNotification(o.title || DEF_TITLE, orderNotif(o, silent));
        if (!done.includes(o.code)) done.push(o.code);
      }
      await writeData('__notified.json', done.slice(-200));
    })());
  });

  /* ---------- Chạm vào thông báo → mở đúng trang đơn hàng ---------- */
  self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const scope = self.registration.scope;
    let target = (e.notification.data && e.notification.data.url) || '';
    try { target = new URL(target.startsWith('#') ? scope + target : target, scope).href; } catch (err) { target = scope; }
    if (!target.startsWith(scope) || /\/(script\.js|style\.css)/.test(target)) target = scope;
    e.waitUntil((async () => {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of list) {
        if (!c.url.startsWith(scope)) continue;
        try {
          if (c.navigate) { const nc = await c.navigate(target); if (nc && nc.focus) await nc.focus(); else if (c.focus) await c.focus(); return; }
        } catch (err) { /* thử mở cửa sổ mới */ }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })());
  });
} else {
(function () {
/* ================= ỨNG DỤNG ================= */

/* ---------- Tiện ích ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
const fmtRating = (r) => { const s = Number(r).toFixed(1); return L() === 'vi' ? s.replace('.', ',') : s; };
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
const now = () => Date.now();
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function ago(ts) {
  const s = Math.max(0, Math.floor((now() - ts) / 1000));
  if (s < 10) return t('vừa xong');
  if (s < 60) return t('{n} giây trước', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('{n} phút trước', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('{n} giờ trước', { n: h });
  const d = Math.floor(h / 24);
  if (d < 7) return t('{n} ngày trước', { n: d });
  return new Date(ts).toLocaleDateString(loc());
}
function dateTime(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  if (L() !== 'vi') {
    try {
      const hm = d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit', hour12: false });
      const dt = d.toLocaleDateString(loc(), { year: 'numeric', month: '2-digit', day: '2-digit' });
      return `${hm} • ${dt}`;
    } catch (e) { /* dùng kiểu mặc định */ }
  }
  return `${p(d.getHours())}:${p(d.getMinutes())} • ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function rndStr(n, chars) {
  chars = chars || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const out = [];
  const buf = new Uint32Array(n);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 4294967296);
  for (let i = 0; i < n; i++) out.push(chars[buf[i] % chars.length]);
  return out.join('');
}
function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return rndStr(8, '0123456789abcdef') + '-' + rndStr(4, '0123456789abcdef') + '-' + rndStr(4, '0123456789abcdef') + '-' + rndStr(12, '0123456789abcdef');
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const pageUrl = () => location.origin + location.pathname;

/* ---------- Icon (SVG) ---------- */
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2.5 3h2.6l2.4 11.2a2 2 0 0 0 2 1.6h8.3a2 2 0 0 0 2-1.5L21.5 7H6"/>',
  cartPlus: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2.5 3h2.6l2.4 11.2a2 2 0 0 0 2 1.6h8.3a2 2 0 0 0 2-1.5L21.5 7H6"/><path d="M13.5 8v5M11 10.5h5"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  type: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  sort: '<path d="m3 8 4-4 4 4M7 4v16M21 16l-4 4-4-4M17 20V4"/>',
  sortDown: '<path d="m3 16 4 4 4-4M7 20V4M11 4h10M11 8h7M11 12h4"/>',
  sortUp: '<path d="m3 8 4-4 4 4M7 4v16M11 12h4M11 16h7M11 20h10"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20.5h.01M17.5 17.5H21V21h-3.5z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  star: '<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="16" cy="16" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="16" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="16" r="1.4" fill="currentColor"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  checkc: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16.5 9.5"/>',
  receipt: '<path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  package: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
  bike: '<circle cx="5.5" cy="17" r="3"/><circle cx="18.5" cy="17" r="3"/><path d="M5.5 17h6l2.5-6h3l1.5 6M14 11l-1.5-4H10M16 7h2"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M16 13.5h.01"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
  bank: '<path d="M3 10h18L12 4zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.2 0-2.1-.5-2.6-1.5M12 6.5V8M12 16v1.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  monitor: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  draft: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* ---------- Dữ liệu món ăn ---------- */
const MENU = [
  { id: 1, name: 'Phở bò', cat: 'bun', emoji: '🍜', rating: 5.0, price: 20000,
    img: 'https://i.ibb.co/G3RzLjMR/8ce5f8f6be5bef52542fd1aa5a12aca3.jpg',
    desc: 'Nước dùng hầm xương thơm quế hồi, bánh phở mềm cùng thịt bò ngọt mềm.',
    giavi: [['Chanh', 2000], ['Ớt tươi', 1000], ['Tương ớt', 2000], ['Tương đen', 2000]],
    ankem: [['Giá đỗ', 5000], ['Húng quế', 3000], ['Ngò gai', 2000], ['Hành lá, hành tây', 3000]] },
  { id: 2, name: 'Phở gà', cat: 'bun', emoji: '🍜', rating: 4.8, price: 50000,
    img: 'https://i.ibb.co/PskMvYD7/ef42d2b194710449677cd9dc51952a25.jpg',
    desc: 'Nước dùng gà thanh ngọt, thịt gà xé dai thơm, rắc hành lá tươi.',
    giavi: [['Chanh', 2000], ['Ớt tươi', 1000], ['Tiêu', 2000], ['Nước mắm', 2000]],
    ankem: [['Rau răm', 3000], ['Giá đỗ', 5000], ['Hành lá', 2000], ['Hành tây', 3000]] },
  { id: 3, name: 'Bánh mì thịt', cat: 'banh', emoji: '🥖', rating: 4.8, price: 35000,
    img: 'https://i.ibb.co/MxCsggdB/b6535a782fa6fb6e1991c15b44379edb.jpg',
    desc: 'Vỏ bánh giòn rụm, nhân thịt đậm đà, pate béo ngậy và rau thơm.',
    giavi: [['Tương ớt', 2000], ['Mayonnaise', 3000], ['Nước tương', 2000], ['Tiêu', 2000]],
    ankem: [['Dưa leo', 3000], ['Đồ chua', 5000], ['Ngò rí', 2000], ['Ớt tươi', 1000]] },
  { id: 4, name: 'Gỏi cuốn tôm thịt', cat: 'banh', emoji: '🥢', rating: 4.5, price: 45000,
    img: 'https://i.ibb.co/gMVgyh22/f7576bc886c91729b6853c4ae1fc91db-1.jpg',
    desc: 'Bánh tráng cuốn tôm, thịt luộc, bún và rau sống tươi mát.',
    giavi: [['Tương đậu phộng', 5000], ['Nước mắm', 2000], ['Chanh', 2000], ['Ớt tươi', 1000]],
    ankem: [['Rau sống', 5000], ['Xà lách', 3000], ['Hẹ', 2000], ['Bún tươi', 5000]] },
  { id: 5, name: 'Chả giò', cat: 'banh', emoji: '🥟', rating: 4.5, price: 50000,
    img: 'https://i.ibb.co/8GRQkdN/4543600e5521f8a2a5495edfabefd796.jpg',
    desc: 'Lớp vỏ chiên vàng giòn, nhân thịt, miến, mộc nhĩ đậm đà.',
    giavi: [['Nước mắm chua ngọt', 3000], ['Tương ớt', 2000], ['Ớt tươi', 1000], ['Tiêu', 2000]],
    ankem: [['Xà lách', 3000], ['Rau thơm', 3000], ['Dưa leo', 3000], ['Đồ chua', 5000]] },
  { id: 6, name: 'Bún chả', cat: 'bun', emoji: '🍢', rating: 4.3, price: 35000,
    img: 'https://i.ibb.co/8qmvXyJ/2f31148eb0fc332cbc552e720ad9bbfd.jpg',
    desc: 'Chả nướng than hoa thơm lừng, chấm nước mắm chua ngọt.',
    giavi: [['Nước mắm chua ngọt', 3000], ['Tỏi', 2000], ['Ớt tươi', 1000], ['Tiêu', 2000]],
    ankem: [['Bún tươi', 5000], ['Rau sống', 5000], ['Xà lách', 3000], ['Dưa leo', 3000]] },
  { id: 7, name: 'Bún bò Huế', cat: 'bun', emoji: '🌶️', rating: 4.9, price: 65000,
    img: 'https://i.ibb.co/pv9QhK4G/5fc8a0e23bae27ed6a2a5e71d03fda28.jpg',
    desc: 'Nước dùng đậm vị sả và mắm ruốc, sợi bún to, cay nồng xứ Huế.',
    giavi: [['Chanh', 2000], ['Sa tế', 3000], ['Nước mắm', 2000], ['Tiêu', 2000]],
    ankem: [['Rau muống bào', 5000], ['Bắp chuối bào', 5000], ['Giá đỗ', 5000], ['Rau thơm', 3000]] },
  { id: 8, name: 'Bún riêu', cat: 'bun', emoji: '🦀', rating: 4.2, price: 55000,
    img: 'https://i.ibb.co/dwC9rbCM/8fd71ff79967d4f3637eb280d893d3d3.jpg',
    desc: 'Riêu cua béo ngậy, cà chua chua dịu, nước dùng đỏ au.',
    giavi: [['Chanh', 2000], ['Mắm tôm', 3000], ['Ớt tươi', 1000], ['Tiêu', 2000]],
    ankem: [['Giá đỗ', 5000], ['Rau muống bào', 5000], ['Rau thơm', 3000], ['Bắp chuối bào', 5000]] },
  { id: 9, name: 'Bún mắm', cat: 'bun', emoji: '🐟', rating: 4.2, price: 50000,
    img: 'https://i.ibb.co/cXkXMCqh/4d042cf5df1726fc037ed775146f6933.jpg',
    desc: 'Nước lèo mắm cá thơm nồng, đậm đà kiểu miền Tây.',
    giavi: [['Chanh', 2000], ['Ớt tươi', 1000], ['Mắm nguyên chất', 3000], ['Tiêu', 2000]],
    ankem: [['Rau muống bào', 5000], ['Bắp chuối bào', 5000], ['Rau thơm', 3000], ['Giá đỗ', 5000]] },
  { id: 10, name: 'Bún cá', cat: 'bun', emoji: '🐠', rating: 4.3, price: 50000,
    img: 'https://i.ibb.co/LDbw04wf/045fbb9728ca44527dc8401a2d443242.jpg',
    desc: 'Chả cá chiên thơm, nước dùng thanh ngọt, ăn kèm rau tươi.',
    giavi: [['Chanh', 2000], ['Ớt tươi', 1000], ['Nước mắm', 2000], ['Tiêu', 2000]],
    ankem: [['Rau thơm', 3000], ['Giá đỗ', 5000], ['Bắp chuối bào', 5000], ['Rau muống bào', 5000]] }
];
const byId = (id) => MENU.find((d) => d.id === Number(id));

const CATS = {
  bun: { title: 'Bún/Mì/Phở', emoji: '🍜' },
  com: { title: 'Cơm', emoji: '🍚' }
};

const PAYS = [
  { k: 'cod', n: 'Thanh toán khi nhận hàng', icon: 'cash' },
  { k: 'wallet', n: 'Ví điện tử 1277Pay (ảo)', icon: 'wallet' },
  { k: 'card', n: 'Thẻ tín dụng / ghi nợ (ảo)', icon: 'card' },
  { k: 'bank', n: 'Chuyển khoản ngân hàng (ảo)', icon: 'bank' },
  { k: 'xu', n: 'Xu 1277 (ảo)', icon: 'coin' }
];
const payName = (k) => t((PAYS.find((p) => p.k === k) || PAYS[0]).n);

const SYS_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';
const FONTS = [
  { k: 'system', n: 'Phông chữ hệ thống' },
  { k: 'bevn', n: 'Be Vietnam Pro', g: 'Be+Vietnam+Pro:wght@400;500;700;800' },
  { k: 'nunito', n: 'Nunito', g: 'Nunito:wght@400;600;800' },
  { k: 'quicksand', n: 'Quicksand', g: 'Quicksand:wght@400;600;700' },
  { k: 'montserrat', n: 'Montserrat', g: 'Montserrat:wght@400;600;800' },
  { k: 'roboto', n: 'Roboto', g: 'Roboto:wght@400;500;700;900' },
  { k: 'lexend', n: 'Lexend', g: 'Lexend:wght@400;600;800' },
  { k: 'comfortaa', n: 'Comfortaa', g: 'Comfortaa:wght@400;600;700' },
  { k: 'baloo', n: 'Baloo 2', g: 'Baloo+2:wght@400;600;800' },
  { k: 'lora', n: 'Lora', g: 'Lora:wght@400;600;700' },
  { k: 'playfair', n: 'Playfair Display', g: 'Playfair+Display:wght@400;700;800' },
  { k: 'merri', n: 'Merriweather', g: 'Merriweather:wght@400;700;900' },
  { k: 'dancing', n: 'Dancing Script', g: 'Dancing+Script:wght@400;700' },
  { k: 'pacifico', n: 'Pacifico', g: 'Pacifico' },
  { k: 'patrick', n: 'Patrick Hand', g: 'Patrick+Hand' }
];
const fontStack = (f) => (f && f.g ? `'${f.n}', ${SYS_FONT}` : SYS_FONT);

/* ---------- Lưu trữ an toàn trên trình duyệt ---------- */
const KEY = '1277foods.v1';
const DEF = {
  theme: 'system', font: 'system', fontScale: 0, sort: 'none',
  cart: [], recent: [], orders: [], drafts: [], checkout: null,
  vid: '', visitDone: false, lastCount: null, ordersTab: 'coming',
  lang: 'vi', cur: '', fx: null
};
function loadState() {
  for (const k of [KEY, KEY + '.bak']) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') {
        const s = Object.assign(clone(DEF), o);
        ['cart', 'recent', 'orders', 'drafts'].forEach((a) => { if (!Array.isArray(s[a])) s[a] = []; });
        s.cart = s.cart.filter((l) => l && byId(l.id) && l.qty > 0);
        if (!['vi', 'en', 'ja', 'ko', 'zh', 'th'].includes(s.lang)) s.lang = 'vi';
        if (!['', 'VND', 'USD', 'JPY', 'KRW', 'CNY', 'THB'].includes(s.cur)) s.cur = '';
        return s;
      }
    } catch (e) { /* thử bản sao lưu */ }
  }
  return clone(DEF);
}
let S = loadState();
let memOnly = false;
function save() {
  try {
    const raw = JSON.stringify(S);
    localStorage.setItem(KEY, raw);
    localStorage.setItem(KEY + '.bak', raw);
  } catch (e) {
    if (!memOnly) { memOnly = true; console.warn('Không lưu được vào trình duyệt:', e); }
  }
}

/* Trạng thái tạm (không cần lưu) */
const UI = { q: '', open: new Set(), sel: null, soft: false, trackStage: -1, rndId: null, spinning: false };

/* ---------- Giỏ hàng ---------- */
const lineKey = (id, gv, ak) => `${id}|${[...gv].sort((a, b) => a - b).join(',')}|${[...ak].sort((a, b) => a - b).join(',')}`;
function unitPrice(l) {
  const d = byId(l.id);
  if (!d) return 0;
  let p = d.price;
  (l.giavi || []).forEach((i) => { if (d.giavi[i]) p += d.giavi[i][1]; });
  (l.ankem || []).forEach((i) => { if (d.ankem[i]) p += d.ankem[i][1]; });
  return p;
}
function optText(l) {
  const d = byId(l.id);
  if (!d) return '';
  const g = (l.giavi || []).map((i) => d.giavi[i] && oName(d.giavi[i][0])).filter(Boolean);
  const a = (l.ankem || []).map((i) => d.ankem[i] && oName(d.ankem[i][0])).filter(Boolean);
  return `${t('Gia vị')}: ${g.length ? g.join(', ') : t('Không có')} • ${t('Ăn kèm')}: ${a.length ? a.join(', ') : t('Không có')}`;
}
const cartCount = () => S.cart.reduce((a, l) => a + l.qty, 0);
const activeOrders = () => S.orders.filter((o) => stageOf(o) < 3);

function stageOf(o, t) {
  const e = (t || now()) - o.created;
  return e < o.t1 ? 0 : e < o.t2 ? 1 : e < o.t3 ? 2 : 3;
}
const STAGES = [
  { t: 'Chờ xác nhận', s: 'Quán 1277 đang xác nhận đơn của bạn', icon: 'receipt' },
  { t: 'Chờ lấy hàng', s: 'Bếp đang nấu, tài xế đang tới quán lấy món', icon: 'package' },
  { t: 'Chờ giao hàng', s: 'Tài xế đang chạy tới Nhà mình', icon: 'bike' },
  { t: 'Đã giao hàng thành công', s: 'Chúc bạn ngon miệng! 😋', icon: 'checkc' }
];

/* ---------- Ngôn ngữ & Tiền tệ ---------- */
const LANGS = [
  { k: 'vi', n: 'Tiếng Việt', code: 'VI', loc: 'vi-VN', cur: 'VND' },
  { k: 'en', n: 'English', code: 'EN', loc: 'en-US', cur: 'USD' },
  { k: 'ja', n: '日本語', code: 'JA', loc: 'ja-JP', cur: 'JPY' },
  { k: 'ko', n: '한국어', code: 'KO', loc: 'ko-KR', cur: 'KRW' },
  { k: 'zh', n: '中文', code: 'ZH', loc: 'zh-CN', cur: 'CNY' },
  { k: 'th', n: 'ภาษาไทย', code: 'TH', loc: 'th-TH', cur: 'THB' }
];
/* Thứ tự bản dịch trong từ điển: [English, 日本語, 한국어, 中文, ภาษาไทย] */
const LANG_IDX = { en: 0, ja: 1, ko: 2, zh: 3, th: 4 };
/* Tỷ giá tham khảo (số ₫ cho 1 đơn vị, cuối 11/2026). Khi có mạng, trang tự lấy tỷ giá mới. */
const CURS = [
  { k: 'VND', s: '₫', d: 0, r: 1 },
  { k: 'USD', s: '$', d: 2, r: 26280 },
  { k: 'JPY', s: '¥', d: 0, r: 163 },
  { k: 'KRW', s: '₩', d: 0, r: 19 },
  { k: 'CNY', s: '¥', d: 2, r: 3812 },
  { k: 'THB', s: '฿', d: 2, r: 760 }
];
const FX_URL = 'https://open.er-api.com/v6/latest/VND';
const TR = {};       /* 'câu tiếng Việt' → [en, ja, ko, zh, th] */
const DISH_TR = {};  /* id món → { n: [tên...], d: [mô tả...] } */
const OPT_TR = {};   /* 'tên gia vị / ăn kèm' → [en, ja, ko, zh, th] */

const L = () => (S && LANGS.some((l) => l.k === S.lang) ? S.lang : 'vi');
const langInfo = () => LANGS.find((l) => l.k === L()) || LANGS[0];
const loc = () => langInfo().loc;
const li = () => LANG_IDX[L()];
function t(key, vars) {
  let s = key;
  const i = li();
  if (i != null) { const e = TR[key]; if (e && e[i]) s = e[i]; }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
  return s;
}
function dName(d) {
  if (!d) return '';
  const i = li(), e = DISH_TR[d.id];
  return (i != null && e && e.n[i]) || d.name;
}
function dDesc(d) {
  if (!d) return '';
  const i = li(), e = DISH_TR[d.id];
  return (i != null && e && e.d[i]) || d.desc;
}
function oName(n) {
  const i = li(), e = OPT_TR[n];
  return (i != null && e && e[i]) || n;
}
/* Tên món trong đơn hàng đã lưu (đơn cũ vẫn hiện đúng) */
const itName = (it) => (byId(it.id) ? dName(byId(it.id)) : it.name || '');
const numFmt = (n) => Number(n).toLocaleString(loc());

/* Tiền tệ: giá gốc luôn tính bằng ₫, chỉ quy đổi khi hiển thị */
function curInfo() {
  const k = S.cur || langInfo().cur;
  return CURS.find((c) => c.k === k) || CURS[0];
}
function rateOf(c) {
  const r = S.fx && S.fx.r && Number(S.fx.r[c.k]);
  return r && r > c.r * 0.4 && r < c.r * 2.5 ? r : c.r;
}
function fmtCur(vnd, c) {
  const v = c.k === 'VND' ? Math.round(vnd) : vnd / rateOf(c);
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: c.d, maximumFractionDigits: c.d });
  return (v < 0 ? '-' : '') + c.s + s;
}
const fmt = (n) => fmtCur(Number(n) || 0, curInfo());
function fxNote() {
  const c = curInfo();
  if (c.k === 'VND') return esc(t('Giá gốc của món ăn tính bằng Việt Nam Đồng (₫).'));
  const live = !!(S.fx && S.fx.r && S.fx.r[c.k]);
  return `1 ${c.k} ≈ ₫${Math.round(rateOf(c)).toLocaleString('en-US')} • ${esc(t('Tỷ giá tham khảo'))}` +
    (live ? ` • <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Rates By Exchange Rate API</a>` : '');
}
let fxBusy = false;
async function refreshFx(force) {
  if (fxBusy || !navigator.onLine) return;
  if (!force && S.fx && S.fx.t && now() - S.fx.t < 6 * 3600000) return;
  fxBusy = true;
  const ctl = 'AbortController' in window ? new AbortController() : null;
  const to = setTimeout(() => ctl && ctl.abort(), 9000);
  try {
    const res = await fetch(FX_URL, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    const j = await res.json();
    if (!j || j.result !== 'success' || !j.rates) return;
    const r = {};
    CURS.forEach((c) => { const x = Number(j.rates[c.k]); if (c.k !== 'VND' && x > 0 && isFinite(x)) r[c.k] = 1 / x; });
    if (!Object.keys(r).length) return;
    const before = fmt(100000);
    S.fx = { t: now(), r };
    save();
    if (fmt(100000) !== before && typeof onFxChange === 'function') onFxChange();
  } catch (e) { /* dùng tỷ giá tham khảo */ } finally { clearTimeout(to); fxBusy = false; }
}

/* ---------- Từ điển (1/4): [English, 日本語, 한국어, 中文, ภาษาไทย] ---------- */
Object.assign(TR, {
  "vừa xong": ["just now", "たった今", "방금", "刚刚", "เมื่อสักครู่"],
  "{n} giây trước": ["{n}s ago", "{n}秒前", "{n}초 전", "{n}秒前", "{n} วินาทีที่แล้ว"],
  "{n} phút trước": ["{n} min ago", "{n}分前", "{n}분 전", "{n}分钟前", "{n} นาทีที่แล้ว"],
  "{n} giờ trước": ["{n}h ago", "{n}時間前", "{n}시간 전", "{n}小时前", "{n} ชั่วโมงที่แล้ว"],
  "{n} ngày trước": ["{n}d ago", "{n}日前", "{n}일 전", "{n}天前", "{n} วันที่แล้ว"],
  "Gia vị": ["Seasoning", "調味料", "양념", "调料", "เครื่องปรุง"],
  "Không có": ["None", "なし", "없음", "无", "ไม่มี"],
  "Ăn kèm": ["Sides", "付け合わせ", "곁들임", "配菜", "เครื่องเคียง"],
  "Giá gốc của món ăn tính bằng Việt Nam Đồng (₫).": ["Original prices are in Vietnamese Dong (₫).", "元の価格はベトナムドン（₫）です。", "원래 가격은 베트남 동(₫)입니다.", "原价以越南盾（₫）计算。", "ราคาเดิมเป็นเงินด่องเวียดนาม (₫)"],
  "Tỷ giá tham khảo": ["Reference rate", "参考レート", "참고 환율", "参考汇率", "อัตราแลกเปลี่ยนอ้างอิง"],
  "{r} sao": ["{r} stars", "星{r}", "별점 {r}", "{r}星", "{r} ดาว"],
  "Giỏ hàng": ["Cart", "カート", "장바구니", "购物车", "ตะกร้า"],
  "Quay lại": ["Back", "戻る", "뒤로", "返回", "กลับ"],
  "Trang giả lập vui vẻ: không giao hàng thật, không thu tiền thật.": ["A just-for-fun simulator: no real delivery, no real payment.", "お遊びのシミュレーターです：実際の配達も支払いもありません。", "재미로 만든 시뮬레이터: 실제 배달도, 실제 결제도 없어요.", "娱乐模拟网站：不真实配送，不真实收费。", "เว็บจำลองเพื่อความสนุก: ไม่มีการจัดส่งจริง ไม่มีการเก็บเงินจริง"],
  "Đang trực tuyến": ["Online", "オンライン", "온라인", "在线", "ออนไลน์"],
  "Ngoại tuyến – vẫn dùng bình thường": ["Offline – still works normally", "オフライン – 通常どおり使えます", "오프라인 – 그대로 사용할 수 있어요", "离线 – 仍可正常使用", "ออฟไลน์ – ยังใช้งานได้ตามปกติ"],
  "Xem {n}": ["View {n}", "{n}を見る", "{n} 보기", "查看{n}", "ดู {n}"],
  "Thêm {n} vào giỏ": ["Add {n} to cart", "{n}をカートに追加", "{n} 장바구니에 담기", "将{n}加入购物车", "เพิ่ม {n} ลงตะกร้า"],
  "Không tìm thấy món nào": ["No dishes found", "料理が見つかりません", "찾는 메뉴가 없어요", "未找到菜品", "ไม่พบเมนู"],
  "Không có món phù hợp với “{q}”. Thử từ khoá khác nhé!": ["Nothing matches “{q}”. Try another keyword!", "「{q}」に一致する料理はありません。別のキーワードを試してください！", "“{q}”에 맞는 메뉴가 없어요. 다른 검색어로 찾아보세요!", "没有与“{q}”匹配的菜品，换个关键词试试吧！", "ไม่มีเมนูที่ตรงกับ “{q}” ลองคำค้นอื่นนะ!"],
  "Chưa có món": ["No dishes yet", "料理はまだありません", "아직 메뉴가 없어요", "暂无菜品", "ยังไม่มีเมนู"],
  "Danh sách đang trống.": ["The list is empty.", "リストは空です。", "목록이 비어 있어요.", "列表为空。", "รายการว่างเปล่า"],
  "Trình duyệt này không hỗ trợ thông báo": ["This browser doesn't support notifications", "このブラウザは通知に対応していません", "이 브라우저는 알림을 지원하지 않아요", "此浏览器不支持通知", "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน"],
  "Thông báo giao hàng": ["Delivery notifications", "配達通知", "배달 알림", "送达通知", "การแจ้งเตือนการจัดส่ง"],
  "báo cả khi đã thoát trình duyệt": ["even after closing the browser", "ブラウザを閉じても届きます", "브라우저를 닫아도 알려 드려요", "关闭浏览器后也会提醒", "แจ้งแม้ปิดเบราว์เซอร์แล้ว"],
  "Đã bật": ["On", "オン", "켜짐", "已开启", "เปิดแล้ว"],
  "Thông báo đang bị chặn – mở cài đặt trang web của trình duyệt để cho phép": ["Notifications are blocked – allow them in your browser's site settings", "通知がブロックされています – ブラウザのサイト設定で許可してください", "알림이 차단되어 있어요 – 브라우저의 사이트 설정에서 허용해 주세요", "通知已被阻止 – 请在浏览器的网站设置中允许", "การแจ้งเตือนถูกบล็อก – เปิดอนุญาตได้ในการตั้งค่าเว็บไซต์ของเบราว์เซอร์"],
  "Nhận thông báo khi giao hàng thành công": ["Get notified when your order is delivered", "配達完了時に通知を受け取る", "배달이 완료되면 알림 받기", "送达成功时接收通知", "รับการแจ้งเตือนเมื่อจัดส่งสำเร็จ"],
  "Bật": ["Turn on", "オンにする", "켜기", "开启", "เปิด"],
  "Cỡ chữ hiện tại: {v}": ["Current text size: {v}", "現在の文字サイズ：{v}", "현재 글자 크기: {v}", "当前字号：{v}", "ขนาดตัวอักษรปัจจุบัน: {v}"],
  "Giao diện": ["Appearance", "表示モード", "화면 모드", "外观", "ธีม"],
  "Sáng": ["Light", "ライト", "라이트", "浅色", "สว่าง"],
  "Tối": ["Dark", "ダーク", "다크", "深色", "มืด"],
  "Hệ thống": ["System", "システム", "시스템", "跟随系统", "ตามระบบ"],
  "Thông báo": ["Notifications", "通知", "알림", "通知", "การแจ้งเตือน"],
  "Đổi cỡ chữ": ["Text size", "文字サイズ", "글자 크기", "字号", "ขนาดตัวอักษร"],
  "Giảm cỡ chữ": ["Smaller text", "文字を小さく", "글자 작게", "缩小字号", "ลดขนาดตัวอักษร"],
  "Mặc định": ["Default", "標準", "기본", "默认", "ค่าเริ่มต้น"],
  "Tăng cỡ chữ": ["Larger text", "文字を大きく", "글자 크게", "放大字号", "เพิ่มขนาดตัวอักษร"],
  "Sắp xếp theo giá: Cao đến Thấp": ["Sort by price: High to Low", "価格順：高い順", "가격순: 높은 순", "按价格：从高到低", "เรียงตามราคา: สูงไปต่ำ"],
  "Sắp xếp theo giá: Thấp đến Cao": ["Sort by price: Low to High", "価格順：安い順", "가격순: 낮은 순", "按价格：从低到高", "เรียงตามราคา: ต่ำไปสูง"],
  "Chia sẻ ngay": ["Share now", "今すぐシェア", "지금 공유", "立即分享", "แชร์เลย"],
  "Sao chép link": ["Copy link", "リンクをコピー", "링크 복사", "复制链接", "คัดลอกลิงก์"],
  "Mã QR code": ["QR code", "QRコード", "QR 코드", "二维码", "คิวอาร์โค้ด"],
  "Nhấn để mở toàn màn hình": ["Tap to open full screen", "タップで全画面表示", "눌러서 전체 화면으로 보기", "点击全屏打开", "แตะเพื่อเปิดเต็มจอ"],
  "Mã QR của trang": ["QR code for this page", "このページのQRコード", "이 페이지의 QR 코드", "本页面二维码", "คิวอาร์โค้ดของหน้านี้"],
  "Mở hình ảnh mã QR": ["Open QR code image", "QRコード画像を開く", "QR 코드 이미지 열기", "打开二维码图片", "เปิดรูปคิวอาร์โค้ด"],
  "Quét để mở trang trên máy khác": ["Scan to open on another device", "スキャンして別の端末で開く", "스캔해서 다른 기기에서 열기", "扫码在其他设备上打开", "สแกนเพื่อเปิดบนเครื่องอื่น"],
  "Đã xem {t}": ["Viewed {t}", "{t}に閲覧", "{t} 봄", "{t}看过", "ดูเมื่อ {t}"],
  "Bạn chưa xem món nào. Chạm vào một món bên dưới để bắt đầu nhé! 👇": ["You haven't viewed any dishes yet. Tap one below to start! 👇", "まだ料理を見ていません。下の料理をタップしてみましょう！👇", "아직 본 메뉴가 없어요. 아래 메뉴를 눌러 시작해 보세요! 👇", "你还没有看过任何菜品，点击下方菜品开始吧！👇", "คุณยังไม่ได้ดูเมนูไหนเลย แตะเมนูด้านล่างเพื่อเริ่มกันเลย! 👇"],
  "Trang chủ": ["Home", "ホーム", "홈", "首页", "หน้าแรก"],
  "Tìm kiếm": ["Search", "検索", "검색", "搜索", "ค้นหา"],
  "Tìm kiếm món ăn": ["Search dishes", "料理を検索", "메뉴 검색", "搜索菜品", "ค้นหาเมนู"],
  "Đặt Đồ Ăn Ảo – Chỉ Vui, Không Lo Gì Cả": ["Virtual Food Ordering – Just for Fun, Zero Worries", "バーチャル料理注文 – 楽しむだけ、心配ゼロ", "가상 음식 주문 – 재미만 있고 걱정은 없어요", "虚拟点餐 – 只为开心，毫无负担", "สั่งอาหารเสมือน – สนุกอย่างเดียว ไม่ต้องกังวลอะไรเลย"],
  "Lượt truy cập": ["Visits", "訪問数", "방문 수", "访问量", "จำนวนผู้เข้าชม"]
});

/* ---------- Từ điển (2/4) ---------- */
Object.assign(TR, {
  "Đơn hàng": ["Orders", "注文", "주문", "订单", "คำสั่งซื้อ"],
  "Bún, Mì, Phở": ["Noodles & Phở", "麺・フォー", "국수·쌀국수", "米线·面·河粉", "ก๋วยเตี๋ยว & เฝอ"],
  "Cơm": ["Rice", "ご飯もの", "밥", "米饭", "ข้าว"],
  "Bún/Mì/Phở": ["Noodles/Phở", "麺/フォー", "국수/쌀국수", "米线/面/河粉", "ก๋วยเตี๋ยว/เฝอ"],
  "Chọn ngẫu nhiên": ["Random pick", "ランダムに選ぶ", "랜덤 선택", "随机挑选", "สุ่มเลือก"],
  "Cài đặt": ["Settings", "設定", "설정", "设置", "การตั้งค่า"],
  "Sáng / Tối / Hệ thống": ["Light / Dark / System", "ライト / ダーク / システム", "라이트 / 다크 / 시스템", "浅色 / 深色 / 跟随系统", "สว่าง / มืด / ตามระบบ"],
  "Ngôn ngữ": ["Language", "言語", "언어", "语言", "ภาษา"],
  "Tiền tệ": ["Currency", "通貨", "통화", "货币", "สกุลเงิน"],
  "Đổi phông chữ": ["Change font", "フォント変更", "글꼴 변경", "更换字体", "เปลี่ยนฟอนต์"],
  "Phông chữ & cỡ chữ": ["Font & text size", "フォントと文字サイズ", "글꼴 및 글자 크기", "字体和字号", "ฟอนต์และขนาดตัวอักษร"],
  "Phông chữ hệ thống": ["System font", "システムフォント", "시스템 글꼴", "系统字体", "ฟอนต์ของระบบ"],
  "Sắp xếp": ["Sort", "並べ替え", "정렬", "排序", "เรียงลำดับ"],
  "Theo giá món ăn": ["By dish price", "料理の価格順", "메뉴 가격순", "按菜品价格", "ตามราคาอาหาร"],
  "Chia sẻ": ["Share", "シェア", "공유", "分享", "แชร์"],
  "Gửi trang & mã QR": ["Send link & QR code", "リンクとQRコードを送る", "링크 및 QR 코드 보내기", "发送链接和二维码", "ส่งลิงก์และคิวอาร์โค้ด"],
  "Xem gần đây": ["Recently viewed", "最近見た料理", "최근 본 메뉴", "最近浏览", "ดูล่าสุด"],
  "Xem thêm": ["See more", "もっと見る", "더 보기", "查看更多", "ดูเพิ่มเติม"],
  "Món ăn Việt Nam": ["Vietnamese dishes", "ベトナム料理", "베트남 요리", "越南美食", "อาหารเวียดนาม"],
  "{n} món": ["{n} items", "{n}品", "{n}개", "{n}道", "{n} รายการ"],
  "Giá: Cao đến Thấp": ["Price: High to Low", "価格：高い順", "가격: 높은 순", "价格：从高到低", "ราคา: สูงไปต่ำ"],
  "Giá: Thấp đến Cao": ["Price: Low to High", "価格：安い順", "가격: 낮은 순", "价格：从低到高", "ราคา: ต่ำไปสูง"],
  "Đã bỏ sắp xếp": ["Sorting cleared", "並べ替えを解除しました", "정렬을 해제했어요", "已取消排序", "ยกเลิกการเรียงลำดับแล้ว"],
  "Chưa có món {c}": ["No {c} dishes yet", "{c}の料理はまだありません", "아직 {c} 메뉴가 없어요", "暂无{c}类菜品", "ยังไม่มีเมนู{c}"],
  "Món {c} đang được bếp chuẩn bị, bạn quay lại sau nhé! Trong lúc chờ, xem thử các món khác.": ["Our kitchen is still preparing {c} dishes – check back later! Meanwhile, try our other dishes.", "{c}の料理は準備中です。また後で来てね！それまで他の料理をどうぞ。", "{c} 메뉴는 주방에서 준비 중이에요. 나중에 다시 들러 주세요! 그동안 다른 메뉴를 구경해 보세요.", "{c}类菜品正在准备中，请稍后再来！先看看其他菜品吧。", "ครัวกำลังเตรียมเมนู{c} แวะมาใหม่นะ! ระหว่างนี้ลองดูเมนูอื่นก่อน"],
  "Xem món khác": ["See other dishes", "他の料理を見る", "다른 메뉴 보기", "看看其他菜品", "ดูเมนูอื่น"],
  "Xóa lịch sử xem": ["Clear history", "閲覧履歴を消去", "기록 지우기", "清除浏览记录", "ล้างประวัติการดู"],
  "Chưa xem món nào": ["Nothing viewed yet", "まだ何も見ていません", "아직 본 메뉴가 없어요", "还没有浏览过菜品", "ยังไม่ได้ดูเมนูใด"],
  "Các món bạn đã xem sẽ hiện ở đây kèm thời gian xem.": ["Dishes you view will appear here with the time you viewed them.", "見た料理が閲覧時間とともにここに表示されます。", "본 메뉴가 본 시간과 함께 여기에 표시돼요.", "你浏览过的菜品会连同浏览时间显示在这里。", "เมนูที่คุณดูจะแสดงที่นี่พร้อมเวลาที่ดู"],
  "Khám phá món ngon": ["Explore dishes", "おいしい料理を探す", "맛있는 메뉴 둘러보기", "探索美食", "สำรวจเมนูอร่อย"],
  "(chọn nhiều được)": ["(choose any)", "（複数選択可）", "(여러 개 선택 가능)", "（可多选）", "(เลือกได้หลายอย่าง)"],
  "Ảnh {n}": ["Photo {n}", "写真{n}", "사진 {n}", "图片{n}", "รูปที่ {n}"],
  "Đánh giá": ["Rating", "評価", "평점", "评分", "คะแนน"],
  "Số lượng": ["Quantity", "数量", "수량", "数量", "จำนวน"],
  "Giảm": ["Decrease", "減らす", "줄이기", "减少", "ลด"],
  "Tăng": ["Increase", "増やす", "늘리기", "增加", "เพิ่ม"],
  "Tạm tính": ["Subtotal", "小計", "소계", "小计", "ยอดรวมย่อย"],
  "Thêm vào Giỏ hàng": ["Add to Cart", "カートに追加", "장바구니 담기", "加入购物车", "เพิ่มลงตะกร้า"],
  "Mua ngay": ["Buy now", "今すぐ購入", "바로 구매", "立即购买", "ซื้อเลย"],
  "Không tìm thấy": ["Not found", "見つかりません", "찾을 수 없음", "未找到", "ไม่พบ"],
  "Không tìm thấy trang": ["Page not found", "ページが見つかりません", "페이지를 찾을 수 없어요", "页面不存在", "ไม่พบหน้านี้"],
  "Trang bạn mở không tồn tại hoặc đã bị xoá.": ["The page you opened doesn't exist or has been removed.", "開いたページは存在しないか、削除されました。", "연 페이지가 없거나 삭제되었어요.", "你打开的页面不存在或已被删除。", "หน้าที่คุณเปิดไม่มีอยู่หรือถูกลบไปแล้ว"],
  "Về trang chủ": ["Go home", "ホームへ", "홈으로", "返回首页", "กลับหน้าแรก"],
  "Giỏ hàng ({n})": ["Cart ({n})", "カート（{n}）", "장바구니 ({n})", "购物车（{n}）", "ตะกร้า ({n})"],
  "Giỏ hàng đang trống": ["Your cart is empty", "カートは空です", "장바구니가 비어 있어요", "购物车是空的", "ตะกร้าว่างเปล่า"],
  "Thêm vài món ngon vào giỏ rồi quay lại đây nhé!": ["Add some tasty dishes, then come back here!", "おいしい料理をカートに入れてから戻ってきてね！", "맛있는 메뉴를 담고 다시 와 주세요!", "先加几道美食到购物车再回来吧！", "เพิ่มเมนูอร่อยลงตะกร้าแล้วกลับมาที่นี่นะ!"],
  "Chọn món": ["Select item", "商品を選択", "메뉴 선택", "选择菜品", "เลือกเมนู"],
  "Xóa món": ["Remove item", "商品を削除", "메뉴 삭제", "删除菜品", "ลบเมนู"],
  "Tất cả": ["All", "すべて", "전체", "全选", "ทั้งหมด"],
  "Tổng cộng": ["Total", "合計", "합계", "合计", "ยอดรวม"],
  "Mua hàng ({n})": ["Checkout ({n})", "購入する（{n}）", "구매하기 ({n})", "去结算（{n}）", "สั่งซื้อ ({n})"],
  "Thanh toán": ["Checkout", "お支払い", "결제", "结算", "ชำระเงิน"],
  "Chưa có món để thanh toán": ["Nothing to check out yet", "支払う料理がまだありません", "결제할 메뉴가 아직 없어요", "暂无可结算的菜品", "ยังไม่มีเมนูให้ชำระเงิน"],
  "Hãy chọn món trong giỏ hàng hoặc bấm “Mua ngay” ở một món bất kỳ.": ["Select items in your cart or tap “Buy now” on any dish.", "カートで料理を選ぶか、料理の「今すぐ購入」をタップしてください。", "장바구니에서 메뉴를 선택하거나 메뉴에서 “바로 구매”를 눌러 주세요.", "请在购物车中选择菜品，或在任意菜品上点击“立即购买”。", "เลือกเมนูในตะกร้า หรือแตะ “ซื้อเลย” ที่เมนูใดก็ได้"],
  "Tới giỏ hàng": ["Go to cart", "カートへ", "장바구니로", "前往购物车", "ไปที่ตะกร้า"]
});

/* ---------- Từ điển (3/4) ---------- */
Object.assign(TR, {
  "Địa chỉ Giao hàng": ["Delivery address", "お届け先", "배달 주소", "收货地址", "ที่อยู่จัดส่ง"],
  "Nhà mình": ["My Home", "わが家", "우리 집", "我家", "บ้านเรา"],
  "Địa chỉ tượng trưng – trang không dùng địa chỉ thật của bạn hay của bất kỳ ai.": ["A symbolic address – this site never uses your or anyone's real address.", "象徴的な住所です – 本サイトはあなたや他人の実際の住所を使いません。", "상징적인 주소예요 – 이 사이트는 당신이나 누구의 실제 주소도 사용하지 않아요.", "象征性地址 – 本网站不会使用你或任何人的真实地址。", "ที่อยู่สมมติ – เว็บนี้ไม่ใช้ที่อยู่จริงของคุณหรือของใครเลย"],
  "Món đã chọn ({n})": ["Selected items ({n})", "選んだ料理（{n}）", "선택한 메뉴 ({n})", "已选菜品（{n}）", "เมนูที่เลือก ({n})"],
  "Phương thức thanh toán": ["Payment method", "お支払い方法", "결제 수단", "支付方式", "วิธีชำระเงิน"],
  "Thanh toán khi nhận hàng": ["Cash on delivery", "代金引換", "만나서 결제", "货到付款", "เก็บเงินปลายทาง"],
  "Ví điện tử 1277Pay (ảo)": ["1277Pay e-wallet (virtual)", "1277Pay電子マネー（仮想）", "1277Pay 전자지갑 (가상)", "1277Pay电子钱包（虚拟）", "อีวอลเล็ต 1277Pay (เสมือน)"],
  "Thẻ tín dụng / ghi nợ (ảo)": ["Credit / debit card (virtual)", "クレジット / デビットカード（仮想）", "신용 / 체크카드 (가상)", "信用卡 / 借记卡（虚拟）", "บัตรเครดิต / เดบิต (เสมือน)"],
  "Chuyển khoản ngân hàng (ảo)": ["Bank transfer (virtual)", "銀行振込（仮想）", "계좌이체 (가상)", "银行转账（虚拟）", "โอนผ่านธนาคาร (เสมือน)"],
  "Xu 1277 (ảo)": ["1277 Coins (virtual)", "1277コイン（仮想）", "1277 코인 (가상)", "1277金币（虚拟）", "เหรียญ 1277 (เสมือน)"],
  "Tạm tính ({n} món)": ["Subtotal ({n} items)", "小計（{n}品）", "소계 ({n}개)", "小计（{n}道）", "ยอดรวมย่อย ({n} รายการ)"],
  "Phí giao hàng": ["Delivery fee", "配達料", "배달비", "配送费", "ค่าจัดส่ง"],
  "Miễn phí": ["Free", "無料", "무료", "免费", "ฟรี"],
  "Giảm giá": ["Discount", "割引", "할인", "优惠", "ส่วนลด"],
  "Đặt hàng": ["Place order", "注文する", "주문하기", "提交订单", "สั่งซื้อ"],
  "Đặt hàng thành công! Đang chờ quán xác nhận…": ["Order placed! Waiting for the restaurant to confirm…", "注文しました！お店の確認を待っています…", "주문 완료! 가게의 확인을 기다리는 중…", "下单成功！正在等待商家确认…", "สั่งซื้อสำเร็จ! กำลังรอร้านยืนยัน…"],
  "và {n} món khác": ["and {n} more", "ほか{n}品", "외 {n}개", "等{n}道菜", "และอีก {n} รายการ"],
  "Giao tới sau {t}": ["Arrives in {t}", "あと{t}でお届け", "{t} 후 도착", "{t}后送达", "จะถึงใน {t}"],
  "Tổng": ["Total", "合計", "합계", "合计", "รวม"],
  "Đang đến": ["On the way", "配達中", "배달 중", "配送中", "กำลังมา"],
  "Deal đã mua": ["Bought deals", "購入済み", "구매한 딜", "已购商品", "ดีลที่ซื้อแล้ว"],
  "Lịch sử": ["History", "履歴", "내역", "历史", "ประวัติ"],
  "Đơn nháp": ["Drafts", "下書き", "임시 저장", "草稿", "ฉบับร่าง"],
  "Không có đơn nào đang đến": ["No orders on the way", "配達中の注文はありません", "배달 중인 주문이 없어요", "暂无配送中的订单", "ไม่มีคำสั่งซื้อที่กำลังมา"],
  "Đặt một món ngon để xem tài xế chạy tới Nhà mình nhé!": ["Order something tasty and watch the rider head to My Home!", "おいしい料理を注文して、配達員がわが家へ向かう様子を見てみよう！", "맛있는 메뉴를 주문하고 라이더가 우리 집으로 오는 걸 지켜보세요!", "点一道美食，看骑手奔向我家吧！", "สั่งเมนูอร่อยแล้วดูไรเดอร์วิ่งมาที่บ้านเรากัน!"],
  "Đặt món ngay": ["Order now", "今すぐ注文", "지금 주문하기", "立即点餐", "สั่งเลย"],
  "Chưa có lịch sử": ["No history yet", "履歴はまだありません", "아직 내역이 없어요", "暂无历史记录", "ยังไม่มีประวัติ"],
  "Các đơn đã giao thành công sẽ được lưu ở đây.": ["Delivered orders will be saved here.", "配達完了した注文はここに保存されます。", "배달 완료된 주문이 여기에 저장돼요.", "已送达的订单会保存在这里。", "คำสั่งซื้อที่จัดส่งสำเร็จจะถูกเก็บไว้ที่นี่"],
  "Đã mua {q} phần • Lần gần nhất {t}": ["Bought {q} • Last {t}", "{q}点購入 • 最終{t}", "{q}개 구매 • 최근 {t}", "已购{q}份 • 最近{t}", "ซื้อแล้ว {q} ที่ • ล่าสุด {t}"],
  "Đã chi (ảo)": ["Spent (virtual)", "支払額（仮想）", "사용 금액 (가상)", "已花费（虚拟）", "ใช้ไป (เสมือน)"],
  "Mua lại": ["Buy again", "もう一度買う", "다시 구매", "再次购买", "ซื้ออีกครั้ง"],
  "Chưa có deal nào": ["No deals yet", "購入済みの商品はまだありません", "아직 구매한 딜이 없어요", "暂无已购商品", "ยังไม่มีดีล"],
  "Món bạn đã nhận sẽ hiện ở đây để mua lại thật nhanh.": ["Dishes you've received will show up here for quick reordering.", "受け取った料理がここに表示され、すぐに再注文できます。", "받은 메뉴가 여기에 표시되어 빠르게 다시 주문할 수 있어요.", "你收到的菜品会显示在这里，方便快速回购。", "เมนูที่คุณได้รับจะแสดงที่นี่ เพื่อสั่งซ้ำได้อย่างรวดเร็ว"],
  "Xóa": ["Delete", "削除", "삭제", "删除", "ลบ"],
  "Tiếp tục thanh toán": ["Continue to checkout", "支払いを続ける", "결제 계속하기", "继续结算", "ชำระเงินต่อ"],
  "Không có đơn nháp": ["No drafts", "下書きはありません", "임시 저장된 주문이 없어요", "暂无草稿", "ไม่มีฉบับร่าง"],
  "Khi bạn vào trang Thanh toán mà chưa đặt hàng, đơn sẽ được lưu nháp ở đây.": ["If you open Checkout without placing the order, it's saved here as a draft.", "お支払い画面を開いて注文しなかった場合、ここに下書きとして保存されます。", "결제 화면에서 주문하지 않고 나가면 여기에 임시 저장돼요.", "进入结算页但未下单时，订单会以草稿形式保存在这里。", "หากเข้าหน้าชำระเงินแต่ยังไม่สั่งซื้อ คำสั่งซื้อจะถูกบันทึกเป็นฉบับร่างไว้ที่นี่"],
  "Theo dõi đơn hàng": ["Track order", "注文の追跡", "주문 추적", "订单跟踪", "ติดตามคำสั่งซื้อ"],
  "Chờ xác nhận": ["Awaiting confirmation", "確認待ち", "확인 대기", "待确认", "รอยืนยัน"],
  "Quán 1277 đang xác nhận đơn của bạn": ["1277 Restaurant is confirming your order", "1277食堂が注文を確認しています", "1277 식당이 주문을 확인하고 있어요", "1277餐厅正在确认你的订单", "ร้าน 1277 กำลังยืนยันคำสั่งซื้อของคุณ"],
  "Chờ lấy hàng": ["Awaiting pickup", "集荷待ち", "픽업 대기", "待取餐", "รอรับอาหาร"],
  "Bếp đang nấu, tài xế đang tới quán lấy món": ["The kitchen is cooking, the rider is heading to pick it up", "調理中です。配達員がお店へ向かっています", "주방에서 조리 중이고 라이더가 픽업하러 가고 있어요", "后厨正在烹饪，骑手正赶去取餐", "ครัวกำลังปรุง ไรเดอร์กำลังไปรับอาหารที่ร้าน"],
  "Chờ giao hàng": ["Out for delivery", "配達中", "배달 중", "配送中", "กำลังจัดส่ง"],
  "Tài xế đang chạy tới Nhà mình": ["The rider is on the way to My Home", "配達員がわが家へ向かっています", "라이더가 우리 집으로 오고 있어요", "骑手正在赶往我家", "ไรเดอร์กำลังมาที่บ้านเรา"],
  "Đã giao hàng thành công": ["Delivered successfully", "配達完了", "배달 완료", "已成功送达", "จัดส่งสำเร็จ"],
  "Chúc bạn ngon miệng! 😋": ["Enjoy your meal! 😋", "どうぞ召し上がれ！😋", "맛있게 드세요! 😋", "祝你用餐愉快！😋", "ทานให้อร่อยนะ! 😋"],
  "Đã giao lúc {t}": ["Delivered at {t}", "{t}に配達完了", "{t}에 배달 완료", "送达时间 {t}", "จัดส่งเมื่อ {t}"],
  "Thời gian giao tới nhà còn": ["Time until delivery", "お届けまで残り", "도착까지 남은 시간", "距离送达还有", "เวลาที่เหลือก่อนถึงบ้าน"],
  "Sao chép mã đơn": ["Copy order code", "注文番号をコピー", "주문 번호 복사", "复制订单号", "คัดลอกรหัสคำสั่งซื้อ"],
  "Bản đồ đường đi của tài xế": ["Rider's route map", "配達員のルートマップ", "라이더 경로 지도", "骑手路线地图", "แผนที่เส้นทางไรเดอร์"],
  "Quán 1277": ["1277 Restaurant", "1277食堂", "1277 식당", "1277餐厅", "ร้าน 1277"],
  "Tài xế": ["Rider", "配達員", "라이더", "骑手", "ไรเดอร์"],
  "Chi tiết đơn ({n} món)": ["Order details ({n} items)", "注文内容（{n}品）", "주문 상세 ({n}개)", "订单详情（{n}道）", "รายละเอียดคำสั่งซื้อ ({n} รายการ)"],
  "Địa chỉ": ["Address", "住所", "주소", "地址", "ที่อยู่"],
  "Đặt lúc": ["Ordered at", "注文日時", "주문 시간", "下单时间", "สั่งเมื่อ"]
});

/* ---------- Từ điển (4/4) ---------- */
Object.assign(TR, {
  "Sao chép đơn hàng": ["Copy order", "注文をコピー", "주문 복사", "复制订单", "คัดลอกคำสั่งซื้อ"],
  "Đặt lại": ["Reorder", "再注文", "다시 주문", "再来一单", "สั่งอีกครั้ง"],
  "Quán đang xác nhận đơn…": ["Restaurant is confirming…", "お店が確認中…", "가게에서 확인 중…", "商家确认中…", "ร้านกำลังยืนยัน…"],
  "Đang nấu – tài xế chờ lấy món": ["Cooking – rider waiting for pickup", "調理中 – 配達員が受け取り待ち", "조리 중 – 라이더 픽업 대기", "烹饪中 – 骑手等待取餐", "กำลังปรุง – ไรเดอร์รอรับอาหาร"],
  "Đang giao • còn {t}": ["Delivering • {t} left", "配達中 • 残り{t}", "배달 중 • {t} 남음", "配送中 • 还剩{t}", "กำลังส่ง • เหลือ {t}"],
  "Đã tới Nhà mình": ["Arrived at My Home", "わが家に到着", "우리 집 도착", "已到达我家", "ถึงบ้านเราแล้ว"],
  "Đơn hàng #{c}": ["Order #{c}", "注文 #{c}", "주문 #{c}", "订单 #{c}", "คำสั่งซื้อ #{c}"],
  "Đơn hàng ảo – chỉ vui, không giao thật 😄": ["Virtual order – just for fun, no real delivery 😄", "仮想の注文 – 楽しむだけで実際には届きません 😄", "가상 주문 – 재미로만, 실제 배달은 없어요 😄", "虚拟订单 – 只为好玩，不会真的送达 😄", "คำสั่งซื้อเสมือน – เพื่อความสนุก ไม่มีการส่งจริง 😄"],
  "Sông 1277": ["1277 River", "1277川", "1277강", "1277河", "แม่น้ำ 1277"],
  "Mã đơn #{c}": ["Order #{c}", "注文番号 #{c}", "주문 번호 #{c}", "订单号 #{c}", "รหัสคำสั่งซื้อ #{c}"],
  "Đóng": ["Close", "閉じる", "닫기", "关闭", "ปิด"],
  "Đã hiểu": ["Got it", "わかりました", "알겠어요", "知道了", "เข้าใจแล้ว"],
  "Thoát": ["Close", "閉じる", "닫기", "退出", "ออก"],
  "Hôm nay ăn gì?": ["What to eat today?", "今日は何を食べる？", "오늘 뭐 먹지?", "今天吃什么？", "วันนี้กินอะไรดี?"],
  "Chọn lại": ["Pick again", "もう一度", "다시 고르기", "重新挑选", "สุ่มใหม่"],
  "Xem món": ["View dish", "料理を見る", "메뉴 보기", "查看菜品", "ดูเมนู"],
  "Quét mã bằng camera để mở trang": ["Scan with your camera to open the page", "カメラでスキャンしてページを開く", "카메라로 스캔해서 페이지 열기", "用相机扫码打开页面", "สแกนด้วยกล้องเพื่อเปิดหน้าเว็บ"],
  "Không tạo được mã QR": ["Couldn't create the QR code", "QRコードを作成できませんでした", "QR 코드를 만들 수 없어요", "无法生成二维码", "สร้างคิวอาร์โค้ดไม่ได้"],
  "Đặt Đồ Ăn Ảo": ["Virtual Food Ordering", "バーチャル料理注文", "가상 음식 주문", "虚拟点餐", "สั่งอาหารเสมือน"],
  "Đặt đồ ăn ảo cho vui, không lo gì cả!": ["Order virtual food for fun, zero worries!", "楽しくバーチャル注文、心配ゼロ！", "재미로 하는 가상 음식 주문, 걱정은 제로!", "虚拟点餐图个乐，毫无负担！", "สั่งอาหารเสมือนเพื่อความสนุก ไม่ต้องกังวลอะไร!"],
  "Đã sao chép link – dán để chia sẻ nhé!": ["Link copied – paste it to share!", "リンクをコピーしました – 貼り付けてシェアしてね！", "링크를 복사했어요 – 붙여넣어 공유하세요!", "链接已复制 – 粘贴即可分享！", "คัดลอกลิงก์แล้ว – วางเพื่อแชร์ได้เลย!"],
  "Không chia sẻ được trên trình duyệt này": ["Sharing isn't available in this browser", "このブラウザではシェアできません", "이 브라우저에서는 공유할 수 없어요", "此浏览器无法分享", "เบราว์เซอร์นี้แชร์ไม่ได้"],
  "Đã tải ảnh đơn hàng & sao chép nội dung": ["Order image downloaded & text copied", "注文画像を保存し、内容をコピーしました", "주문 이미지를 저장하고 내용을 복사했어요", "已下载订单图片并复制内容", "ดาวน์โหลดรูปคำสั่งซื้อและคัดลอกข้อความแล้ว"],
  "Giao hàng thành công": ["Delivered", "配達完了", "배달 완료", "送达成功", "จัดส่งสำเร็จ"],
  "Món ăn": ["Dish", "料理", "메뉴", "菜品", "อาหาร"],
  "Đơn #{c}: {n} đã giao thành công tới Nhà mình. Chúc bạn ngon miệng! 😋": ["Order #{c}: {n} has been delivered to My Home. Enjoy your meal! 😋", "注文 #{c}：{n}がわが家に届きました。どうぞ召し上がれ！😋", "주문 #{c}: {n} — 우리 집으로 배달 완료! 맛있게 드세요! 😋", "订单 #{c}：{n}已成功送达我家。祝你用餐愉快！😋", "คำสั่งซื้อ #{c}: {n} จัดส่งถึงบ้านเราเรียบร้อยแล้ว ทานให้อร่อยนะ! 😋"],
  "Đơn hàng của bạn đã giao thành công tới Nhà mình. Chúc bạn ngon miệng! 😋": ["Your order has been delivered to My Home. Enjoy your meal! 😋", "ご注文がわが家に届きました。どうぞ召し上がれ！😋", "주문하신 메뉴가 우리 집에 배달되었어요. 맛있게 드세요! 😋", "你的订单已成功送达我家。祝你用餐愉快！😋", "คำสั่งซื้อของคุณจัดส่งถึงบ้านเราเรียบร้อยแล้ว ทานให้อร่อยนะ! 😋"],
  "Trang web giả lập đặt đồ ăn trực tuyến: xem món, chọn món, tạo đơn hàng cho vui. Không giao hàng thật, không trả tiền thật.": ["A simulated online food-ordering site: browse, pick dishes and place orders for fun. No real delivery, no real payment.", "オンライン料理注文のシミュレーター：料理を見て、選んで、楽しく注文。実際の配達・支払いはありません。", "온라인 음식 주문 시뮬레이터: 메뉴를 구경하고 골라 재미로 주문해 보세요. 실제 배달·결제는 없어요.", "模拟在线点餐网站：浏览、挑选菜品并下单，只为好玩。不真实配送，不真实付款。", "เว็บจำลองการสั่งอาหารออนไลน์: ดูเมนู เลือกเมนู และสั่งซื้อเพื่อความสนุก ไม่มีการจัดส่งจริง ไม่มีการจ่ายเงินจริง"],
  "Đã chuyển sang {n}": ["Switched to {n}", "{n}に切り替えました", "언어 변경: {n}", "已切换为{n}", "เปลี่ยนเป็น{n}แล้ว"],
  "Đã đổi tiền tệ sang {n}": ["Currency changed to {n}", "通貨を{n}に変更しました", "통화 변경: {n}", "货币已切换为{n}", "เปลี่ยนสกุลเงินเป็น {n} แล้ว"],
  "Đã bật thông báo giao hàng": ["Delivery notifications on", "配達通知をオンにしました", "배달 알림을 켰어요", "已开启送达通知", "เปิดการแจ้งเตือนการจัดส่งแล้ว"],
  "Thông báo đang bị chặn trong cài đặt trình duyệt": ["Notifications are blocked in your browser settings", "ブラウザの設定で通知がブロックされています", "브라우저 설정에서 알림이 차단되어 있어요", "通知已在浏览器设置中被阻止", "การแจ้งเตือนถูกบล็อกในการตั้งค่าเบราว์เซอร์"],
  "Đã thêm {n} vào giỏ hàng": ["Added {n} to cart", "{n}をカートに追加しました", "장바구니에 담았어요: {n}", "已将{n}加入购物车", "เพิ่ม {n} ลงตะกร้าแล้ว"],
  "Đã thêm {q} phần {n} vào giỏ hàng": ["Added {q} × {n} to cart", "{n}を{q}点カートに追加しました", "장바구니에 담았어요: {n} {q}개", "已将{q}份{n}加入购物车", "เพิ่ม {n} {q} ที่ลงตะกร้าแล้ว"],
  "Xóa món khỏi giỏ hàng?": ["Remove this item from your cart?", "カートから削除しますか？", "장바구니에서 삭제할까요?", "要从购物车中删除吗？", "ลบเมนูนี้ออกจากตะกร้าไหม?"],
  "Hủy": ["Cancel", "キャンセル", "취소", "取消", "ยกเลิก"],
  "Đã xóa món khỏi giỏ hàng": ["Item removed from cart", "カートから削除しました", "장바구니에서 삭제했어요", "已从购物车删除", "ลบออกจากตะกร้าแล้ว"],
  "Bạn vẫn chưa chọn món ăn nào để mua": ["You haven't selected any dishes to buy", "購入する料理がまだ選ばれていません", "구매할 메뉴를 아직 선택하지 않았어요", "你还没有选择要购买的菜品", "คุณยังไม่ได้เลือกเมนูที่จะซื้อ"],
  "Nhấn vào ô vuông bên cạnh món, hoặc chọn “Tất cả”.": ["Tap the box next to an item, or choose “All”.", "料理の横のチェックボックスをタップするか、「すべて」を選んでください。", "메뉴 옆의 네모 칸을 누르거나 “전체”를 선택하세요.", "点击菜品旁的方框，或选择“全选”。", "แตะช่องสี่เหลี่ยมข้างเมนู หรือเลือก “ทั้งหมด”"],
  "Đã xóa đơn nháp": ["Draft deleted", "下書きを削除しました", "임시 저장을 삭제했어요", "已删除草稿", "ลบฉบับร่างแล้ว"],
  "Xóa toàn bộ lịch sử xem?": ["Clear all viewing history?", "閲覧履歴をすべて消去しますか？", "본 기록을 모두 지울까요?", "要清除全部浏览记录吗？", "ล้างประวัติการดูทั้งหมดไหม?"],
  "Danh sách “Xem gần đây” sẽ trống.": ["The “Recently viewed” list will be emptied.", "「最近見た料理」が空になります。", "“최근 본 메뉴” 목록이 비워져요.", "“最近浏览”列表将被清空。", "รายการ “ดูล่าสุด” จะว่างเปล่า"],
  "Đã xóa lịch sử xem": ["Viewing history cleared", "閲覧履歴を消去しました", "본 기록을 지웠어요", "已清除浏览记录", "ล้างประวัติการดูแล้ว"],
  "Đã sao chép mã đơn #{c}": ["Copied order code #{c}", "注文番号 #{c} をコピーしました", "주문 번호 #{c} 복사 완료", "已复制订单号 #{c}", "คัดลอกรหัสคำสั่งซื้อ #{c} แล้ว"],
  "Không sao chép được": ["Couldn't copy", "コピーできませんでした", "복사할 수 없어요", "复制失败", "คัดลอกไม่ได้"],
  "Đã sao chép đơn hàng": ["Order copied", "注文をコピーしました", "주문을 복사했어요", "已复制订单", "คัดลอกคำสั่งซื้อแล้ว"],
  "Đã sao chép link trang": ["Page link copied", "ページのリンクをコピーしました", "페이지 링크를 복사했어요", "已复制页面链接", "คัดลอกลิงก์หน้าเว็บแล้ว"],
  "Đơn #{c} đã giao thành công!": ["Order #{c} delivered!", "注文 #{c} が届きました！", "주문 #{c} 배달 완료!", "订单 #{c} 已送达！", "คำสั่งซื้อ #{c} จัดส่งสำเร็จ!"],
  "Đã có mạng trở lại": ["Back online", "オンラインに戻りました", "다시 온라인이에요", "网络已恢复", "กลับมาออนไลน์แล้ว"],
  "Đang ngoại tuyến – mọi chức năng vẫn chạy bình thường": ["You're offline – everything still works", "オフラインです – すべての機能は通常どおり使えます", "오프라인이에요 – 모든 기능은 그대로 작동해요", "当前离线 – 所有功能仍可正常使用", "ออฟไลน์อยู่ – ทุกฟังก์ชันยังทำงานตามปกติ"],
  "Trang web giả lập đặt đồ ăn trực tuyến, nơi bạn tự do xem món, chọn món và tạo đơn hàng theo ý thích. <strong>Hoàn toàn không có giao hàng thật, không có trả tiền thật, không phát sinh chi phí hay nghĩa vụ nào.</strong> Được xây dựng riêng để <strong>thỏa mãn nhu cầu tinh thần:</strong> giải tỏa cơn thèm, thỏa thích xem món ngon, tưởng tượng thưởng thức hay đơn giản chỉ có vài phút trải nghiệm vui vẻ, thoải mái và hoàn toàn không có gánh nặng nào.": [
    "A simulated online food-ordering site where you can freely browse, pick dishes and place orders however you like. <strong>There is absolutely no real delivery, no real payment, and no cost or obligation of any kind.</strong> Built especially to <strong>feed the soul:</strong> ease your cravings, enjoy looking at delicious food, imagine tasting it, or simply spend a few fun, relaxing minutes completely free of any burden.",
    "自由に料理を見て、選んで、好きなように注文できるオンライン料理注文のシミュレーターです。<strong>実際の配達も支払いも一切なく、費用や義務も発生しません。</strong><strong>心を満たすため</strong>に作られました：食欲を紛らわせたり、おいしそうな料理を眺めたり、味わう想像をしたり、ただ数分間、気軽に楽しく、何の負担もなく過ごせます。",
    "자유롭게 메뉴를 구경하고 골라 마음대로 주문해 볼 수 있는 온라인 음식 주문 시뮬레이터예요. <strong>실제 배달도, 실제 결제도 전혀 없고 어떤 비용이나 의무도 생기지 않아요.</strong> <strong>마음의 허기를 채우기 위해</strong> 만들었어요: 먹고 싶은 마음을 달래고, 맛있는 음식을 실컷 구경하고, 맛보는 상상을 하거나, 그저 몇 분 동안 아무 부담 없이 즐겁고 편안하게 즐겨 보세요.",
    "一个模拟在线点餐网站，你可以随心浏览、挑选菜品并按喜好下单。<strong>完全没有真实配送，没有真实付款，不产生任何费用或义务。</strong>专为<strong>满足精神需求</strong>而打造：解解馋、尽情欣赏美食、想象品尝的滋味，或只是享受几分钟轻松愉快、毫无负担的体验。",
    "เว็บจำลองการสั่งอาหารออนไลน์ ที่คุณดูเมนู เลือกเมนู และสั่งซื้อได้ตามใจชอบ <strong>ไม่มีการจัดส่งจริง ไม่มีการจ่ายเงินจริง และไม่มีค่าใช้จ่ายหรือข้อผูกมัดใด ๆ เลย</strong> สร้างขึ้นเพื่อ<strong>เติมเต็มความสุขทางใจ:</strong> คลายความอยาก ดูอาหารอร่อยให้หนำใจ จินตนาการว่าได้ลิ้มรส หรือแค่ใช้เวลาไม่กี่นาทีอย่างสนุก สบาย ๆ โดยไม่มีภาระใด ๆ"
  ]
});

/* ---------- Tên món, mô tả, gia vị & ăn kèm: [English, 日本語, 한국어, 中文, ภาษาไทย] ---------- */
Object.assign(DISH_TR, {
  1: { n: ["Beef Phở", "牛肉のフォー", "소고기 쌀국수", "牛肉河粉", "เฝอเนื้อ"],
       d: ["Bone broth simmered with cinnamon and star anise, soft rice noodles and tender, sweet beef.", "シナモンと八角が香る骨スープに、やわらかなフォーと甘くやわらかい牛肉。", "계피와 팔각 향이 나는 사골 육수에 부드러운 쌀국수와 연한 소고기.", "肉桂八角熬制的骨汤，配软滑河粉和鲜嫩牛肉。", "น้ำซุปกระดูกเคี่ยวหอมอบเชยและโป๊ยกั๊ก เส้นเฝอนุ่มกับเนื้อวัวนุ่มหวาน"] },
  2: { n: ["Chicken Phở", "鶏肉のフォー", "닭고기 쌀국수", "鸡肉河粉", "เฝอไก่"],
       d: ["Light, sweet chicken broth with chewy shredded chicken and fresh scallions.", "あっさり甘い鶏スープに、歯ごたえのある裂いた鶏肉と新鮮なねぎ。", "맑고 달큰한 닭 육수에 쫄깃한 닭고기와 신선한 쪽파.", "清甜鸡汤，配嚼劲十足的手撕鸡和新鲜葱花。", "น้ำซุปไก่ใสหวาน ไก่ฉีกหนึบหอม โรยต้นหอมสด"] },
  3: { n: ["Bánh mì with pork", "豚肉のバインミー", "고기 반미", "越南猪肉法包", "บั๋นหมี่หมู"],
       d: ["Crispy baguette filled with savory pork, rich pâté and fresh herbs.", "パリパリのパンに、旨みたっぷりの豚肉、濃厚なパテと香草。", "바삭한 바게트에 짭조름한 고기, 고소한 파테와 향긋한 채소.", "外皮酥脆，夹入浓香猪肉、醇厚肉酱和香草。", "ขนมปังกรอบ ไส้หมูรสเข้มข้น ปาเต้มัน ๆ และผักหอม"] },
  4: { n: ["Shrimp & pork spring rolls", "エビと豚肉の生春巻き", "새우 돼지고기 월남쌈", "鲜虾猪肉春卷", "ปอเปี๊ยะสดกุ้งหมู"],
       d: ["Rice paper rolled with shrimp, boiled pork, vermicelli and fresh greens.", "ライスペーパーでエビ、ゆで豚、ブンと新鮮な野菜を巻きました。", "라이스페이퍼에 새우, 삶은 돼지고기, 쌀국수와 신선한 채소를 말았어요.", "米纸卷入鲜虾、白切猪肉、米线和新鲜蔬菜。", "แผ่นแป้งข้าวม้วนกุ้ง หมูต้ม เส้นหมี่ และผักสด"] },
  5: { n: ["Fried spring rolls", "揚げ春巻き", "짜조 (튀김 춘권)", "越南炸春卷", "ปอเปี๊ยะทอด"],
       d: ["Golden crispy wrappers filled with savory pork, glass noodles and wood ear mushrooms.", "黄金色のパリパリの皮に、豚肉、春雨、きくらげの旨み。", "노릇하고 바삭한 피 속에 고기, 당면, 목이버섯이 가득.", "金黄酥脆的外皮，包裹猪肉、粉丝和木耳。", "แป้งทอดสีทองกรอบ ไส้หมู วุ้นเส้น และเห็ดหูหนู"] },
  6: { n: ["Bún chả", "ブンチャー", "분짜", "烤肉米线", "บุ๋นจ่า"],
       d: ["Fragrant charcoal-grilled pork with sweet and sour fish sauce dip.", "炭火で香ばしく焼いた豚肉を甘酸っぱいヌックマムにつけて。", "숯불에 구운 향긋한 고기를 새콤달콤한 느억맘 소스에 찍어 먹어요.", "炭火烤肉香气扑鼻，蘸酸甜鱼露食用。", "หมูย่างเตาถ่านหอมฉุย จิ้มน้ำปลาเปรี้ยวหวาน"] },
  7: { n: ["Huế spicy beef noodles", "ブンボーフエ", "분보후에", "顺化牛肉米线", "บุ๋นบ่อเว้"],
       d: ["Rich lemongrass and shrimp-paste broth, thick round noodles, with Huế's signature heat.", "レモングラスとエビ味噌が効いた濃厚スープに太麺、フエ名物の辛さ。", "레몬그라스와 새우젓 향이 진한 육수, 굵은 면, 후에 특유의 매운맛.", "香茅虾酱浓汤，粗米线，带着顺化特有的香辣。", "น้ำซุปเข้มข้นตะไคร้และกะปิ เส้นใหญ่ เผ็ดร้อนแบบเว้"] },
  8: { n: ["Crab noodle soup", "ブンリエウ", "분리에우", "蟹汤米线", "บุ๋นเรียว"],
       d: ["Rich crab paste, mildly tangy tomatoes and a vivid red broth.", "濃厚なカニのすり身、ほどよい酸味のトマト、真っ赤なスープ。", "고소한 게살 완자, 은은하게 새콤한 토마토, 붉은 국물.", "浓郁蟹膏、微酸番茄，汤色红亮。", "มันปูเข้มข้น มะเขือเทศเปรี้ยวอ่อน ๆ น้ำซุปสีแดงสวย"] },
  9: { n: ["Fermented fish noodle soup", "ブンマム", "분맘", "鱼露米线", "บุ๋นหมั่ม"],
       d: ["Bold, aromatic fermented-fish broth, rich in Mekong Delta style.", "発酵魚の香り高いスープ、メコンデルタ風の濃厚な味。", "발효 생선 향이 진한 육수, 메콩 델타 스타일의 깊은 맛.", "鱼酱汤底香气浓郁，地道的湄公河三角洲风味。", "น้ำซุปปลาหมักหอมเข้มข้น รสจัดแบบภาคตะวันตกเฉียงใต้"] },
  10: { n: ["Fish noodle soup", "魚のブン", "생선 쌀국수", "鱼米线", "บุ๋นปลา"],
       d: ["Fragrant fried fish cakes in a light, sweet broth, served with fresh greens.", "香ばしい揚げ魚のすり身に、あっさり甘いスープと新鮮な野菜。", "향긋한 어묵 튀김과 맑고 달큰한 국물, 신선한 채소와 함께.", "香煎鱼饼配清甜汤底，佐以新鲜蔬菜。", "ทอดมันปลาหอม ๆ ในน้ำซุปใสหวาน ทานกับผักสด"] }
});
Object.assign(OPT_TR, {
  "Chanh": ["Lime", "ライム", "라임", "青柠", "มะนาว"],
  "Ớt tươi": ["Fresh chili", "生唐辛子", "생고추", "鲜辣椒", "พริกสด"],
  "Tương ớt": ["Chili sauce", "チリソース", "칠리소스", "辣椒酱", "ซอสพริก"],
  "Tương đen": ["Hoisin sauce", "海鮮醤", "해선장", "海鲜酱", "ซอสฮอยซิน"],
  "Giá đỗ": ["Bean sprouts", "もやし", "숙주", "豆芽", "ถั่วงอก"],
  "Húng quế": ["Thai basil", "ホーラパー（バジル）", "타이 바질", "九层塔", "โหระพา"],
  "Ngò gai": ["Sawtooth coriander", "ノコギリコリアンダー", "톱니 고수", "刺芫荽", "ผักชีฝรั่ง"],
  "Hành lá, hành tây": ["Scallions & onion", "ねぎと玉ねぎ", "쪽파·양파", "葱和洋葱", "ต้นหอมและหอมใหญ่"],
  "Tiêu": ["Black pepper", "コショウ", "후추", "胡椒", "พริกไทย"],
  "Nước mắm": ["Fish sauce", "ヌックマム", "느억맘 (피시소스)", "鱼露", "น้ำปลา"],
  "Rau răm": ["Vietnamese coriander", "ラウラム", "베트남 고수", "越南香菜", "ผักแพว"],
  "Hành lá": ["Scallions", "ねぎ", "쪽파", "葱花", "ต้นหอม"],
  "Hành tây": ["Onion", "玉ねぎ", "양파", "洋葱", "หอมใหญ่"],
  "Mayonnaise": ["Mayonnaise", "マヨネーズ", "마요네즈", "蛋黄酱", "มายองเนส"],
  "Nước tương": ["Soy sauce", "醤油", "간장", "酱油", "ซีอิ๊ว"],
  "Dưa leo": ["Cucumber", "きゅうり", "오이", "黄瓜", "แตงกวา"],
  "Đồ chua": ["Pickled veggies", "なますの酢漬け", "채소 절임", "腌萝卜丝", "ผักดอง"],
  "Ngò rí": ["Cilantro", "パクチー", "고수", "香菜", "ผักชี"],
  "Tương đậu phộng": ["Peanut sauce", "ピーナッツソース", "땅콩 소스", "花生酱", "ซอสถั่ว"],
  "Rau sống": ["Fresh greens", "生野菜", "생채소", "生菜拼盘", "ผักสด"],
  "Xà lách": ["Lettuce", "レタス", "상추", "生菜", "ผักกาดหอม"],
  "Hẹ": ["Garlic chives", "ニラ", "부추", "韭菜", "กุยช่าย"],
  "Bún tươi": ["Rice vermicelli", "ブン（米麺）", "쌀국수 면", "鲜米线", "ขนมจีนเส้นสด"],
  "Nước mắm chua ngọt": ["Sweet & sour fish sauce", "甘酸っぱいヌックマム", "새콤달콤 피시소스", "酸甜鱼露", "น้ำปลาเปรี้ยวหวาน"],
  "Rau thơm": ["Fresh herbs", "香草", "향채", "香草", "ผักหอม"],
  "Tỏi": ["Garlic", "ニンニク", "마늘", "大蒜", "กระเทียม"],
  "Sa tế": ["Chili lemongrass oil", "サテ（辣油）", "사떼 (고추기름)", "沙爹辣油", "น้ำมันพริกซาเต๊"],
  "Rau muống bào": ["Shredded water spinach", "空芯菜の千切り", "채 썬 공심채", "空心菜丝", "ผักบุ้งซอย"],
  "Bắp chuối bào": ["Shredded banana blossom", "バナナの花の千切り", "채 썬 바나나꽃", "香蕉花丝", "หัวปลีซอย"],
  "Mắm tôm": ["Shrimp paste", "エビ味噌（マムトム）", "새우젓 소스", "虾酱", "กะปิ"],
  "Mắm nguyên chất": ["Pure fermented fish paste", "純発酵魚醤", "순수 생선 젓갈", "纯鱼酱", "ปลาร้าแท้"]
});

/* ---------- Mã QR (tự tạo, không cần mạng) ---------- */
const QR = (() => {
  const ECC_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const BLK_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

  function rawModules(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      const na = Math.floor(v / 7) + 2;
      r -= (25 * na - 10) * na - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  }
  const dataCodewords = (v) => Math.floor(rawModules(v) / 8) - ECC_M[v] * BLK_M[v];

  function gmul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }
  function rsDivisor(deg) {
    const r = new Array(deg).fill(0);
    r[deg - 1] = 1;
    let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < r.length; j++) {
        r[j] = gmul(r[j], root);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      root = gmul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    const r = new Array(div.length).fill(0);
    for (const b of data) {
      const f = b ^ r.shift();
      r.push(0);
      for (let i = 0; i < div.length; i++) r[i] ^= gmul(div[i], f);
    }
    return r;
  }

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 1;
    for (; ver <= 40; ver++) {
      const ccBits = ver <= 9 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    }
    if (ver > 40) throw new Error('Dữ liệu quá dài cho mã QR');
    const ccBits = ver <= 9 ? 8 : 16;
    const cap = dataCodewords(ver) * 8;
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, ccBits);
    bytes.forEach((b) => put(b, 8));
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (let p = 0xEC; bits.length < cap; p ^= 0xEC ^ 0x11) put(p, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }

    /* Thêm mã sửa lỗi và đan xen */
    const nb = BLK_M[ver], eccLen = ECC_M[ver];
    const rawCw = Math.floor(rawModules(ver) / 8);
    const nShort = nb - rawCw % nb;
    const shortLen = Math.floor(rawCw / nb);
    const div = rsDivisor(eccLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) all.push(b[i]); });
    }

    /* Vẽ ma trận */
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setF = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };

    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    if (ver > 1) {
      const na = Math.floor(ver / 7) + 2;
      const step = Math.floor((ver * 8 + na * 3 + 5) / (na * 4 - 4)) * 2;
      const pos = [6];
      for (let p = size - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
      for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
          setF(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    const drawFormat = (mask) => {
      const d = (0 << 3) | mask; /* mức sửa lỗi M = 00 */
      let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412;
      const g = (i) => ((b >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) setF(8, i, g(i));
      setF(8, 7, g(6)); setF(8, 8, g(7)); setF(7, 8, g(8));
      for (let i = 9; i < 15; i++) setF(14 - i, 8, g(i));
      for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, g(i));
      for (let i = 8; i < 15; i++) setF(8, size - 15 + i, g(i));
      setF(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let r = ver;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const b = (ver << 12) | r;
      for (let i = 0; i < 18; i++) {
        const bit = ((b >>> i) & 1) !== 0, a = size - 11 + i % 3, c = Math.floor(i / 3);
        setF(a, c, bit); setF(c, a, bit);
      }
    }
    /* Đặt dữ liệu */
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
        if (!fn[y][x] && bi < all.length * 8) { mod[y][x] = ((all[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
      }
    }
    const maskFn = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
    ];
    const applyMask = (m) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
        if (!fn[y][x] && maskFn[m](x, y)) mod[y][x] = !mod[y][x];
    };
    const penalty = () => {
      let p = 0, dark = 0;
      for (let y = 0; y < size; y++) {
        let rc = 1, cc = 1;
        for (let x = 0; x < size; x++) {
          if (mod[y][x]) dark++;
          if (x > 0) {
            if (mod[y][x] === mod[y][x - 1]) { rc++; if (rc === 5) p += 3; else if (rc > 5) p++; } else rc = 1;
            if (mod[x][y] === mod[x - 1][y]) { cc++; if (cc === 5) p += 3; else if (cc > 5) p++; } else cc = 1;
          }
          if (x < size - 1 && y < size - 1) {
            const c = mod[y][x];
            if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
          }
        }
      }
      const total = size * size;
      p += Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return p;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const pn = penalty();
      if (pn < bestP) { bestP = pn; best = m; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);
    return { size, get: (x, y) => mod[y][x] };
  }

  function draw(canvas, text, scale) {
    const q = encode(text);
    const border = 4, s = scale || 8, n = q.size + border * 2;
    canvas.width = n * s; canvas.height = n * s;
    const c = canvas.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, n * s, n * s);
    c.fillStyle = '#111111';
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++)
      if (q.get(x, y)) c.fillRect((x + border) * s, (y + border) * s, s, s);
    return canvas;
  }
  return { encode, draw };
})();

/* ---------- Thành phần giao diện dùng chung ---------- */
const HERO_DESC = 'Trang web giả lập đặt đồ ăn trực tuyến, nơi bạn tự do xem món, chọn món và tạo đơn hàng theo ý thích. <strong>Hoàn toàn không có giao hàng thật, không có trả tiền thật, không phát sinh chi phí hay nghĩa vụ nào.</strong> Được xây dựng riêng để <strong>thỏa mãn nhu cầu tinh thần:</strong> giải tỏa cơn thèm, thỏa thích xem món ngon, tưởng tượng thưởng thức hay đơn giản chỉ có vài phút trải nghiệm vui vẻ, thoải mái và hoàn toàn không có gánh nặng nào.';
function img(d, extra = '') {
  const lazy = extra.includes('loading=') ? '' : 'loading="lazy"';
  return `<img src="${esc(d.img)}" alt="${esc(dName(d))}" ${lazy} decoding="async" referrerpolicy="no-referrer" ${extra} onload="this.parentNode.classList.add('ok')" onerror="this.classList.add('err');this.parentNode.classList.add('ok')">`;
}
const ph = (d, cls = '', attrs = '') => `<div class="ph ${cls}" data-e="${d.emoji}" ${attrs}>${img(d)}</div>`;
function stars(r) {
  return `<span class="stars" style="--p:${clamp(r / 5 * 100, 0, 100)}%" aria-label="${esc(t('{r} sao', { r: fmtRating(r) }))}"><span class="s-bg">★★★★★</span><span class="s-fg">★★★★★</span></span>`;
}
function cartBtn() {
  const n = cartCount();
  return `<button class="cart-btn" data-go="#/cart" aria-label="${esc(t('Giỏ hàng'))}">${ic('cart')}<span class="badge ${n ? '' : 'hide'}" data-cartn>${n > 99 ? '99+' : n}</span></button>`;
}
function topbar(title, opt = {}) {
  return `<header class="topbar"><div class="tb-in">
    <button class="tb-back" data-act="back" aria-label="${esc(t('Quay lại'))}">${ic('back')}<span>${t('Quay lại')}</span></button>
    <h1 class="tb-title">${esc(title)}</h1>
    ${opt.noCart ? '<span class="tb-sp"></span>' : cartBtn()}
  </div></header>`;
}
const pageCls = () => 'wrap page' + (UI.soft ? '' : ' anim');
function footer() {
  return `<footer class="ftr">
    <div>© ${new Date().getFullYear()} 🍜 1277<b>Foods</b> — ${t('Trang giả lập vui vẻ: không giao hàng thật, không thu tiền thật.')}</div>
    <div class="net" id="netState">${netHtml()}</div>
  </footer>`;
}
function netHtml() {
  return navigator.onLine ? `<i class="dot live"></i> ${t('Đang trực tuyến')}` : `<i class="dot off"></i> ${t('Ngoại tuyến – vẫn dùng bình thường')}`;
}
function emptyBox(e, t, s, btn = '') {
  return `<div class="empty"><div class="empty-e">${e}</div><h3>${t}</h3><p>${s}</p>${btn}</div>`;
}

function card(d, i = 0) {
  return `<article class="card" style="--d:${Math.min(i, 12) * 45}ms">
    <div class="card-img ph" data-e="${d.emoji}" data-go="#/dish/${d.id}" role="link" tabindex="0" aria-label="${esc(t('Xem {n}', { n: dName(d) }))}">
      ${img(d)}<span class="rate-chip">${ic('star', 'fill')} ${fmtRating(d.rating)}</span>
    </div>
    <div class="card-b">
      <h3 class="card-n" data-go="#/dish/${d.id}">${esc(dName(d))}</h3>
      <div class="stars-row">${stars(d.rating)} <b>${fmtRating(d.rating)}</b></div>
      <div class="card-f">
        <span class="price">${fmt(d.price)}</span>
        <button class="add-mini" data-act="quickadd" data-v="${d.id}" aria-label="${esc(t('Thêm {n} vào giỏ', { n: dName(d) }))}">${ic('plus')}</button>
      </div>
    </div>
  </article>`;
}
function sortList(list) {
  const a = list.slice();
  if (S.sort === 'desc') a.sort((x, y) => y.price - x.price || x.id - y.id);
  else if (S.sort === 'asc') a.sort((x, y) => x.price - y.price || x.id - y.id);
  return a;
}
function filterQ(list, q) {
  const n = norm(q);
  if (!n) return list;
  return list.filter((d) => norm(d.name).includes(n) || norm(d.desc).includes(n) || norm(dName(d)).includes(n) || norm(dDesc(d)).includes(n) ||
    d.giavi.concat(d.ankem).some((o) => norm(o[0]).includes(n) || norm(oName(o[0])).includes(n)));
}
function gridHtml(list, q) {
  if (!list.length) {
    return q ? `<div style="grid-column:1/-1">${emptyBox('🔍', t('Không tìm thấy món nào'), t('Không có món phù hợp với “{q}”. Thử từ khoá khác nhé!', { q: esc(q) }))}</div>`
             : `<div style="grid-column:1/-1">${emptyBox('🍽️', t('Chưa có món'), t('Danh sách đang trống.'))}</div>`;
  }
  return list.map(card).join('');
}

function acc(id, icon, title, body, opt = {}) {
  const open = UI.open.has(id);
  return `<div class="acc ${opt.sub ? 'sub' : ''} ${open ? 'open' : ''}" data-acc="${id}">
    <button class="acc-h" data-act="acc" data-v="${id}" aria-expanded="${open}">
      <span class="acc-ic">${ic(icon)}</span>
      <span class="acc-t">${title}${opt.sub_t ? `<small>${opt.sub_t}</small>` : ''}</span>
      <span class="acc-chev">${ic('down')}</span>
    </button>
    <div class="acc-b"><div class="acc-in">${body}</div></div>
  </div>`;
}
function opt(act, v, label, on, icon = '', style = '', lang = '') {
  return `<button class="opt ${on ? 'on' : ''}" data-act="${act}" data-v="${v}" ${style ? `style="${style}"` : ''}>
    ${icon ? `<span class="opt-ic">${ic(icon)}</span>` : ''}<span class="opt-t"${lang ? ` lang="${lang}"` : ''}>${label}</span><span class="tick">${ic('check')}</span>
  </button>`;
}
function notifHtml() {
  if (!('Notification' in window)) return `${ic('bell')}<span>${t('Trình duyệt này không hỗ trợ thông báo')}</span>`;
  const p = Notification.permission;
  if (p === 'granted') return `${ic('bell')}<span>${t('Thông báo giao hàng')}${('PushManager' in window) ? ' – ' + t('báo cả khi đã thoát trình duyệt') : ''}</span><b class="notif-ok">${t('Đã bật')} ✓</b>`;
  if (p === 'denied') return `${ic('bell')}<span>${t('Thông báo đang bị chặn – mở cài đặt trang web của trình duyệt để cho phép')}</span>`;
  return `${ic('bell')}<span>${t('Nhận thông báo khi giao hàng thành công')}</span><button data-act="notif">${t('Bật')}</button>`;
}
const fsLabel = () => Math.round((1 + S.fontScale * 0.08) * 100) + '%';
const fsText = () => t('Cỡ chữ hiện tại: {v}', { v: fsLabel() });
const langSub = () => langInfo().n + (L() !== 'en' ? ' · Language' : '');
const curSub = () => { const c = curInfo(); return `${c.k} (${c.s})`; };

/* ---------- Trang chủ ---------- */
function vHome() {
  const list = sortList(filterQ(MENU, UI.q));
  const act = activeOrders().length;
  const fl = ['🍜', '🥢', '🌶️', '🥖', '🍋', '🦐', '🌿', '🍲'];
  const floaties = fl.map((e, i) => `<span class="floaty" style="left:${[4, 88, 72, 30, 52, 12, 94, 62][i]}%;top:${[8, 12, 70, 82, 6, 58, 48, 38][i]}%;animation-delay:${i * -0.9}s">${e}</span>`).join('');

  const settings = `
    <div class="lbl">${t('Giao diện')}</div>
    <div class="opts">
      ${opt('theme', 'light', t('Sáng'), S.theme === 'light', 'sun')}
      ${opt('theme', 'dark', t('Tối'), S.theme === 'dark', 'moon')}
      ${opt('theme', 'system', t('Hệ thống'), S.theme === 'system', 'monitor')}
    </div>
    <div class="lbl" style="margin-top:14px">${t('Thông báo')}</div>
    <div class="notif-row" id="notifRow">${notifHtml()}</div>`;

  const langs = `<div class="opts">${LANGS.map((l) => opt('lang', l.k, `<span class="lg-code">${l.code}</span>${esc(l.n)}`, L() === l.k, '', '', l.k)).join('')}</div>`;
  const curs = `<div class="opts">${CURS.map((c) => opt('cur', c.k, `${c.k} (${c.s})`, curInfo().k === c.k, 'coin')).join('')}</div>
    <div class="fs-val fx-note" id="fxNote">${fxNote()}</div>`;

  const fonts = `
    <div class="opts">${FONTS.map((f) => opt('font', f.k, esc(t(f.n)), S.font === f.k, '', `font-family:${esc(fontStack(f))}`)).join('')}</div>
    <div class="lbl" style="margin-top:14px">${t('Đổi cỡ chữ')}</div>
    <div class="fs-row">
      <button class="fs-btn" data-act="fs" data-v="-1" aria-label="${esc(t('Giảm cỡ chữ'))}">-A</button>
      <button class="fs-btn ${S.fontScale === 0 ? 'on' : ''}" data-act="fs" data-v="0">${t('Mặc định')}</button>
      <button class="fs-btn" data-act="fs" data-v="1" aria-label="${esc(t('Tăng cỡ chữ'))}">A+</button>
    </div>
    <div class="fs-val" id="fsVal">${fsText()}</div>`;

  const sorts = `<div class="opts">
      ${opt('sort', 'desc', t('Sắp xếp theo giá: Cao đến Thấp'), S.sort === 'desc', 'sortDown')}
      ${opt('sort', 'asc', t('Sắp xếp theo giá: Thấp đến Cao'), S.sort === 'asc', 'sortUp')}
    </div>`;

  const share = `
    <div class="share-grid">
      <button class="btn btn-red btn-sm" data-act="share">${ic('share')} ${t('Chia sẻ ngay')}</button>
      <button class="btn btn-ghost btn-sm" data-act="copylink">${ic('link')} ${t('Sao chép link')}</button>
    </div>
    ${acc('qr', 'qr', t('Mã QR code'), `<div class="qr-box"><canvas id="qrMini" data-act="qrfull" title="${esc(t('Nhấn để mở toàn màn hình'))}" aria-label="${esc(t('Mã QR của trang'))}"></canvas>
      <button class="btn btn-soft btn-sm" data-act="qrfull">${ic('qr')} ${t('Mở hình ảnh mã QR')}</button>
      <div class="qr-link">${esc(pageUrl())}</div></div>`, { sub: true, sub_t: t('Quét để mở trang trên máy khác') })}`;

  const recent = S.recent.slice(0, 10).filter((r) => byId(r.id));
  const recentHtml = recent.length
    ? `<div class="recent-row">${recent.map((r) => { const d = byId(r.id); return `
        <button class="rc" data-go="#/dish/${d.id}">
          ${ph(d)}
          <div class="rc-b"><div class="rc-n">${esc(dName(d))}</div>
          <div class="rc-t">${ic('clock')} <span>${t('Đã xem {t}', { t: `<span data-ago="${r.t}">${ago(r.t)}</span>` })}</span></div></div>
        </button>`; }).join('')}</div>`
    : `<div class="empty-mini">${t('Bạn chưa xem món nào. Chạm vào một món bên dưới để bắt đầu nhé! 👇')}</div>`;

  return `
  <header class="hdr"><div class="hdr-in">
    <a class="logo" data-go="#/" aria-label="1277Foods – ${esc(t('Trang chủ'))}"><span class="logo-ic">🍜</span><span class="logo-t">1277<b>Foods</b></span></a>
    <form class="search" id="searchForm" role="search" autocomplete="off">
      <span class="search-ic">${ic('search')}</span>
      <input id="q" type="search" placeholder="${esc(t('Tìm kiếm'))}" value="${esc(UI.q)}" enterkeyhint="search" aria-label="${esc(t('Tìm kiếm món ăn'))}">
      <button type="submit" class="search-btn">${t('Tìm kiếm')}</button>
    </form>
    ${cartBtn()}
  </div></header>

  <div class="${pageCls()}">
    <section class="hero">
      ${floaties}
      <div class="hero-txt">
        <h1 class="hero-title">1277Foods | ${t('Đặt Đồ Ăn Ảo – Chỉ Vui, Không Lo Gì Cả')}</h1>
        <p class="hero-desc">${t(HERO_DESC)}</p>
      </div>
      <div class="visits" role="status" aria-label="${esc(t('Lượt truy cập'))}">
        <div class="v-top">${ic('eye')}</div>
        <div class="v-num" id="vNum">${S.lastCount == null ? '—' : numFmt(S.lastCount)}</div>
      </div>
    </section>

    <section class="quick">
      <button class="qt stg" style="--d:40ms" data-go="#/orders"><span class="qt-e">🧾</span><span>${t('Đơn hàng')}</span><span class="badge ${act ? '' : 'hide'}" data-actn>${act}</span></button>
      <button class="qt stg" style="--d:80ms" data-go="#/cat/bun"><span class="qt-e">🍜</span><span>${t('Bún, Mì, Phở')}</span></button>
      <button class="qt stg" style="--d:120ms" data-go="#/cat/com"><span class="qt-e">🍚</span><span>${t('Cơm')}</span></button>
      <button class="qt qt-rand stg" style="--d:160ms" data-act="random"><span class="qt-e">${ic('dice')}</span><span>${t('Chọn ngẫu nhiên')}</span></button>
    </section>

    <section class="tools">
      ${acc('settings', 'gear', t('Cài đặt'), settings, { sub_t: t('Sáng / Tối / Hệ thống') })}
      ${acc('lang', 'globe', t('Ngôn ngữ'), langs, { sub_t: esc(langSub()) })}
      ${acc('cur', 'coin', t('Tiền tệ'), curs, { sub_t: esc(curSub()) })}
      ${acc('font', 'type', t('Đổi phông chữ'), fonts, { sub_t: t('Phông chữ & cỡ chữ') })}
      ${acc('sort', 'sort', t('Sắp xếp'), sorts, { sub_t: t('Theo giá món ăn') })}
      ${acc('share', 'share', t('Chia sẻ'), share, { sub_t: t('Gửi trang & mã QR') })}
    </section>

    <section class="sec">
      <div class="sec-h"><h2>${t('Xem gần đây')}</h2><button class="more" data-go="#/recent">${t('Xem thêm')} ${ic('right')}</button></div>
      ${recentHtml}
    </section>

    <section class="sec" id="menu">
      <div class="sec-h"><h2 class="big-h">${t('Món ăn Việt Nam')}</h2><span class="muted" id="menuCount">${t('{n} món', { n: list.length })}</span></div>
      <div class="grid" id="grid">${gridHtml(list, UI.q)}</div>
    </section>
  </div>
  ${footer()}`;
}
function refreshGrid() {
  const g = $('#grid');
  if (!g) return;
  const list = sortList(filterQ(MENU, UI.q));
  g.innerHTML = gridHtml(list, UI.q);
  const c = $('#menuCount');
  if (c) c.textContent = t('{n} món', { n: list.length });
}

/* ---------- Trang danh mục ---------- */
function vCat(c) {
  const info = { title: t(CATS[c].title), emoji: CATS[c].emoji };
  const list = sortList(MENU.filter((d) => d.cat === c));
  const chips = `<div class="sort-chips">
    <button class="chip ${S.sort === 'desc' ? 'on' : ''}" data-act="sort" data-v="desc">${ic('sortDown')} ${t('Giá: Cao đến Thấp')} <span class="tk">${ic('check')}</span></button>
    <button class="chip ${S.sort === 'asc' ? 'on' : ''}" data-act="sort" data-v="asc">${ic('sortUp')} ${t('Giá: Thấp đến Cao')} <span class="tk">${ic('check')}</span></button>
  </div>`;
  const body = list.length
    ? `${chips}<div class="grid" id="grid">${list.map(card).join('')}</div>`
    : emptyBox(info.emoji, t('Chưa có món {c}', { c: info.title }), t('Món {c} đang được bếp chuẩn bị, bạn quay lại sau nhé! Trong lúc chờ, xem thử các món khác.', { c: info.title.toLowerCase() }),
      `<button class="btn btn-red" data-go="#/">${ic('home')} ${t('Xem món khác')}</button>`);
  return `${topbar(info.title)}
  <div class="${pageCls()}">
    <div class="sec" style="margin-top:18px">
      <div class="sec-h"><h2 class="big-h">${info.emoji} ${info.title}</h2><span class="muted">${t('{n} món', { n: list.length })}</span></div>
      ${body}
    </div>
  </div>${footer()}`;
}

/* ---------- Trang Xem gần đây ---------- */
function vRecent() {
  const list = S.recent.filter((r) => byId(r.id));
  const body = list.length
    ? `<div class="list">${list.map((r, i) => { const d = byId(r.id); return `
        <div class="rrow stg" style="--d:${Math.min(i, 12) * 40}ms" data-go="#/dish/${d.id}" role="link" tabindex="0">
          ${ph(d)}
          <div style="min-width:0"><div class="rr-n">${esc(dName(d))}</div>
            <div class="rr-m"><span>${ic('star', 'fill')} <b style="color:var(--text)">${fmtRating(d.rating)}</b></span>${stars(d.rating)}<span class="price" style="font-size:.9rem">${fmt(d.price)}</span></div>
            <div class="rr-m">${ic('clock')} <span>${t('Đã xem {t}', { t: `<span data-ago="${r.t}">${ago(r.t)}</span>` })}</span></div>
          </div>
          ${ic('right')}
        </div>`; }).join('')}</div>
      <div style="display:flex;justify-content:center;margin-top:18px"><button class="btn btn-soft btn-sm" data-act="r-clear">${ic('trash')} ${t('Xóa lịch sử xem')}</button></div>`
    : emptyBox('👀', t('Chưa xem món nào'), t('Các món bạn đã xem sẽ hiện ở đây kèm thời gian xem.'), `<button class="btn btn-red" data-go="#/">${ic('home')} ${t('Khám phá món ngon')}</button>`);
  return `${topbar(t('Xem gần đây'))}
  <div class="${pageCls()}">
    <div class="sec" style="margin-top:18px"><div class="sec-h"><h2 class="big-h">${t('Xem gần đây')}</h2><span class="muted">${t('{n} món', { n: list.length })}</span></div>${body}</div>
  </div>${footer()}`;
}
function addRecent(id) {
  S.recent = S.recent.filter((r) => r.id !== id);
  S.recent.unshift({ id, t: now() });
  S.recent = S.recent.slice(0, 40);
  save();
}

/* ---------- Trang chi tiết món ---------- */
const VIEWS = [
  { s: 1, o: '50% 50%' }, { s: 1.6, o: '25% 30%' }, { s: 1.6, o: '75% 65%' }, { s: 2.1, o: '50% 80%' }
];
const viewStyle = (v) => `transform:scale(${v.s});transform-origin:${v.o}`;

function selTotal() {
  const s = UI.sel;
  return unitPrice({ id: s.id, giavi: s.giavi, ankem: s.ankem }) * s.qty;
}
function optGroup(g, title, items, chosen) {
  return `<div class="og">
    <div class="og-h">${title} <small>${t('(chọn nhiều được)')}</small></div>
    <div class="choices" data-group="${g}">
      <button class="choice ${chosen.length ? '' : 'on'}" data-act="opt" data-g="${g}" data-v="-1">
        <span class="tick">${ic('check')}</span><span class="c-n">${t('Không có')}</span><span class="c-p">${fmt(0)}</span>
      </button>
      ${items.map((o, i) => `<button class="choice ${chosen.includes(i) ? 'on' : ''}" data-act="opt" data-g="${g}" data-v="${i}">
        <span class="tick">${ic('check')}</span><span class="c-n">${esc(oName(o[0]))}</span><span class="c-p">+${fmt(o[1])}</span>
      </button>`).join('')}
    </div>
  </div>`;
}
function vDish(id) {
  const d = byId(id);
  if (!d) return vNotFound();
  if (!UI.sel || UI.sel.id !== d.id) UI.sel = { id: d.id, giavi: [], ankem: [], qty: 1, view: 0 };
  const s = UI.sel;
  return `${topbar(dName(d))}
  <div class="${pageCls()} detail">
    <div class="gallery">
      <div class="g-main ph" data-e="${d.emoji}">${img(d, `id="gMain" style="${viewStyle(VIEWS[s.view])}" loading="eager"`)}</div>
      <div class="thumbs">${VIEWS.map((v, i) => `
        <button class="thumb ph ${i === s.view ? 'on' : ''}" data-e="${d.emoji}" data-act="thumb" data-v="${i}" aria-label="${esc(t('Ảnh {n}', { n: i + 1 }))}">
          ${img(d, `style="${viewStyle(v)}"`)}
        </button>`).join('')}</div>
    </div>
    <div class="info">
      <h1 class="d-name">${esc(dName(d))}</h1>
      <div class="d-rate">${ic('star', 'fill')}<b>${fmtRating(d.rating)}</b>${stars(d.rating)}<span class="muted">${t('Đánh giá')}</span></div>
      <div class="d-price">${fmt(d.price)}</div>
      <p class="d-desc">${esc(dDesc(d))}</p>
      ${optGroup('giavi', t('Gia vị') + ':', d.giavi, s.giavi)}
      ${optGroup('ankem', t('Ăn kèm') + ':', d.ankem, s.ankem)}
      <div class="qty-row"><span>${t('Số lượng')}</span>
        <div class="stepper"><button data-act="qty" data-v="-1" aria-label="${esc(t('Giảm'))}">${ic('minus')}</button><output id="dQty">${s.qty}</output><button data-act="qty" data-v="1" aria-label="${esc(t('Tăng'))}">${ic('plus')}</button></div>
      </div>
      <div class="buybar">
        <div class="bb-total"><small>${t('Tạm tính')}</small><b id="dTotal">${fmt(selTotal())}</b></div>
        <button class="btn btn-ghost" data-act="addcart">${ic('cartPlus')} ${t('Thêm vào Giỏ hàng')}</button>
        <button class="btn btn-red" data-act="buynow">${t('Mua ngay')}</button>
      </div>
    </div>
  </div>${footer()}`;
}
function refreshDetail() {
  const s = UI.sel;
  if (!s) return;
  ['giavi', 'ankem'].forEach((g) => {
    $$(`.choices[data-group="${g}"] .choice`).forEach((b) => {
      const v = Number(b.dataset.v);
      b.classList.toggle('on', v < 0 ? s[g].length === 0 : s[g].includes(v));
    });
  });
  const q = $('#dQty'); if (q) q.textContent = s.qty;
  const t = $('#dTotal'); if (t) t.textContent = fmt(selTotal());
  const m = $('#gMain'); if (m) m.style.cssText = viewStyle(VIEWS[s.view]);
  $$('.thumb').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === s.view));
}
function vNotFound() {
  return `${topbar(t('Không tìm thấy'))}<div class="${pageCls()}">${emptyBox('🤔', t('Không tìm thấy trang'), t('Trang bạn mở không tồn tại hoặc đã bị xoá.'), `<button class="btn btn-red" data-go="#/">${ic('home')} ${t('Về trang chủ')}</button>`)}</div>${footer()}`;
}

function addToCart(id, giavi, ankem, qty) {
  const key = lineKey(id, giavi, ankem);
  const ex = S.cart.find((l) => l.key === key);
  if (ex) ex.qty = clamp(ex.qty + qty, 1, 99);
  else S.cart.unshift({ key, id: Number(id), giavi: [...giavi].sort((a, b) => a - b), ankem: [...ankem].sort((a, b) => a - b), qty: clamp(qty, 1, 99), checked: false, added: now() });
  save();
  updateBadges(true);
}

/* ---------- Giỏ hàng ---------- */
function vCart() {
  const n = cartCount();
  if (!S.cart.length) {
    return `${topbar(t('Giỏ hàng ({n})', { n: 0 }), { noCart: true })}<div class="${pageCls()}">${emptyBox('🛒', t('Giỏ hàng đang trống'), t('Thêm vài món ngon vào giỏ rồi quay lại đây nhé!'), `<button class="btn btn-red" data-go="#/">${ic('home')} ${t('Khám phá món ngon')}</button>`)}</div>${footer()}`;
  }
  const sel = S.cart.filter((l) => l.checked);
  const all = sel.length === S.cart.length;
  const total = sel.reduce((a, l) => a + unitPrice(l) * l.qty, 0);
  const selQty = sel.reduce((a, l) => a + l.qty, 0);
  return `${topbar(t('Giỏ hàng ({n})', { n }), { noCart: true })}
  <div class="${pageCls()}">
    <div class="list">${S.cart.map((l, i) => { const d = byId(l.id); return `
      <div class="citem stg ${l.checked ? 'sel' : ''}" style="--d:${Math.min(i, 10) * 40}ms">
        <button class="chk-btn" data-act="c-check" data-v="${esc(l.key)}" aria-label="${esc(t('Chọn món'))}"><span class="chk ${l.checked ? 'on' : ''}">${ic('check')}</span></button>
        ${ph(d, '', `data-go="#/dish/${d.id}"`)}
        <div class="ci-b">
          <div class="ci-n" data-go="#/dish/${d.id}">${esc(dName(d))}</div>
          <div class="ci-o">${esc(optText(l))}</div>
          <div class="ci-f">
            <span class="price">${fmt(unitPrice(l))}</span>
            <div class="ci-act">
              <div class="stepper sm"><button data-act="c-qty" data-k="${esc(l.key)}" data-v="-1" aria-label="${esc(t('Giảm'))}">${ic('minus')}</button><output>${l.qty}</output><button data-act="c-qty" data-k="${esc(l.key)}" data-v="1" aria-label="${esc(t('Tăng'))}">${ic('plus')}</button></div>
              <button class="icon-btn" data-act="c-del" data-v="${esc(l.key)}" aria-label="${esc(t('Xóa món'))}">${ic('trash')}</button>
            </div>
          </div>
        </div>
      </div>`; }).join('')}</div>
    <div class="cartbar">
      <button class="chk-all" data-act="c-all"><span class="chk ${all ? 'on' : ''}">${ic('check')}</span> ${t('Tất cả')}</button>
      <div class="cb-total"><small>${t('Tổng cộng')}</small><b>${fmt(total)}</b></div>
      <button class="btn btn-red" data-act="c-buy">${t('Mua hàng ({n})', { n: selQty })}</button>
    </div>
  </div>${footer()}`;
}

/* ---------- Thanh toán ---------- */
function coItems() {
  return (S.checkout && Array.isArray(S.checkout.items) ? S.checkout.items : []).filter((l) => byId(l.id) && l.qty > 0);
}
function vCheckout() {
  const items = coItems();
  if (!items.length) {
    return `${topbar(t('Thanh toán'))}<div class="${pageCls()}">${emptyBox('🧾', t('Chưa có món để thanh toán'), t('Hãy chọn món trong giỏ hàng hoặc bấm “Mua ngay” ở một món bất kỳ.'), `<button class="btn btn-red" data-go="#/cart">${ic('cart')} ${t('Tới giỏ hàng')}</button>`)}</div>${footer()}`;
  }
  const pay = S.checkout.pay || 'cod';
  const sub = items.reduce((a, l) => a + unitPrice(l) * l.qty, 0);
  const qty = items.reduce((a, l) => a + l.qty, 0);
  return `${topbar(t('Thanh toán'))}
  <div class="${pageCls()}">
    <div class="co-grid">
      <div class="stack" style="padding-top:0">
        <div class="box addr stg">
          <div class="addr-ic">${ic('pin')}</div>
          <div><div class="addr-t">${t('Địa chỉ Giao hàng')}:</div><div class="addr-v">${t('Nhà mình')} 🏠</div>
          <div class="addr-n">${t('Địa chỉ tượng trưng – trang không dùng địa chỉ thật của bạn hay của bất kỳ ai.')}</div></div>
        </div>
        <div class="box stg" style="--d:60ms">
          <div class="box-h">${ic('receipt')} ${t('Món đã chọn ({n})', { n: qty })}</div>
          ${items.map((l) => { const d = byId(l.id); return `
            <div class="oitem">${ph(d)}
              <div style="min-width:0"><div class="oi-n">${esc(dName(d))}</div><div class="oi-o">${esc(optText(l))}</div></div>
              <div class="oi-r"><span class="price">${fmt(unitPrice(l))}</span><span class="oi-q">x${l.qty}</span></div>
            </div>`; }).join('')}
        </div>
        <div class="box stg" style="--d:120ms">
          <div class="box-h">${ic('wallet')} ${t('Phương thức thanh toán')}</div>
          <div class="pays">${PAYS.map((p) => opt('pay', p.k, esc(t(p.n)), p.k === pay, p.icon)).join('')}</div>
        </div>
      </div>
      <div class="co-side">
        <div class="box stg" style="--d:160ms">
          <div class="sum">
            <div class="sum-r"><span>${t('Tạm tính ({n} món)', { n: qty })}</span><b>${fmt(sub)}</b></div>
            <div class="sum-r"><span>${t('Phí giao hàng')}</span><b class="free">${t('Miễn phí')}</b></div>
            <div class="sum-r"><span>${t('Giảm giá')}</span><b>${fmt(0)}</b></div>
            <div class="sum-r tot"><span>${t('Tổng cộng')}</span><b>${fmt(sub)}</b></div>
          </div>
        </div>
        <div class="cartbar" style="margin-top:0">
          <div class="cb-total" style="text-align:left"><small>${t('Tổng cộng')}</small><b>${fmt(sub)}</b></div>
          <button class="btn btn-red" data-act="place" style="flex:1">${ic('check')} ${t('Đặt hàng')}</button>
        </div>
      </div>
    </div>
  </div>${footer()}`;
}
function saveDraft() {
  const c = S.checkout;
  if (!c || !coItems().length) return;
  const items = clone(coItems());
  const sig = (arr) => arr.map((l) => lineKey(l.id, l.giavi || [], l.ankem || []) + 'x' + l.qty).sort().join('|');
  const me = sig(items);
  S.drafts = S.drafts.filter((d) => d.id === c.sid || sig(d.items) !== me);
  const ex = S.drafts.find((d) => d.id === c.sid);
  if (ex) { ex.items = items; ex.pay = c.pay; ex.updated = now(); }
  else S.drafts.unshift({ id: c.sid, items, pay: c.pay || 'cod', source: c.source, created: now(), updated: now() });
  S.drafts = S.drafts.slice(0, 30);
  save();
}
function placeOrder() {
  const items = coItems();
  if (!items.length) return;
  const c = S.checkout;
  const snap = items.map((l) => { const d = byId(l.id); return { id: d.id, name: d.name, img: d.img, emoji: d.emoji, unit: unitPrice(l), qty: l.qty, opts: optText(l), gv: (l.giavi || []).slice(), ak: (l.ankem || []).slice() }; });
  const total = snap.reduce((a, l) => a + l.unit * l.qty, 0);
  let code;
  do { code = '1277-' + rndStr(4) + '-' + rndStr(4); } while (S.orders.some((o) => o.code === code));
  const d1 = rand(12, 25) * 1000, d2 = rand(25, 45) * 1000, d3 = rand(100, 200) * 1000;
  const order = { code, items: snap, total, pay: c.pay || 'cod', created: now(), t1: d1, t2: d1 + d2, t3: d1 + d2 + d3, seed: rand(1, 2147483646), notified: false };
  S.orders.unshift(order);
  if (c.source === 'cart') {
    const keys = new Set(items.map((l) => l.key));
    S.cart = S.cart.filter((l) => !keys.has(l.key));
  }
  S.drafts = S.drafts.filter((d) => d.id !== c.sid);
  S.checkout = null;
  save();
  updateBadges();
  syncSwData();
  askNotif().then(() => schedulePush(order));
  go('#/order/' + code, { replace: true });
  toast(t('Đặt hàng thành công! Đang chờ quán xác nhận…'));
}

/* ---------- Trang Đơn hàng ---------- */
const TABS = [
  { k: 'coming', n: 'Đang đến', icon: 'bike' },
  { k: 'deals', n: 'Deal đã mua', icon: 'tag' },
  { k: 'history', n: 'Lịch sử', icon: 'clock' },
  { k: 'drafts', n: 'Đơn nháp', icon: 'draft' }
];
/* Gia vị / ăn kèm của món trong đơn (đơn mới dịch được theo ngôn ngữ) */
function itOpts(it) {
  const d = byId(it.id);
  if (d && Array.isArray(it.gv) && Array.isArray(it.ak)) return optText({ id: it.id, giavi: it.gv, ankem: it.ak });
  /* Đơn đặt trước khi có đa ngôn ngữ: đọc lại tên gia vị đã lưu để dịch */
  const m = d && /^Gia vị: (.*) • Ăn kèm: (.*)$/.exec(it.opts || '');
  if (!m) return it.opts || '';
  const pick = (list, seg) => (seg === 'Không có' ? [] : list.map((o, i) => ((', ' + seg + ', ').includes(', ' + o[0] + ', ') ? i : -1)).filter((i) => i >= 0));
  return optText({ id: it.id, giavi: pick(d.giavi, m[1]), ankem: pick(d.ankem, m[2]) });
}
const payLbl = () => (L() === 'vi' ? 'Thanh toán' : t('Phương thức thanh toán'));
const moreText = (n) => (n > 0 ? t('và {n} món khác', { n }) : '');
function dealsList() {
  const map = new Map();
  S.orders.filter((o) => stageOf(o) === 3).forEach((o) => o.items.forEach((it) => {
    const m = map.get(it.id) || { id: it.id, qty: 0, last: 0, spent: 0 };
    m.qty += it.qty; m.spent += it.unit * it.qty; m.last = Math.max(m.last, o.created + o.t3);
    map.set(it.id, m);
  }));
  return [...map.values()].filter((m) => byId(m.id)).sort((a, b) => b.last - a.last);
}
function orderCard(o, i) {
  const st = stageOf(o);
  const first = o.items[0] || {};
  const more = o.items.length - 1;
  const qty = o.items.reduce((a, l) => a + l.qty, 0);
  const d = byId(first.id) || { emoji: first.emoji || '🍜', img: first.img, name: first.name };
  return `<div class="ocard stg" style="--d:${Math.min(i, 10) * 40}ms" data-go="#/order/${o.code}" role="link" tabindex="0">
    <div class="oc-top">
      <span class="oc-code">${ic('receipt')} #${esc(o.code)}</span>
      <span class="st ${st === 3 ? 'done' : ''}" data-stl="${o.code}">${ic(STAGES[st].icon)} ${t(STAGES[st].t)}</span>
    </div>
    <div class="oc-mid">${ph(d)}
      <div style="min-width:0"><div class="oi-n">${esc(itName(first))}${more > 0 ? ` <span class="muted" style="font-weight:600">${moreText(more)}</span>` : ''}</div>
      <div class="oi-o">${t('{n} món', { n: qty })} • ${esc(payName(o.pay))}</div></div>
    </div>
    <div class="oc-bot">
      <span>${st < 3 ? `${ic('clock')} <span>${t('Giao tới sau {t}', { t: `<span class="cd" data-cd="${o.code}">${mmss(o.created + o.t3 - now())}</span>` })}</span>` : `${ic('checkc')} ${dateTime(o.created + o.t3)}`}</span>
      <span>${t('Tổng')}: <b>${fmt(o.total)}</b></span>
    </div>
  </div>`;
}
function vOrders() {
  const tab = TABS.some((x) => x.k === S.ordersTab) ? S.ordersTab : 'coming';
  const coming = activeOrders();
  const hist = S.orders.filter((o) => stageOf(o) === 3);
  const deals = dealsList();
  const counts = { coming: coming.length, deals: deals.length, history: hist.length, drafts: S.drafts.length };
  let body = '';
  if (tab === 'coming') {
    body = coming.length ? coming.map(orderCard).join('')
      : emptyBox('🛵', t('Không có đơn nào đang đến'), t('Đặt một món ngon để xem tài xế chạy tới Nhà mình nhé!'), `<button class="btn btn-red" data-go="#/">${ic('home')} ${t('Đặt món ngay')}</button>`);
  } else if (tab === 'history') {
    body = hist.length ? hist.map(orderCard).join('')
      : emptyBox('📜', t('Chưa có lịch sử'), t('Các đơn đã giao thành công sẽ được lưu ở đây.'));
  } else if (tab === 'deals') {
    body = deals.length ? deals.map((m, i) => { const d = byId(m.id); return `
      <div class="ocard stg" style="--d:${Math.min(i, 10) * 40}ms; cursor:default">
        <div class="oc-mid">${ph(d, '', `data-go="#/dish/${d.id}" style="cursor:pointer"`)}
          <div style="min-width:0"><div class="oi-n">${esc(dName(d))}</div>
          <div class="oi-o">${t('Đã mua {q} phần • Lần gần nhất {t}', { q: m.qty, t: ago(m.last) })}</div>
          <div class="stars-row">${stars(d.rating)} <b>${fmtRating(d.rating)}</b></div></div>
        </div>
        <div class="oc-bot"><span>${t('Đã chi (ảo)')}: <b>${fmt(m.spent)}</b></span>
          <button class="btn btn-red btn-sm" data-go="#/dish/${d.id}">${ic('refresh')} ${t('Mua lại')}</button></div>
      </div>`; }).join('')
      : emptyBox('🏷️', t('Chưa có deal nào'), t('Món bạn đã nhận sẽ hiện ở đây để mua lại thật nhanh.'));
  } else {
    body = S.drafts.length ? S.drafts.map((dr, i) => {
      const items = dr.items.filter((l) => byId(l.id));
      const first = items[0] ? byId(items[0].id) : MENU[0];
      const total = items.reduce((a, l) => a + unitPrice(l) * l.qty, 0);
      const qty = items.reduce((a, l) => a + l.qty, 0);
      return `<div class="ocard stg" style="--d:${Math.min(i, 10) * 40}ms; cursor:default">
        <div class="oc-top"><span class="oc-code">${ic('draft')} ${t('Đơn nháp')}</span><span class="st draft">${ic('clock')} <span data-ago="${dr.updated}">${ago(dr.updated)}</span></span></div>
        <div class="oc-mid">${ph(first)}
          <div style="min-width:0"><div class="oi-n">${esc(dName(first))}${items.length > 1 ? ` <span class="muted" style="font-weight:600">${moreText(items.length - 1)}</span>` : ''}</div>
          <div class="oi-o">${t('{n} món', { n: qty })} • ${t('Tổng')} ${fmt(total)}</div></div>
        </div>
        <div class="oc-bot"><span></span><div class="oc-acts">
          <button class="btn btn-soft btn-sm" data-act="draft-del" data-v="${esc(dr.id)}">${ic('trash')} ${t('Xóa')}</button>
          <button class="btn btn-red btn-sm" data-act="draft-go" data-v="${esc(dr.id)}">${t('Tiếp tục thanh toán')}</button>
        </div></div>
      </div>`; }).join('')
      : emptyBox('📝', t('Không có đơn nháp'), t('Khi bạn vào trang Thanh toán mà chưa đặt hàng, đơn sẽ được lưu nháp ở đây.'));
  }
  return `${topbar(t('Đơn hàng'))}
  <div class="${pageCls()}">
    <div class="sec" style="margin-top:18px"><h2 class="big-h" style="font-size:1.8rem">🧾 ${t('Đơn hàng')}</h2></div>
    <div class="tabs" role="tablist">${TABS.map((tb) => `
      <button class="tab ${tb.k === tab ? 'on' : ''}" data-act="tab" data-v="${tb.k}" role="tab" aria-selected="${tb.k === tab}">${ic(tb.icon)} ${t(tb.n)} <span class="n">${counts[tb.k]}</span></button>`).join('')}
    </div>
    <div class="list">${body}</div>
  </div>${footer()}`;
}

/* ---------- Theo dõi đơn hàng ---------- */
function stepsHtml(st) {
  return `<div class="steps">${STAGES.map((s, i) => `
    <div class="step ${i === 3 ? 'fin' : ''} ${i < st || st === 3 ? 'done' : ''} ${i === st && st < 3 ? 'cur' : ''}">
      <span class="s-ic">${ic(s.icon)}</span><span>${t(s.t)}</span>
    </div>`).join('')}</div>`;
}
function vTrack(code) {
  const o = S.orders.find((x) => x.code === code);
  if (!o) return vNotFound();
  const st = stageOf(o);
  UI.trackStage = st;
  const done = st === 3;
  const qty = o.items.reduce((a, l) => a + l.qty, 0);
  return `${topbar(t('Theo dõi đơn hàng'))}
  <div class="${pageCls()}">
    <div class="stack">
      <div class="trk-hero stg">
        <div class="trk-ic ${done ? 'ok' : 'spin-ring'}">${ic(done ? 'check' : STAGES[st].icon)}</div>
        <div class="trk-t ${done ? 'ok' : ''}">${t(STAGES[st].t)}</div>
        <div class="trk-s">${t(STAGES[st].s)}</div>
        ${done ? `<div class="trk-s">${t('Đã giao lúc {t}', { t: dateTime(o.created + o.t3) })}</div>`
               : `<div class="trk-s">${t('Thời gian giao tới nhà còn')}</div><div class="trk-cd" id="trkCd">${mmss(o.created + o.t3 - now())}</div>`}
        <div class="code-chip">#${esc(o.code)}<button data-act="o-code" data-v="${esc(o.code)}" aria-label="${esc(t('Sao chép mã đơn'))}">${ic('copy')}</button></div>
      </div>
      ${stepsHtml(st)}
      <div class="trk-grid">
        <div class="map-box stg" style="--d:80ms">
          <canvas id="mapCv" aria-label="${esc(t('Bản đồ đường đi của tài xế'))}"></canvas>
          <div class="map-chip" id="mapChip">${mapChipText(o)}</div>
          <div class="map-legend"><span>🍜 ${t('Quán 1277')}</span><span>🛵 ${t('Tài xế')}</span><span>🏠 ${t('Nhà mình')}</span></div>
        </div>
        <div class="stack" style="padding-top:0">
          <div class="box stg" style="--d:120ms">
            <div class="box-h">${ic('receipt')} ${t('Chi tiết đơn ({n} món)', { n: qty })}</div>
            ${o.items.map((it) => { const d = byId(it.id) || { emoji: it.emoji || '🍜', img: it.img, name: it.name }; return `
              <div class="oitem">${ph(d)}
                <div style="min-width:0"><div class="oi-n">${esc(itName(it))}</div><div class="oi-o">${esc(itOpts(it))}</div></div>
                <div class="oi-r"><span class="price">${fmt(it.unit)}</span><span class="oi-q">x${it.qty}</span></div>
              </div>`; }).join('')}
            <div class="sum" style="margin-top:10px">
              <div class="sum-r"><span>${ic('pin')} ${t('Địa chỉ')}</span><b>${t('Nhà mình')}</b></div>
              <div class="sum-r"><span>${payLbl()}</span><b>${esc(payName(o.pay))}</b></div>
              <div class="sum-r"><span>${t('Đặt lúc')}</span><b>${dateTime(o.created)}</b></div>
              <div class="sum-r tot"><span>${t('Tổng cộng')}</span><b>${fmt(o.total)}</b></div>
            </div>
          </div>
          ${done ? `<div class="acts">
            <button class="btn btn-red" data-act="o-share" data-v="${esc(o.code)}">${ic('share')} ${t('Chia sẻ')}</button>
            <button class="btn btn-ghost" data-act="o-copy" data-v="${esc(o.code)}">${ic('copy')} ${t('Sao chép đơn hàng')}</button>
            <button class="btn btn-soft" data-act="o-again" data-v="${esc(o.code)}">${ic('refresh')} ${t('Đặt lại')}</button>
          </div>` : `<div class="acts"><button class="btn btn-soft" data-act="o-copy" data-v="${esc(o.code)}">${ic('copy')} ${t('Sao chép đơn hàng')}</button></div>`}
        </div>
      </div>
    </div>
  </div>${footer()}`;
}
function mapChipText(o) {
  const st = stageOf(o);
  if (st === 0) return '🍜 ' + t('Quán đang xác nhận đơn…');
  if (st === 1) return '👨‍🍳 ' + t('Đang nấu – tài xế chờ lấy món');
  if (st === 2) return '🛵 ' + t('Đang giao • còn {t}', { t: mmss(o.created + o.t3 - now()) });
  return '✅ ' + t('Đã tới Nhà mình');
}
function orderText(o) {
  const st = stageOf(o);
  const lines = [
    `🧾 1277Foods – ${t('Đơn hàng #{c}', { c: o.code })}`,
    st === 3 ? '✅ ' + t('Đã giao hàng thành công') : `⏳ ${t(STAGES[st].t)}`,
    `🕒 ${t('Đặt lúc')}: ${dateTime(o.created)}`,
    `📍 ${t('Địa chỉ')}: ${t('Nhà mình')}`,
    ...o.items.map((it) => `• ${itName(it)} x${it.qty} – ${fmt(it.unit * it.qty)}\n   (${itOpts(it)})`),
    `💳 ${payLbl()}: ${payName(o.pay)}`,
    `💰 ${t('Tổng cộng')}: ${fmt(o.total)}`,
    `(${t('Đơn hàng ảo – chỉ vui, không giao thật 😄')})`,
    `👉 ${pageUrl()}`
  ];
  return lines.join('\n');
}

/* ---------- Bản đồ thành phố (vẽ bằng canvas, chạy offline) ---------- */
const MapView = (() => {
  let raf = 0, cv = null, order = null, city = null, layer = null, lw = 0, lh = 0, ldark = null;
  const STREETS = ['Đ. Hoa Phượng', 'Đ. Hoa Sữa', 'Đ. Bằng Lăng', 'Đ. Hoa Mai', 'Đ. Cây Me', 'Đ. Hàng Phở', 'Đ. Bánh Mì', 'Đ. Gió Mát', 'Đ. Sông Xanh', 'Đ. Nắng Vàng'];

  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function gen(seed) {
    const r = rng(seed);
    const nx = 7, ny = 7;
    const river = 2 + Math.floor(r() * 2); /* hàng ô có sông */
    const cols = [0, 1, 2, 3, 4, 5, 6].sort(() => r() - 0.5);
    const bridges = cols.slice(0, 2);
    const cells = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      if (j === river) { cells.push({ i, j, t: 'water' }); continue; }
      const t = r() < 0.17 ? 'park' : 'build';
      const b = [];
      if (t === 'build') {
        const n = 2 + Math.floor(r() * 3);
        const split = r() < 0.5;
        for (let k = 0; k < n; k++) {
          const w = 1 / n;
          b.push(split ? { x: k * w + 0.04, y: 0.06 + r() * 0.1, w: w - 0.08, h: 0.55 + r() * 0.3, c: Math.floor(r() * 6), hgt: 2 + r() * 5 }
                       : { x: 0.06 + r() * 0.1, y: k * w + 0.04, w: 0.55 + r() * 0.3, h: w - 0.08, c: Math.floor(r() * 6), hgt: 2 + r() * 5 });
        }
      }
      const trees = [];
      if (t === 'park') for (let k = 0; k < 6; k++) trees.push({ x: 0.15 + r() * 0.7, y: 0.15 + r() * 0.7, s: 0.6 + r() * 0.5 });
      cells.push({ i, j, t, b, trees, pond: t === 'park' && r() < 0.5 });
    }
    const hasV = (i, j) => j !== river || bridges.includes(i); /* cạnh dọc (i,j)-(i,j+1) */
    const majorRow = r() < 0.5 ? 0 : ny - 1, majorCol = 1 + Math.floor(r() * (nx - 2));
    /* Quán ở phía trên sông, nhà ở phía dưới (hoặc ngược lại) */
    const flip = r() < 0.5;
    const top = { x: Math.floor(r() * nx), y: Math.floor(r() * (river + 1)) };
    const bot = { x: Math.floor(r() * nx), y: river + 1 + Math.floor(r() * (ny - river - 1)) };
    if (Math.abs(top.x - bot.x) < 2) bot.x = (top.x + 3 + Math.floor(r() * 2)) % nx;
    const shop = flip ? bot : top, home = flip ? top : bot;
    /* Tìm đường ngắn, ít rẽ (Dijkstra) — chỉ đi trên đường, không xuyên nhà */
    const id = (x, y, d) => ((y * nx + x) * 5) + d;
    const dist = new Map(), prev = new Map(), done = new Set();
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const start = id(shop.x, shop.y, 4);
    dist.set(start, 0);
    let endKey = null;
    while (true) {
      let best = null, bd = Infinity;
      dist.forEach((v, k) => { if (!done.has(k) && v < bd) { bd = v; best = k; } });
      if (best === null) break;
      done.add(best);
      const d = best % 5, node = (best - d) / 5, x = node % nx, y = (node - x) / nx;
      if (x === home.x && y === home.y) { endKey = best; break; }
      DIRS.forEach(([dx, dy], nd) => {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= nx || Y >= ny) return;
        if (dy !== 0 && !hasV(x, Math.min(y, Y))) return;
        const k = id(X, Y, nd), c = bd + 1 + (d !== 4 && d !== nd ? 0.6 : 0);
        if (c < (dist.has(k) ? dist.get(k) : Infinity)) { dist.set(k, c); prev.set(k, best); }
      });
    }
    let path = [];
    for (let k = endKey; k != null; k = prev.get(k)) { const d = k % 5, n = (k - d) / 5; path.unshift([n % nx, (n - n % nx) / nx]); if (k === start) break; }
    if (path.length < 2) path = [[shop.x, shop.y], [home.x, home.y]];
    const names = STREETS.slice().sort(() => r() - 0.5);
    return { nx, ny, river, bridges, cells, hasV, majorRow, majorCol, shop, home, path, names };
  }

  const PAL = {
    light: { land: '#eef0e4', block: '#e4e2d6', road: '#ffffff', casing: '#d3d6da', major: '#ffe6a0', majorCase: '#efc65a', water: '#9fd3f5', water2: '#7cc0ee', park: '#bfe3a5', tree: '#6fbf5a', tree2: '#4e9f43', label: '#7b6f66', roofs: ['#f6c9b4', '#f3d9a4', '#cfe0f5', '#e7cfe9', '#d9e8c9', '#f1c6c6'], shadow: 'rgba(80,60,40,.18)', route: '#e53935' },
    dark: { land: '#1a1f1c', block: '#232823', road: '#3b4249', casing: '#2a3036', major: '#6b5a2c', majorCase: '#544622', water: '#1f4a6b', water2: '#2a5f86', park: '#24402a', tree: '#2f6b3a', tree2: '#235530', label: '#a89c92', roofs: ['#5b3d33', '#5a4b2e', '#2f4258', '#4b3650', '#3b4a31', '#55302f'], shadow: 'rgba(0,0,0,.4)', route: '#ff5449' }
  };

  function geo(W, H) {
    const pad = Math.max(22, W * 0.05);
    const padT = Math.max(50, H * 0.12);
    const rw = clamp(W / 42, 8, 15);
    const X = (i) => pad + i * (W - 2 * pad) / (city.nx - 1);
    const Y = (j) => padT + j * (H - padT - pad) / (city.ny - 1);
    return { pad, rw, X, Y };
  }
  function drawStatic(W, H, dark) {
    const P = dark ? PAL.dark : PAL.light;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    layer = document.createElement('canvas');
    layer.width = Math.round(W * dpr); layer.height = Math.round(H * dpr);
    const c = layer.getContext('2d');
    c.scale(dpr, dpr);
    const { rw, X, Y } = geo(W, H);
    c.fillStyle = P.land; c.fillRect(0, 0, W, H);
    /* Sông */
    const ry1 = Y(city.river) + rw * 0.9, ry2 = Y(city.river + 1) - rw * 0.9;
    const gr = c.createLinearGradient(0, ry1, 0, ry2);
    gr.addColorStop(0, P.water2); gr.addColorStop(0.5, P.water); gr.addColorStop(1, P.water2);
    c.fillStyle = gr; c.fillRect(0, ry1, W, ry2 - ry1);
    /* Ô phố */
    city.cells.forEach((cell) => {
      if (cell.t === 'water') return;
      const x1 = X(cell.i) + rw * 0.9, y1 = Y(cell.j) + rw * 0.9, x2 = X(cell.i + 1) - rw * 0.9, y2 = Y(cell.j + 1) - rw * 0.9;
      const w = x2 - x1, h = y2 - y1;
      if (w <= 4 || h <= 4) return;
      c.fillStyle = cell.t === 'park' ? P.park : P.block;
      roundRect(c, x1, y1, w, h, 6); c.fill();
      if (cell.t === 'park') {
        if (cell.pond) { c.fillStyle = P.water; c.beginPath(); c.ellipse(x1 + w * 0.5, y1 + h * 0.55, w * 0.22, h * 0.16, 0, 0, Math.PI * 2); c.fill(); }
        cell.trees.forEach((t) => {
          const r = Math.min(w, h) * 0.08 * t.s;
          c.fillStyle = P.tree2; c.beginPath(); c.arc(x1 + t.x * w + 1, y1 + t.y * h + 2, r, 0, Math.PI * 2); c.fill();
          c.fillStyle = P.tree; c.beginPath(); c.arc(x1 + t.x * w, y1 + t.y * h, r, 0, Math.PI * 2); c.fill();
        });
      } else {
        cell.b.forEach((b) => {
          const bx = x1 + b.x * w, by = y1 + b.y * h, bw = b.w * w, bh = b.h * h;
          if (bw < 3 || bh < 3) return;
          c.fillStyle = P.shadow; roundRect(c, bx + b.hgt * 0.6, by + b.hgt * 0.8, bw, bh, 3); c.fill();
          c.fillStyle = P.roofs[b.c]; roundRect(c, bx, by, bw, bh, 3); c.fill();
          c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1; c.strokeRect(bx + 2.5, by + 2.5, Math.max(0, bw - 5), Math.max(0, bh - 5));
        });
      }
    });
    /* Đường */
    const edges = [];
    for (let j = 0; j < city.ny; j++) for (let i = 0; i < city.nx - 1; i++) edges.push([i, j, i + 1, j, j === city.majorRow]);
    for (let i = 0; i < city.nx; i++) for (let j = 0; j < city.ny - 1; j++) if (city.hasV(i, j)) edges.push([i, j, i, j + 1, i === city.majorCol]);
    c.lineCap = 'round';
    const pass = (major, cas) => edges.forEach((e) => {
      if (!!e[4] !== major) return;
      c.strokeStyle = cas ? (major ? P.majorCase : P.casing) : (major ? P.major : P.road);
      c.lineWidth = (major ? rw * 1.35 : rw) + (cas ? 2.5 : 0);
      c.beginPath(); c.moveTo(X(e[0]), Y(e[1])); c.lineTo(X(e[2]), Y(e[3])); c.stroke();
    });
    pass(false, true); pass(true, true); pass(false, false); pass(true, false);
    /* Vạch giữa đường lớn */
    c.setLineDash([6, 7]); c.lineWidth = 1.4; c.strokeStyle = dark ? 'rgba(255,230,160,.55)' : 'rgba(255,255,255,.95)';
    c.beginPath(); c.moveTo(X(0), Y(city.majorRow)); c.lineTo(X(city.nx - 1), Y(city.majorRow)); c.stroke();
    c.beginPath(); c.moveTo(X(city.majorCol), Y(0)); c.lineTo(X(city.majorCol), Y(city.ny - 1)); c.stroke();
    c.setLineDash([]);
    /* Cầu */
    city.bridges.forEach((i) => {
      const x = X(i), ya = Y(city.river) + rw * 0.6, yb = Y(city.river + 1) - rw * 0.6;
      c.strokeStyle = dark ? '#8a7a66' : '#b9a58a'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x - rw * 0.75, ya); c.lineTo(x - rw * 0.75, yb); c.moveTo(x + rw * 0.75, ya); c.lineTo(x + rw * 0.75, yb); c.stroke();
    });
    /* Tên đường */
    c.fillStyle = P.label; c.font = `600 ${clamp(W / 60, 9, 12)}px system-ui, sans-serif`; c.textBaseline = 'middle';
    c.fillText(city.names[0], X(0) + 6, Y(city.majorRow) + (city.majorRow === 0 ? rw + 6 : -rw - 6));
    c.save(); c.translate(X(city.majorCol) + rw + 6, Y(0) + 8); c.rotate(Math.PI / 2); c.fillText(city.names[1], 0, 0); c.restore();
    c.fillStyle = dark ? '#9cc9ee' : '#3d7fb8'; c.font = `italic 700 ${clamp(W / 50, 10, 14)}px system-ui, sans-serif`;
    const rv = t('Sông 1277');
    c.fillText(rv, Math.max(6, X(city.nx - 1) - c.measureText(rv).width - 6), (ry1 + ry2) / 2);
    lw = W; lh = H; ldark = dark;
  }
  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function pin(c, x, y, color, emoji, label) {
    c.save();
    c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(x, y + 2, 8, 3, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = color; c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(x - 6, y - 10, x - 16, y - 16, x - 16, y - 28); c.arc(x, y - 28, 16, Math.PI, 0); c.bezierCurveTo(x + 16, y - 16, x + 6, y - 10, x, y); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y - 28, 12, 0, Math.PI * 2); c.fill();
    c.font = '15px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(emoji, x, y - 27);
    if (label) {
      c.font = '800 11px system-ui, sans-serif';
      const tw = c.measureText(label).width + 14;
      const ly = y - 66 < 2 ? y + 8 : y - 66;
      const lx = clamp(x, tw / 2 + 2, c.canvas.width / Math.min(window.devicePixelRatio || 1, 2) - tw / 2 - 2);
      c.fillStyle = color; roundRect(c, lx - tw / 2, ly, tw, 20, 10); c.fill();
      c.fillStyle = '#fff'; c.fillText(label, lx, ly + 10);
    }
    c.restore();
  }
  function frame(tm) {
    raf = 0;
    if (!cv || !cv.isConnected || !order) { stop(); return; }
    const W = cv.clientWidth, H = Math.round(clamp(W * (W < 600 ? 0.95 : 0.72), 260, 540));
    if (W < 60) { raf = requestAnimationFrame(frame); return; }
    const dark = document.documentElement.dataset.theme === 'dark';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; }
    if (!layer || lw !== W || lh !== H || ldark !== dark) drawStatic(W, H, dark);
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(layer, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = dark ? PAL.dark : PAL.light;
    const { rw, X, Y } = geo(W, H);
    /* Sóng nước */
    const ry1 = Y(city.river) + rw * 0.9, ry2 = Y(city.river + 1) - rw * 0.9;
    c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1.2;
    for (let k = 1; k <= 3; k++) {
      const yy = ry1 + (ry2 - ry1) * k / 4;
      c.beginPath();
      for (let x = 0; x <= W; x += 8) { const y = yy + Math.sin(x / 18 + tm / 600 + k) * 2; x ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    }
    /* Lộ trình */
    const pts = city.path.map(([i, j]) => [X(i), Y(j)]);
    const seg = []; let L = 0;
    for (let k = 1; k < pts.length; k++) { const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); seg.push(d); L += d; }
    const st = stageOf(order);
    const tt = now();
    let p = st < 2 ? 0 : st === 3 ? 1 : clamp((tt - order.created - order.t2) / (order.t3 - order.t2), 0, 1);
    p = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; /* chạy nhanh dần rồi chậm dần */
    const at = (dist) => {
      let acc = 0;
      for (let k = 0; k < seg.length; k++) {
        if (acc + seg[k] >= dist) { const f = seg[k] ? (dist - acc) / seg[k] : 0; return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f, k]; }
        acc += seg[k];
      }
      const e = pts[pts.length - 1]; return [e[0], e[1], seg.length - 1];
    };
    const pos = at(L * p);
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = P.route; c.globalAlpha = 0.25; c.lineWidth = rw * 0.95;
    c.beginPath(); pts.forEach((q, k) => (k ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke();
    c.globalAlpha = 1; c.lineWidth = rw * 0.42; c.setLineDash([rw * 0.9, rw * 0.7]); c.lineDashOffset = -tm / 40;
    c.beginPath(); c.moveTo(pos[0], pos[1]); for (let k = pos[2] + 1; k < pts.length; k++) c.lineTo(pts[k][0], pts[k][1]); c.stroke();
    c.setLineDash([]); c.lineWidth = rw * 0.5;
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k <= pos[2]; k++) c.lineTo(pts[k][0], pts[k][1]); c.lineTo(pos[0], pos[1]); c.stroke();
    /* Điểm quán & nhà */
    pin(c, pts[0][0], pts[0][1], '#e53935', '🍜', t('Quán 1277'));
    const e = pts[pts.length - 1];
    pin(c, e[0], e[1], '#16a34a', '🏠', t('Nhà mình'));
    /* Tài xế */
    const pulse = (tm / 900) % 1;
    c.fillStyle = `rgba(229,57,53,${0.35 * (1 - pulse)})`; c.beginPath(); c.arc(pos[0], pos[1], 14 + pulse * 18, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.strokeStyle = P.route; c.lineWidth = 3;
    c.beginPath(); c.arc(pos[0], pos[1], 15, 0, Math.PI * 2); c.fill(); c.stroke();
    c.font = '17px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('🛵', pos[0], pos[1] + (st === 2 ? Math.sin(tm / 90) * 1 : 0));
    raf = requestAnimationFrame(frame);
  }
  function start(canvas, o) {
    stop();
    cv = canvas; order = o;
    city = gen(o.seed || 1277);
    layer = null;
    raf = requestAnimationFrame(frame);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  return { start, stop };
})();

/* ---------- Ảnh chia sẻ đơn hàng ---------- */
function loadImg(src) {
  return new Promise((res) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.referrerPolicy = 'no-referrer';
    const to = setTimeout(() => res(null), 4000);
    im.onload = () => { clearTimeout(to); res(im); };
    im.onerror = () => { clearTimeout(to); res(null); };
    im.src = src;
  });
}
async function orderImage(o) {
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const font = (w, s) => `${w} ${s}px ${SYS_FONT}`;
  const g = c.createLinearGradient(0, 0, W, 420);
  g.addColorStop(0, '#e53935'); g.addColorStop(0.6, '#d81b60'); g.addColorStop(1, '#ff6a3d');
  c.fillStyle = '#fff8f3'; c.fillRect(0, 0, W, H);
  c.fillStyle = g; c.fillRect(0, 0, W, 420);
  c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.font = font(800, 64); c.fillText('🍜 1277Foods', 60, 110);
  c.font = font(600, 34); c.fillText(t('Đặt Đồ Ăn Ảo – Chỉ Vui, Không Lo Gì Cả'), 60, 165, W - 120);
  const first = o.items[0];
  const im = first ? await loadImg(first.img) : null;
  const ix = 60, iy = 220, iw = W - 120, ih = 440;
  c.save(); c.beginPath(); c.roundRect ? c.roundRect(ix, iy, iw, ih, 36) : c.rect(ix, iy, iw, ih); c.clip();
  if (im) {
    const r = Math.max(iw / im.width, ih / im.height), dw = im.width * r, dh = im.height * r;
    try { c.drawImage(im, ix + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh); } catch (e) { /* bỏ qua */ }
  } else {
    c.fillStyle = '#fde3d6'; c.fillRect(ix, iy, iw, ih);
    c.font = '220px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(first ? (first.emoji || '🍜') : '🍜', W / 2, iy + ih / 2);
  }
  c.restore();
  let y = 740; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.fillStyle = '#16a34a'; c.font = font(800, 50);
  c.fillText(stageOf(o) === 3 ? '✅ ' + t('Đã giao hàng thành công') : '⏳ ' + t(STAGES[stageOf(o)].t), 60, y, W - 120);
  y += 60; c.fillStyle = '#8a7468'; c.font = font(600, 30);
  c.fillText(`${t('Mã đơn #{c}', { c: o.code })}  •  ${dateTime(o.created)}`, 60, y, W - 120);
  y += 60; c.fillStyle = '#2b1d16';
  o.items.slice(0, 5).forEach((it) => {
    c.font = font(700, 36);
    const name = `${itName(it)} x${it.qty}`;
    c.fillText(name.length > 30 ? name.slice(0, 29) + '…' : name, 60, y, W - 400);
    c.textAlign = 'right'; c.fillStyle = '#e53935'; c.fillText(fmt(it.unit * it.qty), W - 60, y);
    c.textAlign = 'left'; c.fillStyle = '#2b1d16'; y += 54;
  });
  if (o.items.length > 5) { c.font = font(600, 30); c.fillStyle = '#8a7468'; c.fillText('… ' + moreText(o.items.length - 5), 60, y); y += 50; }
  c.strokeStyle = '#f1dfd3'; c.lineWidth = 3; c.setLineDash([12, 10]); c.beginPath(); c.moveTo(60, y - 18); c.lineTo(W - 60, y - 18); c.stroke(); c.setLineDash([]);
  y += 30; c.font = font(800, 44); c.fillStyle = '#2b1d16'; c.fillText(t('Tổng cộng'), 60, y);
  c.textAlign = 'right'; c.fillStyle = '#e53935'; c.fillText(fmt(o.total), W - 60, y); c.textAlign = 'left';
  c.font = font(600, 28); c.fillStyle = '#8a7468';
  c.fillText(`📍 ${t('Nhà mình')}  •  💳 ${payName(o.pay)}`, 60, Math.min(y + 60, H - 110), W - 120);
  c.fillStyle = '#e53935'; c.fillRect(0, H - 80, W, 80);
  c.fillStyle = '#fff'; c.font = font(700, 28); c.textAlign = 'center';
  c.fillText(t('Đơn hàng ảo – chỉ vui, không giao thật 😄'), W / 2, H - 30, W - 60);
  return new Promise((res) => {
    try { cv.toBlob((b) => res(b), 'image/png'); } catch (e) { res(null); }
  });
}

/* ---------- Thông báo nhỏ (toast) & hộp thoại ---------- */
let toastT = 0;
function toast(msg, warn = false) {
  const t = $('#toast');
  if (!t) return;
  t.className = 'toast' + (warn ? ' warn' : '');
  t.innerHTML = `${ic(warn ? 'alert' : 'checkc')}<span>${esc(msg)}</span>`;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}
let modalClose = null;
function modal(html, cls = '', onClose = null) {
  closeModal(true);
  const root = $('#modal-root');
  const el = document.createElement('div');
  el.className = 'mo ' + cls;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = cls.includes('qrfull') ? html : `<div class="mo-card">${html}</div>`;
  el.addEventListener('click', (e) => { if (e.target === el) closeModal(); });
  root.appendChild(el);
  document.body.style.overflow = 'hidden';
  modalClose = onClose;
  return el;
}
function closeModal(instant = false) {
  const el = $('#modal-root .mo');
  const fn = modalClose; modalClose = null;
  if (fn) try { fn(); } catch (e) { /* bỏ qua */ }
  document.body.style.overflow = '';
  if (!el) return;
  if (instant) { el.remove(); return; }
  el.classList.add('out');
  setTimeout(() => el.remove(), 220);
}
function alertBox(title, sub, btns) {
  modal(`<button class="m-x" data-act="close-modal" aria-label="${esc(t('Đóng'))}">${ic('x')}</button>
    <div class="alert-ic">${ic('alert')}</div>
    <div class="alert-t">${title}</div>${sub ? `<div class="alert-s">${sub}</div>` : '<div style="height:12px"></div>'}
    <div class="alert-acts">${btns || `<button class="btn btn-red" data-act="close-modal">${t('Đã hiểu')}</button>`}</div>`);
}

/* ---------- Chọn món ngẫu nhiên ---------- */
function rndCardHtml(d) {
  return `${ph(d)}<div class="rnd-b"><div class="rnd-n">${esc(dName(d))}</div>
    <div class="stars-row">${ic('star', 'fill')} <b>${fmtRating(d.rating)}</b> ${stars(d.rating)}</div>
    <div class="price" style="font-size:1.35rem">${fmt(d.price)}</div></div>`;
}
function openRandom() {
  modal(`<button class="m-x" data-act="close-modal" aria-label="${esc(t('Thoát'))}">${ic('x')}</button>
    <div class="rnd-title">${ic('dice')} ${t('Hôm nay ăn gì?')}</div>
    <div class="rnd-card" id="rndCard"></div>
    <div class="rnd-acts">
      <button class="btn btn-ghost" data-act="random-again" id="rndAgain">${ic('refresh')} ${t('Chọn lại')}</button>
      <button class="btn btn-red" data-act="random-view" id="rndView">${t('Xem món')}</button>
    </div>`);
  spin();
}
function spin() {
  const box = $('#rndCard');
  if (!box || UI.spinning) return;
  UI.spinning = true;
  ['#rndAgain', '#rndView'].forEach((s) => { const b = $(s); if (b) b.disabled = true; });
  box.className = 'rnd-card spinning';
  const final = MENU[Math.floor(Math.random() * MENU.length)];
  let delay = 60, last = -1, total = 0;
  const step = () => {
    if (!box.isConnected) { UI.spinning = false; return; }
    let i; do { i = Math.floor(Math.random() * MENU.length); } while (i === last && MENU.length > 1);
    last = i;
    total += delay;
    if (total > 1500) {
      UI.rndId = final.id;
      box.innerHTML = rndCardHtml(final);
      box.className = 'rnd-card';
      void box.offsetWidth;
      box.className = 'rnd-card landed';
      UI.spinning = false;
      ['#rndAgain', '#rndView'].forEach((s) => { const b = $(s); if (b) b.disabled = false; });
      if (navigator.vibrate) try { navigator.vibrate(40); } catch (e) { /* bỏ qua */ }
      return;
    }
    box.innerHTML = rndCardHtml(MENU[i]);
    delay = Math.min(260, delay * 1.18);
    setTimeout(step, delay);
  };
  step();
}

/* ---------- Mã QR toàn màn hình (giữ màn hình sáng) ---------- */
let wakeLock = null;
async function openQrFull() {
  const el = modal(`<div class="qrf">
      <button class="m-x" data-act="close-modal" aria-label="${esc(t('Đóng'))}">${ic('x')}</button>
      <div class="qrf-t">🍜 1277Foods</div>
      <canvas id="qrBig" aria-label="${esc(t('Mã QR của trang'))}"></canvas>
      <div class="qrf-l">${esc(pageUrl())}</div>
      <div class="qrf-l">${t('Quét mã bằng camera để mở trang')}</div>
    </div>`, 'qrfull', async () => {
    if (wakeLock) { try { await wakeLock.release(); } catch (e) { /* bỏ qua */ } wakeLock = null; }
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  });
  try { QR.draw($('#qrBig'), pageUrl(), 10); } catch (e) { toast(t('Không tạo được mã QR'), true); }
  try { if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' }); } catch (e) { /* bỏ qua */ }
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* bỏ qua */ }
}

/* ---------- Sao chép & chia sẻ ---------- */
async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* thử cách khác */ }
  try {
    const a = document.createElement('textarea');
    a.value = text; a.setAttribute('readonly', ''); a.style.position = 'fixed'; a.style.opacity = '0';
    document.body.appendChild(a); a.select(); const ok = document.execCommand('copy'); a.remove();
    return ok;
  } catch (e) { return false; }
}
async function sharePage() {
  const data = { title: '1277Foods | ' + t('Đặt Đồ Ăn Ảo'), text: '🍜 1277Foods – ' + t('Đặt đồ ăn ảo cho vui, không lo gì cả!'), url: pageUrl() };
  if (navigator.share) {
    try { await navigator.share(data); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  if (await copyText(data.url)) toast(t('Đã sao chép link – dán để chia sẻ nhé!'));
  else toast(t('Không chia sẻ được trên trình duyệt này'), true);
}
async function shareOrder(o) {
  const text = orderText(o);
  const blob = await orderImage(o);
  const file = blob ? new File([blob], `1277Foods-${o.code}.png`, { type: 'image/png' }) : null;
  if (navigator.share) {
    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: t('Đơn hàng #{c}', { c: o.code }), text });
      } else {
        await navigator.share({ title: t('Đơn hàng #{c}', { c: o.code }), text });
      }
      return;
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  if (blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `1277Foods-${o.code}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  await copyText(text);
  toast(t('Đã tải ảnh đơn hàng & sao chép nội dung'));
}

/* ---------- Thông báo trên thiết bị ---------- */
let notifAsked = false;
async function askNotif() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try {
    const r = Notification.requestPermission();
    if (r && r.then) await r;
  } catch (e) { /* bỏ qua */ }
  const row = $('#notifRow'); if (row) row.innerHTML = notifHtml();
}
function swReg(waitActive) {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  const p = waitActive ? navigator.serviceWorker.ready : navigator.serviceWorker.getRegistration();
  return Promise.race([Promise.resolve(p).catch(() => null), new Promise((r) => setTimeout(() => r(null), waitActive ? 6000 : 1500))]);
}
/* Đường link đẹp của trang (thư mục chứa index.html) — không bao giờ trỏ tới script.js */
const appBase = () => location.origin + location.pathname.replace(/[^/]*$/, '');
async function notify(title, opts) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { const reg = await swReg(); if (reg && reg.showNotification) { await reg.showNotification(title, opts); return; } } catch (e) { /* thử cách khác */ }
  try { new Notification(title, opts); } catch (e) { /* bỏ qua */ }
}
/* Nội dung thông báo theo ngôn ngữ đang chọn (Service Worker dùng lại khi trang đã đóng) */
const notifTitle = () => '1277Foods – ' + t('Giao hàng thành công') + ' ✅';
function notifBody(o) {
  const first = o.items[0] || {};
  const more = o.items.length - 1;
  const name = (itName(first) || t('Món ăn')) + (more > 0 ? ' ' + t('và {n} món khác', { n: more }) : '');
  return t('Đơn #{c}: {n} đã giao thành công tới Nhà mình. Chúc bạn ngon miệng! 😋', { c: o.code, n: name });
}
function orderNotifOpts(o) {
  const first = o.items[0] || {};
  return {
    body: notifBody(o),
    icon: first.img, image: first.img, tag: 'order-' + o.code, renotify: true,
    vibrate: [120, 60, 120], timestamp: o.created + o.t3,
    data: { url: appBase() + '#/order/' + o.code }
  };
}

/* ---------- Dữ liệu dùng chung với Service Worker (để báo khi đã thoát trình duyệt) ---------- */
const DATA_CACHE = '1277foods-data';
async function readData(name, def) {
  try { if (!('caches' in window)) return def; const c = await caches.open(DATA_CACHE); const r = await c.match(appBase() + name); return r ? await r.json() : def; } catch (e) { return def; }
}
async function writeData(name, val) {
  try { if (!('caches' in window)) return; const c = await caches.open(DATA_CACHE); await c.put(appBase() + name, new Response(JSON.stringify(val), { headers: { 'Content-Type': 'application/json' } })); } catch (e) { /* bỏ qua */ }
}
function syncSwData() {
  const cutoff = now() - 86400000;
  return writeData('__orders.json', S.orders.filter((o) => o.created + o.t3 > cutoff).map((o) => {
    const first = o.items[0] || {};
    return { code: o.code, at: o.created + o.t3, name: itName(first), more: o.items.length - 1, img: first.img || '', total: o.total, title: notifTitle(), body: notifBody(o) };
  })).then(() => writeData('__generic.json', { title: notifTitle(), body: t('Đơn hàng của bạn đã giao thành công tới Nhà mình. Chúc bạn ngon miệng! 😋') }));
}
async function markNotified(code) {
  const done = await readData('__notified.json', []);
  if (done.includes(code)) return false;
  done.push(code);
  await writeData('__notified.json', done.slice(-200));
  return true;
}

/* ---------- Thông báo đẩy (Web Push qua Apps Script) ---------- */
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function b64uBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function getVapid() {
  /* Đổi link Apps Script → lấy lại khoá mới (tránh lệch khoá thông báo) */
  if (S.vapid && S.vapidSrc === scriptUrl()) return S.vapid;
  const j = await callScript({ action: 'vapid' });
  if (j && typeof j.key === 'string' && /^[A-Za-z0-9_-]{80,100}$/.test(j.key)) { S.vapid = j.key; S.vapidSrc = scriptUrl(); save(); return j.key; }
  return null;
}
async function ensurePush() {
  if (!pushSupported() || Notification.permission !== 'granted' || !scriptUrl() || !navigator.onLine) return null;
  const reg = await swReg(true);
  if (!reg || !reg.pushManager) return null;
  const key = await getVapid();
  if (!key) return null;
  let sub = await reg.pushManager.getSubscription();
  if (sub && S.pushKey !== key) { try { await sub.unsubscribe(); } catch (e) { /* bỏ qua */ } sub = null; }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(key) });
    S.pushKey = key; save();
  }
  return sub;
}
async function schedulePush(o) {
  try {
    await syncSwData();
    const sub = await ensurePush();
    if (!sub || !sub.endpoint) return false;
    const wait = Math.max(0, o.created + o.t3 - now());
    const u = scriptUrl();
    const qs = new URLSearchParams({ action: 'schedule', code: o.code, wait: String(wait), ep: sub.endpoint, site: location.origin }).toString();
    fetch(u + (u.includes('?') ? '&' : '?') + qs, { method: 'GET', cache: 'no-store', keepalive: true, redirect: 'follow' }).catch(() => {});
    o.pushed = true; save();
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- Lượt truy cập (Google Sheets) ---------- */
function scriptUrl() {
  let u = String(SCRIPT_URL || '').trim();
  if (u && !/^https?:\/\//i.test(u)) { try { u = atob(u).trim(); } catch (e) { u = ''; } }
  return /^https:\/\/script\.google(usercontent)?\.com\//.test(u) ? u : '';
}
let visitState = 'init';
function visitStatusHtml() {
  if (!scriptUrl()) return '<i class="dot"></i><span>Chưa gắn link Apps Script</span>';
  if (!navigator.onLine || visitState === 'off') return '<i class="dot off"></i><span>Ngoại tuyến – số gần nhất</span>';
  if (visitState === 'live') return '<i class="dot live"></i><span>Đang cập nhật trực tiếp</span>';
  return '<i class="dot"></i><span>Đang kết nối…</span>';
}
function showCount(n) {
  const el = $('#vNum');
  const st = $('#vSt'); if (st) st.innerHTML = visitStatusHtml();
  if (n == null || !isFinite(n)) return;
  const old = S.lastCount;
  if (old !== n) { S.lastCount = n; save(); }
  if (!el) return;
  const from = Number(String(el.textContent).replace(/\D/g, '')) || 0;
  if (from === n) { el.textContent = numFmt(n); return; }
  const t0 = performance.now(), dur = 900;
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = numFmt(Math.round(from + (n - from) * e));
    if (k < 1 && el.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}
async function callScript(params) {
  const u = scriptUrl();
  if (!u) return null;
  const ctl = 'AbortController' in window ? new AbortController() : null;
  const to = setTimeout(() => ctl && ctl.abort(), 12000);
  try {
    const qs = new URLSearchParams(Object.assign({ t: Date.now() }, params)).toString();
    const res = await fetch(u + (u.includes('?') ? '&' : '?') + qs, { method: 'GET', cache: 'no-store', redirect: 'follow', signal: ctl ? ctl.signal : undefined });
    const j = await res.json();
    return j && j.ok ? j : null;
  } catch (e) { return null; } finally { clearTimeout(to); }
}
let visitTimer = 0, visitBusy = false;
async function refreshVisits() {
  if (!scriptUrl() || visitBusy) { showCount(S.lastCount); return; }
  if (!navigator.onLine) { visitState = 'off'; showCount(S.lastCount); return; }
  visitBusy = true;
  try {
    if (!S.vid) { S.vid = uid(); save(); }
    let j;
    if (!S.visitDone) {
      j = await callScript({ action: 'visit', vid: S.vid, ua: navigator.userAgent.slice(0, 160) });
      if (j) { S.visitDone = true; save(); }
    } else {
      j = await callScript({ action: 'count' });
    }
    visitState = j ? 'live' : 'off';
    showCount(j ? Number(j.count) : S.lastCount);
  } finally { visitBusy = false; }
}
function startVisits() {
  refreshVisits();
  clearInterval(visitTimer);
  visitTimer = setInterval(() => { if (document.visibilityState === 'visible') refreshVisits(); }, 15000);
}

/* ---------- Giao diện, phông, cỡ chữ ---------- */
const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const dark = S.theme === 'dark' || (S.theme === 'system' && mq && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const m = $('meta[name="theme-color"]'); if (m) m.setAttribute('content', dark ? '#140f0c' : '#e53935');
}
const fontLoaded = new Set();
function loadFont(f) {
  if (!f || !f.g || fontLoaded.has(f.k)) return;
  fontLoaded.add(f.k);
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?family=${f.g}&display=swap`;
  document.head.appendChild(l);
}
function applyFont() {
  const f = FONTS.find((x) => x.k === S.font) || FONTS[0];
  loadFont(f);
  document.documentElement.style.setProperty('--font', fontStack(f));
}
function applyFs() {
  document.documentElement.style.setProperty('--fs', String(1 + S.fontScale * 0.08));
  const v = $('#fsVal'); if (v) v.textContent = fsText();
  $$('.fs-btn[data-v="0"]').forEach((b) => b.classList.toggle('on', S.fontScale === 0));
}
function applyLang() {
  document.documentElement.lang = L();
  const m = $('meta[name="description"]'); if (m) m.setAttribute('content', t('Trang web giả lập đặt đồ ăn trực tuyến: xem món, chọn món, tạo đơn hàng cho vui. Không giao hàng thật, không trả tiền thật.'));
}
/* Tỷ giá mới về: cập nhật giá trên trang (không làm mất chữ đang gõ) */
function onFxChange() {
  const a = document.activeElement;
  if ($('#modal-root .mo') || (a && a.tagName === 'INPUT')) { const n = $('#fxNote'); if (n) n.innerHTML = fxNote(); return; }
  render(true);
}
function setOn(act, val) { $$(`[data-act="${act}"]`).forEach((b) => b.classList.toggle('on', b.dataset.v === val)); }

function updateBadges(pop = false) {
  const n = cartCount();
  $$('[data-cartn]').forEach((b) => {
    b.textContent = n > 99 ? '99+' : n;
    b.classList.toggle('hide', !n);
    if (pop) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  });
  const a = activeOrders().length;
  $$('[data-actn]').forEach((b) => { b.textContent = a; b.classList.toggle('hide', !a); });
}
function flyToCart(fromEl) {
  const cart = $('.cart-btn');
  if (!fromEl || !cart || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const a = fromEl.getBoundingClientRect(), b = cart.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'fly';
  const im = fromEl.querySelector('img');
  if (im && im.complete && im.naturalWidth) f.innerHTML = `<img src="${esc(im.src)}" alt="">`; else f.textContent = '🍜';
  const s = 64;
  Object.assign(f.style, { left: a.left + a.width / 2 - s / 2 + 'px', top: a.top + a.height / 2 - s / 2 + 'px', width: s + 'px', height: s + 'px' });
  document.body.appendChild(f);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const anim = f.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 80}px) scale(.8)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(.2)`, opacity: 0.6 }
  ], { duration: 750, easing: 'cubic-bezier(.5,0,.5,1)' });
  anim.onfinish = () => f.remove();
}
function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#e53935', '#ff6a3d', '#f5a524', '#16a34a', '#3b82f6', '#d81b60'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.8 + Math.random() * 1.6 + 's';
    c.style.animationDelay = Math.random() * 0.4 + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4200);
  }
}

/* ---------- Điều hướng trang ---------- */
const app = $('#app');
const ROUTES = [
  [/^#\/?$/, () => vHome()],
  [/^#\/recent$/, () => vRecent()],
  [/^#\/orders$/, () => vOrders()],
  [/^#\/cat\/(bun|com)$/, (m) => vCat(m[1])],
  [/^#\/dish\/(\d+)$/, (m) => vDish(Number(m[1]))],
  [/^#\/cart$/, () => vCart()],
  [/^#\/checkout$/, () => vCheckout()],
  [/^#\/order\/([A-Z0-9-]{4,40})$/, (m) => vTrack(m[1])]
];
let curRoute = null, isBack = false;
const scrollMemo = {};
const routeNow = () => (location.hash && location.hash !== '#' ? location.hash : '#/');

function render(soft = false) {
  const h = routeNow();
  if (curRoute === '#/checkout' && h !== '#/checkout') saveDraft();
  if (!soft && curRoute) scrollMemo[curRoute] = window.scrollY;
  if (!soft && !h.startsWith('#/dish/')) UI.sel = null;
  UI.soft = soft;
  const keepY = window.scrollY;
  let html = null, matched = null;
  for (const [re, fn] of ROUTES) { const m = h.match(re); if (m) { matched = m; html = fn(m); break; } }
  if (html == null) html = vNotFound();
  app.innerHTML = html;
  document.body.dataset.route = (h.split('/')[1] || 'home');
  const prev = curRoute;
  curRoute = h;
  /* Sau khi vẽ */
  if (h.startsWith('#/dish/') && matched && (!soft || prev !== h)) { const d = byId(matched[1]); if (d) addRecent(d.id); }
  if (h.startsWith('#/order/')) {
    const o = S.orders.find((x) => x.code === (matched && matched[1]));
    const cv = $('#mapCv');
    if (o && cv) MapView.start(cv, o);
  } else MapView.stop();
  if (UI.open.has('qr')) drawMiniQr();
  if (soft) window.scrollTo(0, keepY);
  else window.scrollTo(0, isBack && scrollMemo[h] ? scrollMemo[h] : 0);
  isBack = false;
  const title = h === '#/' ? '1277Foods | ' + t('Đặt Đồ Ăn Ảo – Chỉ Vui, Không Lo Gì Cả') : ($('.tb-title') ? $('.tb-title').textContent + ' – 1277Foods' : '1277Foods');
  document.title = title;
}
function go(hash, opt = {}) {
  if (hash === routeNow() && !opt.replace) { render(true); return; }
  const d = (history.state && history.state.d) || 0;
  if (opt.replace) history.replaceState({ d }, '', hash);
  else history.pushState({ d: d + 1 }, '', hash);
  render();
}
function back() {
  if (history.state && history.state.d > 0) { isBack = true; history.back(); }
  else { history.replaceState({ d: 0 }, '', '#/'); isBack = true; render(); }
}
window.addEventListener('popstate', () => {
  if (!history.state) history.replaceState({ d: 1 }, '', location.hash);
  if ($('#modal-root .mo')) closeModal(true);
  isBack = true;
  render();
});

/* ---------- Xử lý bấm nút ---------- */
function drawMiniQr() {
  const c = $('#qrMini');
  if (c && !c.dataset.done) { try { QR.draw(c, pageUrl(), 8); c.dataset.done = '1'; } catch (e) { /* bỏ qua */ } }
}
const ACT = {
  back: () => back(),
  'close-modal': () => closeModal(),
  acc: (v, el) => {
    const box = el.closest('.acc');
    const open = !box.classList.contains('open');
    box.classList.toggle('open', open);
    el.setAttribute('aria-expanded', open);
    if (open) UI.open.add(v); else UI.open.delete(v);
    if (open && v === 'qr') drawMiniQr();
    if (open && v === 'font') FONTS.forEach(loadFont);
  },
  theme: (v) => { S.theme = v; save(); applyTheme(); setOn('theme', v); },
  font: (v) => { S.font = v; save(); applyFont(); setOn('font', v); },
  lang: (v) => {
    if (!LANGS.some((l) => l.k === v) || v === L()) return;
    S.lang = v; save(); applyLang(); render(true); syncSwData();
    toast(t('Đã chuyển sang {n}', { n: langInfo().n }));
  },
  cur: (v) => {
    if (!CURS.some((c) => c.k === v)) return;
    S.cur = v; save(); render(true);
    toast(t('Đã đổi tiền tệ sang {n}', { n: curSub() }));
    refreshFx();
  },
  fs: (v) => { const n = Number(v); S.fontScale = n === 0 ? 0 : clamp(S.fontScale + n, -3, 5); save(); applyFs(); },
  sort: (v) => {
    S.sort = S.sort === v ? 'none' : v; save();
    setOn('sort', S.sort);
    if (curRoute === '#/') refreshGrid(); else render(true);
    toast(t(S.sort === 'none' ? 'Đã bỏ sắp xếp' : S.sort === 'desc' ? 'Giá: Cao đến Thấp' : 'Giá: Thấp đến Cao'));
  },
  notif: async () => {
    await askNotif();
    if (Notification.permission === 'granted') { toast(t('Đã bật thông báo giao hàng')); ensurePush().then(pushPending); }
    else if (Notification.permission === 'denied') toast(t('Thông báo đang bị chặn trong cài đặt trình duyệt'), true);
  },
  share: () => sharePage(),
  qrfull: () => openQrFull(),
  random: () => openRandom(),
  'random-again': () => spin(),
  'random-view': () => { const id = UI.rndId; closeModal(); if (id) go('#/dish/' + id); },
  quickadd: (v, el) => {
    addToCart(Number(v), [], [], 1);
    flyToCart(el.closest('.card') ? el.closest('.card').querySelector('.card-img') : el);
    toast(t('Đã thêm {n} vào giỏ hàng', { n: dName(byId(v)) }));
  },
  opt: (v, el) => {
    const s = UI.sel, g = el.dataset.g, i = Number(v);
    if (!s || !g) return;
    if (i < 0) s[g] = [];
    else { const k = s[g].indexOf(i); if (k >= 0) s[g].splice(k, 1); else s[g].push(i); }
    refreshDetail();
  },
  qty: (v) => { const s = UI.sel; if (!s) return; s.qty = clamp(s.qty + Number(v), 1, 99); refreshDetail(); },
  thumb: (v) => { if (UI.sel) { UI.sel.view = Number(v); refreshDetail(); } },
  addcart: () => {
    const s = UI.sel; if (!s) return;
    addToCart(s.id, s.giavi, s.ankem, s.qty);
    flyToCart($('.g-main'));
    toast(t('Đã thêm {q} phần {n} vào giỏ hàng', { q: s.qty, n: dName(byId(s.id)) }));
  },
  buynow: () => {
    const s = UI.sel; if (!s) return;
    const line = { key: lineKey(s.id, s.giavi, s.ankem), id: s.id, giavi: [...s.giavi].sort((a, b) => a - b), ankem: [...s.ankem].sort((a, b) => a - b), qty: s.qty };
    S.checkout = { sid: uid(), source: 'now', items: [line], pay: 'cod' };
    save();
    go('#/checkout');
  },
  'c-check': (v) => { const l = S.cart.find((x) => x.key === v); if (l) { l.checked = !l.checked; save(); render(true); } },
  'c-all': () => { const all = S.cart.every((l) => l.checked); S.cart.forEach((l) => { l.checked = !all; }); save(); render(true); },
  'c-qty': (v, el) => {
    const l = S.cart.find((x) => x.key === el.dataset.k); if (!l) return;
    const n = l.qty + Number(v);
    if (n < 1) { ACT['c-del'](l.key); return; }
    l.qty = clamp(n, 1, 99); save(); updateBadges(); render(true);
  },
  'c-del': (v) => {
    const l = S.cart.find((x) => x.key === v); if (!l) return;
    alertBox(t('Xóa món khỏi giỏ hàng?'), esc(dName(byId(l.id))), `<button class="btn btn-soft" data-act="close-modal">${t('Hủy')}</button><button class="btn btn-red" data-act="c-del-ok" data-v="${esc(v)}">${t('Xóa')}</button>`);
  },
  'c-del-ok': (v) => { S.cart = S.cart.filter((x) => x.key !== v); save(); closeModal(); updateBadges(); render(true); toast(t('Đã xóa món khỏi giỏ hàng')); },
  'c-buy': () => {
    const sel = S.cart.filter((l) => l.checked);
    if (!sel.length) { alertBox(t('Bạn vẫn chưa chọn món ăn nào để mua'), t('Nhấn vào ô vuông bên cạnh món, hoặc chọn “Tất cả”.')); return; }
    S.checkout = { sid: uid(), source: 'cart', items: clone(sel), pay: 'cod' };
    save();
    go('#/checkout');
  },
  pay: (v) => { if (S.checkout) { S.checkout.pay = v; save(); setOn('pay', v); } },
  place: () => placeOrder(),
  tab: (v) => { S.ordersTab = v; save(); render(true); },
  'draft-del': (v) => { S.drafts = S.drafts.filter((d) => d.id !== v); save(); render(true); toast(t('Đã xóa đơn nháp')); },
  'draft-go': (v) => {
    const d = S.drafts.find((x) => x.id === v); if (!d) return;
    S.checkout = { sid: d.id, source: d.source === 'cart' ? 'cart' : 'draft', items: clone(d.items), pay: d.pay || 'cod' };
    save(); go('#/checkout');
  },
  'r-clear': () => alertBox(t('Xóa toàn bộ lịch sử xem?'), t('Danh sách “Xem gần đây” sẽ trống.'), `<button class="btn btn-soft" data-act="close-modal">${t('Hủy')}</button><button class="btn btn-red" data-act="r-clear-ok">${t('Xóa')}</button>`),
  'r-clear-ok': () => { S.recent = []; save(); closeModal(); render(true); toast(t('Đã xóa lịch sử xem')); },
  'o-code': async (v) => toast((await copyText(v)) ? t('Đã sao chép mã đơn #{c}', { c: v }) : t('Không sao chép được')),
  'o-copy': async (v) => { const o = S.orders.find((x) => x.code === v); if (o) toast((await copyText(orderText(o))) ? t('Đã sao chép đơn hàng') : t('Không sao chép được')); },
  'o-share': (v) => { const o = S.orders.find((x) => x.code === v); if (o) shareOrder(o); },
  'o-again': (v) => {
    const o = S.orders.find((x) => x.code === v); if (!o) return;
    const items = [];
    o.items.forEach((it) => { if (byId(it.id)) { const gv = Array.isArray(it.gv) ? it.gv.slice() : [], ak = Array.isArray(it.ak) ? it.ak.slice() : []; items.push({ key: lineKey(it.id, gv, ak) + '#' + items.length, id: it.id, giavi: gv, ankem: ak, qty: it.qty }); } });
    if (!items.length) return;
    S.checkout = { sid: uid(), source: 'again', items, pay: o.pay || 'cod' };
    save(); go('#/checkout');
  }
};
ACT.copylink = async () => { const ok = await copyText(pageUrl()); toast(ok ? t('Đã sao chép link trang') : t('Không sao chép được'), !ok); };

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act],[data-go]');
  if (!el || el.disabled) return;
  const a = el.dataset.act;
  if (!a && el.dataset.go) { e.preventDefault(); if ($('#modal-root .mo')) closeModal(true); go(el.dataset.go); return; }
  const fn = ACT[a];
  if (fn) { e.preventDefault(); fn(el.dataset.v, el, e); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#modal-root .mo')) { closeModal(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="link"][data-go]')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { UI.q = e.target.value; refreshGrid(); }
});
document.addEventListener('submit', (e) => {
  if (e.target.id === 'searchForm') {
    e.preventDefault();
    const q = $('#q'); if (q) { UI.q = q.value; q.blur(); }
    refreshGrid();
    const m = $('#menu'); if (m) window.scrollTo({ top: m.getBoundingClientRect().top + window.scrollY - 140, behavior: 'smooth' });
  }
});

/* ---------- Đồng hồ chung: thời gian, đơn hàng, thông báo ---------- */
function checkOrders() {
  let changed = false;
  S.orders.forEach((o) => {
    if (!o.notified && stageOf(o) === 3) {
      o.notified = true; changed = true;
      const late = now() - (o.created + o.t3) > 20000;
      /* Nếu Service Worker đã báo đúng giờ (lúc bạn thoát trình duyệt) thì không báo lại */
      markNotified(o.code).then((isNew) => {
        if (isNew && (!late || document.visibilityState === 'hidden')) notify(notifTitle(), orderNotifOpts(o));
      });
      if (curRoute === '#/order/' + o.code) confetti();
      else toast(t('Đơn #{c} đã giao thành công!', { c: o.code }));
    }
  });
  if (changed) { save(); updateBadges(); syncSwData(); }
}
function pushPending() {
  activeOrders().filter((o) => !o.pushed && o.created + o.t3 - now() > 8000).forEach((o) => schedulePush(o));
}
function tick() {
  $$('[data-ago]').forEach((el) => { el.textContent = ago(Number(el.dataset.ago)); });
  checkOrders();
  const r = curRoute || '';
  if (r.startsWith('#/order/')) {
    const o = S.orders.find((x) => x.code === r.slice(8));
    if (o) {
      const st = stageOf(o);
      if (st !== UI.trackStage) render(true);
      else {
        const cd = $('#trkCd'); if (cd) cd.textContent = mmss(o.created + o.t3 - now());
        const ch = $('#mapChip'); if (ch) ch.textContent = mapChipText(o);
      }
    }
  } else if (r === '#/orders') {
    let need = false;
    $$('[data-cd]').forEach((el) => {
      const o = S.orders.find((x) => x.code === el.dataset.cd);
      if (!o) return;
      if (stageOf(o) === 3) need = true;
      el.textContent = mmss(o.created + o.t3 - now());
    });
    $$('[data-stl]').forEach((el) => {
      const o = S.orders.find((x) => x.code === el.dataset.stl);
      if (!o) return;
      const st = stageOf(o);
      const html = `${ic(STAGES[st].icon)} ${t(STAGES[st].t)}`;
      if (el.dataset.st !== String(st)) { el.dataset.st = st; el.innerHTML = html; el.classList.toggle('done', st === 3); }
    });
    if (need && S.ordersTab === 'coming') render(true);
  }
}

/* ---------- Khởi động ---------- */
function netChange() {
  const n = $('#netState');
  if (n) n.innerHTML = netHtml();
  if (navigator.onLine) { toast(t('Đã có mạng trở lại')); refreshVisits(); refreshFx(); }
  else { visitState = 'off'; showCount(S.lastCount); toast(t('Đang ngoại tuyến – mọi chức năng vẫn chạy bình thường'), true); }
}
function init() {
  applyLang(); applyTheme(); applyFont(); applyFs();
  if (mq) {
    const f = () => { if (S.theme === 'system') { applyTheme(); } };
    if (mq.addEventListener) mq.addEventListener('change', f); else if (mq.addListener) mq.addListener(f);
  }
  history.replaceState({ d: 0 }, '', routeNow());
  render();
  setInterval(tick, 1000);
  startVisits();
  refreshFx();
  window.addEventListener('online', netChange);
  window.addEventListener('offline', netChange);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tick(); refreshVisits(); } });
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && e.newValue) { S = loadState(); applyLang(); applyTheme(); applyFont(); applyFs(); render(true); updateBadges(); }
  });

  /* Tự hỏi quyền thông báo (ngay khi mở và ở lần chạm đầu tiên) */
  askNotif();
  const first = () => { if (!notifAsked) { notifAsked = true; askNotif(); } };
  document.addEventListener('pointerdown', first, { once: true, capture: true });

  /* Chế độ offline: đăng ký Service Worker (chính file script.js) */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('script.js').then((r) => { try { r.update(); } catch (e) { /* bỏ qua */ } return navigator.serviceWorker.ready; }).then((reg) => {
      const urls = MENU.map((d) => d.img);
      const sw = reg.active || navigator.serviceWorker.controller;
      if (sw) sw.postMessage({ type: 'precache', urls });
      syncSwData();
      if ('Notification' in window && Notification.permission === 'granted') ensurePush().then(pushPending).catch(() => {});
    }).catch(() => { /* bỏ qua */ });
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
init();

})();
}
