import { Store } from './store.js';
import { VERSES, NIV_NOTICE } from './verses.js';
import { chick, icons } from './art.js';
import { AGE_BANDS, STORAGE, pumpPlan, pumpEvery, nextPump, ageDays, bandFor } from './pump.js';

const store = new Store();
const ui = { tab: 'home', msgUnlocked: false, histDays: 14, pendingRender: false, setupError: '', form: {}, rescueOff: {}, hopUntil: 0, confirmFn: null };
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');
$nav.innerHTML = [['home', 'egg', 'Today'], ['history', 'calendar', 'History'], ['settings', 'settings', 'Settings']]
  .map(([t, i, l]) => `<button data-act="tab" data-tab="${t}">${icons[i]}<span>${l}</span></button>`).join('');

const APP_VERSION = '3.0';
// The notification sender (a Cloudflare Worker, see push/worker.js).
const PUSH_URL = 'https://lil-chicken-push.lilchicken-7535ca94.workers.dev';
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDate = (ts) => new Date(ts).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
const fmtShortDate = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
function fmtHM(ms) {
  const m = Math.max(0, Math.floor(ms / MIN));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
const toLocalInput = (ts) => {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v) => (v ? new Date(v).getTime() : NaN);
const sideName = (s) => (s === 'L' ? 'Left' : 'Right');
const other = (s) => (s === 'L' ? 'R' : 'L');

function birthDate(bday) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bday || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
}
/** Day 1 is the day of birth. */
function babyDay(bday, now = Date.now()) {
  const b = birthDate(bday);
  if (b == null) return null;
  return Math.round((startOfDay(now) - b) / DAY) + 1;
}
const dateOfDay = (bday, n) => birthDate(bday) + (n - 1) * DAY;
function ageLabel(bday) {
  const n = babyDay(bday);
  if (n == null) return 'Add her birthday in Settings';
  if (n < 1) return 'Coming soon';
  if (n === 1) return 'Born today · Day 1';
  const days = n - 1;
  if (days < 14) return `${days} day${days > 1 ? 's' : ''} old · Day ${n}`;
  const w = Math.floor(days / 7), d = days % 7;
  return `${w} weeks${d ? `, ${d} day${d > 1 ? 's' : ''}` : ''} old · Day ${n}`;
}

const tOf = (e) => e.start ?? e.at;
const fmtOz = (v) => (v === '' || v == null || isNaN(+v) ? '' : `${+(+v).toFixed(1)} oz`);
const fmtHrs = (h) => `${Math.floor(h)}${h % 1 ? '½' : ''}`;
const PUMP_SIDE = { both: 'Both sides', L: 'Left', R: 'Right' };
const isRealFeed = (e) => e.type === 'feed' && e.end && !e.attempt;
const feedDur = (e, now = Date.now()) => e.segs.reduce((sum, s) => sum + ((s.b ?? now) - s.a), 0);
const lastSide = (e) => e.segs[e.segs.length - 1].s;
const running = (d) => d.entries.find((e) => e.type === 'feed' && !e.end);
const sorted = (d) => [...d.entries].sort((a, b) => tOf(b) - tOf(a));
/** Which side to offer next. One side last time: the other one. Both sides: the one that got
 * less time (it is likely fuller); if they were about even, the side she finished on. */
function nextSide(f) {
  const t = { L: 0, R: 0 };
  f.segs.forEach((s) => { t[s.s] += (s.b ?? Date.now()) - s.a; });
  if (!t.L || !t.R) return other(lastSide(f));
  if (Math.abs(t.L - t.R) < 2 * MIN) return lastSide(f);
  return t.L < t.R ? 'L' : 'R';
}
const feedSides = (e) => e.segs.map((s) => s.s).filter((s, i, a) => i === 0 || a[i - 1] !== s);

const KIND = { wet: 'Wet diaper', dirty: 'Dirty diaper', both: 'Wet + dirty' };

const isNight = (now = new Date()) => { const h = now.getHours() + now.getMinutes() / 60; return h >= 21 || h < 6.5; };
function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 5 || h >= 22) return 'Night shift, mama';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** One row of the activity timeline. */
function row(e, d) {
  let icon, title, meta = '';
  if (e.type === 'feed') {
    const sides = feedSides(e);
    icon = `<span class="tl-ico egg-ico ${lastSide(e)} ${e.attempt ? 'attempt' : ''}">${sides.length > 1 ? sides.join('') : sides[0]}</span>`;
    title = (e.attempt ? 'Attempt · ' : '') + sides.map(sideName).join(' → ');
    meta = !e.end ? '<span class="live">Feeding now</span>'
      : e.segs.length > 1 ? `${fmtHM(feedDur(e))} · ${e.segs.map((s) => `${s.s} ${fmtHM((s.b ?? Date.now()) - s.a)}`).join(', ')}` : fmtHM(feedDur(e));
  } else if (e.type === 'bottle') {
    icon = `<span class="tl-ico bottle">${icons.bottle}</span>`;
    title = 'Bottle';
    meta = e.oz ? `${esc(e.oz)} oz` : '';
  } else if (e.type === 'diaper') {
    icon = `<span class="tl-ico diaper ${e.kind}">${icons[e.kind === 'wet' ? 'drop' : e.kind === 'dirty' ? 'dirty' : 'both']}</span>`;
    title = KIND[e.kind] || 'Diaper';
  } else if (e.type === 'pump') {
    icon = `<span class="tl-ico pump">${icons.pump}</span>`;
    title = e.end ? `Pumped${e.oz ? ` · ${fmtOz(e.oz)}` : ''}` : 'Pumping';
    meta = e.end ? `${PUMP_SIDE[e.side] || 'Both sides'} · ${fmtHM(e.end - e.start)}` : '<span class="live">Pumping now</span>';
  } else if (e.type === 'med') {
    const med = d.settings.meds.find((m) => m.id === e.medId);
    icon = `<span class="tl-ico med">${icons.pill}</span>`;
    title = esc(med ? med.name : e.name || 'Medicine');
  }
  return `<li><button class="tl-row" data-act="edit" data-id="${esc(e.id)}">
    ${icon}<span class="tl-body"><span class="tl-title">${title}</span>${meta ? `<span class="tl-meta">${meta}</span>` : ''}</span>
    <span class="tl-time">${fmtTime(tOf(e))}</span></button></li>`;
}

function timeline(list, d, emptyText = 'Nothing yet. Fresh day, fresh eggs.') {
  if (!list.length) return `<div class="empty">${chick('sleepy', 'empty-chick')}<p>${emptyText}</p></div>`;
  return `<ul class="timeline">${list.map((e) => row(e, d)).join('')}</ul>`;
}

// The ring fills over 20 minutes on the current side.
const ringPct = (ms) => (((ms % (20 * MIN)) / (20 * MIN)) * 100).toFixed(2);

// ---------- rendering ----------
function syncBadge(always = false) {
  const s = store.status;
  if (!always && s !== 'offline' && s !== 'auth') return '';
  const label = { ok: 'Synced', idle: 'Synced', pending: 'Saving', offline: 'Offline', auth: 'Reconnect' }[s];
  return `<button class="sync ${s}" data-act="tab" data-tab="settings" aria-label="Sync: ${label}"><i></i><span>${label}</span></button>`;
}

const nameSize = (n) => (n.length > 22 ? 'xl-name' : n.length > 13 ? 'long-name' : '');

function header(d, title, sub) {
  const s = d.settings;
  return `<header class="top">
    <div class="avatar ${running(d) ? 'bob' : ''} ${Date.now() < ui.hopUntil ? 'hop' : ''}">${chick(isNight() && !running(d) ? 'sleepy' : 'happy')}</div>
    <div class="who"><div class="eyebrow">${title ? '' : greeting()}</div>
      <h1 class="${nameSize(title || s.babyName || 'Lil Chicken')}">${esc(title || s.babyName || 'Lil Chicken')}</h1>
      <div class="sub">${esc(sub ?? ageLabel(s.birthday))}</div></div>
    ${syncBadge()}</header>`;
}

function todaysNote(d) {
  const s = d.settings;
  const day = babyDay(s.birthday);
  const msgs = day ? d.messages.filter((m) => +m.day === day) : [];
  const verseIdx = day && day > 0 ? (day - 1) : Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / DAY);
  const v = VERSES[((verseIdx % VERSES.length) + VERSES.length) % VERSES.length];
  if (!msgs.length && !s.showVerses) return '';
  const earlier = day ? d.messages.some((m) => +m.day < day) : false;
  let h = '<section class="note"><div class="gingham"></div><div class="note-body">';
  if (msgs.length) {
    h += `<div class="note-label">${icons.heart} A note for you <span class="new-pill">New today</span></div>`;
    for (const m of msgs) h += `<p class="msg">${esc(m.text)}</p>`;
    h += `<div class="sign">— ${s.signOff ? `love, ${esc(s.signOff)}` : 'with love'}</div>`;
  }
  if (s.showVerses) {
    h += `<div class="verse-wrap ${msgs.length ? 'split' : ''}"><div class="note-label">${icons.book} Verse for today</div>
      <p class="verse">${esc(v[1])}</p><div class="ref">${esc(v[0])} · NIV</div></div>`;
  }
  if (earlier) h += `<button class="text-btn" data-act="earlier">Earlier notes ${icons.chevron}</button>`;
  return h + '</div></section>';
}

