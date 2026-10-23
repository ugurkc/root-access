// MODULE CONTRACT
//
// A mechanic module is a plain object the core composes in a fixed order:
//
//   id                          config block name; `config[id].enabled === false` skips the module everywhere
//   init(state, config, profile) create the module's own slice of state (e.g. `state.jobs = {...}`);
//                               never rely on another module having run first
//   tick(state, dt, ctx)        advance `dt` seconds of active play
//   offline?(state, seconds, ctx)  advance an absence; only mechanics that earn while away implement it
//   offers(state, ctx)          → [{ id, cost, gainPerSec, kind }], all numbers finite; `id` unique per module
//   buy(state, offerId)         apply the effect only. The core has already deducted `cost` from `state.credits`
//   metrics(state)              → { 'name': number }; merged into the run's metrics
//   multipliers?(state)         → partial { payMult, speedMult, comfortMult }; missing keys default to 1
//
// Metric keys the core reads:
//   'income.passive'  credits per second earned without tapping
//   'income.tap'      credits per tap; the core multiplies by the session's taps per second
//
// Offer kinds the core treats specially:
//   'rig'                  bought in a pre-pass whenever affordable (policy.buyRigsWhenAffordable)
//   'rig', 'item', 'rack'  "big": the shop saves for one that is reachable within the save window
//                          and beats the best affordable offer by policy.bigValueRatio
//
// ctx, rebuilt each tick and each offline call:
//   { payMult, speedMult, comfortMult,  product of every module's multipliers()
//     tapsThisTick,                     1 per tick while in a session, 0 offline
//     t,                                simulated seconds since the first session began (gaps included)
//     policy }                          the profile's buying policy
//
// Intended order once the modules exist: taps, bar, jobs, rigs, racks, items, events, offline.
import { taps } from './mods/taps.mjs';
import { jobs } from './mods/jobs.mjs';

export function defaultModules() {
  return [taps, jobs];
}
