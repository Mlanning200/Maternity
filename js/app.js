import { Store } from './store.js';
import { VERSES, NIV_NOTICE } from './verses.js';
import { chick, icons } from './art.js';

const store = new Store();
const ui = { tab: 'home', msgUnlocked: false, histDays: 14, pendingRender: false, setupError: '' };
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');
$nav.innerHTML = [['home', 'egg', 'Today'], ['history', 'calendar', 'History'], ['settings', 'settings', 'Settings']]
  .map(([t, i, l]) => `<button data-act="tab" data-tab="${t}">${icons[i]}<span>${l}</span></button>`).join('');

const APP_VERSION = '2.0';
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

const tOf = (e) => (e.type === 'feed' ? e.start : e.at);
const feedDur = (e, now = Date.now()) => e.segs.reduce((sum, s) => sum + ((s.b ?? now) - s.a), 0);
const lastSide = (e) => e.segs[e.segs.length - 1].s;
const running = (d) => d.entries.find((e) => e.type === 'feed' && !e.end);
const sorted = (d) => [...d.entries].sort((a, b) => tOf(b) - tOf(a));
const feedSides = (e) => e.segs.map((s) => s.s).filter((s, i, a) => i === 0 || a[i - 1] !== s);

const KIND = { wet: 'Wet diaper', dirty: 'Dirty diaper', both: 'Wet + dirty' };

function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 5 || h >= 22) return 'Night shift';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** One row of the activity timeline. */
function row(e, d) {
  let icon, title, meta = '';
  if (e.type === 'feed') {
    const sides = feedSides(e);
    icon = `<span class="tl-ico egg-ico ${lastSide(e)}">${sides.length > 1 ? sides.join('') : sides[0]}</span>`;
    title = sides.map(sideName).join(' → ');
    meta = e.end ? `${fmtHM(feedDur(e))} · ${e.segs.map((s) => `${s.s} ${fmtHM((s.b ?? Date.now()) - s.a)}`).join(', ')}` : '<span class="live">Feeding now</span>';
  } else if (e.type === 'bottle') {
    icon = `<span class="tl-ico bottle">${icons.bottle}</span>`;
    title = 'Bottle';
    meta = e.oz ? `${esc(e.oz)} oz` : '';
  } else if (e.type === 'diaper') {
    icon = `<span class="tl-ico diaper ${e.kind}">${icons[e.kind === 'wet' ? 'drop' : e.kind === 'dirty' ? 'dirty' : 'both']}</span>`;
    title = KIND[e.kind] || 'Diaper';
  } else if (e.type === 'med') {
    const med = d.settings.meds.find((m) => m.id === e.medId);
    icon = `<span class="tl-ico med">${icons.pill}</span>`;
    title = esc(med ? med.name : e.name || 'Medicine');
  }
  return `<li><button class="tl-row" data-act="edit" data-id="${esc(e.id)}">
    ${icon}<span class="tl-body"><span class="tl-title">${title}</span>${meta ? `<span class="tl-meta">${meta}</span>` : ''}</span>
    <span class="tl-time">${fmtTime(tOf(e))}</span></button></li>`;
}

function timeline(list, d, emptyText = 'Nothing logged yet today') {
  if (!list.length) return `<div class="empty">${chick('sleepy', 'empty-chick')}<p>${emptyText}</p></div>`;
  return `<ul class="timeline">${list.map((e) => row(e, d)).join('')}</ul>`;
}

// The ring fills over 20 minutes on the current side.
const ringPct = (ms) => Math.min(100, (ms / (20 * MIN)) * 100).toFixed(2);

// ---------- rendering ----------
function syncBadge() {
  const s = store.status;
  const label = { ok: 'Synced', idle: 'Synced', pending: 'Saving', offline: 'Offline', auth: 'Reconnect' }[s];
  return `<button class="sync ${s}" data-act="tab" data-tab="settings" aria-label="Sync: ${label}"><i></i><span>${label}</span></button>`;
}

