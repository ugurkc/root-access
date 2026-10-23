// Player profile validator. A profile is
//   { id?, sessions: { day1: session, later: [session] }, policy: { saveForBigWithinMinutes, bigValueRatio,
//     buyRigsWhenAffordable, restartManualJobs } }
// with session = { hour: 0–23, minutes > 0, tps > 0 }. → [{ path, message }]; [] when valid.
// Plain ES module with no node: imports: it runs in the browser too.

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const describe = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function checkSession(s, path, errs) {
  if (!isRecord(s)) { errs.push({ path, message: `expected a session object, got ${describe(s)}` }); return; }
  if (!(finite(s.hour) && s.hour >= 0 && s.hour <= 23)) errs.push({ path: `${path}.hour`, message: `expected a number from 0 to 23, got ${s.hour}` });
  if (!(finite(s.minutes) && s.minutes > 0)) errs.push({ path: `${path}.minutes`, message: `expected a positive number, got ${s.minutes}` });
  if (!(finite(s.tps) && s.tps > 0)) errs.push({ path: `${path}.tps`, message: `expected a positive number, got ${s.tps}` });
}

export function validateProfile(profile) {
  if (!isRecord(profile)) return [{ path: '', message: `expected a profile object, got ${describe(profile)}` }];
  const errs = [];
  if ('id' in profile && typeof profile.id !== 'string') errs.push({ path: 'id', message: `expected string, got ${describe(profile.id)}` });

  const { sessions, policy } = profile;
  if (!isRecord(sessions)) errs.push({ path: 'sessions', message: `expected an object with day1 and later, got ${describe(sessions)}` });
  else {
    checkSession(sessions.day1, 'sessions.day1', errs);
    if (!Array.isArray(sessions.later)) errs.push({ path: 'sessions.later', message: `expected an array of sessions, got ${describe(sessions.later)}` });
    else sessions.later.forEach((s, i) => checkSession(s, `sessions.later[${i}]`, errs));
  }

  if (!isRecord(policy)) errs.push({ path: 'policy', message: `expected a policy object, got ${describe(policy)}` });
  else {
    const at = (key, message) => errs.push({ path: `policy.${key}`, message });
    if (!(finite(policy.saveForBigWithinMinutes) && policy.saveForBigWithinMinutes >= 0)) at('saveForBigWithinMinutes', `expected a number ≥ 0, got ${policy.saveForBigWithinMinutes}`);
    if (!(finite(policy.bigValueRatio) && policy.bigValueRatio >= 1)) at('bigValueRatio', `expected a number ≥ 1, got ${policy.bigValueRatio}`);
    for (const key of ['buyRigsWhenAffordable', 'restartManualJobs']) {
      if (typeof policy[key] !== 'boolean') at(key, `expected boolean, got ${describe(policy[key])}`);
    }
  }
  return errs;
}