function feedCard(d, now) {
  const r = running(d);
  if (r) {
    const seg = r.segs[r.segs.length - 1];
    return `<section class="card running ${seg.s}">
      <div class="run-top"><span class="run-dot"></span>${sideName(seg.s)} side</div>
      <div class="ring" data-ring="${seg.a}" style="--p:${ringPct(now - seg.a)}%"><div class="ring-inner">
        <div class="clock" data-clock="${seg.a}">${fmtClock(now - seg.a)}</div>
        <div class="run-total">total <span data-feedtotal="${r.id}">${fmtHM(feedDur(r, now))}</span> · since ${fmtTime(r.start)}</div>
      </div></div>
      ${now - seg.a > 45 * MIN && !ui.rescueOff[r.id] ? `<div class="rescue"><b>Still feeding? Dozed off?</b><span>How long did it really last on this side?</span>
        <div class="chips">${[15, 20, 30].map((m) => `<button data-act="stop-at" data-min="${m}">${m} min</button>`).join('')}
        <button data-act="still-going" data-id="${r.id}">She’s still feeding</button></div></div>` : ''}
      <div class="run-actions">
        <button class="btn soft ${other(seg.s)}" data-act="switch">Switch to ${sideName(other(seg.s))}</button>
        <button class="btn primary done" data-act="stop">${icons.stop} Done</button>
      </div>
      <button class="attempt-btn" data-act="stop-attempt">Didn’t really feed? <b>Save as attempt</b></button>
    </section>`;
  }
  const feeds = d.entries.filter(isRealFeed).sort((a, b) => b.start - a.start);
  const lastAttempt = d.entries.filter((e) => e.type === 'feed' && e.attempt).sort((a, b) => b.start - a.start)[0];
  const bottles = d.entries.filter((e) => e.type === 'bottle').sort((a, b) => b.at - a.at);
  const lf = feeds[0], lb = bottles[0];
  const lastAny = Math.max(lf ? lf.start : 0, lb ? lb.at : 0);
  const next = lf ? nextSide(lf) : null;
  let since;
  if (!lastAny) {
    since = `<div class="since"><div class="eyebrow">Ready when you are</div><div class="since-empty">Tap an egg to start</div></div>`;
  } else {
    const isFeed = lf && lf.start === lastAny;
    const meta = isFeed
      ? `${feedSides(lf).map(sideName).join(' → ')} · ${fmtTime(lf.start)} · ${fmtHM(feedDur(lf))}`
      : `Bottle · ${fmtTime(lb.at)}${lb.oz ? ` · ${esc(lb.oz)} oz` : ''}`;
    since = `<div class="since"><div class="eyebrow">Last feed started</div>
      <div class="big"><span data-ago="${lastAny}">${fmtHM(now - lastAny)}</span><small>ago</small></div>
      <div class="since-meta">${meta}</div>
      ${lastAttempt && lastAttempt.start > lastAny ? `<div class="since-attempt">Attempt at ${fmtTime(lastAttempt.start)} · ${sideName(lastSide(lastAttempt))}</div>` : ''}</div>`;
  }
  const egg = (s) => `<button class="egg ${s} ${next === s ? 'next' : ''}" data-act="start" data-side="${s}" aria-label="Start feed on ${sideName(s).toLowerCase()} side${next === s ? ' (suggested)' : ''}">
      <span class="sheen"></span>${next === s ? '<span class="next-tag">Start here</span>' : ''}
      <span class="egg-letter">${s}</span><span class="egg-name">${sideName(s)}</span></button>`;
  return `<section class="card hero">
    ${since}
    <div class="eggs ${next ? 'has-next' : ''}">${egg('L')}${egg('R')}</div>
    <div class="quick ${pumpPlan(d.settings).plan !== 'off' ? 'three' : ''}">
      <button data-act="bottle">${icons.bottle}<span>Bottle</span></button>
      ${pumpPlan(d.settings).plan !== 'off' ? `<button data-act="pump-start">${icons.pump}<span>Pump</span></button>` : ''}
      <button data-act="past-feed">${icons.clock}<span>${pumpPlan(d.settings).plan !== 'off' ? 'Past feed' : 'Add past feed'}</span></button>
    </div>
  </section>`;
}

function diaperCard(d, now) {
  const today = d.entries.filter((e) => e.type === 'diaper' && e.at >= startOfDay(now));
  const wet = today.filter((e) => e.kind === 'wet' || e.kind === 'both').length;
  const dirty = today.filter((e) => e.kind === 'dirty' || e.kind === 'both').length;
  return `<section class="card">
    <div class="card-head"><h2>Diapers</h2><span class="stat">Today <b>${wet}</b> wet · <b>${dirty}</b> dirty</span></div>
    <div class="tiles">
      <button class="tile wet" data-act="diaper" data-kind="wet">${icons.drop}<span>Wet</span></button>
      <button class="tile dirty" data-act="diaper" data-kind="dirty">${icons.dirty}<span>Dirty</span></button>
      <button class="tile both" data-act="diaper" data-kind="both">${icons.both}<span>Both</span></button>
    </div>
  </section>`;
}

function medStatus(d, med, now) {
  const last = d.entries.filter((e) => e.type === 'med' && e.medId === med.id).sort((a, b) => b.at - a.at)[0];
  const readyAt = last ? last.at + (+med.hours || 0) * HOUR : 0;
  return { last, readyAt, ready: now >= readyAt };
}

function medsCard(d, now) {
  let h = '<section class="card"><div class="card-head"><h2>Medicine</h2></div>';
  for (const med of d.settings.meds) {
    const st = medStatus(d, med, now);
    const when = st.ready
      ? `<span class="ok">OK to take now</span>${st.last ? ` · last ${fmtTime(st.last.at)}` : ''}`
      : `Took at <b>${fmtTime(st.last.at)}</b><br>Next ${fmtTime(st.readyAt)} · <span data-countdown="${st.readyAt}">${fmtHM(st.readyAt - now + MIN - 1)}</span>`;
    const pct = st.ready || !st.last ? 100 : Math.min(100, Math.max(0, ((now - st.last.at) / (st.readyAt - st.last.at)) * 100));
    h += `<div class="med ${st.ready ? 'ready' : ''}">
      <span class="med-ico">${icons.pill}</span>
      <div class="med-info"><div class="med-name">${esc(med.name || 'Medicine')}</div><div class="med-when">${when}</div>
        <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div></div>
      <button class="med-btn" data-act="med" data-id="${esc(med.id)}" aria-label="Took ${esc(med.name)}">${st.ready ? 'Took it' : 'Log dose'}</button></div>`;
  }
  return h + '</section>';
}

function todayList(d, now) {
  const list = sorted(d).filter((e) => tOf(e) >= startOfDay(now) && (d.settings.showDiapers || e.type !== 'diaper'));
  return `<section class="card"><div class="card-head"><h2>Today</h2><span class="stat">${daySummary(list, d.settings.showDiapers)}</span></div>${timeline(list, d)}</section>`;
}

function pumpCard(d, now) {
  const np = nextPump(d, now);
  if (np.state === 'off') return '';
  const today = d.entries.filter((e) => e.type === 'pump' && e.end && e.start >= startOfDay(now));
  const oz = today.reduce((t, e) => t + (+e.oz || 0), 0);
  const head = `<div class="card-head"><h2>Pumping</h2><span class="stat">Today <b>${today.length}</b>${oz ? ` · <b>${+oz.toFixed(1)}</b> oz` : ''}</span></div>`;
  if (np.state === 'running') {
    const e = np.entry;
    return `<section class="card pump-card running-pump">${head}
      <div class="pump-run"><span class="pump-ico live">${icons.pump}</span>
        <div><div class="pump-clock" data-clock="${e.start}">${fmtClock(now - e.start)}</div><div class="pump-sub">Pumping since ${fmtTime(e.start)}</div></div></div>
      <div class="pump-actions"><button class="btn soft" data-act="pump-cancel">Cancel</button><button class="btn primary" data-act="pump-stop">${icons.stop} Done</button></div>
    </section>`;
  }
  const { plan } = pumpPlan(d.settings);
  const lastPump = np.last ? `Last pumped ${fmtTime(np.last.start)}${np.last.oz ? `, ${fmtOz(np.last.oz)}` : ''}` : 'No pumps logged yet';
  let big, sub, cls = '';
  if (np.state === 'due') {
    cls = 'due';
    big = 'Time to pump';
    sub = plan === 'combo'
      ? `<span data-ago="${np.lastAt}">${fmtHM(now - np.lastAt)}</span> since she last ${np.lastKind}`
      : np.last ? `It’s been <span data-ago="${np.last.start}">${fmtHM(now - np.last.start)}</span> since the last pump` : 'No pumps logged yet';
  } else if (np.state === 'later') {
    big = plan === 'combo' ? `Pump around ${fmtTime(np.at)}` : `Next pump around ${fmtTime(np.at)}`;
    sub = plan === 'combo' ? `if she doesn’t nurse before then · ${lastPump}` : `in <span data-countdown="${np.at}">${fmtHM(np.at - now + MIN - 1)}</span> · ${lastPump}`;
  } else {
    big = 'Ready when she is';
    sub = 'Tap Start pumping when she begins';
  }
  return `<section class="card pump-card ${cls}">${head}
    <div class="pump-status"><span class="pump-ico">${icons.pump}</span>
      <div><div class="pump-big">${big}</div><div class="pump-sub">${sub}</div></div></div>
    <button class="btn primary full pump-go" data-act="pump-start">${icons.pump} Start pumping</button>
    <div class="pump-links"><button class="text-btn" data-act="pump-log">${icons.plus} Log a past pump</button><button class="text-btn" data-act="pump-guide">Guide ${icons.chevron}</button></div>
  </section>`;
}