function header(d, title, sub) {
  const s = d.settings;
  return `<header class="top">
    <div class="avatar">${chick()}</div>
    <div class="who"><div class="eyebrow">${title ? '' : greeting()}</div>
      <h1>${esc(title || s.babyName || 'Lil Chicken')}</h1>
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
    h += `<div class="note-label">${icons.heart} A note for you</div>`;
    for (const m of msgs) h += `<p class="msg">${esc(m.text)}</p>`;
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
      <div class="run-top"><span class="run-dot"></span>Feeding on the ${sideName(seg.s).toLowerCase()}</div>
      <div class="ring" data-ring="${seg.a}" style="--p:${ringPct(now - seg.a)}%"><div class="ring-inner">
        <div class="clock" data-clock="${seg.a}">${fmtClock(now - seg.a)}</div>
        <div class="run-total">total <span data-feedtotal="${r.id}">${fmtHM(feedDur(r, now))}</span> · since ${fmtTime(r.start)}</div>
      </div></div>
      <div class="run-actions">
        <button class="btn soft ${other(seg.s)}" data-act="switch">Switch to ${sideName(other(seg.s))}</button>
        <button class="btn primary" data-act="stop">${icons.stop} Done</button>
      </div>
    </section>`;
  }
  const feeds = d.entries.filter((e) => e.type === 'feed' && e.end).sort((a, b) => b.start - a.start);
  const bottles = d.entries.filter((e) => e.type === 'bottle').sort((a, b) => b.at - a.at);
  const lf = feeds[0], lb = bottles[0];
  const lastAny = Math.max(lf ? lf.start : 0, lb ? lb.at : 0);
  const next = lf ? other(lastSide(lf)) : null;
  let since;
  if (!lastAny) {
    since = `<div class="since"><div class="eyebrow">Ready when you are</div><div class="since-empty">Tap a side to start the first feed</div></div>`;
  } else {
    const isFeed = lf && lf.start === lastAny;
    const meta = isFeed
      ? `<span class="chip ${lastSide(lf)}">Ended ${sideName(lastSide(lf))}</span><span>${fmtTime(lf.start)} · ${fmtHM(feedDur(lf))}</span>`
      : `<span class="chip">Bottle</span><span>${fmtTime(lb.at)}${lb.oz ? ` · ${esc(lb.oz)} oz` : ''}</span>`;
    since = `<div class="since"><div class="eyebrow">Last feed started</div>
      <div class="big"><span data-ago="${lastAny}">${fmtHM(now - lastAny)}</span><small>ago</small></div>
      <div class="since-meta">${meta}</div></div>`;
  }
  const egg = (s) => `<button class="egg ${s} ${next === s ? 'next' : ''}" data-act="start" data-side="${s}">
      ${next === s ? '<span class="next-tag">Next</span>' : ''}
      <span class="egg-letter">${s}</span><span class="egg-name">${sideName(s)}</span></button>`;
  return `<section class="card hero">
    ${since}
    <div class="eggs">${egg('L')}${egg('R')}</div>
    <div class="quick">
      <button data-act="bottle">${icons.bottle}<span>Bottle</span></button>
      <button data-act="past-feed">${icons.clock}<span>Add past feed</span></button>
    </div>
  </section>`;
}

