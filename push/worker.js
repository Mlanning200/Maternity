// Lil Chicken push sender: a Cloudflare Worker.
//
// Once a minute it reads data.json from the family's private GitHub repo and sends Web Push
// notifications to the phones that turned them on: medicine ready, feed reminder, and a
// feed timer that was left running. It keeps no copy of the baby data.
//
// Storage (KV, key "state"): { repo, token, devices: { [deviceId]: { sub, prefs } } }
//   The GitHub token arrives from the app when a phone turns notifications on, and is only
//   used to read data.json. A new token is accepted only if it can open the same private repo.
// Secrets/vars: VAPID_PRIVATE_JWK (secret), VAPID_PUBLIC (b64url raw P-256 key), VAPID_SUBJECT.
//
// Web Push encryption is RFC 8291 (aes128gcm) and sender identity is RFC 8292 (VAPID),
// implemented with WebCrypto so there are no dependencies.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const FORGOTTEN_AFTER = 45 * MIN;
const ALLOWED_ORIGINS = ['https://mlanning200.github.io'];
const UA = 'lil-chicken-push';

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const okOrigin = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
    const cors = okOrigin ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    } : {};
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const path = new URL(req.url).pathname;
    try {
      if (req.method === 'GET' && path === '/vapid') return json({ key: env.VAPID_PUBLIC });
      if (req.method !== 'POST') return json({ error: 'Not found' }, 404);
      const body = await req.json();
      const state = await loadState(env);
      if (!(await authorize(state, body.repo, body.token))) return json({ error: 'That access token cannot open the family data repo.' }, 403);
      const id = String(body.deviceId || '').slice(0, 64);
      if (!/^[\w-]{8,64}$/.test(id)) return json({ error: 'Bad device id' }, 400);

      if (path === '/register') {
        const sub = body.subscription;
        if (!sub || !/^https:\/\//.test(sub.endpoint || '') || !sub.keys?.p256dh || !sub.keys?.auth) return json({ error: 'Bad subscription' }, 400);
        state.devices[id] = { sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, prefs: cleanPrefs(body.prefs), at: Date.now() };
        await saveState(env, state);
        return json({ ok: true });
      }
      if (path === '/unregister') {
        delete state.devices[id];
        await saveState(env, state);
        return json({ ok: true });
      }
      if (path === '/test') {
        const dev = state.devices[id];
        if (!dev) return json({ error: 'This phone is not registered yet.' }, 404);
        const r = await sendPush(env, dev.sub, { title: 'Lil Chicken', body: 'Notifications are working on this phone. 🐣', tag: 'test' });
        const prev = (await env.KV.get('log', 'json')) || [];
        await env.KV.put('log', JSON.stringify([...prev, { at: new Date().toISOString(), device: id.slice(0, 6), tag: 'test', status: r.status, reason: r.reason || '' }].slice(-50)));
        return json({ ok: r.ok, status: r.status });
      }
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: 'Something went wrong: ' + (e && e.message) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlerts(env, event.scheduledTime));
  },
};

// ---------- state ----------
async function loadState(env) {
  const s = (await env.KV.get('state', 'json')) || {};
  s.devices = s.devices || {};
  return s;
}
async function saveState(env, s) { await env.KV.put('state', JSON.stringify(s)); }

async function authorize(state, repo, token) {
  repo = String(repo || '').trim();
  token = String(token || '').trim();
  if (!repo || !token) return false;
  if (state.repo && state.repo.toLowerCase() !== repo.toLowerCase()) return false;
  if (state.token === token && state.repo) return true;
  // A new or renewed token: accept it only if it really opens this private repo.
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': UA },
  });
  if (!res.ok) return false;
  const j = await res.json();
  if (!j.private) return false;
  state.repo = j.full_name || repo;
  state.token = token;
  return true;
}