function renderHome(d) {
  const now = Date.now();
  const s = d.settings;
  // While she is pumping, the pump timer goes to the top where her thumb is.
  const pumping = d.entries.some((e) => e.type === 'pump' && !e.end);
  return header(d) + (pumping ? pumpCard(d, now) + feedCard(d, now) : feedCard(d, now) + pumpCard(d, now))
    + (s.showDiapers ? diaperCard(d, now) : '')
    + todaysNote(d)
    + (s.showMeds && s.meds.length ? medsCard(d, now) : '')
    + todayList(d, now);
}

function counts(list) {
  return {
    feeds: list.filter((e) => e.type === 'feed' && !e.attempt).length,
    attempts: list.filter((e) => e.type === 'feed' && e.attempt).length,
    bottles: list.filter((e) => e.type === 'bottle').length,
    pumps: list.filter((e) => e.type === 'pump' && e.end).length,
    pumpOz: +list.filter((e) => e.type === 'pump' && e.end).reduce((t, e) => t + (+e.oz || 0), 0).toFixed(1),
    wet: list.filter((e) => e.type === 'diaper' && (e.kind === 'wet' || e.kind === 'both')).length,
    dirty: list.filter((e) => e.type === 'diaper' && (e.kind === 'dirty' || e.kind === 'both')).length,
  };
}
function daySummary(list, showDiapers) {
  const c = counts(list);
  const parts = [`${c.feeds} feed${c.feeds === 1 ? '' : 's'}`];
  if (c.attempts) parts.push(`${c.attempts} attempt${c.attempts === 1 ? '' : 's'}`);
  if (c.bottles) parts.push(`${c.bottles} bottle${c.bottles === 1 ? '' : 's'}`);
  if (c.pumps) parts.push(`${c.pumps} pump${c.pumps === 1 ? '' : 's'}${c.pumpOz ? ` (${c.pumpOz} oz)` : ''}`);
  if (showDiapers) parts.push(`${c.wet} wet`, `${c.dirty} dirty`);
  return parts.join(' · ');
}

