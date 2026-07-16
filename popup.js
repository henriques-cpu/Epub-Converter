/**
 * popup.js
 * Shows the configured procedures and today's completed-procedure log.
 */
(function () {
  "use strict";

  const LOG_KEY = "zpd_completed_log";

  function get(key) {
    return new Promise((resolve) =>
      chrome.storage.local.get([key], (r) => resolve(r ? r[key] : undefined))
    );
  }
  function set(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve()));
  }

  // procedures.js is loaded via a <script> tag in popup.html (see the tag just
  // before this file). It runs under the extension page's CSP and exposes the
  // config on window.ZPD_PROCEDURES. Loading it with fetch()+new Function() is
  // NOT possible here: MV3's default extension-page CSP forbids eval/Function.
  function loadProcedures() {
    return window.ZPD_PROCEDURES || [];
  }

  function renderProcedures(procs) {
    const list = document.getElementById("proc-list");
    list.innerHTML = "";
    if (!procs.length) {
      list.innerHTML = '<li class="p-muted">No procedures configured.</li>';
      return;
    }
    procs.forEach((p) => {
      const li = document.createElement("li");
      li.style.borderLeftColor = p.color || "#1f73b7";
      li.innerHTML =
        `<div class="p-proc-name">${escapeHtml(p.name)}</div>` +
        `<div class="p-proc-meta">${p.steps.length} steps · ` +
        `${p.keywords.length} keywords</div>`;
      list.appendChild(li);
    });
  }

  function isToday(iso) {
    const d = new Date(iso);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  }

  async function renderLog() {
    const log = (await get(LOG_KEY)) || [];
    const today = log.filter((e) => isToday(e.completedAt));
    const summary = document.getElementById("log-summary");
    const list = document.getElementById("log-list");
    list.innerHTML = "";

    summary.textContent = today.length
      ? `${today.length} procedure(s) completed today.`
      : "No procedures completed yet today.";

    today
      .slice()
      .reverse()
      .forEach((e) => {
        const li = document.createElement("li");
        const time = new Date(e.completedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        });
        li.innerHTML =
          `<span>${escapeHtml(e.procedureName)} <span class="p-proc-meta">#${escapeHtml(
            String(e.ticketId)
          )}</span></span>` + `<span class="p-log-time">${time}</span>`;
        list.appendChild(li);
      });
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  document.getElementById("clear-log").addEventListener("click", async () => {
    await set({ [LOG_KEY]: [] });
    renderLog();
  });

  (function init() {
    renderProcedures(loadProcedures());
    renderLog();
  })();
})();