function cleanPrefs(p = {}) {
  const hours = Number(p.feedHours);
  return {
    med: p.med !== false,
    feed: p.feed !== false,
    feedHours: hours >= 1 && hours <= 8 ? hours : 3,
    forgotten: p.forgotten !== false,
    pump: p.pump !== false,
    tz: typeof p.tz === 'string' && p.tz.length < 64 ? p.tz : 'America/Chicago',
  };
}

// ---------- alerts ----------
async function readData(state) {
  const res = await fetch(`https://api.github.com/repos/${state.repo}/contents/data.json`, {
    headers: { Authorization: `Bearer ${state.token}`, Accept: 'application/vnd.github.raw+json', 'User-Agent': UA },
  });
  if (!res.ok) return null;
  return res.json();
}

const sideName = (s) => (s === 'L' ? 'Left' : 'Right');
const other = (s) => (s === 'L' ? 'R' : 'L');
function nextSide(f) {
  const t = { L: 0, R: 0 };
  f.segs.forEach((s) => { t[s.s] += (s.b ?? s.a) - s.a; });
  const last = f.segs[f.segs.length - 1].s;
  if (!t.L || !t.R) return other(last);
  if (Math.abs(t.L - t.R) < 2 * MIN) return last;
  return t.L < t.R ? 'L' : 'R';
}
const DAY = 24 * HOUR;
// Local calendar date and hour in the phone's time zone.
function localParts(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ts));
  const g = (t) => parts.find((x) => x.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: +g('hour') };
}
// Mirrors js/pump.js: hours between sessions when exclusively pumping.
function pumpEvery(settings, now, tz) {
  const every = +(settings.pump || {}).every;
  if (every > 0) return every;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(settings.birthday || '')) return 2.5;
  const days = Math.round((Date.parse(localParts(now, tz).date) - Date.parse(settings.birthday)) / DAY);
  return days <= 60 ? 2.5 : days <= 180 ? 3.5 : 4;
}
const fmtTime = (ts, tz) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });

/** Everything that becomes due in the minute ending at `now`, per device. Pure, for testing. */
export function dueAlerts(data, devices, now) {
  const inWindow = (due) => due > now - MIN && due <= now;
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  const settings = data?.settings || {};
  const out = [];

  const running = entries.find((e) => e.type === 'feed' && !e.end);
  const feeds = entries.filter((e) => e.type === 'feed' && e.end && !e.attempt).sort((a, b) => b.start - a.start);
  const bottles = entries.filter((e) => e.type === 'bottle').sort((a, b) => b.at - a.at);
  const lastFeedAt = Math.max(feeds[0]?.start || 0, bottles[0]?.at || 0);

  for (const [id, dev] of Object.entries(devices)) {
    const p = dev.prefs || cleanPrefs();
    if (p.med && settings.showMeds !== false) {
      for (const med of settings.meds || []) {
        const last = entries.filter((e) => e.type === 'med' && e.medId === med.id).sort((a, b) => b.at - a.at)[0];
        if (last && inWindow(last.at + (+med.hours || 0) * HOUR)) {
          out.push({ id, msg: { title: `${med.name || 'Medicine'} is OK now`, body: `It’s been ${+med.hours} hours since the last dose at ${fmtTime(last.at, p.tz)}.`, tag: `med-${med.id}` } });
        }
      }
    }
    if (p.feed && lastFeedAt && !running && inWindow(lastFeedAt + p.feedHours * HOUR)) {
      const next = feeds[0] ? ` Start on the ${sideName(nextSide(feeds[0])).toLowerCase()}.` : '';
      out.push({ id, msg: { title: 'Time for a feed?', body: `${p.feedHours} hours since the last feed started at ${fmtTime(lastFeedAt, p.tz)}.${next}`, tag: 'feed' } });
    }
    const plan = (settings.pump || {}).plan;
    if (p.pump && (plan === 'exclusive' || plan === 'combo' || plan === 'stash')) {
      const pumps = entries.filter((e) => e.type === 'pump').sort((a, b) => b.start - a.start);
      if (!pumps.some((e) => !e.end)) {
        if (plan === 'exclusive' && pumps[0]) {
          const every = pumpEvery(settings, now, p.tz);
          if (inWindow(pumps[0].start + every * HOUR)) {
            out.push({ id, msg: { title: 'Time to pump', body: `It’s been ${Math.floor(every)}${every % 1 ? '½' : ''} hours since the last pump at ${fmtTime(pumps[0].start, p.tz)}.`, tag: 'pump' } });
          }
        }
        if (plan === 'combo' || plan === 'stash') {
          // Breast + pump: no breastfeed and no pump for `after` hours. Mirrors js/pump.js.
          const after = +(settings.pump || {}).after > 0 ? +settings.pump.after : 3;
          const lastNurse = entries.filter((e) => e.type === 'feed' && !e.attempt).sort((a, b) => b.start - a.start)[0];
          const lastAt = Math.max(lastNurse?.start || 0, pumps[0]?.start || 0);
          if (lastAt && !running && inWindow(lastAt + after * HOUR)) {
            const what = pumps[0] && pumps[0].start === lastAt ? 'pumped' : 'nursed';
            out.push({ id, msg: { title: 'Time to pump?', body: `It’s been ${Math.floor(after)}${after % 1 ? '½' : ''} hours since she last ${what} (${fmtTime(lastAt, p.tz)}).`, tag: 'pump' } });
          }
        }
      }
    }
    if (p.forgotten && running) {
      const seg = running.segs[running.segs.length - 1];
      if (inWindow(seg.a + FORGOTTEN_AFTER)) {
        out.push({ id, msg: { title: 'Still feeding?', body: `The ${sideName(seg.s).toLowerCase()} side timer has been running 45 minutes. Tap to fix the time if she dozed off.`, tag: 'forgotten' } });
      }
    }
  }
  return out;
}

