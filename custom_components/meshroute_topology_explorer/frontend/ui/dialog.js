// SPDX-License-Identifier: MIT
// A confirmation dialog (WAI-ARIA dialog pattern, modal): built from DOM nodes, opened with the native <dialog>
// showModal(), which makes the rest of the page inert; Tab is also kept inside by hand, so focus cannot leave it
// even where a browser lets it reach its own chrome. Esc cancels; focus returns to where the dialog was opened.
// Runs in the browser.
import { h } from "./dom.js";

let uid = 0;

/** Ask for confirmation. root: the element to attach to (inside the panel's shadow root); title; paragraphs (texts);
 *  confirm / cancel: button labels; opener: element to focus afterwards. Resolves to true (confirmed) or false. */
export function confirmDialog(root, { title, paragraphs, confirm, cancel, opener }) {
  const id = `mte-dialog-${++uid}`;
  return new Promise((resolve) => {
    const cancelButton = h("button", { type: "button", class: "button", text: cancel });
    const confirmButton = h("button", { type: "button", class: "button primary", text: confirm });
    const dialog = h("dialog", { class: "confirm", "aria-labelledby": `${id}-title`, "aria-describedby": `${id}-body` },
      h("h2", { id: `${id}-title`, text: title }),
      h("div", { id: `${id}-body` }, paragraphs.map((p) => h("p", { text: p }))),
      h("div", { class: "dialog-actions" }, cancelButton, confirmButton));
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      if (opener && opener.isConnected && opener.focus) opener.focus();
      resolve(value);
    };
    cancelButton.addEventListener("click", () => finish(false));
    confirmButton.addEventListener("click", () => finish(true));
    // Esc: the native dialog fires "cancel"; handled here so the promise settles and focus goes back.
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(false); });
    dialog.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); finish(false); return; }
      if (e.key !== "Tab") return;
      const order = [cancelButton, confirmButton];
      const at = order.indexOf(dialog.getRootNode().activeElement);
      e.preventDefault();
      order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length].focus();
    });
    root.append(dialog);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
    // The safe choice has focus: starting radio traffic needs a deliberate second step.
    cancelButton.focus();
  });
}
