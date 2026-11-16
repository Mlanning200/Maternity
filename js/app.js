import { Store } from './store.js';
import { VERSES, NIV_NOTICE } from './verses.js';

const store = new Store();
const ui = { tab: 'home', msgUnlocked: false, histDays: 14, pendingRender: false, setupError: '' };
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');

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
  if (n == null) return 'Add the birthday in Settings';
  if (n < 1) return 'Coming soon';
  const days = n - 1;
  if (days < 14) return `Day ${n}`;
  const w = Math.floor(days / 7), d = days % 7;
  return `${w} weeks${d ? `, ${d} day${d > 1 ? 's' : ''}` : ''} old · Day ${n}`;
}

const tOf = (e) => (e.type === 'feed' ? e.start : e.at);
const feedDur = (e, now = Date.now()) => e.segs.reduce((sum, s) => sum + ((s.b ?? now) - s.a), 0);
const lastSide = (e) => e.segs[e.segs.length - 1].s;
const running = (d) => d.entries.find((e) => e.type === 'feed' && !e.end);
const sorted = (d) => [...d.entries].sort((a, b) => tOf(b) - tOf(a));
const feedSides = (e) => e.segs.map((s) => s.s).filter((s, i, a) => i === 0 || a[i - 1] !== s);

function describe(e, d) {
  if (e.type === 'feed') {
    const sides = e.segs.map((s) => `<span class="pill ${s.s}">${s.s} ${fmtHM((s.b ?? Date.now()) - s.a)}</span>`).join('');
    return e.end ? `${sides}` : `${sides}<small>feeding now</small>`;
  }
  if (e.type === 'bottle') return `<span class="dot bottle"></span>Bottle${e.oz ? ` · ${esc(e.oz)} oz` : ''}`;
  if (e.type === 'diaper') return `<span class="dot diaper"></span>${{ wet: 'Wet', dirty: 'Dirty', both: 'Wet + dirty' }[e.kind] || 'Diaper'} diaper`;
  if (e.type === 'med') {
    const med = d.settings.meds.find((m) => m.id === e.medId);
    return `<span class="dot med"></span>${esc(med ? med.name : e.name || 'Medicine')}`;
  }
  return '';
}
function timeCell(e) {
  if (e.type === 'feed') return fmtTime(e.start);
  return fmtTime(e.at);
}

// ---------- rendering ----------
function syncBadge() {
  const s = store.status;
  const label = { ok: 'Synced', idle: 'Synced', pending: 'Saving…', offline: 'Offline', auth: 'Sign-in issue' }[s];
  return `<button class="sync ${s}" data-act="tab" data-tab="settings"><i></i>${label}</button>`;
}

function header(d) {
  const s = d.settings;
  return `<header class="top"><div><h1>${esc(s.babyName || 'Baby')}</h1><div class="sub">${esc(ageLabel(s.birthday))}</div></div>${syncBadge()}</header>`;
}

function todaysNote(d) {
  const s = d.settings;
  const day = babyDay(s.birthday);
  const msgs = day ? d.messages.filter((m) => +m.day === day) : [];
  const verseIdx = day && day > 0 ? (day - 1) : Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / DAY);
  const v = VERSES[((verseIdx % VERSES.length) + VERSES.length) % VERSES.length];
  if (!msgs.length && !s.showVerses) return '';
  const earlier = day ? d.messages.some((m) => +m.day < day) : false;
  let h = '<section class="card note">';
  for (const m of msgs) h += `<p class="msg">${esc(m.text)}</p>`;
  if (msgs.length) h += `<div class="from">— with love</div>`;
  if (s.showVerses) h += `<p class="verse">${esc(v[1])}</p><div class="ref">${esc(v[0])} (NIV)</div>`;
  if (earlier) h += `<button class="linkish" data-act="earlier">Earlier notes</button>`;
  return h + '</section>';
}