function renderHistory(d) {
  const groups = new Map();
  for (const e of sorted(d)) {
    if (!d.settings.showDiapers && e.type === 'diaper') continue;
    const k = startOfDay(tOf(e));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const keys = [...groups.keys()];
  let h = header(d, 'History', 'Every feed, day by day');
  if (!keys.length) return h + `<section class="card">${timeline([], d, 'Nothing logged yet')}</section>`;
  for (const k of keys.slice(0, ui.histDays)) {
    const list = groups.get(k);
    const c = counts(list);
    const n = babyDay(d.settings.birthday, k);
    const title = k === startOfDay(Date.now()) ? 'Today' : k === startOfDay(Date.now() - DAY) ? 'Yesterday' : fmtDate(k);
    const stat = (v, l, cls) => `<div class="mini ${cls}"><b>${v}</b><span>${l}</span></div>`;
    const dateTxt = title === 'Today' || title === 'Yesterday' ? new Date(k).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '';
    h += `<section class="card"><div class="card-head"><h2>${title}</h2><span class="stat">${[dateTxt, n && n > 0 ? `Day ${n}` : ''].filter(Boolean).join(' · ')}</span></div>
      <div class="minis ${d.settings.showDiapers ? '' : 'two'}">${stat(c.feeds, c.feeds === 1 ? 'feed' : 'feeds', 'f')}${stat(c.bottles || '–', c.bottles === 1 ? 'bottle' : 'bottles', 'b')}${d.settings.showDiapers ? stat(c.wet, 'wet', 'w') + stat(c.dirty, 'dirty', 'd') : ''}</div>
      ${c.pumps ? `<div class="pump-line">${icons.pump} Pumped ${c.pumps} time${c.pumps === 1 ? '' : 's'}${c.pumpOz ? ` · ${c.pumpOz} oz` : ''}</div>` : ''}
      ${timeline(list, d)}</section>`;
  }
  if (keys.length > ui.histDays) h += `<button class="btn soft full" data-act="more-history">Show earlier days</button>`;
  return h;
}

function pumpSettings(d) {
  const { plan, every, after } = pumpPlan(d.settings);
  const days = ageDays(d.settings.birthday);
  const band = bandFor(days);
  const seg = [['off', 'Off'], ['combo', 'Breast + pump'], ['exclusive', 'Only pumping']]
    .map(([v, l]) => `<button data-act="pump-plan" data-val="${v}" class="${plan === v ? 'on' : ''}">${l}</button>`).join('');
  let more = '';
  if (plan === 'combo') {
    more = `<div class="seg-label" style="margin-top:14px">Remind her to pump after</div>
      <div class="chips tight">${[2, 2.5, 3, 3.5, 4].map((v) => `<button data-act="pump-after" data-val="${v}" class="${after === v ? 'on' : ''}">${fmtHrs(v)}h</button>`).join('')}</div>
      <p class="hint">…with no breastfeed or pump. Nursing resets it. When Grace gets a bottle instead, pumping around then keeps her supply up.</p>`;
  }
  if (plan === 'exclusive') {
    more = `<div class="seg-label" style="margin-top:14px">How often</div>
      <div class="chips tight">${[[0, `Auto · ${fmtHrs(band.every)}h`], [2, '2h'], [2.5, '2½h'], [3, '3h'], [3.5, '3½h'], [4, '4h'], [5, '5h']]
        .map(([v, l]) => `<button data-act="pump-every" data-val="${v}" class="${every === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <p class="hint">Auto follows her age${days != null ? `. Right now (${band.label}): ${band.text}` : '. Add her birthday above to use it.'}</p>`;
  }
  return `<section class="card form"><div class="seg seg-pump">${seg}</div>${more}
    <button class="text-btn" data-act="pump-guide">Pumping guide ${icons.chevron}</button></section>`;
}

function renderSettings(d) {
  const s = d.settings;
  const tog = (key, label, ico) => `<label class="row"><span class="row-ico">${ico}</span><span class="row-label">${label}</span><input type="checkbox" class="switch" data-set="${key}" ${s[key] ? 'checked' : ''}></label>`;
  const statusText = {
    ok: 'Everything is saved and shared.', idle: 'Everything is saved and shared.',
    pending: 'Saving changes…', offline: 'Offline. Changes are kept on this phone and sync when you are back online.',
    auth: 'GitHub stopped accepting the access token (it may have expired). Disconnect, then connect again with a new token.',
  }[store.status];
  return `${header(d, 'Settings', 'Shared on both phones')}
  <div class="group-label">Baby</div>
  <section class="card form">
    <label class="field"><span>Name</span><input data-set="babyName" value="${esc(s.babyName)}" autocomplete="off" autocapitalize="words" placeholder="Baby's name"></label>
    <label class="field"><span>Birthday</span><input type="date" data-set="birthday" value="${esc(s.birthday)}"></label>
  </section>
  <div class="group-label">Show on Today</div>
  <section class="card list-card">
    ${tog('showDiapers', 'Diapers', icons.drop)}
    ${tog('showMeds', 'Medicine timer', icons.pill)}
    ${tog('showVerses', 'Verse of the day', icons.book)}
  </section>
  <div class="group-label">Pumping</div>
  ${pumpSettings(d)}
  <div class="group-label">Medicine</div>
  <section class="card form">
    <div class="med-edit head"><span>Name</span><span>Hours apart</span><span></span></div>
    ${s.meds.map((m) => `<div class="med-edit">
      <input class="inp" data-med="${esc(m.id)}" data-field="name" value="${esc(m.name)}" placeholder="Name">
      <input class="inp" data-med="${esc(m.id)}" data-field="hours" value="${esc(m.hours)}" inputmode="decimal" placeholder="6">
      <button class="x" data-act="del-med" data-id="${esc(m.id)}" aria-label="Remove ${esc(m.name)}">×</button></div>`).join('')}
    <button class="btn soft full" data-act="add-med">${icons.plus} Add medicine</button>
    <p class="hint">Follow the dosing her doctor gave. This is only a reminder.</p>
  </section>
  <div class="group-label">Notes for her</div>
  <section class="card list-card">
    <button class="row" data-act="tab" data-tab="messages"><span class="row-ico">${icons.heart}</span><span class="row-label">Write notes ahead of time<small>${ui.msgUnlocked ? `${d.messages.length} written${s.msgPin ? ' · locked with PIN' : ''}` : 'A little something each day'}</small></span>${icons.chevron}</button>
  </section>
  <div class="group-label">This phone</div>
  <section class="card form">
    <div class="seg-label">Appearance</div>
    <div class="seg">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button data-act="theme" data-val="${v}" class="${themePref() === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="hint">Auto goes dark from 9 pm to 6:30 am, and whenever the iPhone is in dark mode.</p>
  </section>
  ${pushSection()}
  <div class="group-label">Sync</div>
  <section class="card form">
    <p class="sync-text">${syncBadge(true)} ${statusText}</p>
    <button class="btn soft full" data-act="copy-setup">${icons.link} Copy setup code</button>
    <p class="hint">Text or AirDrop it, then paste it into Lil Chicken on the other iPhone. Treat it like a password.</p>
    <div class="danger-zone"><button class="btn ghost-danger full" data-act="disconnect">Disconnect this phone</button></div>
  </section>
  <div class="colophon">${chick('sleepy')}<p>Lil Chicken · version ${APP_VERSION}</p><p class="fine">${esc(NIV_NOTICE)}</p></div>`;
}

function renderMessages(d) {
  const s = d.settings;
  const back = `<button class="back" data-act="tab" data-tab="settings">${icons.back} Settings</button>`;
  if (s.msgPin && !ui.msgUnlocked) {
    return `${back}<section class="card lockcard">
      <div class="lock-ico">${icons.lock}</div><h2>Notes are locked</h2>
      <p class="hint">Enter the PIN to see and write notes.</p>
      <input id="pin" class="inp pin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN">
      <button class="btn primary full" data-act="unlock">Unlock</button>
      <div id="pin-err" class="err"></div></section>`;
  }
  const today = babyDay(s.birthday);
  const msgs = [...d.messages].sort((a, b) => a.day - b.day);
  let h = `${back}<header class="top plain"><div class="who"><h1>Notes for her</h1><div class="sub">${today ? `Today is Day ${today}` : 'Set the birthday in Settings first'}</div></div></header>`;
  h += `<button class="btn primary full" data-act="msg-new" style="margin-bottom:16px">${icons.plus} Write a note</button>`;
  if (!msgs.length) h += `<section class="card">${timeline([], d, 'No notes yet. Write one for tomorrow!')}</section>`;
  else {
    h += '<section class="card list-card">' + msgs.map((m) => {
      const when = s.birthday ? fmtShortDate(dateOfDay(s.birthday, m.day)) : '';
      const state = today && m.day < today ? 'shown' : today && m.day === today ? 'today' : 'upcoming';
      return `<button class="row note-row ${state}" data-act="msg-edit" data-id="${esc(m.id)}">
        <span class="day-badge"><b>${esc(m.day)}</b><small>${when}</small></span>
        <span class="row-label">${esc(m.text)}<small>${{ shown: 'Already shown', today: 'Showing today', upcoming: 'Coming up' }[state]}</small></span>${icons.chevron}</button>`;
    }).join('') + '</section>';
  }
  h += `<div class="group-label">Signed</div><section class="card form">
    <label class="field"><span>Sign notes as</span><input data-set="signOff" value="${esc(s.signOff || '')}" autocomplete="off" autocapitalize="words" placeholder="Your name (shows as “— love, …”)"></label></section>`;
  h += `<div class="group-label">Keep them a surprise</div><section class="card form">
    <p class="hint" style="margin-top:0">${s.msgPin ? 'This page is locked with a PIN.' : 'Add a PIN so this page stays locked on her phone.'}</p>
    <div class="pin-row"><input id="newpin" class="inp" inputmode="numeric" autocomplete="off" placeholder="${s.msgPin ? 'New PIN' : '4 digits'}">
    <button class="btn soft" data-act="set-pin">${s.msgPin ? 'Change' : 'Set PIN'}</button></div>
    ${s.msgPin ? '<button class="btn ghost-danger full" data-act="clear-pin">Remove PIN</button>' : ''}</section>`;
  return h;
}

function renderSetup() {
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  return `<div class="setup">
    <div class="setup-hero">${chick()}<h1>Lil Chicken</h1><p>Feeds, diapers and little notes,<br>shared between your two phones.</p></div>
    ${standalone ? '' : `<section class="card callout"><h2>First, add to Home Screen</h2>
      <p>In Safari, tap <b>Share</b> → <b>Add to Home Screen</b>. Then open Lil Chicken from your Home Screen and connect it there.</p></section>`}
    <section class="card form"><h2>Have a setup code?</h2>
      <label class="field"><span>Paste the code from the other phone</span><input id="code" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="MT1:…"></label>
      <button class="btn primary full" data-act="connect-code">Connect</button>
    </section>
    <section class="card form"><h2>Or set up with GitHub</h2>
      <label class="field"><span>Private data repo</span><input id="repo" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="yourname/maternity-data"></label>
      <label class="field"><span>Access token</span><input id="token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…"></label>
      <button class="btn soft full" data-act="connect">Connect</button>
    </section>
    <div class="err" id="setup-err">${esc(ui.setupError)}</div>
  </div>`;
}

function render() {
  const a = document.activeElement;
  if (a && $app.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox') { ui.pendingRender = true; return; }
  ui.pendingRender = false;
  if (!store.configured()) {
    $nav.hidden = true;
    $app.innerHTML = renderSetup();
    return;
  }
  const d = store.data;
  $nav.hidden = false;
  const navTab = ui.tab === 'messages' ? 'settings' : ui.tab;
  $nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === navTab));
  $app.innerHTML = { home: renderHome, history: renderHistory, settings: renderSettings, messages: renderMessages }[ui.tab](d);
}

// Live-updating times without redrawing everything.
let lastMedReady = null;
function tick() {
  if (!store.configured() || document.hidden) return;
  const now = Date.now();
  $app.querySelectorAll('[data-clock]').forEach((el) => { el.textContent = fmtClock(now - +el.dataset.clock); });
  $app.querySelectorAll('[data-ring]').forEach((el) => { el.style.setProperty('--p', ringPct(now - +el.dataset.ring) + '%'); });
  $app.querySelectorAll('[data-ago]').forEach((el) => { el.textContent = fmtHM(now - +el.dataset.ago); });
  $app.querySelectorAll('[data-countdown]').forEach((el) => { el.textContent = fmtHM(+el.dataset.countdown - now + MIN - 1); });
  const d = store.data;
  $app.querySelectorAll('[data-feedtotal]').forEach((el) => {
    const e = d.entries.find((x) => x.id === el.dataset.feedtotal);
    if (e) el.textContent = fmtHM(feedDur(e, now));
  });
  applyTheme();
  if (ui.tab === 'home') {
    const r = running(d);
    const readyKey = d.settings.meds.map((m) => medStatus(d, m, now).ready).join()
      + (r ? now - r.segs[r.segs.length - 1].a > 45 * MIN : '') + isNight() + nextPump(d, now).state;
    if (lastMedReady !== null && readyKey !== lastMedReady) render();
    lastMedReady = readyKey;
  }
}

