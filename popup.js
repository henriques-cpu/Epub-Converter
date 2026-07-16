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

  // Load the procedures config from the extension bundle.
  async function loadProcedures() {
    try {
      const url = chrome.runtime.getURL("procedures.js");
      const text = await fetch(url).then((r) => r.text());
      // Evaluate in a scoped function exposing a fake window/root.
      const root = {};
      // eslint-disable-next-line no-new-func
      new Function("window", "module", text)(root, {});
      return root.ZPD_PROCEDURES || [];
    } catch (e) {
      return [];
    }
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

  (async function init() {
    renderProcedures(await loadProcedures());
    renderLog();
  })();
})();
