// MODULE CONTRACT
//
// A mechanic module is a plain object the core composes in a fixed order:
//
//   id                          config block name; `config[id].enabled === false` skips the module everywhere
//   init(state, config, profile) create the module's own slice of state (e.g. `state.jobs = {...}`);
//                               never rely on another module having run first
//   tick(state, dt, ctx)        advance `dt` seconds of active play
//   offline?(state, seconds, ctx)  advance an absence, or reset anything that does not survive one (bar empties
//                               its boost stack). Called in registry order, with ctx rebuilt before each
//                               module's call, so a module sees the multipliers as left by the modules before it
//   offers(state, ctx)          → [{ id, cost, gainPerSec, kind }], all numbers finite; `id` unique per module
//   buy(state, offerId)         apply the effect only. The core has already deducted `cost` from `state.credits`
//   metrics(state, ctx)         → { 'name': number }; merged into the run's metrics. `ctx` is the current
//                               multipliers at the call site (the core always passes one; a caller with
//                               none in hand passes a neutral ctx of all 1s)
//   multipliers?(state)         → partial { payMult, speedMult, comfortMult, rigSpeedMult, tapMult, barMult,
//                               tapAdvanceMult }; missing keys default to 1, every value must be finite
//                               (the core throws otherwise)
//
// State: the core sets `state.config` once in run(); module methods read config from there and
// never stash it in their own slice. A module's slice layout is private: other modules go through
// the intent-level helpers it exports (e.g. jobs.mjs `advanceRunning`, `setRigged`, `isRigged`).
// Exported helpers take `cfg` explicitly, `helper(state, cfg, ...)`, so a test can hand them any config.
//
// Metric keys the core reads:
//   'income.passive'  credits per second earned without tapping
//   'income.tap'      credits per tap; the core multiplies by the session's taps per second
//
// Purchase kinds: 'level', 'class' (a class's first tier), 'tier' (a later one), 'rig'.
// Offer kinds the core treats specially:
//   'rig'                  bought in a pre-pass whenever affordable (policy.buyRigsWhenAffordable)
//   'rig', 'class', 'tier' "big": the shop saves for one that is reachable within the save window
//                          and beats the best affordable offer by policy.bigValueRatio
//
// ctx, rebuilt each tick, and per module in the gap loop:
//   { payMult, speedMult, comfortMult, rigSpeedMult, tapMult, barMult, tapAdvanceMult,
//                                       product of every module's multipliers()
//     tapsThisTick,                     1 per tick while in a session, 0 offline
//     t,                                simulated seconds since the first session began (gaps included)
//     tps,                              taps per second of the current session; 0 while offline and in
//                                       the final metrics ctx
//     policy,                           the profile's buying policy
//     record(event) }                   adds a timeline event, stamped with the current t and day (`t` and `day`
//                                       in the passed event are overwritten by the core's stamp). Inside offline()
//                                       the stamp's `t` is the gap's start (the end of the previous session) while
//                                       `day` is the day of the session that follows the gap. Give it a numeric
//                                       `cost` only for a purchase: the core records purchases itself, so modules
//                                       use it for non-purchase events such as loot drops
//
// Order: taps, bar, jobs, rigs, classes, events, loot, offline.
// bar must precede jobs: bar.offline() clears the boosts before jobs.offline() prices the gap.
// loot must follow jobs: it rolls on the job runs that completed this tick.
import { taps } from './mods/taps.mjs';
import { bar } from './mods/bar.mjs';
import { jobs } from './mods/jobs.mjs';
import { rigs } from './mods/rigs.mjs';
import { classes } from './mods/classes.mjs';
import { events } from './mods/events.mjs';
import { loot } from './mods/loot.mjs';
import { offline } from './mods/offline.mjs';

// taps before bar so the bar counts this tick's taps; bar before jobs so a boost reaches job work
// as early as possible (the core collects multipliers() before the tick, so from the next tick on).
// loot follows jobs (and, in the gap loop, jobs.offline) so it sees the runs completed this step.
// rigs, classes, events and offline have no tick effect of their own and are order-agnostic.
export function defaultModules() {
  return [taps, bar, jobs, rigs, classes, events, loot, offline];
}