// ---------- sheets & toast ----------
function openSheet(html) {
  hideToast();
  $sheet.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="grabber"></div>${html.replace('<h2>', '<h2 id="sheet-title">')}</div>`;
  $sheet.hidden = false;
  document.body.classList.add('locked');
}
function closeSheet() { $sheet.hidden = true; $sheet.innerHTML = ''; ui.form = {}; ui.confirmFn = null; document.body.classList.remove('locked'); }

// Swipe the sheet down to close it.
let drag = null;
$sheet.addEventListener('touchstart', (e) => {
  const sh = $sheet.querySelector('.sheet');
  if (!sh || sh.scrollTop > 0) return;
  drag = { y: e.touches[0].clientY, dy: 0, sh };
}, { passive: true });
$sheet.addEventListener('touchmove', (e) => {
  if (!drag) return;
  drag.dy = Math.max(0, e.touches[0].clientY - drag.y);
  drag.sh.style.transition = 'none';
  drag.sh.style.transform = `translateY(${drag.dy}px)`;
}, { passive: true });
$sheet.addEventListener('touchend', () => {
  if (!drag) return;
  const { sh, dy } = drag;
  drag = null;
  sh.style.transition = 'transform .2s ease-out';
  if (dy > 90) { sh.style.transform = 'translateY(100%)'; setTimeout(closeSheet, 180); } else sh.style.transform = '';
});

/** A themed replacement for confirm(). */
function confirmSheet({ title, body, ok, cancel = 'Cancel', danger = false, okFirst = false }, fn) {
  ui.confirmFn = fn;
  const okBtn = `<button class="btn ${danger ? 'ghost-danger' : okFirst ? 'primary' : 'soft'}" data-act="confirm-ok">${ok}</button>`;
  const cancelBtn = `<button class="btn ${okFirst || danger ? 'soft' : 'primary'}" data-act="close">${cancel}</button>`;
  openSheet(`<h2>${title}</h2><p class="sheet-body">${body}</p><div class="actions">${okFirst || danger ? okBtn + cancelBtn : cancelBtn + okBtn}</div>`);
}

/** Chip group helpers for quick-pick sheets. */
const chipGroup = (group, opts, sel) => `<div class="chips" data-group="${group}">${opts.map(([v, l]) =>
  `<button data-act="pick" data-group="${group}" data-val="${v}" class="${String(sel) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
$sheet.addEventListener('click', (e) => { if (e.target === $sheet) closeSheet(); });

let toastTimer, toastUndo;
function hideToast() { clearTimeout(toastTimer); $toast.hidden = true; toastUndo = null; }
// Tap the message itself (not Undo) to dismiss it right away.
$toast.addEventListener('click', (e) => { if (!e.target.closest('[data-act]')) hideToast(); });
function toast(text, undo, label = 'Undo') {
  clearTimeout(toastTimer);
  toastUndo = undo;
  $toast.innerHTML = `<span>${esc(text)}</span>${undo ? `<button data-act="undo">${label}</button>` : ''}`;
  $toast.hidden = false;
  toastTimer = setTimeout(hideToast, 4000);
}

function editSheet(e) {
  const d = store.data;
  let fields = '';
  if (e.type === 'feed') {
    const sides = feedSides(e).join('');
    const opt = (v, l) => `<option value="${v}" ${sides === v ? 'selected' : ''}>${l}</option>`;
    const knownSides = ['L', 'R', 'LR', 'RL'].includes(sides);
    ui.form = { fkind: e.attempt ? 'attempt' : 'feed' };
    fields = `${e.end ? `<div class="field"><span>What happened</span>${chipGroup('fkind', [['feed', 'Fed'], ['attempt', 'Attempt only']], ui.form.fkind)}</div>` : ''}${nudges('f-start')}<label class="field"><span>Started</span><input type="datetime-local" id="f-start" value="${toLocalInput(e.start)}"></label>
      ${e.end ? `<label class="field"><span>Length (minutes)</span><input id="f-len" inputmode="numeric" value="${Math.round(feedDur(e) / MIN)}"></label>
      <label class="field"><span>Sides</span><select id="f-sides">${opt('L', 'Left')}${opt('R', 'Right')}${opt('LR', 'Left, then Right')}${opt('RL', 'Right, then Left')}${knownSides ? '' : `<option value="" selected>Several switches (keep)</option>`}</select></label>` : ''}`;
  } else if (e.type === 'pump') {
    ui.form = { pside: e.side || 'both' };
    fields = `${nudges('f-start')}<label class="field"><span>Started</span><input type="datetime-local" id="f-start" value="${toLocalInput(e.start)}"></label>
      ${e.end ? `<label class="field"><span>Length (minutes)</span><input id="f-len" inputmode="numeric" value="${Math.round((e.end - e.start) / MIN)}"></label>
      <label class="field"><span>Amount (oz)</span><input id="f-oz" inputmode="decimal" value="${esc(e.oz || '')}"></label>
      <div class="field"><span>Sides</span>${chipGroup('pside', [['both', 'Both'], ['L', 'Left'], ['R', 'Right']], ui.form.pside)}</div>` : ''}`;
  } else {
    fields = `${nudges('f-at')}<label class="field"><span>Time</span><input type="datetime-local" id="f-at" value="${toLocalInput(e.at)}"></label>`;
    if (e.type === 'bottle') fields += `<label class="field"><span>Ounces</span><input id="f-oz" inputmode="decimal" value="${esc(e.oz || '')}"></label>`;
    if (e.type === 'diaper') {
      const o = (v, l) => `<option value="${v}" ${e.kind === v ? 'selected' : ''}>${l}</option>`;
      fields += `<label class="field"><span>Kind</span><select id="f-kind">${o('wet', 'Wet')}${o('dirty', 'Dirty')}${o('both', 'Wet + dirty')}</select></label>`;
    }
  }
  const title = e.attempt ? 'Feeding attempt' : { feed: 'Feed', bottle: 'Bottle', diaper: 'Diaper', med: 'Medicine', pump: 'Pumping' }[e.type];
  openSheet(`<h2>${title}</h2>${fields}
    <div class="actions">
      <button class="btn primary" data-act="save-edit" data-id="${esc(e.id)}">Save</button>
      <button class="btn soft" data-act="close">Cancel</button>
      <button class="btn ghost-danger" data-act="delete-entry" data-id="${esc(e.id)}">Delete</button>
    </div>`);
}

const nudges = (target) => `<div class="field"><span>Move time</span><div class="chips tight">${[-30, -15, -5, 5].map((m) =>
  `<button data-act="nudge" data-target="${target}" data-min="${m}">${m > 0 ? '+' : '−'}${Math.abs(m)}m</button>`).join('')}</div></div>`;

function buildSegs(start, lenMin, sides) {
  const len = Math.max(1, lenMin) * MIN;
  const list = sides.split('');
  const part = len / list.length;
  return list.map((s, i) => ({ s, a: Math.round(start + i * part), b: Math.round(start + (i + 1) * part) }));
}

function messageSheet(m) {
  const d = store.data;
  const today = babyDay(d.settings.birthday) || 1;
  const maxDay = d.messages.reduce((x, y) => Math.max(x, +y.day || 0), 0);
  const day = m ? m.day : Math.max(today, maxDay + 1);
  openSheet(`<h2>${m ? 'Edit note' : 'New note'}</h2>
    <label class="field"><span>Your note</span><textarea id="m-text" placeholder="I'm so proud of you…">${esc(m ? m.text : '')}</textarea></label>
    <label class="field"><span>Show on day</span><input id="m-day" inputmode="numeric" value="${esc(day)}"></label>
    <p class="hint" id="m-date"></p>
    <div class="actions">
      <button class="btn primary" data-act="msg-save" data-id="${m ? esc(m.id) : ''}">Save</button>
      <button class="btn soft" data-act="close">Cancel</button>
      ${m ? `<button class="btn ghost-danger" data-act="msg-del" data-id="${esc(m.id)}">Delete note</button>` : ''}
    </div>`);
  const upd = () => {
    const n = parseInt(document.getElementById('m-day').value, 10);
    const el = document.getElementById('m-date');
    el.textContent = d.settings.birthday && n > 0 ? `That's ${fmtDate(dateOfDay(d.settings.birthday, n))}.` : '';
  };
  document.getElementById('m-day').addEventListener('input', upd);
  upd();
}

function stopFeed(endAt, asAttempt = false) {
  const r = running(store.data);
  if (!r) return;
  const segs = r.segs.map((s) => ({ ...s }));
  const last = segs[segs.length - 1];
  last.b = Math.max(last.a, Math.min(endAt, Date.now()));
  const done = { ...r, segs, end: last.b };
  if (asAttempt) {
    done.attempt = true;
    store.put('entries', done);
    toast('Attempt saved. Try again soon, mama.', () => store.put('entries', r));
    return;
  }
  if (feedDur(done) < MIN) {
    store.del('entries', r.id);
    toast('Under a minute, not saved', () => store.put('entries', { ...done, attempt: true }), 'Save as attempt');
    return;
  }
  ui.hopUntil = Date.now() + 600;
  store.put('entries', done);
  toast(`Feed saved · ${fmtHM(feedDur(done))}. Nice work, mama.`, () => store.put('entries', r));
}

// ---------- theme (per phone) ----------
function themePref() { try { return localStorage.getItem('mt.theme') || 'auto'; } catch { return 'auto'; } }
function applyTheme() {
  const pref = themePref();
  const dark = pref === 'dark' || (pref === 'auto' && (matchMedia('(prefers-color-scheme: dark)').matches || isNight()));
  const t = dark ? 'dark' : 'light';
  if (document.documentElement.dataset.theme !== t) {
    document.documentElement.dataset.theme = t;
    document.querySelectorAll('meta[name=theme-color]').forEach((m) => { m.content = dark ? '#17120D' : '#FFF8EB'; m.removeAttribute('media'); });
  }
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// ---------- push notifications (per phone) ----------
const pushDefaults = { on: false, med: true, feed: true, feedHours: 3, forgotten: true, pump: true };
function pushPrefs() { try { return { ...pushDefaults, ...JSON.parse(localStorage.getItem('mt.push') || '{}') }; } catch { return { ...pushDefaults }; } }
function savePushPrefs(p) { try { localStorage.setItem('mt.push', JSON.stringify(p)); } catch {} }
function deviceId() {
  try {
    let id = localStorage.getItem('mt.device');
    if (!id) { id = 'd-' + crypto.getRandomValues(new Uint32Array(3)).join('-'); localStorage.setItem('mt.device', id); }
    return id;
  } catch { return 'd-unsaved'; }
}
function pushSupport() {
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if ('PushManager' in window && 'Notification' in window && 'serviceWorker' in navigator) return 'ok';
  return standalone ? 'old-ios' : 'not-home-screen';
}
async function pushPost(path, extra = {}) {
  const res = await fetch(PUSH_URL + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: deviceId(), repo: store.cfg.repo, token: store.cfg.token, ...extra }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `The notification sender answered ${res.status}.`);
  return j;
}
const b64uBytes = (str) => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)), (c) => c.charCodeAt(0));
async function pushRegister(p) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await (await fetch(PUSH_URL + '/vapid')).json();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(key) });
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await pushPost('/register', { subscription: sub.toJSON(), prefs: { med: p.med, feed: p.feed, feedHours: p.feedHours, forgotten: p.forgotten, pump: p.pump, tz } });
}
let pushSaveTimer;
function pushPrefsChanged(p) {
  savePushPrefs(p);
  render();
  if (!p.on) return;
  clearTimeout(pushSaveTimer);
  pushSaveTimer = setTimeout(() => pushRegister(p).then(() => toast('Notification settings saved')).catch((e) => toast(e.message)), 400);
}
function pushSection() {
  const p = pushPrefs();
  const sup = pushSupport();
  const tog = (key, label, ico, sub) => `<label class="row"><span class="row-ico">${ico}</span><span class="row-label">${label}<small>${sub}</small></span><input type="checkbox" class="switch" data-push="${key}" ${p[key] ? 'checked' : ''}></label>`;
  let body;
  if (PUSH_URL.startsWith('__')) body = '<p class="hint" style="margin:0">Notifications are being set up. Check back soon.</p>';
  else if (sup === 'not-home-screen') body = '<p class="hint" style="margin:0">Open Lil Chicken from your Home Screen to turn on notifications.</p>';
  else if (sup === 'old-ios') body = '<p class="hint" style="margin:0">Notifications need iOS 16.4 or newer. Update the iPhone in Settings → General → Software Update.</p>';
  else if (!p.on) body = `<p class="hint" style="margin:0 0 12px">Get a nudge on this phone when medicine is OK, when a feed is due, or if the timer was left running.</p>
    <button class="btn primary full" data-act="push-on">${icons.bell} Turn on notifications</button>`;
  else body = `<div class="list-in">
      ${tog('med', 'Medicine ready', icons.pill, 'When the next dose is OK')}
      ${tog('feed', 'Feed reminder', icons.clock, `${p.feedHours} hours after the last feed started`)}
      ${p.feed ? `<div class="chips tight hours">${[2, 2.5, 3, 3.5, 4].map((h) => `<button data-act="push-hours" data-val="${h}" class="${p.feedHours === h ? 'on' : ''}">${h}h</button>`).join('')}</div>` : ''}
      ${tog('forgotten', 'Forgotten timer', icons.egg, 'If a side runs 45 minutes')}
      ${pumpPlan(store.data.settings).plan !== 'off' ? tog('pump', 'Pump reminder', icons.pump, 'When it’s been a while without nursing or pumping') : ''}
    </div>
    <div class="push-actions"><button class="btn soft" data-act="push-test">Send a test</button><button class="btn ghost-danger" data-act="push-off">Turn off</button></div>`;
  return `<div class="group-label">Notifications · this phone</div><section class="card form">${body}</section>`;
}

