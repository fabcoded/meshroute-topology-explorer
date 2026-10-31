// SPDX-License-Identifier: MIT
// Test helpers (not a test file): a recording 2D context, a fake canvas, a fake clock and realistic label widths, so
// the graph view runs in Node without a browser. Imported by the graph-*.test.mjs files.

// Glyph widths of the label font ("12px sans-serif"), measured with canvas measureText in headless Chromium on
// 2026-10-31 (the font there has Arial's metrics); printable ASCII and the ellipsis.
const CHARS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
const WIDTHS = [3.33, 3.33, 4.26, 6.67, 6.67, 10.67, 8, 2.29, 4, 4, 4.67, 7.01, 3.33, 4, 3.33, 3.33, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67, 6.67, 3.33, 3.33, 7.01, 7.01, 7.01, 6.67, 12.18, 8, 8, 8.67, 8.67, 8, 7.33, 9.33, 8.67, 3.33, 6, 8, 6.67, 10, 8.67, 9.33, 8, 9.33, 8.67, 8, 7.33, 8.67, 8, 11.33, 8, 8, 7.33, 3.33, 3.33, 3.33, 5.63, 6.67, 4, 6.67, 6.67, 6, 6.67, 6.67, 3.33, 6.67, 6.67, 2.67, 2.67, 6, 2.67, 10, 6.67, 6.67, 6.67, 6.67, 4, 6, 3.33, 6.67, 6, 8.67, 6, 6, 6, 4.01, 3.12, 4.01, 7.01];
const ELLIPSIS_WIDTH = 12;

/** Width of text in the 12 px label font, as a browser would measure it (other characters count as a digit). */
export function labelWidth(text) {
  let w = 0;
  for (const ch of String(text)) {
    const i = CHARS.indexOf(ch);
    w += ch === "\u2026" ? ELLIPSIS_WIDTH : i >= 0 ? WIDTHS[i] : 6.67;
  }
  return w;
}

/** 2D context that records every method call as [name, ...args] and stores property assignments. Text is measured
 *  with the realistic label widths. */
export function recordingContext() {
  const target = { calls: [], measureText: (text) => ({ width: labelWidth(text) }) };
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
