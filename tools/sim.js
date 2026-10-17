#!/usr/bin/env node
// Pacing simulator: a greedy player taps at TAPS_PER_SEC and always buys the
// item with the best (effect / cost) ratio it can afford and has floor space
// for. When nothing fits, it saves for the next room. Prints time to each
// milestone so you can judge the 30-60 minute target without playing.
//
//   node tools/sim.js            # equipment idle mode
//   node tools/sim.js none 3     # idle mode, taps per second

const fs = require('fs');
const vm = require('vm');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(__dirname + '/../config.js', 'utf8'), ctx);
const C = ctx.window.RA_CONFIG;

const idleMode = process.argv[2] || 'equipment';
const TAPS = Number(process.argv[3] || 3);
const DT = 1;

const costOf = (it, lvl) => Math.floor(it.baseCost * Math.pow(C.costGrowth, lvl));
const roomCost = (rooms) => Math.floor(C.rooms.baseCost * Math.pow(C.rooms.costGrowth, rooms - 1));
const maxRooms = 1 + C.rooms.order.length;
const roomTiles = C.rooms.tilesPerSide ** 2;
const capacity = (rooms) => rooms * roomTiles - C.rooms.furnitureTiles.length;
const roles = (it) => {
  if (idleMode === 'helpers') {
    if (it.helper) return { idle: it.idle };
    if (it.helperModeTap) return { tap: it.helperModeTap };
  }
  if (idleMode === 'none' && it.idle) return null;
  return { tap: it.tap, idle: it.idle };
};
const active = C.items.filter((it) => roles(it));

let money = 0, t = 0, lv = {}, rooms = 1, used = 0;
active.forEach((i) => (lv[i.id] = 0));
const tapValue = () => C.baseTap + active.reduce((s, i) => s + (roles(i).tap || 0) * lv[i.id], 0);
const idleRate = () => active.reduce((s, i) => s + (roles(i).idle || 0) * lv[i.id], 0);
const firstBuy = {}, maxed = {}, roomAt = [];

while (t < 4 * 3600) {
  money += (tapValue() * TAPS + idleRate()) * DT;
  t += DT;
  for (;;) {
    let best = null, bestScore = 0, blockedBySpace = false;
    for (const it of active) {
      if (lv[it.id] >= C.maxLevel) continue;
      const cost = costOf(it, lv[it.id]);
      if (cost > money) continue;
      if (used + (it.footprint || 0) > capacity(rooms)) { blockedBySpace = true; continue; }
      const r = roles(it);
      const score = ((r.tap || 0) * TAPS + (r.idle || 0)) / cost;
      if (score > bestScore) { best = it; bestScore = score; }
    }
    if (best) {
      money -= costOf(best, lv[best.id]);
      lv[best.id]++; used += best.footprint || 0;
      if (lv[best.id] === 1) firstBuy[best.id] = t;
      if (lv[best.id] === C.maxLevel) maxed[best.id] = t;
      continue;
    }
    if (blockedBySpace && rooms < maxRooms && money >= roomCost(rooms)) {
      money -= roomCost(rooms); rooms++; roomAt.push(t); continue;
    }
    break;
  }
  if (Object.keys(maxed).length === active.length) break;
}

const mm = (s) => `${String(Math.floor(s / 60)).padStart(3)}m${String(s % 60).padStart(2, '0')}s`;
console.log(`idle=${idleMode} taps/s=${TAPS}`);
console.log('item        first buy   maxed');
for (const it of active) {
  console.log(`${it.id.padEnd(11)} ${mm(firstBuy[it.id] ?? 0)}     ${maxed[it.id] != null ? mm(maxed[it.id]) : '  never'}`);
}
console.log(`rooms bought at: ${roomAt.map(mm).join(', ') || 'none'}`);
console.log(`everything maxed at ${mm(t)}  ($/tap ${tapValue()}, $/s idle ${idleRate()}, ${used}/${capacity(rooms)} tiles, ${rooms} rooms)`);