function feedCard(d, now) {
  const r = running(d);
  if (r) {
    const seg = r.segs[r.segs.length - 1];
    return `<section class="card running ${seg.s}">
      <div class="side-label">Feeding · ${sideName(seg.s)}</div>
      <div class="clock" data-clock="${seg.a}">${fmtClock(now - seg.a)}</div>
      <div class="total">Started ${fmtTime(r.start)} · total <span data-feedtotal="${r.id}">${fmtHM(feedDur(r, now))}</span></div>
      <div class="row">
        <button class="btn ${other(seg.s)}" data-act="switch">Switch to ${sideName(other(seg.s))}</button>
        <button class="btn primary" data-act="stop">Stop</button>
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
    since = `<div class="since"><div class="label">No feeds yet. Tap a side to start.</div></div>`;
  } else {
    let detail;
    if (lf && lf.start === lastAny) detail = `${fmtTime(lf.start)} · ${fmtHM(feedDur(lf))} · ended on ${sideName(lastSide(lf))}`;
    else detail = `Bottle at ${fmtTime(lb.at)}${lb.oz ? ` · ${esc(lb.oz)} oz` : ''}`;
    since = `<div class="since"><div class="big" data-ago="${lastAny}">${fmtHM(now - lastAny)}</div><div class="label">since last feed started · ${detail}</div></div>`;
  }
  return `<section class="card">
    ${since}
    <div class="sides">
      <button class="side-btn L ${next === 'L' ? 'next' : ''}" data-act="start" data-side="L">Left<small>Start</small></button>
      <button class="side-btn R ${next === 'R' ? 'next' : ''}" data-act="start" data-side="R">Right<small>Start</small></button>
    </div>
    <div class="mini-row">
      <button data-act="bottle">+ Bottle</button>
      <button data-act="past-feed">+ Past feed</button>
    </div>
  </section>`;
}

function diaperCard(d, now) {
  const today = d.entries.filter((e) => e.type === 'diaper' && e.at >= startOfDay(now));
  const wet = today.filter((e) => e.kind === 'wet' || e.kind === 'both').length;
  const dirty = today.filter((e) => e.kind === 'dirty' || e.kind === 'both').length;
  return `<section class="card">
    <h2>Diapers <span class="count">· ${wet} wet · ${dirty} dirty today</span></h2>
    <div class="diapers">
      <button data-act="diaper" data-kind="wet">Wet</button>
      <button data-act="diaper" data-kind="dirty">Dirty</button>
      <button data-act="diaper" data-kind="both">Both</button>
    </div>
  </section>`;
}

function medStatus(d, med, now) {
  const last = d.entries.filter((e) => e.type === 'med' && e.medId === med.id).sort((a, b) => b.at - a.at)[0];
  const readyAt = last ? last.at + (+med.hours || 0) * HOUR : 0;
  return { last, readyAt, ready: now >= readyAt };
}

function medsCard(d, now) {
  const meds = d.settings.meds;
  let h = '<section class="card"><h2>Medicine</h2>';
  for (const med of meds) {
    const st = medStatus(d, med, now);
    const when = st.ready
      ? `<span class="ok"><b class="ok">OK to take now</b></span>${st.last ? ` · last ${fmtTime(st.last.at)}` : ''}`
      : `Next at <b>${fmtTime(st.readyAt)}</b> · in <span data-countdown="${st.readyAt}">${fmtHM(st.readyAt - now + MIN - 1)}</span>`;
    h += `<div class="med"><div class="info"><div class="name">${esc(med.name)}</div><div class="when">${when}</div></div>
      <button class="${st.ready ? '' : 'wait'}" data-act="med" data-id="${esc(med.id)}">Took it</button></div>`;
  }
  return h + '</section>';
}

function entryList(list, d) {
  if (!list.length) return '<div class="empty">Nothing yet</div>';
  return '<ul class="list">' + list.map((e) => `<li><button data-act="edit" data-id="${esc(e.id)}">
      <span class="time">${timeCell(e)}</span><span class="what">${describe(e, d)}</span><span class="chev">›</span>
    </button></li>`).join('') + '</ul>';
}

function todayList(d, now) {
  const list = sorted(d).filter((e) => tOf(e) >= startOfDay(now) && (d.settings.showDiapers || e.type !== 'diaper'));
  return `<section class="card"><h2>Today</h2>${entryList(list, d)}</section>`;
}

function renderHome(d) {
  const now = Date.now();
  const s = d.settings;
  return header(d) + todaysNote(d) + feedCard(d, now)
    + (s.showDiapers ? diaperCard(d, now) : '')
    + (s.showMeds && s.meds.length ? medsCard(d, now) : '')
    + todayList(d, now);
}

function daySummary(list, showDiapers) {
  const feeds = list.filter((e) => e.type === 'feed').length;
  const bottles = list.filter((e) => e.type === 'bottle').length;
  const wet = list.filter((e) => e.type === 'diaper' && (e.kind === 'wet' || e.kind === 'both')).length;
  const dirty = list.filter((e) => e.type === 'diaper' && (e.kind === 'dirty' || e.kind === 'both')).length;
  const parts = [`${feeds} feed${feeds === 1 ? '' : 's'}`];
  if (bottles) parts.push(`${bottles} bottle${bottles === 1 ? '' : 's'}`);
  if (showDiapers) parts.push(`${wet} wet`, `${dirty} dirty`);
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
  let h = header(d);
  if (!keys.length) return h + '<section class="card"><div class="empty">Nothing logged yet</div></section>';
  for (const k of keys.slice(0, ui.histDays)) {
    const list = groups.get(k);
    const n = babyDay(d.settings.birthday, k);
    const title = k === startOfDay(Date.now()) ? 'Today' : k === startOfDay(Date.now() - DAY) ? 'Yesterday' : fmtDate(k);
    h += `<section class="card"><div class="day-head"><h3>${title}</h3><span>${n && n > 0 ? `Day ${n}` : ''}</span></div>
      <div class="day-sum hint">${daySummary(list, d.settings.showDiapers)}</div>${entryList(list, d)}</section>`;
  }
  if (keys.length > ui.histDays) h += `<button class="btn full" data-act="more-history">Show more days</button>`;
  return h;
}

function renderSettings(d) {
  const s = d.settings;
  const tog = (key, label) => `<label class="toggle"><span>${label}</span><input type="checkbox" class="switch" data-set="${key}" ${s[key] ? 'checked' : ''}></label>`;
  const statusText = {
    ok: 'Everything is saved and shared.', idle: 'Everything is saved and shared.',
    pending: 'Saving changes…', offline: 'Offline. Changes are kept on this phone and will sync when you are back online.',
    auth: 'GitHub stopped accepting the access token (it may have expired). Disconnect, then connect again with a new token.',
  }[store.status];
  return `<header class="top"><div><h1>Settings</h1><div class="sub">Shared between both phones</div></div>${syncBadge()}</header>
  <section class="card"><h2>Baby</h2>
    <label class="field"><span>Name</span><input data-set="babyName" value="${esc(s.babyName)}" autocomplete="off" autocapitalize="words" placeholder="Baby's name"></label>
    <label class="field"><span>Birthday</span><input type="date" data-set="birthday" value="${esc(s.birthday)}"></label>
  </section>
  <section class="card"><h2>Show on Today</h2>
    ${tog('showDiapers', 'Diaper tracking')}
    ${tog('showMeds', 'Medicine timer')}
    ${tog('showVerses', 'Bible verse of the day')}
  </section>
  <section class="card"><h2>Medicine</h2>
    <div class="hint" style="margin:0 0 10px">Name, and hours to wait between doses.</div>
    ${s.meds.map((m) => `<div class="med-edit">
      <input class="inp" data-med="${esc(m.id)}" data-field="name" value="${esc(m.name)}" placeholder="Name">
      <input class="inp" data-med="${esc(m.id)}" data-field="hours" value="${esc(m.hours)}" inputmode="decimal" placeholder="Hours">
      <button class="x" data-act="del-med" data-id="${esc(m.id)}" aria-label="Remove">×</button></div>`).join('')}
    <button class="btn full" data-act="add-med">+ Add medicine</button>
    <p class="hint">Follow the dosing her doctor gave. This timer is only a reminder.</p>
  </section>
  <section class="card"><h2>Notes for her</h2>
    <p class="hint" style="margin:0 0 12px">Write messages ahead of time. Each one shows up on its day.</p>
    <button class="btn full" data-act="tab" data-tab="messages">Open notes</button>
  </section>
  <section class="card"><h2>Sync</h2>
    <p style="margin:0 0 12px">${statusText}</p>
    <button class="btn full" data-act="copy-setup">Copy setup code for the other phone</button>
    <p class="hint">Text or AirDrop it, then paste it in the app on the other iPhone. Treat it like a password.</p>
    <div class="actions" style="margin-top:12px"><button class="btn danger full" data-act="disconnect">Disconnect this phone</button></div>
  </section>
  <p class="fine">${esc(NIV_NOTICE)}</p>`;
}

function renderMessages(d) {
  const s = d.settings;
  const back = `<button class="back" data-act="tab" data-tab="settings">‹ Settings</button>`;
  if (s.msgPin && !ui.msgUnlocked) {
    return `${back}<section class="card"><h2>Notes for her</h2>
      <label class="field"><span>PIN</span><input id="pin" type="password" inputmode="numeric" autocomplete="off"></label>
      <button class="btn primary full" data-act="unlock">Unlock</button>
      <div id="pin-err" class="err"></div></section>`;
  }
  const today = babyDay(s.birthday);
  const msgs = [...d.messages].sort((a, b) => a.day - b.day);
  let h = `${back}<header class="top"><div><h1>Notes for her</h1><div class="sub">${today ? `Today is Day ${today}` : 'Set the birthday in Settings first'}</div></div></header>`;
  h += `<button class="btn primary full" data-act="msg-new" style="margin-bottom:14px">+ Write a note</button>`;
  h += '<section class="card">';
  if (!msgs.length) h += '<div class="empty">No notes yet</div>';
  else h += '<ul class="list">' + msgs.map((m) => {
    const when = s.birthday ? fmtShortDate(dateOfDay(s.birthday, m.day)) : '';
    const tag = today && m.day < today ? ' · shown' : today && m.day === today ? ' · today' : '';
    return `<li class="msg-item"><button data-act="msg-edit" data-id="${esc(m.id)}"><span class="time">Day ${esc(m.day)}<br><small>${when}</small></span>
      <span class="what">${esc(m.text)}<br><small>${tag.replace(' · ', '')}</small></span><span class="chev">›</span></button></li>`;
  }).join('') + '</ul>';
  h += '</section>';
  h += `<section class="card"><h2>Keep them a surprise</h2>
    <p class="hint" style="margin:0 0 12px">${s.msgPin ? 'A PIN is set for this page.' : 'Add a PIN so this page stays locked on her phone.'}</p>
    <label class="field"><span>${s.msgPin ? 'Change PIN' : 'PIN'}</span><input id="newpin" inputmode="numeric" autocomplete="off" placeholder="4 digits"></label>
    <button class="btn full" data-act="set-pin">${s.msgPin ? 'Change PIN' : 'Set PIN'}</button>
    ${s.msgPin ? '<button class="btn danger full" data-act="clear-pin">Remove PIN</button>' : ''}</section>`;
  return h;
}

function renderSetup() {
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  return `<div class="setup">
    <h1>Welcome</h1>
    <p>Connect this phone once and it stays connected.</p>
    ${standalone ? '' : `<section class="card"><h2>First, add to Home Screen</h2>
      <p style="margin:0">In Safari, tap <b>Share</b> → <b>Add to Home Screen</b>, then open the app from your Home Screen and connect it there.</p></section>`}
    <section class="card"><h2>Have a setup code?</h2>
      <label class="field"><span>Paste the code from the other phone</span><input id="code" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="MT1:…"></label>
      <button class="btn primary full" data-act="connect-code">Connect</button>
    </section>
    <section class="card"><h2>Or set up with GitHub</h2>
      <label class="field"><span>Private data repo</span><input id="repo" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="yourname/maternity-data"></label>
      <label class="field"><span>Access token</span><input id="token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…"></label>
      <button class="btn primary full" data-act="connect">Connect</button>
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
  $sheet.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
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
    const parsed = Store.parseSetupCode(document.getElementById('code').value);
    if (!parsed) { showSetupError('That setup code does not look right. Copy it again from the other phone.'); return; }
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

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
