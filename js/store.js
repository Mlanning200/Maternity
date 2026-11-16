// Shared data store, synced to a single JSON file in a PRIVATE GitHub repo.
// Every change is a small "op" that is applied locally right away, queued,
// and then written to GitHub. If the other phone wrote in the meantime,
// we re-read the file and re-apply our ops on top, so nothing is lost.

const FILE = 'data.json';
const LS_CFG = 'mt.cfg';
const LS_CACHE = 'mt.cache';
const LS_QUEUE = 'mt.queue';

export function defaultData() {
  return {
    rev: 0,
    settings: {
      babyName: '',
      birthday: '',
      showDiapers: true,
      showVerses: true,
      showMeds: true,
      meds: [{ id: 'ibuprofen', name: 'Ibuprofen', hours: 6 }],
      msgPin: '',
    },
    entries: [],
    messages: [],
  };
}

function normalize(d) {
  const def = defaultData();
  d.settings = Object.assign(def.settings, d.settings || {});
  d.entries = Array.isArray(d.entries) ? d.entries : [];
  d.messages = Array.isArray(d.messages) ? d.messages : [];
  d.rev = d.rev || 0;
  return d;
}

export function applyOp(d, op) {
  if (op.t === 'put') {
    const arr = d[op.c];
    const i = arr.findIndex((x) => x.id === op.v.id);
    if (i >= 0) arr[i] = op.v;
    else arr.push(op.v);
  } else if (op.t === 'del') {
    d[op.c] = d[op.c].filter((x) => x.id !== op.id);
  } else if (op.t === 'set') {
    Object.assign(d.settings, op.v);
  }
}

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage full or blocked */ }
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function cleanRepo(repo) {
  return String(repo || '').trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

export class Store {
  constructor() {
    this.cfg = load(LS_CFG);
    this.base = load(LS_CACHE); // { data, sha }
    this.queue = load(LS_QUEUE) || [];
    this.status = this.queue.length ? 'pending' : 'idle'; // idle | ok | pending | offline | auth
    this.listeners = new Set();
    this.flushing = false;
    this.pulling = false;
    this._view = null;
    this._flushTimer = null;
  }

  configured() { return !!(this.cfg && this.cfg.repo && this.cfg.token); }
  onChange(fn) { this.listeners.add(fn); }
  emit() { this._view = null; this.listeners.forEach((fn) => fn()); }
  setStatus(s) { if (this.status !== s) { this.status = s; this.emit(); } }

  /** Current data: last known server copy + this phone's not-yet-saved changes. */
  get data() {
    if (!this._view) {
      const d = normalize(structuredClone(this.base?.data || defaultData()));
      for (const op of this.queue) applyOp(d, op);
      this._view = d;
    }
    return this._view;
  }

  do(op) {
    this.queue.push(op);
    save(LS_QUEUE, this.queue);
    this.status = 'pending';
    this.emit();
    clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this.flush(), 250);
  }
  put(c, v) { this.do({ t: 'put', c, v }); }
  del(c, id) { this.do({ t: 'del', c, id }); }
  set(v) { this.do({ t: 'set', v }); }

  headers(extra) {
    return Object.assign({
      Authorization: `Bearer ${this.cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }, extra || {});
  }
  url() { return `https://api.github.com/repos/${this.cfg.repo}/contents/${FILE}`; }

  async fetchRemote() {
    const res = await fetch(this.url(), { cache: 'no-store', headers: this.headers() });
    if (res.status === 404) return { data: null, sha: null };
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('auth'), { auth: true });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    let text;
    if (j.content && j.encoding === 'base64') {
      text = b64decode(j.content);
    } else {
      // Files over 1 MB come back without content; fetch the raw file instead.
      const raw = await fetch(this.url(), {
        cache: 'no-store',
        headers: this.headers({ Accept: 'application/vnd.github.raw+json' }),
      });
      if (!raw.ok) throw new Error('HTTP ' + raw.status);
      text = await raw.text();
    }
    return { data: normalize(JSON.parse(text)), sha: j.sha };
  }

  async pull() {
    if (!this.configured() || this.pulling || this.flushing) return;
    this.pulling = true;
    try {
      const r = await this.fetchRemote();
      // Ignore a stale read (GitHub can briefly return an older copy right after a write).
      if (r.data && (!this.base?.data || r.data.rev >= this.base.data.rev)) {
        this.base = r;
        save(LS_CACHE, this.base);
      } else if (!r.data && !this.base) {
        this.base = r;
      }
      this.status = this.queue.length ? 'pending' : 'ok';
      this.emit();
    } catch (e) {
      this.setStatus(e.auth ? 'auth' : 'offline');
    } finally {
      this.pulling = false;
    }
    if (this.queue.length) this.flush();
  }

  async flush() {
    if (!this.configured() || this.flushing || !this.queue.length) return;
    this.flushing = true;
    try {
      let base = this.base;
      for (let attempt = 0; attempt < 5 && this.queue.length; attempt++) {
        if (!base || attempt > 0) base = await this.fetchRemote();
        const ops = this.queue.slice();
        const d = normalize(structuredClone(base.data || defaultData()));
        ops.forEach((op) => applyOp(d, op));
        d.rev = (d.rev || 0) + 1;
        d.updated = Date.now();
        const body = { message: 'Update ' + new Date().toISOString(), content: b64encode(JSON.stringify(d)) };
        if (base.sha) body.sha = base.sha;
        const res = await fetch(this.url(), {
          method: 'PUT',
          headers: this.headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const j = await res.json();
          base = this.base = { data: d, sha: j.content.sha };
          this.queue = this.queue.slice(ops.length);
          save(LS_CACHE, this.base);
          save(LS_QUEUE, this.queue);
          this._view = null;
          attempt = -1; // more ops may have arrived while saving; keep going with a fresh budget
          continue;
        }
        if (res.status === 401 || res.status === 403) throw Object.assign(new Error('auth'), { auth: true });
        if (res.status === 409 || res.status === 422) {
          // The other phone saved first: wait a moment, re-read and retry.
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        throw new Error('HTTP ' + res.status);
      }
      this.status = this.queue.length ? 'pending' : 'ok';
    } catch (e) {
      this.status = e.auth ? 'auth' : 'offline';
    } finally {
      this.flushing = false;
      this.emit();
    }
  }

  async connect(repo, token) {
    repo = cleanRepo(repo);
    token = String(token || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('The repo should look like yourname/maternity-data.');
    if (!token) throw new Error('Paste the access token.');
    let res;
    try {
      res = await fetch(`https://api.github.com/repos/${repo}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      });
    } catch {
      throw new Error('No internet connection. Try again in a moment.');
    }
    if (res.status === 401) throw new Error('GitHub did not accept that token. Check it was copied fully.');
    if (!res.ok) throw new Error('Could not open that repo with this token. Check the repo name, and that the token has access to it.');
    const j = await res.json();
    if (!j.private) throw new Error('That repo is public. Your data must go in a PRIVATE repo.');
    this.cfg = { repo, token };
    save(LS_CFG, this.cfg);
    this.base = null;
    save(LS_CACHE, null);
    await this.pull();
    if (this.status === 'auth') {
      throw new Error('The token can see the repo but cannot read files. Give it "Contents: Read and write" access.');
    }
  }

  disconnect() {
    this.cfg = null;
    this.base = null;
    this.queue = [];
    ['mt.cfg', 'mt.cache', 'mt.queue'].forEach((k) => { try { localStorage.removeItem(k); } catch {} });
    this.status = 'idle';
    this.emit();
  }

  setupCode() {
    return 'MT1:' + btoa(JSON.stringify({ r: this.cfg.repo, k: this.cfg.token }));
  }
  static parseSetupCode(code) {
    // Forgive spaces, line breaks and invisible characters added by Messages or copy/paste.
    const clean = String(code || '').replace(/[\s​-‍﻿ ]/g, '');
    const m = clean.match(/MT1:([A-Za-z0-9+/=]+)/i);
    if (!m) return null;
    try {
      const o = JSON.parse(atob(m[1]));
      return o.r && o.k ? { repo: o.r, token: o.k } : null;
    } catch { return null; }
  }
}