// ---------- pumping sheets ----------
const OZ_CHIPS = [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['8', '8']];
function pumpAmountFields() {
  return `<div class="field"><span>How much? (oz, both sides together)</span>${chipGroup('poz', OZ_CHIPS.map(([v, l]) => [v, `${l} oz`]), '')}</div>
    <label class="field"><span>Or type an amount</span><input id="p-oz" inputmode="decimal" placeholder="e.g. 3.5"></label>
    <div class="field"><span>Sides</span>${chipGroup('pside', [['both', 'Both'], ['L', 'Left'], ['R', 'Right']], 'both')}</div>`;
}
function readPumpAmount() {
  const typed = document.getElementById('p-oz')?.value.trim().replace(',', '.');
  return typed || ui.form.poz || '';
}
function pumpGuideSheet() {
  const d = store.data;
  const days = ageDays(d.settings.birthday);
  const band = bandFor(days);
  openSheet(`<h2>Pumping guide</h2>
    <div class="guide">
      <h3>Exclusively pumping</h3>
      <ul class="bands">${AGE_BANDS.map((b) => `<li class="${days != null && b === band ? 'now' : ''}"><b>${b.label}</b><span>${b.text}</span>${days != null && b === band ? '<em>Grace now</em>' : ''}</li>`).join('')}</ul>
      <p>Each session usually takes about 15–20 minutes. Pumping both sides at once saves time.</p>
      <h3>Breastfeeding and pumping</h3>
      <p>Pumping some feeds can give sore nipples a rest. A newborn's milk needs to be removed about 8–12 times a day, so when Grace has a bottle instead of the breast, pumping around that time helps keep supply up. Many lactation experts suggest waiting until about 3–4 weeks to add regular extra pumping, since pumping a lot early can cause oversupply, but resting sore nipples is a good reason to pump sooner. If soreness continues, a lactation consultant can check her latch.</p>
      <h3>Storing milk</h3>
      <table class="storage">${STORAGE.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
      <p class="fine-print">General guidance for healthy, full-term babies from the CDC, the AAP (HealthyChildren.org), Solid Starts, Healthline and lactation sources. Every baby and body is different: her doctor or a lactation consultant can tailor this.</p>
    </div>
    <div class="actions"><button class="btn soft" data-act="close">Close</button></div>`);
}