function diaperCard(d, now) {
  const today = d.entries.filter((e) => e.type === 'diaper' && e.at >= startOfDay(now));
  const wet = today.filter((e) => e.kind === 'wet' || e.kind === 'both').length;
  const dirty = today.filter((e) => e.kind === 'dirty' || e.kind === 'both').length;
  return `<section class="card">
    <div class="card-head"><h2>Diapers</h2><span class="stat"><b>${wet}</b> wet · <b>${dirty}</b> dirty today</span></div>
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
      ? `<span class="ok">OK to take now</span>${st.last ? ` · last at ${fmtTime(st.last.at)}` : ''}`
      : `Next <b>${fmtTime(st.readyAt)}</b> · in <span data-countdown="${st.readyAt}">${fmtHM(st.readyAt - now + MIN - 1)}</span>`;
    const pct = st.ready || !st.last ? 100 : Math.min(100, Math.max(0, ((now - st.last.at) / (st.readyAt - st.last.at)) * 100));
    h += `<div class="med ${st.ready ? 'ready' : ''}">
      <span class="med-ico">${icons.pill}</span>
      <div class="med-info"><div class="med-name">${esc(med.name || 'Medicine')}</div><div class="med-when">${when}</div>
        <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div></div>
      <button class="med-btn" data-act="med" data-id="${esc(med.id)}">Took it</button></div>`;
  }
  return h + '</section>';
}

function todayList(d, now) {
  const list = sorted(d).filter((e) => tOf(e) >= startOfDay(now) && (d.settings.showDiapers || e.type !== 'diaper'));
  return `<section class="card"><div class="card-head"><h2>Today</h2><span class="stat">${daySummary(list, d.settings.showDiapers)}</span></div>${timeline(list, d)}</section>`;
}

function renderHome(d) {
  const now = Date.now();
  const s = d.settings;
  return header(d) + feedCard(d, now) + todaysNote(d)
    + (s.showDiapers ? diaperCard(d, now) : '')
    + (s.showMeds && s.meds.length ? medsCard(d, now) : '')
    + todayList(d, now);
}

function counts(list) {
  return {
    feeds: list.filter((e) => e.type === 'feed').length,
    bottles: list.filter((e) => e.type === 'bottle').length,
    wet: list.filter((e) => e.type === 'diaper' && (e.kind === 'wet' || e.kind === 'both')).length,
    dirty: list.filter((e) => e.type === 'diaper' && (e.kind === 'dirty' || e.kind === 'both')).length,
  };
}
function daySummary(list, showDiapers) {
  const c = counts(list);
  const parts = [`${c.feeds} feed${c.feeds === 1 ? '' : 's'}`];
  if (c.bottles) parts.push(`${c.bottles} bottle${c.bottles === 1 ? '' : 's'}`);
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
    h += `<section class="card"><div class="card-head"><h2>${title}</h2><span class="stat">${n && n > 0 ? `Day ${n}` : ''}</span></div>
      <div class="minis">${stat(c.feeds, c.feeds === 1 ? 'feed' : 'feeds', 'f')}${c.bottles ? stat(c.bottles, c.bottles === 1 ? 'bottle' : 'bottles', 'b') : ''}${d.settings.showDiapers ? stat(c.wet, 'wet', 'w') + stat(c.dirty, 'dirty', 'd') : ''}</div>
      ${timeline(list, d)}</section>`;
  }
  if (keys.length > ui.histDays) h += `<button class="btn soft full" data-act="more-history">Show earlier days</button>`;
  return h;
}

function renderSettings(d) {
  const s = d.settings;
  const tog = (key, label, ico) => `<label class="row"><span class="row-ico">${ico}</span><span class="row-label">${label}</span><input type="checkbox" class="switch" data-set="${key}" ${s[key] ? 'checked' : ''}></label>`;
  const statusText = {
    ok: 'Everything is saved and shared.', idle: 'Everything is saved and shared.',
    pending: 'Saving changes…', offline: 'Offline. Changes are kept on this phone and sync when you are back online.',
    auth: 'GitHub stopped accepting the access token (it may have expired). Disconnect, then connect again with a new token.',
  }[store.status];
  return `${header(d, 'Settings', 'Shared between both phones')}
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
    <button class="row" data-act="tab" data-tab="messages"><span class="row-ico">${icons.heart}</span><span class="row-label">Write notes ahead of time<small>${d.messages.length} written${s.msgPin ? ' · locked with PIN' : ''}</small></span>${icons.chevron}</button>
  </section>
  <div class="group-label">Sync</div>
  <section class="card form">
    <p class="sync-text">${syncBadge()} ${statusText}</p>
    <button class="btn soft full" data-act="copy-setup">${icons.link} Copy setup code for the other phone</button>
    <p class="hint">Text or AirDrop it, then paste it into Lil Chicken on the other iPhone. Treat it like a password.</p>
    <button class="btn ghost-danger full" data-act="disconnect">Disconnect this phone</button>
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
  if (ui.tab === 'home') {
    const readyKey = d.settings.meds.map((m) => medStatus(d, m, now).ready).join();
    if (lastMedReady !== null && readyKey !== lastMedReady) render();
    lastMedReady = readyKey;
  }
}

