// Jobs: levelled hacks that run for `time` seconds of work and pay on completion.
// A manual job runs once per start (the profile policy may restart it); a rigged job loops.
// Work advances at speedMult (bar boosts, every job) × rigSpeedMult (tower, rigged jobs only), active
// and offline alike.
//
// The layout of `state.jobs` is private to this module. Other modules use only these entry points:
//   advanceRunning(state, seconds)  push every running job's work along (taps, bar)
//   setRigged(state, id, rigName)   mark a job as automated. rigs.mjs is the only production caller;
//                                   it also owns the slot count
//   isRigged(state, id)             read that mark (rigs)
//   levelOf(state, id)              the job's level; ≥ 1 means unlocked (rigs)
//   runRate(state, cfg, id, ctx, asRigged = isRigged)
//                                   the job's credits per second while it runs; `asRigged` true values
//                                   it at rig speed before the rig is bought (rigs)
//   runsOf(state, id)               completed runs so far, active and offline (loot)
// Exported helpers take `cfg` explicitly so a test can hand them any config.
import { offlineCapSeconds } from './offline.mjs';

const OFFER_PREFIX = 'job:';
const OFFER_SUFFIX = ':lv';
const offerIdFor = (jobId) => `${OFFER_PREFIX}${jobId}${OFFER_SUFFIX}`;
const jobIdOf = (offerId) => offerId.slice(OFFER_PREFIX.length, -OFFER_SUFFIX.length);

// O(1) job config lookup, built once in init from the same config the helpers receive.
const jobCfg = (state, id) => state.jobs.cfgById[id];

// Cost of the next `n` levels from the current level: cost × r^lv × (r^n − 1)/(r − 1).
export function costN(state, cfg, id, n) {
  const job = jobCfg(state, id);
  const { lv } = state.jobs.byId[id];
  const r = job.r;
  const series = r === 1 ? n : (r ** n - 1) / (r - 1);
  return job.cost * r ** lv * series;
}

// Pay per run at level `lv`: pay × (1 + levelGain × (lv − 1)) × 2^(milestones reached) × payMult.
// Comfort does not touch job pay; it scales tap money (taps.mjs) and through it the bar payout.
// levelGain defaults to 1, the plain pay × lv.
const levelMult = (cfg, lv) => 1 + (cfg.jobs.levelGain ?? 1) * (lv - 1);
function payAt(cfg, job, lv, ctx) {
  const milestones = cfg.jobs.milestones.filter((m) => m <= lv).length;
  return job.pay * levelMult(cfg, lv) * 2 ** milestones * ctx.payMult;
}

export function payFor(state, cfg, id, ctx) {
  return payAt(cfg, jobCfg(state, id), state.jobs.byId[id].lv, ctx);
}

// Seconds of work a run takes: the job's time less ctx.timeCut (router), never under MIN_TIME
// (or the job's own time when that is shorter).
const MIN_TIME = 1;
const runTime = (job, ctx) => Math.max(Math.min(MIN_TIME, job.time), job.time - ctx.timeCut);

// Work seconds per real second: speedMult for every job; a rigged one runs at rigs.speed (default 1) × rigSpeedMult.
const workSpeed = (cfg, ctx, rigged) => ctx.speedMult * (rigged ? (cfg.rigs.speed ?? 1) * ctx.rigSpeedMult : 1);

// Credits per second of a job at level `lv` while it runs: pay / time × work speed.
const rateAt = (cfg, job, lv, ctx, rigged) => payAt(cfg, job, lv, ctx) / runTime(job, ctx) * workSpeed(cfg, ctx, rigged);

export function runRate(state, cfg, id, ctx, asRigged = state.jobs.byId[id].rigged) {
  return rateAt(cfg, jobCfg(state, id), state.jobs.byId[id].lv, ctx, asRigged);
}

const sumWhere = (state, cfg, ctx, keep) =>
  cfg.jobs.list.reduce((sum, job) => (keep(state.jobs.byId[job.id]) ? sum + runRate(state, cfg, job.id, ctx) : sum), 0);

// Credits per second of the jobs currently in a run (what taps scale with).
export function runningIncome(state, cfg, ctx) {
  return sumWhere(state, cfg, ctx, (j) => j.running);
}

// Credits per second earned without tapping: rigged jobs, which loop by themselves.
export function passiveIncome(state, cfg, ctx) {
  return sumWhere(state, cfg, ctx, (j) => j.lv > 0 && j.rigged);
}

export function advanceRunning(state, seconds) {
  if (!state.jobs) return;
  for (const j of Object.values(state.jobs.byId)) if (j.running) j.work += seconds;
}

