/* 今天吃什麼：index.html 與 index-jev.html 共用的純函式。
   獨立成檔是為了讓 Node 測試可以直接載入，不需要瀏覽器。 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MealCore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function haversine(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function weightedPick(arr, weight) {
    const ws = arr.map(weight);
    let r = Math.random() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < arr.length; i++) { r -= ws[i]; if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  }

  function mealByTime(d = new Date()) {
    const h = d.getHours() + d.getMinutes() / 60;
    if (h < 4) return 'night';
    if (h < 10.5) return 'breakfast';
    if (h < 15) return 'lunch';
    if (h < 21) return 'dinner';
    return 'night';
  }

  /* ================= 營業時間 ================= */

  // OSM 的 opening_hours → 每天的營業時段（週一 = 0）；看不懂的格式回傳 null，當作「不知道」、不排除
  const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
  const RULE_SPLIT = new RegExp(`\\s*;\\s*|(?<=\\d)\\s*,\\s*(?=(?:${DAY}|PH)\\b)`);
  const DAY_SPEC = new RegExp(`^((?:${DAY}|PH)(?:\\s*-\\s*${DAY})?(?:\\s*,\\s*(?:${DAY}|PH)(?:\\s*-\\s*${DAY})?)*)?\\s*(.*)$`);
  const hoursCache = new Map();

  function parseHours(raw) {
    const str = String(raw || '').trim();
    if (!hoursCache.has(str)) hoursCache.set(str, parseHoursRaw(str));
    return hoursCache.get(str);
  }

  function parseHoursRaw(str) {
    if (!str) return null;
    if (/^(24\/7|24\s*小時|24\s*hours?)$/i.test(str)) return DAYS.map(() => [[0, 24]]);
    const week = DAYS.map(() => null);
    let any = false;
    for (const rule of str.split(RULE_SPLIT)) {
      if (!rule.trim()) continue;
      const [, spec, body] = rule.trim().match(DAY_SPEC);
      const days = new Set();
      if (spec) {
        for (const part of spec.split(/\s*,\s*/)) {
          if (part === 'PH') continue;
          const [a, b] = part.split(/\s*-\s*/).map(x => DAYS.indexOf(x));
          if (b === undefined) days.add(a);
          else for (let i = a; ; i = (i + 1) % 7) { days.add(i); if (i === b) break; }
        }
        if (!days.size) continue; // 只寫國定假日的規則，略過
      } else DAYS.forEach((_, i) => days.add(i));
      const ranges = [];
      if (!/^(off|closed)$/i.test(body.trim())) {
        const left = body.replace(/(\d{1,2}):(\d{2})\s*[-~–]\s*(\d{1,2}):(\d{2})\+?/g, (_, h1, m1, h2, m2) => {
          const a = +h1 + m1 / 60;
          let b = +h2 + m2 / 60;
          if (b <= a) b += 24; // 跨夜
          ranges.push([a, b]);
          return '';
        });
        if (left.replace(/[\s,]|\bopen\b/gi, '') || !ranges.length) return null;
      }
      days.forEach(d => { week[d] = ranges; });
      any = true;
    }
    return any ? week.map(r => r || []) : null;
  }

  function openState(hours, date) {
    const week = parseHours(hours);
    if (!week) return { known: false, open: null };
    const h = date.getHours() + date.getMinutes() / 60;
    const d = (date.getDay() + 6) % 7, y = (d + 6) % 7, n = (d + 1) % 7;
    // 開到 24:00 而隔天 00:00 接著開，就不算打烊
    const until = b => {
      const nx = b >= 24 && week[n].find(([a2]) => a2 === 0);
      return nx ? (nx[1] >= 24 ? Infinity : 24 + nx[1]) : b;
    };
    for (const [a, b] of week[d]) if (h >= a && h < b) { const end = until(b); return { known: true, open: true, closesIn: end - h, closeAt: end }; }
    for (const [, b] of week[y]) if (b > 24 && h + 24 < b) return { known: true, open: true, closesIn: b - 24 - h, closeAt: b - 24 };
    return { known: true, open: false };
  }

  /* ================= JEV 抽籤 ================= */

  // 先減掉最大值再取 exp，避免溫度很低時 exp 溢位成 Infinity
  function softmax(values, temperature) {
    if (!values.length) return [];
    const mx = Math.max(...values);
    const ex = values.map(v => Math.exp((v - mx) / temperature));
    const z = ex.reduce((a, b) => a + b, 0);
    return ex.map(e => e / z);
  }

  return { haversine, weightedPick, mealByTime, parseHours, parseHoursRaw, openState, softmax };
});