// ---------- actions ----------
const actions = {
  tab: ({ tab }) => { ui.tab = tab; closeSheet(); render(); window.scrollTo(0, 0); },
  close: closeSheet,
  undo: () => { if (toastUndo) toastUndo(); $toast.hidden = true; toastUndo = null; },

  start: ({ side }) => {
    if (running(store.data)) return;
    const now = Date.now();
    const id = uid();
    store.put('entries', { id, type: 'feed', start: now, end: null, segs: [{ s: side, a: now, b: null }] });
    toast(`${sideName(side)} side started`, () => store.del('entries', id));
  },
  switch: () => {
    const r = running(store.data);
    if (!r) return;
    const now = Date.now();
    const segs = r.segs.map((s) => ({ ...s }));
    const cur = segs[segs.length - 1];
    cur.b = now;
    segs.push({ s: other(cur.s), a: now, b: null });
    store.put('entries', { ...r, segs });
  },
  stop: () => stopFeed(Date.now()),
  'stop-attempt': () => stopFeed(Date.now(), true),
  'stop-at': ({ min }) => {
    const r = running(store.data);
    if (r) stopFeed(r.segs[r.segs.length - 1].a + +min * MIN);
  },
  'still-going': ({ id }) => { ui.rescueOff[id] = true; render(); },
  diaper: ({ kind }) => {
    const e = { id: uid(), type: 'diaper', kind, at: Date.now() };
    ui.hopUntil = Date.now() + 600;
    store.put('entries', e);
    toast(`${{ wet: 'Wet', dirty: 'Dirty', both: 'Wet + dirty' }[kind]} diaper logged`, () => store.del('entries', e.id));
  },
  med: ({ id }) => {
    const d = store.data;
    const med = d.settings.meds.find((m) => m.id === id);
    if (!med) return;
    const st = medStatus(d, med, Date.now());
    const log = () => {
      const e = { id: uid(), type: 'med', medId: id, name: med.name, at: Date.now() };
      store.put('entries', e);
      toast(`${med.name} logged`, () => store.del('entries', e.id));
    };
    if (st.ready) return log();
    confirmSheet({
      title: 'A little early',
      body: `Last ${esc(med.name)} was at <b>${fmtTime(st.last.at)}</b>. Next dose is OK at <b>${fmtTime(st.readyAt)}</b>.`,
      ok: 'Log it anyway', cancel: 'Wait',
    }, log);
  },
  'confirm-ok': () => { const fn = ui.confirmFn; closeSheet(); if (fn) fn(); },
  pick: ({ group, val }, el) => {
    ui.form[group] = val;
    el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
    const other = document.getElementById(`${group}-other`);
    if (other) other.hidden = val !== 'other';
  },
  nudge: ({ target, min }) => {
    const el = document.getElementById(target);
    const t = fromLocalInput(el.value);
    if (t) el.value = toLocalInput(t + +min * MIN);
  },
  bottle: () => {
    ui.form = { bago: '0' };
    openSheet(`<h2>Bottle</h2>
      <div class="field"><span>When</span>${chipGroup('bago', [['0', 'Now'], ['15', '15m ago'], ['30', '30m ago'], ['60', '1h ago'], ['other', 'Other…']], '0')}</div>
      <label class="field" id="bago-other" hidden><span>Time</span><input type="datetime-local" id="b-at" value="${toLocalInput(Date.now())}"></label>
      <div class="field"><span>How much? Tap to save</span><div class="chips">${['1', '2', '3', '4', '5'].map((o) => `<button class="big-chip" data-act="bottle-oz" data-oz="${o}">${o} oz</button>`).join('')}</div></div>
      <label class="field"><span>Or another amount (oz)</span><input id="b-oz" inputmode="decimal"></label>
      <div class="actions"><button class="btn primary" data-act="bottle-oz">Save</button><button class="btn soft" data-act="close">Cancel</button></div>`);
  },
  'bottle-oz': ({ oz }) => {
    const amount = oz || document.getElementById('b-oz').value.trim();
    const ago = ui.form.bago || '0';
    const at = ago === 'other' ? (fromLocalInput(document.getElementById('b-at').value) || Date.now()) : Date.now() - +ago * MIN;
    const e = { id: uid(), type: 'bottle', oz: amount, at };
    store.put('entries', e);
    closeSheet();
    toast('Bottle logged', () => store.del('entries', e.id));
  },
  'past-feed': () => {
    const lf = store.data.entries.filter(isRealFeed).sort((a, b) => b.start - a.start)[0];
    const side = lf ? nextSide(lf) : 'L';
    ui.form = { pago: '30', plen: '15', psides: side, pkind: 'feed' };
    openSheet(`<h2>Add a past feed</h2>
      <div class="field"><span>What happened</span>${chipGroup('pkind', [['feed', 'Fed'], ['attempt', 'Attempt only']], 'feed')}</div>
      <div class="field"><span>Started</span>${chipGroup('pago', [['15', '15m ago'], ['30', '30m ago'], ['45', '45m ago'], ['60', '1h ago'], ['120', '2h ago'], ['other', 'Other…']], '30')}</div>
      <label class="field" id="pago-other" hidden><span>Start time</span><input type="datetime-local" id="p-start" value="${toLocalInput(Date.now() - 30 * MIN)}"></label>
      <div class="field"><span>How long</span>${chipGroup('plen', [['5', '5m'], ['10', '10m'], ['15', '15m'], ['20', '20m'], ['30', '30m']], '15')}</div>
      <div class="field"><span>Sides</span>${chipGroup('psides', [['L', 'Left'], ['R', 'Right'], ['LR', 'Left → Right'], ['RL', 'Right → Left']], side)}</div>
      <div class="actions"><button class="btn primary" data-act="save-past">Save feed</button><button class="btn soft" data-act="close">Cancel</button></div>`);
  },
  'save-past': () => {
    const f = ui.form;
    const start = f.pago === 'other' ? fromLocalInput(document.getElementById('p-start').value) : Date.now() - +f.pago * MIN;
    const len = +f.plen || 15;
    if (!start) return;
    const segs = buildSegs(start, len, f.psides || 'L');
    store.put('entries', { id: uid(), type: 'feed', start, end: segs[segs.length - 1].b, segs, ...(f.pkind === 'attempt' ? { attempt: true } : {}) });
    closeSheet();
    toast('Feed logged');
  },
  edit: ({ id }) => {
    const e = store.data.entries.find((x) => x.id === id);
    if (e) editSheet(e);
  },
  'save-edit': ({ id }) => {
    const e = store.data.entries.find((x) => x.id === id);
    if (!e) return closeSheet();
    const n = structuredClone(e);
    if (e.type === 'feed') {
      if (e.end) { if (ui.form.fkind === 'attempt') n.attempt = true; else delete n.attempt; }
      const start = fromLocalInput(document.getElementById('f-start').value);
      if (start) {
        const shift = start - e.start;
        n.start = start;
        n.segs = n.segs.map((s) => ({ s: s.s, a: s.a + shift, b: s.b == null ? null : s.b + shift }));
        if (n.end) n.end += shift;
      }
      if (e.end) {
        const len = parseInt(document.getElementById('f-len').value, 10);
        const sides = document.getElementById('f-sides').value;
        const changedLen = len && len !== Math.round(feedDur(e) / MIN);
        if (sides && (sides !== feedSides(e).join('') || changedLen)) {
          n.segs = buildSegs(n.start, len || Math.round(feedDur(e) / MIN), sides);
          n.end = n.segs[n.segs.length - 1].b;
        } else if (changedLen) {
          // Several switches: stretch the last side to fit the new length.
          const last = n.segs[n.segs.length - 1];
          last.b = Math.max(last.a + MIN, last.b + (len * MIN - feedDur(n)));
          n.end = last.b;
        }
      }
    } else if (e.type === 'pump') {
      const start = fromLocalInput(document.getElementById('f-start').value);
      const len = e.end ? (parseInt(document.getElementById('f-len').value, 10) || Math.round((e.end - e.start) / MIN)) : 0;
      if (start) n.start = start;
      if (e.end) {
        n.end = n.start + Math.max(1, len) * MIN;
        n.oz = document.getElementById('f-oz').value.trim().replace(',', '.');
        n.side = ui.form.pside || 'both';
      }
    } else {
      const at = fromLocalInput(document.getElementById('f-at').value);
      if (at) n.at = at;
      if (e.type === 'bottle') n.oz = document.getElementById('f-oz').value.trim();
      if (e.type === 'diaper') n.kind = document.getElementById('f-kind').value;
    }
    store.put('entries', n);
    closeSheet();
  },
  'delete-entry': ({ id }) => {
    const e = store.data.entries.find((x) => x.id === id);
    if (!e) return closeSheet();
    store.del('entries', id);
    closeSheet();
    toast('Deleted', () => store.put('entries', e));
  },
  'more-history': () => { ui.histDays += 14; render(); },
  earlier: () => {
    const d = store.data;
    const today = babyDay(d.settings.birthday);
    const list = d.messages.filter((m) => +m.day < today).sort((a, b) => b.day - a.day);
    openSheet(`<h2>Earlier notes</h2>${list.map((m) => `<div class="card note" style="box-shadow:none">
      <div class="hint" style="margin:0 0 6px">Day ${esc(m.day)}${d.settings.birthday ? ` · ${fmtShortDate(dateOfDay(d.settings.birthday, m.day))}` : ''}</div>
      <p class="msg">${esc(m.text)}</p></div>`).join('')}
      <div class="actions"><button class="btn" data-act="close">Close</button></div>`);
  },

  // settings
  'add-med': () => {
    const meds = [...store.data.settings.meds, { id: uid(), name: '', hours: 6 }];
    store.set({ meds });
    render();
  },
  'del-med': ({ id }) => {
    const med = store.data.settings.meds.find((m) => m.id === id);
    const go = () => { store.set({ meds: store.data.settings.meds.filter((m) => m.id !== id) }); render(); };
    if (!med || !med.name) return go();
    confirmSheet({ title: `Remove ${esc(med.name)}?`, body: 'Its timer disappears from Today. Doses already logged stay in History.', ok: 'Remove', danger: true }, go);
  },
  'copy-setup': async () => {
    const code = store.setupCode();
    try {
      await navigator.clipboard.writeText(code);
      toast('Setup code copied');
    } catch {
      openSheet(`<h2>Setup code</h2><label class="field"><span>Copy this</span><textarea readonly>${esc(code)}</textarea></label>
        <div class="actions"><button class="btn" data-act="close">Done</button></div>`);
    }
  },
  disconnect: () => {
    confirmSheet({ title: 'Disconnect this phone?', body: 'Your data stays safe in GitHub. You can reconnect with the setup code from the other phone.', ok: 'Disconnect', danger: true }, () => {
      store.disconnect();
      ui.tab = 'home';
      render();
    });
  },
  'push-on': () => {
    // Ask right away: iOS only shows the permission prompt straight from a tap.
    Notification.requestPermission().then(async (perm) => {
      if (perm !== 'granted') { toast('Notifications are off for Lil Chicken. Turn them on in iPhone Settings → Notifications.'); return; }
      const p = { ...pushPrefs(), on: true };
      try { await pushRegister(p); savePushPrefs(p); render(); toast('Notifications are on'); }
      catch (e) { toast(e.message || 'Could not turn on notifications.'); }
    });
  },
  'push-hours': ({ val }) => pushPrefsChanged({ ...pushPrefs(), feedHours: +val }),
  'push-test': async () => {
    try { await pushPost('/test'); toast('Test sent. It should arrive in a few seconds.'); }
    catch (e) { toast(e.message); }
  },
  'push-off': async () => {
    const p = { ...pushPrefs(), on: false };
    savePushPrefs(p);
    render();
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      await pushPost('/unregister');
    } catch {}
    toast('Notifications are off on this phone');
  },
  'pump-start': () => {
    if (store.data.entries.some((e) => e.type === 'pump' && !e.end)) return;
    const id = uid();
    store.put('entries', { id, type: 'pump', start: Date.now(), end: null, side: 'both' });
    toast('Pumping started', () => store.del('entries', id));
  },
  'pump-cancel': () => {
    const r = store.data.entries.find((e) => e.type === 'pump' && !e.end);
    if (!r) return;
    store.del('entries', r.id);
    toast('Pumping cancelled', () => store.put('entries', r));
  },
  'pump-stop': () => {
    const r = store.data.entries.find((e) => e.type === 'pump' && !e.end);
    if (!r) return;
    const end = Date.now();
    ui.form = { poz: '', pside: 'both' };
    ui.pumpStop = { id: r.id, end };
    openSheet(`<h2>How much did you pump?</h2><p class="sheet-body">${fmtHM(end - r.start)} session, started at ${fmtTime(r.start)}.</p>${pumpAmountFields()}
      <div class="actions"><button class="btn primary" data-act="pump-save-run">Save</button><button class="btn soft" data-act="pump-save-run" data-skip="1">Save without amount</button></div>`);
  },
  'pump-save-run': ({ skip }) => {
    const r = store.data.entries.find((e) => e.id === ui.pumpStop?.id);
    if (!r) return closeSheet();
    const done = { ...r, end: ui.pumpStop.end, oz: skip ? '' : readPumpAmount(), side: ui.form.pside || 'both' };
    closeSheet();
    ui.hopUntil = Date.now() + 600;
    store.put('entries', done);
    toast(`Pump saved${done.oz ? ` · ${fmtOz(done.oz)}` : ''}`, () => store.put('entries', r));
  },
  'pump-log': () => {
    ui.form = { pago: '0', plen: '15', poz: '', pside: 'both' };
    openSheet(`<h2>Log a pump</h2>
      <div class="field"><span>Finished</span>${chipGroup('pago', [['0', 'Just now'], ['30', '30m ago'], ['60', '1h ago'], ['120', '2h ago'], ['other', 'Other…']], '0')}</div>
      <label class="field" id="pago-other" hidden><span>Start time</span><input type="datetime-local" id="pl-start" value="${toLocalInput(Date.now() - 20 * MIN)}"></label>
      <div class="field"><span>How long</span>${chipGroup('plen', [['10', '10m'], ['15', '15m'], ['20', '20m'], ['30', '30m']], '15')}</div>
      ${pumpAmountFields()}
      <div class="actions"><button class="btn primary" data-act="pump-save-log">Save</button><button class="btn soft" data-act="close">Cancel</button></div>`);
  },
  'pump-save-log': () => {
    const f = ui.form;
    const len = (+f.plen || 15) * MIN;
    // The time chips say when she finished; "Other…" asks for the start time.
    const start = f.pago === 'other' ? fromLocalInput(document.getElementById('pl-start').value) : Date.now() - (+f.pago || 0) * MIN - len;
    if (!start) return;
    const e = { id: uid(), type: 'pump', start, end: start + len, oz: readPumpAmount(), side: f.pside || 'both' };
    closeSheet();
    ui.hopUntil = Date.now() + 600;
    store.put('entries', e);
    toast(`Pump logged${e.oz ? ` · ${fmtOz(e.oz)}` : ''}`, () => store.del('entries', e.id));
  },
  'pump-guide': () => pumpGuideSheet(),
  'pump-plan': ({ val }) => { store.set({ pump: { ...pumpPlan(store.data.settings), plan: val } }); render(); },
  'pump-after': ({ val }) => { store.set({ pump: { ...pumpPlan(store.data.settings), after: +val } }); render(); },
  'pump-every': ({ val }) => { store.set({ pump: { ...pumpPlan(store.data.settings), every: +val } }); render(); },
  theme: ({ val }) => {
    try { localStorage.setItem('mt.theme', val); } catch {}
    applyTheme();
    render();
  },

  // messages
  unlock: () => {
    if (document.getElementById('pin').value === store.data.settings.msgPin) {
      ui.msgUnlocked = true;
      render();
    } else {
      document.getElementById('pin-err').textContent = 'That PIN is not right.';
    }
  },
  'set-pin': () => {
    const pin = document.getElementById('newpin').value.trim();
    if (!pin) return;
    store.set({ msgPin: pin });
    ui.msgUnlocked = true;
    render();
    toast('PIN set');
  },
  'clear-pin': () => { store.set({ msgPin: '' }); render(); toast('PIN removed'); },
  'msg-new': () => messageSheet(null),
  'msg-edit': ({ id }) => messageSheet(store.data.messages.find((m) => m.id === id)),
  'msg-save': ({ id }) => {
    const text = document.getElementById('m-text').value.trim();
    const day = parseInt(document.getElementById('m-day').value, 10);
    if (!text || !(day > 0)) return;
    store.put('messages', { id: id || uid(), day, text });
    closeSheet();
    render();
    toast('Note saved');
  },
  'msg-del': ({ id }) => {
    confirmSheet({ title: 'Delete this note?', body: 'This can’t be undone.', ok: 'Delete note', danger: true }, () => {
      store.del('messages', id);
      render();
    });
  },

  // setup
  connect: async () => {
    await doConnect(document.getElementById('repo').value, document.getElementById('token').value);
  },
  'connect-code': async () => {
    const raw = document.getElementById('code').value.trim();
    if (/^(github_pat_|ghp_)/.test(raw)) {
      // A GitHub token pasted in the wrong box: move it to where it belongs.
      document.getElementById('token').value = raw;
      document.getElementById('code').value = '';
      const repo = document.getElementById('repo');
      if (!repo.value) repo.value = 'mlanning200/maternity-data';
      showSetupError('That was a GitHub token, so it was moved to the GitHub section below. Check the repo name and tap Connect there.');
      return;
    }
    const parsed = Store.parseSetupCode(raw);
    if (!parsed) {
      showSetupError(raw
        ? `That setup code does not look right. It should start with MT1: (this starts with "${raw.slice(0, 6)}…"). Copy it again from the other phone, or use the GitHub section below.`
        : 'Paste the setup code first.');
      return;
    }
    await doConnect(parsed.repo, parsed.token);
  },
};

