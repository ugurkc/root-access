// Jobs: levelled hacks that run for `time` seconds of work and pay on completion.
// A manual job runs once per start (the profile policy may restart it); a rigged job loops.
//
// The layout of `state.jobs` is private to this module. Other modules use only these entry points:
//   advanceRunning(state, seconds)  push every running job's work along (taps, bar)
//   setRigged(state, id, rigName)   mark a job as automated (rigs)
//   isRigged(state, id)             read that mark (rigs, racks)
// Exported helpers take `cfg` explicitly so a test can hand them any config.

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

// Pay per run at level `lv`: pay × lv × 2^(milestones reached) × payMult × comfortMult.
function payAt(cfg, job, lv, ctx) {
  const milestones = cfg.jobs.milestones.filter((m) => m <= lv).length;
  return job.pay * lv * 2 ** milestones * ctx.payMult * ctx.comfortMult;
}

export function payFor(state, cfg, id, ctx) {
  return payAt(cfg, jobCfg(state, id), state.jobs.byId[id].lv, ctx);
}

// Credits per second of one job while it runs.
const rate = (state, cfg, job, ctx) => payFor(state, cfg, job.id, ctx) / job.time * ctx.speedMult;

const sumWhere = (state, cfg, ctx, keep) =>
  cfg.jobs.list.reduce((sum, job) => (keep(state.jobs.byId[job.id]) ? sum + rate(state, cfg, job, ctx) : sum), 0);

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

const unlocked = (state, job) => state.jobs.rep >= job.unlock || state.jobs.byId[job.id].lv > 0;

function finishRun(state, cfg, job, ctx) {
  state.credits += payFor(state, cfg, job.id, ctx);
  state.jobs.rep += job.rep;
}

export const jobs = {
  id: 'jobs',

  init(state, config) {
    const byId = {};
    const cfgById = {};
    for (const job of config.jobs.list) {
      byId[job.id] = { lv: 0, rigged: false, work: 0, running: false };
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
      j.work += dt * ctx.speedMult;
      while (j.work >= job.time) {
        finishRun(state, cfg, job, ctx);
        j.work -= job.time;
        if (!j.rigged) {
          j.running = false;
          j.work = 0;
          break;
        }
      }
    }
  },

  // While away only rigged jobs run, for at most `offline.capHours`, in whole runs.
  offline(state, seconds, ctx) {
    const cfg = state.config;
    const off = cfg.offline;
    if (!off || off.enabled === false) return;
    const secs = Math.min(seconds, off.capHours * 3600);
    for (const job of cfg.jobs.list) {
      const j = state.jobs.byId[job.id];
      if (j.lv === 0 || !j.rigged) continue;
      const runs = Math.floor(secs * ctx.speedMult / job.time);
      state.credits += runs * payFor(state, cfg, job.id, ctx);
      state.jobs.rep += runs * job.rep;
      j.work = 0;
    }
  },

  offers(state, ctx) {
    const cfg = state.config;
    const out = [];
    for (const job of cfg.jobs.list) {
      const { lv } = state.jobs.byId[job.id];
      if (!unlocked(state, job) || lv >= cfg.jobs.maxLevel) continue;
      const gain = (payAt(cfg, job, lv + 1, ctx) - payAt(cfg, job, lv, ctx)) / job.time * ctx.speedMult;
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
