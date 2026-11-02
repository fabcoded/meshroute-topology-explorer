// SPDX-License-Identifier: MIT
// Test helper (not a test file): a very small DOM, just enough for ui/dom.js `h()` and the panel's own builders
// (status pill, View tab) to run in Node. Elements keep tag, attributes, properties, listeners and children; nothing
// is laid out. installFakeDom() sets the globals once.
export class FakeNode {}
export class FakeText extends FakeNode {
  constructor(data) { super(); this.data = data; }
  get textContent() { return this.data; }
}
export class FakeEl extends FakeNode {
  constructor(tag) { super(); this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; }
  append(...nodes) { for (const n of nodes) this.children.push(typeof n === "string" ? new FakeText(n) : n); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  click(init = {}) { for (const fn of this.listeners.click || []) fn({ button: 0, preventDefault() { this.prevented = true; }, ...init }); }
  set textContent(v) { this.children = [new FakeText(String(v))]; }
  get textContent() { return this.children.map((c) => c.textContent).join(""); }
  /** All descendants (and this element) for which test(el) is true. */
  find(test, out = []) {
    if (test(this)) out.push(this);
    for (const c of this.children) if (c instanceof FakeEl) c.find(test, out);
    return out;
  }
}
export function installFakeDom() {
  globalThis.Node = FakeNode;
  globalThis.document = { createElement: (t) => new FakeEl(t), createElementNS: (ns, t) => new FakeEl(t),
    createTextNode: (s) => new FakeText(String(s)) };
}