function showSetupError(msg) {
  ui.setupError = msg;
  const el = document.getElementById('setup-err');
  if (el) el.textContent = msg;
}
async function doConnect(repo, token) {
  showSetupError('Connecting…');
  try {
    await store.connect(repo, token);
    ui.setupError = '';
    ui.tab = store.data.settings.babyName ? 'home' : 'settings';
    document.activeElement?.blur();
    render();
  } catch (e) {
    showSetupError(e.message);
  }
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) { ev.preventDefault(); fn(el.dataset, el); }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.set) {
    const key = el.dataset.set;
    const value = el.type === 'checkbox' ? el.checked : el.value.trim();
    if (store.data.settings[key] !== value) store.set({ [key]: value });
  } else if (el.dataset.push) {
    pushPrefsChanged({ ...pushPrefs(), [el.dataset.push]: el.checked });
  } else if (el.dataset.med) {
    const meds = store.data.settings.meds.map((m) => {
      if (m.id !== el.dataset.med) return m;
      const v = el.value.trim();
      return { ...m, [el.dataset.field]: el.dataset.field === 'hours' ? (parseFloat(v) || 0) : v };
    });
    store.set({ meds });
  }
});

$app.addEventListener('focusout', () => {
  setTimeout(() => { if (ui.pendingRender) render(); }, 0);
});

// On Settings/Notes, a save must not redraw the page under her thumb (it would steal the
// field she just tapped). Only the sync badge updates there; explicit actions re-render.
store.onChange(() => {
  if (store.configured() && (ui.tab === 'settings' || ui.tab === 'messages')) {
    const b = $app.querySelector('.sync');
    if (b) b.outerHTML = syncBadge();
    return;
  }
  render();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { store.pull(); render(); checkForUpdate(); } });

// iPhone keeps a Home Screen app alive in the background, so a new version would not load until
// the app is closed. Whenever the app comes back, ask GitHub for the current version number and
// reload onto it if it changed (but never while she is typing or has a sheet open).
let lastUpdateCheck = 0;
async function checkForUpdate() {
  if (Date.now() - lastUpdateCheck < 60 * 1000) return;
  lastUpdateCheck = Date.now();
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    const { v } = await res.json();
    if (!v || v === APP_VERSION) return;
    const a = document.activeElement;
    const busy = (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox') || !$sheet.hidden;
    if (!busy) location.reload();
  } catch {}
}
setTimeout(checkForUpdate, 3000);
window.addEventListener('online', () => store.pull());
setInterval(tick, 1000);
setInterval(() => { if (!document.hidden) store.pull(); }, 15000);

render();
store.pull();

// Updates: check for a new version every time the app comes to the front, and when one
// takes over, reload so it is used right away (waiting if she is typing).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloadWanted = false;
  const reloadIfIdle = () => {
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox') return;
    if ($sheet.hidden === false) return;
    location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadWanted) return;
    reloadWanted = true;
    reloadIfIdle();
  });
  document.addEventListener('focusout', () => { if (reloadWanted) setTimeout(reloadIfIdle, 300); });
  document.addEventListener('click', () => { if (reloadWanted) setTimeout(reloadIfIdle, 300); });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}
