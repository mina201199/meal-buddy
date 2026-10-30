/*
 * Jev 決策模型外掛（TypeSafe AI）
 * ------------------------------------------------------------
 * 用一句話說想吃什麼，Jev 會從附近餐廳裡挑出最符合的幾家。
 * 它會照主畫面選的「距離」和「類別」篩選候選店家。
 *
 * 需要：
 *   1. 用 server.py 開啟（TypeSafe 不接受網頁直接呼叫，金鑰也不能放在網頁裡）
 *   2. 在 .env 放 TYPESAFE_API_KEY（參考 .env.example）
 *
 * 不想要了：
 *   - 暫時關掉：卡片右上角的開關
 *   - 整個拿掉：刪掉 index.html 最下面 <script src="jev.js"></script> 那一行，
 *     再把 jev.js、server.py、start.bat、.env、.env.example 刪掉即可
 */
(() => {
  'use strict';
  const S = window.SanCan;
  if (!S) return;

  const MAX_SHOPS = 80;          // 一次給 Jev 看最近的幾家（API 上限 255）
  const LOW_CONFIDENCE = 0.5;    // 官方建議：信心低於 0.5 就讓使用者自己挑
  const NONE = 'none of these fit';

  // Jev 主要用英文訓練，官方文件說中文「準確度較低」，
  // 所以送給 Jev 的說明、情境、店家描述都用英文；畫面上照樣是中文。
  const QUICK = new Map([
    ['好冷，想吃熱的', "It's cold. I want something hot and warming."],
    ['清淡一點', 'Something light and not greasy.'],
    ['想大口吃肉', 'A hearty meal with lots of meat.'],
    ['趕時間，快速解決', "I'm in a hurry. Something quick and close by."],
    ['想犒賞自己', 'I want to treat myself to something nice.'],
    ['不要跟最近吃的一樣', 'Something different from what I ate recently.'],
  ]);
  const MEAL_EN = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', night: 'late-night snack' };
  const CAT_EN = {
    chinese: 'Chinese/Taiwanese', japanese: 'Japanese', korean: 'Korean', western: 'American/fast food',
    italian: 'Italian', sea: 'Southeast Asian/Indian', hotpot: 'hot pot', bbq: 'BBQ/grill', noodle: 'noodles',
    rice: 'rice/bento', breakfast: 'breakfast/brunch', cafe: 'cafe/dessert', veg: 'vegetarian',
  };
  const AMENITY_EN = { restaurant: 'restaurant', fast_food: 'fast food or snack shop', cafe: 'cafe', food_court: 'food court', ice_cream: 'ice cream shop' };
  const DISH_EN = {
    蛋餅: 'Taiwanese egg crepe roll', 飯糰: 'Taiwanese sticky rice roll', 燒餅油條: 'sesame flatbread with fried dough stick',
    鹹豆漿: 'savory soy milk soup', 蘿蔔糕: 'pan-fried turnip cake', 鐵板麵: 'griddle noodles with pepper sauce',
    三明治: 'sandwich', 早午餐盤: 'brunch plate', 貝果: 'bagel', 鬆餅: 'pancakes or waffles', 肉粥: 'savory pork congee, hot',
    漢堡: 'burger', 饅頭夾蛋: 'steamed bun with egg', 咖啡配可頌: 'coffee and croissant', 素食早餐: 'vegetarian breakfast',
    牛肉麵: 'Taiwanese beef noodle soup, hot', 滷肉飯: 'braised pork over rice', 雞腿便當: 'chicken leg bento box',
    拉麵: 'Japanese ramen, hot soup', 日式丼飯: 'Japanese rice bowl (donburi)', 咖哩飯: 'curry rice',
    水餃鍋貼: 'dumplings and potstickers', 韓式拌飯: 'Korean bibimbap', 義大利麵: 'Italian pasta',
    越南河粉: 'Vietnamese pho, hot soup', 泰式打拋豬: 'Thai basil pork rice, spicy', 壽司: 'sushi, cold',
    雞肉飯: 'Taiwanese chicken rice', 自助餐: 'Taiwanese buffet, pick your own dishes', 乾麵餛飩湯: 'dry noodles with wonton soup',
    港式燒臘飯: 'Hong Kong roast meat over rice', 速食: 'fast food: burgers, fried chicken, fries', 素食便當: 'vegetarian bento box',
    火鍋: 'hot pot, hot', 麻辣鍋: 'spicy Sichuan hot pot', 燒肉: 'grilled meat (yakiniku / Korean BBQ)',
    韓式炸雞: 'Korean fried chicken', 熱炒: 'Taiwanese stir-fry dishes to share', 牛排: 'steak',
    居酒屋: 'izakaya: skewers and drinks', 披薩: 'pizza', 港式飲茶: 'Hong Kong dim sum', 印度咖哩: 'Indian curry',
    部隊鍋: 'Korean army stew, hot', 泰式料理: 'Thai food, often spicy', 薑母鴨: 'ginger duck hot pot, warming in winter',
    日式定食: 'Japanese set meal', 素食: 'vegetarian meal', 鹽酥雞: 'Taiwanese popcorn chicken, fried',
    滷味: 'braised snacks', 清粥小菜: 'plain congee with side dishes, light', 燒烤串: 'grilled skewers',
    豆花: 'tofu pudding dessert', 麻辣燙: 'spicy hot pot soup for one', 永和豆漿: 'soy milk shop, open late',
    剉冰: 'shaved ice dessert, cold', 鍋燒意麵: 'noodle soup cooked in a pot, hot', 臭豆腐: 'stinky tofu',
  };

  const ls = {
    get(k, d) { try { const v = localStorage.getItem('sancan.jev.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('sancan.jev.' + k, JSON.stringify(v)); } catch { /* 忽略 */ } },
  };
  const esc = S.esc;
  const pct = p => p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`;

  /* ---------- 樣式 ---------- */

  document.head.insertAdjacentHTML('beforeend', `<style id="jev-style">
    #jevCard { order: 1; --jev: #346b48; --jev-soft: #eaf0df; }
    .jev-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .jev-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; }
    .jev-badge { font-size: 11px; font-weight: 700; color: var(--jev); background: var(--jev-soft); padding: 1px 8px; border-radius: 999px; }
    .jev-sub { display: block; font-size: 12.5px; color: var(--muted); margin-top: 2px; }
    .jev-switch { position: relative; width: 44px; height: 26px; flex: none; }
    .jev-switch input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; z-index: 1; }
    .jev-switch span { position: absolute; inset: 0; border-radius: 999px; background: var(--line); transition: background .2s; }
    .jev-switch span::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .2s; }
    .jev-switch input:checked + span { background: var(--jev); }
    .jev-switch input:checked + span::after { transform: translateX(18px); }
    .jev-switch input:focus-visible + span { outline: 2px solid var(--jev); outline-offset: 2px; }
    .jev.off .jev-body { display: none; }
    .jev-body { margin-top: 14px; }
    .jev-form { display: flex; gap: 8px; }
    .jev-form input { flex: 1; min-width: 0; padding: 11px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface-2); outline: none; }
    .jev-form input:focus { border-color: var(--jev); }
    .jev-form .btn { background: var(--jev); border-color: var(--jev); color: #fff; min-width: 76px; }
    .jev-quick { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .jev-quick button { border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 4px 11px; font-size: 12.5px; color: var(--muted); transition: border-color .15s, color .15s; }
    .jev-quick button:hover:not(:disabled) { border-color: var(--jev); color: var(--jev); }
    .jev-quick button:disabled, .jev-form :disabled { opacity: .5; cursor: not-allowed; }
    .jev-note { margin-top: 12px; font-size: 13px; line-height: 1.6; color: var(--muted); background: var(--surface-2); border-radius: 12px; padding: 10px 12px; }
    .jev-note code { font-size: 12px; background: var(--surface); padding: 1px 6px; border-radius: 6px; color: var(--text); }
    .jev-note a { color: var(--jev); font-weight: 700; }
    .jev-out { margin-top: 14px; border-top: 1px dashed var(--line); padding-top: 12px; }
    .jev-meta { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; color: var(--muted); margin-bottom: 6px; }
    .jev-meta span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .jev-dish { font-size: 14px; margin: 2px 0 8px; }
    .jev-dish small { color: var(--muted); }
    .jev-rank { list-style: none; margin: 0; padding: 0; }
    .jev-rank button { width: 100%; display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 8px; align-items: center; text-align: left; border: 0; background: none; padding: 7px 6px; border-radius: 10px; }
    .jev-rank button:hover { background: var(--surface-2); }
    .jev-rank button.on { background: var(--jev-soft); }
    .jev-rank .no { font-weight: 900; color: var(--jev); text-align: center; }
    .jev-rank .nm { display: block; font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .jev-rank .sub { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .jev-rank .bar { display: block; height: 4px; border-radius: 4px; background: var(--jev); opacity: .75; margin-top: 4px; }
    .jev-rank .pc { font-size: 13px; font-weight: 700; color: var(--jev); }
    .jev-warn { font-size: 12.5px; color: var(--warn-text); background: var(--warn-bg); border-radius: 10px; padding: 8px 10px; margin-top: 8px; }
    .jev-warn a { color: inherit; font-weight: 700; }
    .jev-dots { display: inline-flex; gap: 4px; }
    .jev-dots i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: jevDot 1s infinite ease-in-out; }
    .jev-dots i:nth-child(2) { animation-delay: .15s; } .jev-dots i:nth-child(3) { animation-delay: .3s; }
    @keyframes jevDot { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
  </style>`);

  /* ---------- 卡片 ---------- */

  const card = document.createElement('section');
  card.className = 'card jev';
  card.id = 'jevCard';
  card.setAttribute('aria-label', 'Jev 決策模型');
  card.innerHTML = `
    <div class="jev-head">
      <div>
        <div class="jev-title">🤖 跟 Jev 說你想吃什麼 <span class="jev-badge">AI</span></div>
        <span class="jev-sub" id="jevSub"></span>
      </div>
      <label class="jev-switch" title="開關 Jev"><input type="checkbox" id="jevOn" aria-label="使用 Jev" /><span></span></label>
    </div>
    <div class="jev-body">
      <form class="jev-form" id="jevForm">
        <input id="jevWish" type="text" maxlength="120" placeholder="例：好冷想吃熱的、不要辣" autocomplete="off" />
        <button class="btn" type="submit" id="jevAsk">問 Jev</button>
      </form>
      <div class="jev-quick" id="jevQuick">${[...QUICK.keys()].map(q => `<button type="button">${esc(q)}</button>`).join('')}</div>
      <div class="jev-note" id="jevNote" hidden></div>
      <div class="jev-out" id="jevOut" hidden></div>
    </div>`;
  document.querySelector('#controls').after(card);

  const $ = s => card.querySelector(s);
  let status = 'checking';   // checking | ready | no_key | no_server
  let enabled = ls.get('enabled', true);
  let busy = false;
  let last = null;

  /* ---------- 畫面 ---------- */

  function render() {
    card.classList.toggle('off', !enabled);
    $('#jevOn').checked = enabled;
    $('#jevSub').textContent = !enabled ? '已關閉，打開右邊的開關就能用'
      : '會照上面選的距離和類別，從附近餐廳挑最符合的';

    const canAsk = status === 'ready' && !busy;
    card.querySelectorAll('#jevForm input, #jevForm button, #jevQuick button').forEach(el => { el.disabled = !canAsk; });
    $('#jevAsk').innerHTML = busy ? '<span class="jev-dots"><i></i><i></i><i></i></span>' : '問 Jev';

    const note = $('#jevNote');
    note.hidden = status === 'ready';
    if (status === 'checking') note.textContent = '檢查 Jev 連線中…';
    if (status === 'no_server') note.innerHTML =
      'Jev 要透過本機伺服器才能用（TypeSafe 不接受網頁直接呼叫，API 金鑰也不能放在網頁裡）。<br>' +
      '雙擊資料夾裡的 <code>start.bat</code>，或執行 <code>python server.py</code>，再打開 <code>http://localhost:5173</code>。';
    if (status === 'no_key') note.innerHTML =
      '還差一步：到 <a href="https://typesafe.ai" target="_blank" rel="noopener">TypeSafe</a> 註冊並申請 API 金鑰，' +
      '照 <code>.env.example</code> 的說明建立 <code>.env</code>，存檔後重新整理這個頁面。';
  }

  function renderResult() {
    const out = $('#jevOut');
    if (!last) { out.hidden = true; return; }
    out.hidden = false;
    if (last.error) { out.innerHTML = `<div class="jev-warn">${last.error}</div>`; return; }

    const { wish, ms, ranked, dish, dishConf, shopConf, noneTop } = last;
    out.innerHTML = `
      <div class="jev-meta"><span>「${esc(wish)}」</span><span>⚡ ${Math.round(ms)} 毫秒</span></div>
      ${dish ? `<div class="jev-dish">想吃的方向：<b>${dish.emoji} ${esc(dish.name)}</b> <small>· 信心 ${pct(dishConf)}</small></div>` : ''}
      ${noneTop ? `<div class="jev-warn">Jev 覺得附近的店都不太符合，下面是比較接近的。也可以 <a href="${S.searchUrl(wish)}" target="_blank" rel="noopener">直接在 Google 地圖搜尋</a>。</div>` : ''}
      <ol class="jev-rank">
        ${ranked.map((x, i) => `
          <li><button type="button" data-id="${esc(x.shop.id)}" class="${x.shop.id === last.activeId ? 'on' : ''}">
            <span class="no">${i + 1}</span>
            <span>
              <span class="nm">${esc(x.shop.name)}</span>
              <span class="sub">${esc(S.shopCatText(x.shop))} · ${S.fmtDist(x.shop.dist)}</span>
              <span class="bar" style="width:${Math.max(3, x.p * 100)}%"></span>
            </span>
            <span class="pc">${pct(x.p)}</span>
          </button></li>`).join('')}
      </ol>
      ${shopConf < LOW_CONFIDENCE
        ? `<div class="jev-warn">Jev 有點猶豫（信心 ${pct(shopConf)}），前幾名差不多，挑順眼的就好 👆</div>`
        : `<div class="jev-meta"><span>Jev 對第一名的信心 ${pct(shopConf)}</span><span>點其他家可以切換</span></div>`}`;
  }

  /* ---------- 呼叫 Jev ---------- */

  function candidateDishes() {
    const cats = S.state.cats;
    const ok = S.dishAllowed || (() => true); // 主畫面「不能吃」踩到的菜不給 Jev 選
    const allowed = S.ALL_DISHES.filter(ok);
    const pool = cats.has('any') ? allowed : allowed.filter(d => d.cats.some(c => cats.has(c)));
    return pool.length ? pool : allowed.length ? allowed : S.ALL_DISHES;
  }

  const catsEn = cats => [...cats].map(c => CAT_EN[c]).filter(Boolean).join(', ');
  const dishEn = d => DISH_EN[d.name] || catsEn(d.cats) || d.name;

  function context() {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const dishByName = new Map(S.ALL_DISHES.map(d => [d.name, d]));
    const recent = S.history().slice(0, 5).map(h => {
      const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(h.ts).setHours(0, 0, 0, 0)) / 864e5);
      const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
      const d = dishByName.get(h.dish);
      return `${when} ${MEAL_EN[h.meal] || ''}: ${h.dish}${d ? ` (${dishEn(d)})` : ''}`;
    });
    return {
      meal: MEAL_EN[S.state.meal],
      local_time: `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()]} ${hhmm}`,
      recently_eaten: recent.length ? recent : 'no records',
      note: 'The user is in Taiwan. Restaurant and dish names are in Chinese; each option has an English description.',
    };
  }

  function describeShop(s) {
    const walk = s.dist <= 1500 ? `${Math.max(1, Math.round(s.dist / 75))}-min walk` : `${Math.max(1, Math.round(s.dist / 300))}-min scooter ride`;
    const kind = catsEn(s.cats) || AMENITY_EN[s.amenity] || 'restaurant';
    return `${kind} | ${Math.round(s.dist)} m away (${walk})${s.hours ? ` | opening hours: ${s.hours}` : ''}`;
  }

  async function ask(rawWish) {
    const wish = rawWish.trim();
    if (!wish) { $('#jevWish').focus(); return; }
    if (status !== 'ready' || busy) return;
    const st = S.state;
    if (!st.loc || st.loading) { S.toast('還在找附近餐廳，等一下再問 Jev'); return; }

    const shops = S.inRange().filter(S.shopMatchesFilter).slice(0, MAX_SHOPS);
    if (!shops.length) { S.toast('這個範圍內沒有符合的餐廳，放大距離再試試'); return; }

    // 選項的名稱就是店名（重複的加編號），說明用英文寫類型、距離、營業時間
    const keyToShop = new Map();
    const shopCriteria = {};
    for (const s of shops) {
      let key = s.name, n = 2;
      while (keyToShop.has(key)) key = `${s.name} #${n++}`;
      keyToShop.set(key, s);
      shopCriteria[key] = describeShop(s);
    }
    shopCriteria[NONE] = "None of these restaurants fits the user's request.";

    const dishes = candidateDishes();
    const dishCriteria = Object.fromEntries(dishes.map(d => [d.name, `${dishEn(d)} (${catsEn(d.cats)})`]));

    // 快速選項有英文版就一起送；自己打的字只能原文送
    const english = QUICK.get(wish);
    const body = {
      model: 'jev-latest',
      state: {
        user_request: wish,
        ...(english ? { user_request_in_english: english } : {}),
        ...context(),
      },
      questions: {
        dish: {
          type: 'choice',
          instructions: "Given the user's request and context, which kind of food best fits this meal?",
          criteria: dishCriteria,
        },
        shop: {
          type: 'choice',
          instructions: "Given the user's request and context, which nearby restaurant is the best place to eat now? The request matters most; being closer is a bonus.",
          criteria: shopCriteria,
        },
      },
    };

    busy = true; render();
    const t0 = performance.now();
    try {
      const res = await fetch('/api/jev', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error('jev'), { status: res.status, json });
      handleAnswer(json, { wish, ms: performance.now() - t0, keyToShop, dishes });
    } catch (e) {
      last = { error: errorText(e) };
    } finally {
      busy = false; render(); renderResult();
    }
  }

  function handleAnswer(json, { wish, ms, keyToShop, dishes }) {
    const sa = json.answers && json.answers.shop;
    const da = json.answers && json.answers.dish;
    if (!sa || !sa.probabilities) throw Object.assign(new Error('jev'), { status: 0, json });

    const ranked = Object.entries(sa.probabilities)
      .filter(([k]) => keyToShop.has(k))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, p]) => ({ shop: keyToShop.get(k), p }));
    const dish = da ? dishes.find(d => d.name === da.choice) || null : null;

    last = {
      wish, ms, ranked, dish,
      dishConf: da ? da.confidence : 0,
      shopConf: sa.confidence ?? 0,
      noneTop: sa.choice === NONE,
      activeId: null,
    };
    if (ranked.length) pick(ranked[0].shop);
  }

  function pick(shop) {
    // Jev 挑的菜跟這家店對得上才顯示菜名，不然顯示店的類型
    const d = last.dish && (S.kwHit(shop, last.dish) || S.catHit(shop, last.dish)) ? last.dish : null;
    S.setPick(d, shop, { kicker: '🤖 Jev 幫你挑的' });
    last.activeId = shop.id;
    renderResult();
  }

  function errorText(e) {
    const msg = e.json && e.json.detail && e.json.detail.message;
    switch (e.status) {
      case 503:
        if (e.json && e.json.error === 'no_key') { status = 'no_key'; render(); return '還沒設定 API 金鑰，請看上面的說明。'; }
        return 'Jev 暫時無法使用，等一下再試。';
      case 401: return '金鑰無效：請檢查 .env 裡的 TYPESAFE_API_KEY 有沒有貼對，存檔後再問一次就好。';
      case 429: case 529: return 'Jev 現在太忙了，等幾秒再試一次。';
      case 422: return `請求格式有問題${msg ? '：' + esc(msg) : ''}`;
      case 502: return '伺服器連不到 TypeSafe，請檢查網路。';
      case undefined: status = 'no_server'; render(); return '連不上本機伺服器（server.py 是不是關掉了？）';
      default: return `Jev 出了點問題${e.status ? `（${e.status}）` : ''}${msg ? '：' + esc(msg) : ''}`;
    }
  }

  async function checkStatus() {
    try {
      const r = await fetch('/api/jev/status', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      status = (await r.json()).ready ? 'ready' : 'no_key';
    } catch {
      status = 'no_server';
    }
    render();
  }

  /* ---------- 事件 ---------- */

  $('#jevOn').addEventListener('change', e => { enabled = e.target.checked; ls.set('enabled', enabled); render(); });
  $('#jevForm').addEventListener('submit', e => { e.preventDefault(); ask($('#jevWish').value); });
  $('#jevQuick').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $('#jevWish').value = b.textContent;
    ask(b.textContent);
  });
  $('#jevOut').addEventListener('click', e => {
    const b = e.target.closest('[data-id]'); if (!b || !last || !last.ranked) return;
    const hit = last.ranked.find(x => x.shop.id === b.dataset.id);
    if (hit) pick(hit.shop);
  });

  render();
  checkStatus();
})();