export function setRigged(state, id, rigName) {
  const j = state.jobs.byId[id];
  j.rigged = true;
  j.rigName = rigName;
}

export function isRigged(state, id) {
  return state.jobs.byId[id].rigged;
}

export function levelOf(state, id) {
  return state.jobs.byId[id].lv;
}

export function runsOf(state, id) {
  return state.jobs.byId[id].runs;
}

const unlocked = (state, job) => state.jobs.rep >= job.unlock || state.jobs.byId[job.id].lv > 0;

function finishRun(state, cfg, job, ctx) {
  state.credits += payFor(state, cfg, job.id, ctx);
  state.jobs.rep += job.rep;
  state.jobs.byId[job.id].runs += 1;
}

export const jobs = {
  id: 'jobs',

  init(state, config) {
    const byId = {};
    const cfgById = {};
    for (const job of config.jobs.list) {
      byId[job.id] = { lv: 0, rigged: false, work: 0, running: false, runs: 0 };
      cfgById[job.id] = job;
    }
    state.jobs = { rep: 0, byId, cfgById };
  },

  tick(state, dt, ctx) {
    const cfg = state.config;
    const restart = ctx.policy?.restartManualJobs;
    for (const job of cfg.jobs.list) {
      const j = state.jobs.byId[job.id];
      if (j.lv === 0) continue;
      if (!j.running && (j.rigged || restart)) {
        j.running = true;
        j.work = 0;
      }
      if (!j.running) continue;
      j.work += dt * workSpeed(cfg, ctx, j.rigged);
      const need = runTime(job, ctx);
      while (j.work >= need) {
        finishRun(state, cfg, job, ctx);
        j.work -= need;
        if (!j.rigged) {
          j.running = false;
          j.work = 0;
          break;
        }
      }
    }
  },

  // While away, work advances for at most `offline.capHours` × offlineMult seconds.
  // A rigged job loops in whole runs; the unfinished part of a run (including progress made before
  // leaving) carries over to the next session. A hand-started run in progress keeps going at hand
  // speed and pays once if it finishes, then stops, as it would in a session; `offline.handRuns`
  // "pause" freezes it instead. A hand job that was not running earns nothing.
  offline(state, seconds, ctx) {
    const cfg = state.config;
    const secs = Math.min(seconds, offlineCapSeconds(cfg, ctx));
    if (secs <= 0) return;
    const handRuns = cfg.offline.handRuns ?? 'finish';
    for (const job of cfg.jobs.list) {
      const j = state.jobs.byId[job.id];
      if (j.lv === 0) continue;
      const need = runTime(job, ctx);
      if (j.rigged) {
        const work = j.work + secs * workSpeed(cfg, ctx, true);
        const runs = Math.floor(work / need);
        state.credits += runs * payFor(state, cfg, job.id, ctx);
        state.jobs.rep += runs * job.rep;
        j.runs += runs;
        j.work = work - runs * need;
        continue;
      }
      if (!j.running || handRuns === 'pause') continue;
      j.work += secs * workSpeed(cfg, ctx, false);
      if (j.work < need) continue;
      finishRun(state, cfg, job, ctx);
      j.running = false;
      j.work = 0;
    }
  },

  offers(state, ctx) {
    const cfg = state.config;
    const out = [];
    for (const job of cfg.jobs.list) {
      const { lv, rigged } = state.jobs.byId[job.id];
      if (!unlocked(state, job) || lv >= cfg.jobs.maxLevel) continue;
      const gain = rateAt(cfg, job, lv + 1, ctx, rigged) - rateAt(cfg, job, lv, ctx, rigged);
      out.push({ id: offerIdFor(job.id), cost: costN(state, cfg, job.id, 1), gainPerSec: gain, kind: 'level' });
    }
    return out;
  },

  // The core has already paid for the level and only buys what offers() listed, so the maxLevel
  // clamp lives there, not here. A job bought at level 0 starts on the next tick.
  buy(state, offerId) {
    state.jobs.byId[jobIdOf(offerId)].lv += 1;
  },

  metrics(state, ctx) {
    const cfg = state.config;
    const out = {
      rep: state.jobs.rep,
      'income.passive': passiveIncome(state, cfg, ctx),
      'income.running': runningIncome(state, cfg, ctx),
    };
    for (const job of cfg.jobs.list) {
      const j = state.jobs.byId[job.id];
      out[`jobs.${job.id}.level`] = j.lv;
      out[`jobs.${job.id}.rigged`] = j.rigged ? 1 : 0;
    }
    return out;
  },
};
