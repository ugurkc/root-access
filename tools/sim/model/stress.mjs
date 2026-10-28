// Stress: the same config against perturbed players, so a balance claim does not rest on one
// scripted player. Each variant edits a copy of every profile (taps, session lengths, the saving
// habit, how often the player comes back); a variant that would change nothing for a profile is
// skipped for it. Every row is reported next to that profile's unperturbed run ('base').
// Plain ES module with no node: imports: it runs in the browser too.
import { run } from './core.mjs';
import { evaluate } from './targets.mjs';

const eachSession = (p, f) => { f(p.sessions.day1); p.sessions.later.forEach(f); };

// apply(profile) edits the copy in place and returns false when it changed nothing.
export const VARIANTS = [
  { id: 'base', label: 'as profiled', apply: () => true },
  { id: 'slow-taps', label: 'taps at 60% of the profile rate', apply: (p) => { eachSession(p, (s) => { s.tps *= 0.6; }); return true; } },
  { id: 'short-first', label: 'first session 1 min shorter', apply: (p) => {
    if (p.sessions.day1.minutes <= 1) return false;
    p.sessions.day1.minutes -= 1; return true;
  } },
  { id: 'short-sessions', label: 'every session 25% shorter', apply: (p) => { eachSession(p, (s) => { s.minutes *= 0.75; }); return true; } },
  { id: 'impulsive', label: 'never saves up for a big purchase', apply: (p) => {
    if (!p.policy.saveForBigWithinMinutes) return false;
    p.policy.saveForBigWithinMinutes = 0; return true;
  } },
  { id: 'fewer-visits', label: 'last session of each later day dropped', apply: (p) => {
    if (p.sessions.later.length < 2) return false;
    p.sessions.later.pop(); return true;
  } },
];

const CHECKPOINTS = ['firstEvent:rig', 'firstDay:rig', 'firstDay:roomComplete', 'firstEvent:loot', 'income.passive'];

const earnedOf = (r) => r.summary.reduce((sum, d) => sum + d.activeEarned + d.offlineEarned, 0);

// → [{ profile, variant, label, earned, deltaPct, metrics: { checkpoint: value | undefined }, passes, total }],
// grouped by profile, variants in VARIANTS order.
export function stress({ config, profiles, targets = [], days = 7, variants = VARIANTS }) {
  const rows = [];
  for (const [id, profile] of Object.entries(profiles)) {
    let baseEarned;
    for (const v of variants) {
      const p = structuredClone(profile);
      if (!v.apply(p)) continue;
      const r = run({ config, profile: p, days });
      const earned = earnedOf(r);
      baseEarned ??= earned;
      const verdicts = evaluate(targets.filter((t) => t.profile === 'all' || t.profile === id), { [id]: r });
      rows.push({
        profile: id, variant: v.id, label: v.label, earned,
        deltaPct: 100 * (earned / baseEarned - 1),
        metrics: Object.fromEntries(CHECKPOINTS.map((k) => [k, r.metrics[k]])),
        passes: verdicts.filter((x) => x.pass).length, total: verdicts.length,
      });
    }
  }
  return rows;
}