// ---------- sheets & toast ----------
function openSheet(html) {
  $sheet.innerHTML = `<div class="sheet" role="dialog"><div class="grabber"></div>${html}</div>`;
  $sheet.hidden = false;
}
function closeSheet() { $sheet.hidden = true; $sheet.innerHTML = ''; }
$sheet.addEventListener('click', (e) => { if (e.target === $sheet) closeSheet(); });

let toastTimer, toastUndo;
function toast(text, undo) {
  clearTimeout(toastTimer);
  toastUndo = undo;
  $toast.innerHTML = `<span>${esc(text)}</span>${undo ? '<button data-act="undo">Undo</button>' : ''}`;
  $toast.hidden = false;
  toastTimer = setTimeout(() => { $toast.hidden = true; toastUndo = null; }, 5000);
}

function editSheet(e) {
  const d = store.data;
  let fields = '';
  if (e.type === 'feed') {
    const sides = feedSides(e).join('');
    const opt = (v, l) => `<option value="${v}" ${sides === v ? 'selected' : ''}>${l}</option>`;
    const knownSides = ['L', 'R', 'LR', 'RL'].includes(sides);
    fields = `<label class="field"><span>Started</span><input type="datetime-local" id="f-start" value="${toLocalInput(e.start)}"></label>
      ${e.end ? `<label class="field"><span>Length (minutes)</span><input id="f-len" inputmode="numeric" value="${Math.round(feedDur(e) / MIN)}"></label>
      <label class="field"><span>Sides</span><select id="f-sides">${opt('L', 'Left')}${opt('R', 'Right')}${opt('LR', 'Left, then Right')}${opt('RL', 'Right, then Left')}${knownSides ? '' : `<option value="" selected>Several switches (keep)</option>`}</select></label>` : ''}`;
  } else {
    fields = `<label class="field"><span>Time</span><input type="datetime-local" id="f-at" value="${toLocalInput(e.at)}"></label>`;
    if (e.type === 'bottle') fields += `<label class="field"><span>Ounces</span><input id="f-oz" inputmode="decimal" value="${esc(e.oz || '')}"></label>`;
    if (e.type === 'diaper') {
      const o = (v, l) => `<option value="${v}" ${e.kind === v ? 'selected' : ''}>${l}</option>`;
      fields += `<label class="field"><span>Kind</span><select id="f-kind">${o('wet', 'Wet')}${o('dirty', 'Dirty')}${o('both', 'Wet + dirty')}</select></label>`;
    }
  }
  const title = { feed: 'Feed', bottle: 'Bottle', diaper: 'Diaper', med: 'Medicine' }[e.type];
  openSheet(`<h2>${title}</h2>${fields}
    <div class="actions">
      <button class="btn primary" data-act="save-edit" data-id="${esc(e.id)}">Save</button>
      <button class="btn danger" data-act="delete-entry" data-id="${esc(e.id)}">Delete</button>
      <button class="btn" data-act="close">Cancel</button>
    </div>`);
}

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
      ${m ? `<button class="btn danger" data-act="msg-del" data-id="${esc(m.id)}">Delete</button>` : ''}
      <button class="btn" data-act="close">Cancel</button>
    </div>`);
  const upd = () => {
    const n = parseInt(document.getElementById('m-day').value, 10);
    const el = document.getElementById('m-date');
    el.textContent = d.settings.birthday && n > 0 ? `That's ${fmtDate(dateOfDay(d.settings.birthday, n))}.` : '';
  };
  document.getElementById('m-day').addEventListener('input', upd);
  upd();
}

