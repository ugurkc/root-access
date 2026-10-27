import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base, ctx } from './fixtures/starter-base.mjs';
import { rigs } from '../model/mods/rigs.mjs';
import { classes } from '../model/mods/classes.mjs';
import { jobs } from '../model/mods/jobs.mjs';

const setup = () => {
  const state = { credits: 0, config: base() };
  for (const m of [jobs, rigs, classes]) m.init(state, state.config);
  return state;
};

test('a rig is offered only for an unlocked, unrigged job while a rack slot is free, and takes the slot', () => {
  const state = setup();
  jobs.buy(state, 'job:wifi:lv');
  assert.deepEqual(rigs.offers(state, ctx()), []);           // no rack yet
  classes.buy(state, 'class:rack');
  const [offer] = rigs.offers(state, ctx());
  assert.deepEqual([offer.id, offer.kind, offer.cost], ['rig:wifi', 'rig', 120]);
  rigs.buy(state, offer.id);
  assert.deepEqual(rigs.metrics(state), { 'rigs.count': 1, 'slots.rigFree': 2 });
  assert.deepEqual(rigs.offers(state, ctx()), []);           // wifi rigged; stream locked
});

test('a rig for a locked job is not offered', () => {
  const state = setup();
  classes.buy(state, 'class:rack');
  assert.deepEqual(rigs.offers(state, ctx()), []);
});

test('buying a rig without a free slot throws before the job is marked', () => {
  const state = setup();
  jobs.buy(state, 'job:wifi:lv');
  assert.throws(() => rigs.buy(state, 'rig:wifi'), /no free rig slot/);
  assert.equal(rigs.metrics(state)['rigs.count'], 0);
  assert.equal(jobs.metrics(state, ctx())['jobs.wifi.rigged'], 0);
});

test('with the classes block off (no rack possible) rigs are never offered', () => {
  const cfg = base(); cfg.classes.enabled = false;
  const state = { credits: 0, config: cfg };
  for (const m of [jobs, rigs]) m.init(state, cfg);          // classes skipped, as the core would
  jobs.buy(state, 'job:wifi:lv');
  assert.deepEqual(rigs.offers(state, ctx()), []);
  assert.equal(rigs.metrics(state)['slots.rigFree'], 0);
});

test('a rig offer values the job as rigged: gainPerSec scales with rigSpeedMult', () => {
  const state = setup();
  jobs.buy(state, 'job:wifi:lv');
  classes.buy(state, 'class:rack');
  const gain = (c) => rigs.offers(state, c).find((o) => o.id === 'rig:wifi').gainPerSec;
  assert.equal(gain({ ...ctx(), rigSpeedMult: 2 }), 2 * gain(ctx()));
});
