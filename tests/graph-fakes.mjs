// SPDX-License-Identifier: MIT
// Test helpers (not a test file): a recording 2D context, a fake canvas and a fake clock, so the graph view runs in
// Node without a browser. Imported by the graph-*.test.mjs files.

/** 2D context that records every method call as [name, ...args] and stores property assignments. */
export function recordingContext(charWidth = 7) {
  const target = { calls: [], measureText: (text) => ({ width: String(text).length * charWidth }) };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      return (...args) => { t.calls.push([key, ...args]); };
    },
    set(t, key, value) {
      t[key] = value;
      return true;
    },
  });
}

/** Canvas stand-in with the parts GraphView uses. */
export class FakeCanvas extends EventTarget {
  constructor(width = 800, height = 600) {
    super();
    this.clientWidth = width;
    this.clientHeight = height;
    this.width = 0;
    this.height = 0;
    this.style = {};
    this.attributes = {};
    this.captured = new Set();
    this.ctx = recordingContext();
  }

  getContext() { return this.ctx; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  setPointerCapture(id) { this.captured.add(id); }
}

/** Fake clock, timers and animation frames. advance(ms) fires due timers; flush() runs pending frames. */
export function fakeEnv({ reducedMotion = false, dpr = 2 } = {}) {
  let now = 0;
  let timers = [];
  let frames = [];
  const env = {
    now: () => now,
    setTimeout: (fn, ms) => { const h = { fn, at: now + ms }; timers.push(h); return h; },
    clearTimeout: (h) => { timers = timers.filter((x) => x !== h); },
    requestFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelFrame: () => {},
    devicePixelRatio: () => dpr,
    reducedMotion: () => reducedMotion,
    ResizeObserver: undefined,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((h) => h.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        timers = timers.filter((x) => x !== due);
        due.fn();
      }
      now = end;
    },
    flush(limit = 1000) {
      for (let i = 0; i < limit && frames.length; i++) {
        const run = frames;
        frames = [];
        for (const fn of run) fn(now);
        now += 16;
      }
    },
  };
  return env;
}

/** A DOM-like event: cancelable, with the given fields (timeStamp included) as own properties. */
export function domEvent(type, fields = {}) {
  const e = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(e, key, { value });
  return e;
}
