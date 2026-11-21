// Pumping plan: when to pump next, based on the plan chosen in Settings and the baby's age.
//
// Guidance used (general, for healthy full-term babies; her doctor or lactation consultant can tailor it):
//  - Exclusive pumping: 8–12 sessions per 24 h for a newborn, including overnight, ~15–20 min each.
//    By age: every 2–3 h at 0–2 months, every 3–4 h at 3–6 months, every 3–5 h at 7–12 months.
//    (Solid Starts pumping schedules guide; Healthline; WebMD)
//  - Breastfeeding + pumping (e.g. to rest sore nipples): milk should still be removed about as often as a
//    newborn feeds (8–12 times a day), so when a bottle replaces a breastfeed, pump around that time.
//    The reminder fires when neither a breastfeed nor a pump has happened for the chosen number of hours.
//  - Storage (CDC): 4 h room temp, 4 days fridge, ~6 months freezer (12 max); thawed milk within 24 h.
// push/worker.js mirrors pumpEvery() and the breast + pump rule, so keep them in step.

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export const AGE_BANDS = [
  { upTo: 60, every: 2.5, label: '0–2 months', text: 'Every 2–3 hours, 8–12 times a day, including at least once overnight.' },
  { upTo: 180, every: 3.5, label: '3–6 months', text: 'Every 3–4 hours. A longer 4–6 hour stretch overnight is often fine if supply holds.' },
  { upTo: Infinity, every: 4, label: '7–12 months', text: 'Every 3–5 hours during the day, as solid foods start.' },
];

export const STORAGE = [
  ['Room temperature', 'up to 4 hours'],
  ['Refrigerator', 'up to 4 days'],
  ['Freezer', 'about 6 months is best, 12 months at most'],
  ['Thawed milk', 'use within 24 hours; never refreeze'],
  ['Warmed or left over', 'use within 2 hours'],
];

export function pumpPlan(settings) {
  const p = settings.pump || {};
  // 'stash' was an earlier option; it is now part of Breast + pump.
  const plan = p.plan === 'exclusive' ? 'exclusive' : (p.plan === 'combo' || p.plan === 'stash') ? 'combo' : 'off';
  return { plan, every: +p.every > 0 ? +p.every : 0, after: +p.after > 0 ? +p.after : 3 };
}

/** Days since birth (0 on the birthday), or null without a birthday. */
export function ageDays(bday, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bday || '');
  if (!m) return null;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  return Math.round((today - new Date(+m[1], +m[2] - 1, +m[3])) / DAY);
}

export const bandFor = (days) => AGE_BANDS.find((b) => (days ?? 0) <= b.upTo);

/** Hours between sessions for exclusive pumping: the chosen interval, or one set by her age. */
export function pumpEvery(settings, now = Date.now()) {
  const { every } = pumpPlan(settings);
  return every || bandFor(ageDays(settings.birthday, now)).every;
}

const isRealFeed = (e) => e.type === 'feed' && e.end && !e.attempt;

/**
 * What the Pumping card should say right now.
 * states: off | running | due | later | after-feed | done
 */
export function nextPump(data, now = Date.now()) {
  const { plan } = pumpPlan(data.settings);
  if (plan === 'off') return { state: 'off' };
  const pumps = data.entries.filter((e) => e.type === 'pump').sort((a, b) => b.start - a.start);
  const running = pumps.find((e) => !e.end);
  if (running) return { state: 'running', entry: running };
  const last = pumps[0];
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);

  if (plan === 'exclusive') {
    const every = pumpEvery(data.settings, now);
    if (!last) return { state: 'due', every };
    const at = last.start + every * HOUR;
    return { state: now >= at ? 'due' : 'later', at, last, every };
  }

  // Breast + pump: remind when her breasts have gone this long without a breastfeed or a pump.
  const { after } = pumpPlan(data.settings);
  const lastFeed = data.entries.filter((e) => isRealFeed(e) || (e.type === 'feed' && !e.end)).sort((a, b) => b.start - a.start)[0];
  const lastAt = Math.max(lastFeed?.start || 0, last?.start || 0);
  if (!lastAt) return { state: 'idle' };
  const lastKind = last && last.start === lastAt ? 'pumped' : 'nursed';
  const at = lastAt + after * HOUR;
  return { state: now >= at ? 'due' : 'later', at, last, lastAt, lastKind, after };
}