async function runAlerts(env, scheduledTime) {
  const state = await loadState(env);
  if (!state.repo || !Object.keys(state.devices).length) return;
  const data = await readData(state);
  if (!data) return;
  const alerts = dueAlerts(data, state.devices, scheduledTime || Date.now());
  let changed = false;
  const log = [];
  for (const a of alerts) {
    const dev = state.devices[a.id];
    if (!dev) continue;
    const r = await sendPush(env, dev.sub, a.msg);
    log.push({ at: new Date(scheduledTime || Date.now()).toISOString(), device: a.id.slice(0, 6), tag: a.msg.tag, status: r.status, reason: r.reason || '' });
    if (r.status === 404 || r.status === 410) { delete state.devices[a.id]; changed = true; } // phone turned them off
  }
  if (changed) await saveState(env, state);
  if (log.length) {
    // Keep the last 50 delivery results (Apple's answer for each alert) for troubleshooting.
    const prev = (await env.KV.get('log', 'json')) || [];
    await env.KV.put('log', JSON.stringify([...prev, ...log].slice(-50)));
  }
}

// ---------- Web Push (RFC 8291 + RFC 8292) ----------
const enc = new TextEncoder();
const b64u = {
  encode(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Encrypt a payload for one subscription (aes128gcm, single record). */
export async function encryptPayload(sub, plaintext) {
  const uaPublic = b64u.decode(sub.keys.p256dh);
  const authSecret = b64u.decode(sub.keys.auth);
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const record = concat(enc.encode(plaintext), new Uint8Array([2])); // 0x02 marks the last record
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** VAPID authorization header for the push service that owns `endpoint`. */
export async function vapidHeader(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const head = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u.encode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u.encode(sig)}, k=${env.VAPID_PUBLIC}`;
}

export async function sendPush(env, sub, msg) {
  const body = await encryptPayload(sub, JSON.stringify(msg));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(env, sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'high',
      Topic: (msg.tag || 'lc').replace(/[^\w-]/g, '').slice(0, 32),
    },
    body,
  });
  let reason = '';
  if (!res.ok) { try { reason = (await res.text()).slice(0, 200); } catch {} }
  return { ok: res.ok, status: res.status, reason };
}