// ---------- actions ----------
const actions = {
  tab: ({ tab }) => { ui.tab = tab; closeSheet(); render(); window.scrollTo(0, 0); },
  close: closeSheet,
  undo: () => { if (toastUndo) toastUndo(); $toast.hidden = true; toastUndo = null; },

  start: ({ side }) => {
    if (running(store.data)) return;
    const now = Date.now();
    store.put('entries', { id: uid(), type: 'feed', start: now, end: null, segs: [{ s: side, a: now, b: null }] });
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
  stop: () => {
    const r = running(store.data);
    if (!r) return;
    const now = Date.now();
    const segs = r.segs.map((s) => ({ ...s }));
    segs[segs.length - 1].b = now;
    const done = { ...r, segs, end: now };
    store.put('entries', done);
    toast(`Feed saved · ${fmtHM(feedDur(done))}`, () => store.put('entries', r));
  },
  diaper: ({ kind }) => {
    const e = { id: uid(), type: 'diaper', kind, at: Date.now() };
    store.put('entries', e);
    toast(`${{ wet: 'Wet', dirty: 'Dirty', both: 'Wet + dirty' }[kind]} diaper logged`, () => store.del('entries', e.id));
  },
  med: ({ id }) => {
    const d = store.data;
    const med = d.settings.meds.find((m) => m.id === id);
    if (!med) return;
    const st = medStatus(d, med, Date.now());
    if (!st.ready && !confirm(`It hasn't been ${med.hours} hours since the last ${med.name}. Log it anyway?`)) return;
    const e = { id: uid(), type: 'med', medId: id, name: med.name, at: Date.now() };
    store.put('entries', e);
    toast(`${med.name} logged`, () => store.del('entries', e.id));
  },
  bottle: () => {
    openSheet(`<h2>Bottle</h2>
      <div class="chips">${['1', '2', '3', '4', '5'].map((o) => `<button data-act="bottle-oz" data-oz="${o}">${o} oz</button>`).join('')}</div>
      <label class="field"><span>Or another amount (oz)</span><input id="b-oz" inputmode="decimal"></label>
      <label class="field"><span>Time</span><input type="datetime-local" id="b-at" value="${toLocalInput(Date.now())}"></label>
      <div class="actions"><button class="btn primary" data-act="bottle-oz">Save</button><button class="btn" data-act="close">Cancel</button></div>`);
  },
  'bottle-oz': ({ oz }) => {
    const amount = oz || document.getElementById('b-oz').value.trim();
    const at = fromLocalInput(document.getElementById('b-at').value) || Date.now();
    const e = { id: uid(), type: 'bottle', oz: amount, at };
    store.put('entries', e);
    closeSheet();
    toast('Bottle logged', () => store.del('entries', e.id));
  },
  'past-feed': () => {
    openSheet(`<h2>Log a past feed</h2>
      <label class="field"><span>Started</span><input type="datetime-local" id="p-start" value="${toLocalInput(Date.now() - 30 * MIN)}"></label>
      <label class="field"><span>Length (minutes)</span><input id="p-len" inputmode="numeric" value="15"></label>
      <label class="field"><span>Sides</span><select id="p-sides"><option value="L">Left</option><option value="R">Right</option><option value="LR">Left, then Right</option><option value="RL">Right, then Left</option></select></label>
      <div class="actions"><button class="btn primary" data-act="save-past">Save</button><button class="btn" data-act="close">Cancel</button></div>`);
  },
  'save-past': () => {
    const start = fromLocalInput(document.getElementById('p-start').value);
    const len = parseInt(document.getElementById('p-len').value, 10) || 15;
    if (!start) return;
    const segs = buildSegs(start, len, document.getElementById('p-sides').value);
    store.put('entries', { id: uid(), type: 'feed', start, end: segs[segs.length - 1].b, segs });
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
    if (med && med.name && !confirm(`Remove ${med.name}?`)) return;
    store.set({ meds: store.data.settings.meds.filter((m) => m.id !== id) });
    render();
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
    if (!confirm('Disconnect this phone? Your data stays safe in GitHub, and you can reconnect with the setup code.')) return;
    store.disconnect();
    ui.tab = 'home';
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
    if (!confirm('Delete this note?')) return;
    store.del('messages', id);
    closeSheet();
    render();
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) { store.pull(); render(); } });
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
