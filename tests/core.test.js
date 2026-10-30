const test = require('node:test');
const assert = require('node:assert/strict');
const { haversine, weightedPick, mealByTime, parseHoursRaw, openState, softmax } = require('../core.js');

// 用本地時間建立日期，因為 openState 依使用者所在時區判斷營業；2026-10-26 是週一
const at = (day, hour, minute = 0) => new Date(2026, 9, 26 + day, hour, minute);

test('haversine：同一點為 0，台北 101 到台北車站約 4.3 公里', () => {
  const taipei101 = { lat: 25.0339, lng: 121.5645 };
  const mainStation = { lat: 25.0478, lng: 121.5170 };
  assert.equal(haversine(taipei101, taipei101), 0);
  const d = haversine(taipei101, mainStation);
  assert.ok(d > 4800 && d < 5100, `實際距離 ${d}`);
});

test('mealByTime：依時段切換餐別', () => {
  assert.equal(mealByTime(at(0, 3, 59)), 'night');
  assert.equal(mealByTime(at(0, 8)), 'breakfast');
  assert.equal(mealByTime(at(0, 10, 30)), 'lunch');
  assert.equal(mealByTime(at(0, 18)), 'dinner');
  assert.equal(mealByTime(at(0, 22)), 'night');
});

test('weightedPick：權重為 0 的項目不會被抽中', (t) => {
  t.mock.method(Math, 'random', () => 0.99);
  assert.equal(weightedPick(['a', 'b', 'c'], x => (x === 'b' ? 1 : 0)), 'b');
  t.mock.method(Math, 'random', () => 0.5);
  assert.equal(weightedPick(['a', 'b', 'c'], x => (x === 'a' ? 0 : 1)), 'b');
});

test('parseHoursRaw：一般格式、休息日與 24/7', () => {
  const week = parseHoursRaw('Mo-Fr 11:00-14:00,17:00-21:00; Sa 10:00-15:00; Su off');
  assert.deepEqual(week[0], [[11, 14], [17, 21]]);
  assert.deepEqual(week[4], [[11, 14], [17, 21]]);
  assert.deepEqual(week[5], [[10, 15]]);
  assert.deepEqual(week[6], []);
  assert.deepEqual(parseHoursRaw('24/7'), Array(7).fill([[0, 24]]));
});

test('parseHoursRaw：跨夜與跨週的星期範圍', () => {
  const week = parseHoursRaw('Fr-Mo 18:00-02:00');
  assert.deepEqual(week[4], [[18, 26]]);
  assert.deepEqual(week[0], [[18, 26]]);
  assert.deepEqual(week[2], []);
});

test('parseHoursRaw：看不懂的格式回傳 null，只寫國定假日的規則略過', () => {
  assert.equal(parseHoursRaw(''), null);
  assert.equal(parseHoursRaw('依現場公告'), null);
  assert.equal(parseHoursRaw('Mo-Fr sunrise-sunset'), null);
  assert.deepEqual(parseHoursRaw('Mo-Su 09:00-18:00; PH off')[0], [[9, 18]]);
});

test('openState：營業中、已打烊與營業時間未知', () => {
  const hours = 'Mo-Fr 11:00-14:00';
  assert.deepEqual(openState(hours, at(0, 12)), { known: true, open: true, closesIn: 2, closeAt: 14 });
  assert.deepEqual(openState(hours, at(0, 15)), { known: true, open: false });
  assert.deepEqual(openState(hours, at(5, 12)), { known: true, open: false });
  assert.deepEqual(openState('看不懂', at(0, 12)), { known: false, open: null });
});

test('openState：跨夜營業延續到隔天凌晨', () => {
  const s = openState('Fr 18:00-02:00', at(5, 1));
  assert.equal(s.open, true);
  assert.equal(s.closeAt, 2);
  assert.equal(s.closesIn, 1);
});

test('openState：開到 24:00 而隔天 00:00 接著開，不算打烊', () => {
  assert.equal(openState('24/7', at(0, 23)).closesIn, Infinity);
  const s = openState('Mo 10:00-24:00; Tu 00:00-03:00', at(0, 23));
  assert.equal(s.closeAt, 27);
});

test('softmax：機率總和為 1，溫度越低越集中在最高分', () => {
  const warm = softmax([0.9, 0.5, 0.1], 0.26);
  const cold = softmax([0.9, 0.5, 0.1], 0.01);
  assert.ok(Math.abs(warm.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(warm[0] > warm[1] && warm[1] > warm[2]);
  assert.ok(cold[0] > 0.999);
  assert.deepEqual(softmax([], 0.1), []);
});

test('softmax：溫度極低時不會溢位成 NaN', () => {
  const p = softmax([1000, 999], 0.01);
  assert.ok(p.every(Number.isFinite));
});
