/**
 * content.js
 * ---------------------------------------------------------------------------
 * Runs inside every Zendesk agent page. Responsibilities:
 *   1. Track the currently open ticket (Zendesk is a single-page app).
 *   2. Read the conversation text and run the detector.
 *   3. Inject / update a right-hand sidebar with a step checklist.
 *   4. Persist checkbox + override state per ticket (chrome.storage.local).
 *   5. Auto-refresh detection when new messages are added.
 * ---------------------------------------------------------------------------
 */
(function () {
  "use strict";

  const PROCEDURES = window.ZPD_PROCEDURES || [];
  const { detectProcedure } = window.ZPD_DETECTOR;

  const PANEL_ID = "zpd-sidebar";
  const STORAGE_PREFIX = "zpd_ticket_";
  const LOG_KEY = "zpd_completed_log";

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  let currentTicketId = null;
  let currentState = null; // { procedureId, overridden, checked: {}, matches, autoDetectedId }
  let rescanTimer = null;
  let lastScanSignature = "";

  // -------------------------------------------------------------------------
  // Storage helpers (chrome.storage.local, promisified)
  // -------------------------------------------------------------------------
  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([key], (res) => resolve(res ? res[key] : undefined));
      } catch (e) {
        resolve(undefined);
      }
    });
  }
  function storageSet(obj) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(obj, () => resolve());
      } catch (e) {
        resolve();
      }
    });
  }

  // -------------------------------------------------------------------------
  // Ticket identification
  // -------------------------------------------------------------------------
  function getTicketIdFromUrl() {
    // Matches /agent/tickets/12345 and similar variants.
    const m = window.location.pathname.match(/tickets?\/(\d+)/);
    return m ? m[1] : null;
  }

  // -------------------------------------------------------------------------
  // Conversation text extraction
  // -------------------------------------------------------------------------
  // Zendesk's DOM changes between themes/versions, so we try a list of known
  // selectors for comment/message bodies and fall back to the main log region.
  const COMMENT_SELECTORS = [
    '[data-test-id="omni-log-item"]',
    '[data-test-id="ticket-audit-event"]',
    ".zd-comment",
    ".event .message",
    ".comment .content",
    'article[data-comment-id]',
    ".conversation .message"
  ];

  function collectConversationText() {
    let nodes = [];
    for (const sel of COMMENT_SELECTORS) {
      const found = document.querySelectorAll(sel);
      if (found.length) {
        nodes = nodes.concat(Array.from(found));
      }
    }
    if (!nodes.length) {
      // Fall back to the main ticket/conversation region if present.
      const region =
        document.querySelector('[data-test-id="ticket-conversation"]') ||
        document.querySelector(".conversation") ||
        document.querySelector('[role="main"]') ||
        document.querySelector(".main_panes") ||
        document.body;
      if (region) nodes = [region];
    }

    const seen = new Set();
    const parts = [];
    for (const node of nodes) {
      const txt = (node.innerText || node.textContent || "").trim();
      if (txt && !seen.has(txt)) {
        seen.add(txt);
        parts.push(txt);
      }
    }
    return parts.join("\n\n");
  }

  // -------------------------------------------------------------------------
  // State load / save
  // -------------------------------------------------------------------------
  async function loadState(ticketId) {
    const stored = await storageGet(STORAGE_PREFIX + ticketId);
    return (
      stored || {
        procedureId: null,
        overridden: false,
        autoDetectedId: null,
        checked: {},
        matches: []
      }
    );
  }
  async function saveState() {
    if (!currentTicketId || !currentState) return;
    await storageSet({ [STORAGE_PREFIX + currentTicketId]: currentState });
  }

  function getProcedureById(id) {
    return PROCEDURES.find((p) => p.id === id) || null;
  }

  // -------------------------------------------------------------------------
  // Productivity log (optional enhancement)
  // -------------------------------------------------------------------------
  async function logCompletionIfDone(procedure) {
    if (!procedure) return;
    const total = procedure.steps.length;
    const done = procedure.steps.filter((_, i) => currentState.checked[i]).length;
    if (total === 0 || done < total) return;

    const log = (await storageGet(LOG_KEY)) || [];
    const alreadyLogged = log.some(
      (e) => e.ticketId === currentTicketId && e.procedureId === procedure.id
    );
    if (alreadyLogged) return;

    log.push({
      ticketId: currentTicketId,
      procedureId: procedure.id,
      procedureName: procedure.name,
      completedAt: new Date().toISOString()
    });
    await storageSet({ [LOG_KEY]: log });
  }

  // -------------------------------------------------------------------------
  // Detection run
  // -------------------------------------------------------------------------
  async function runDetection() {
    try {
      await runDetectionInner();
    } catch (e) {
      // Never let a single failed scan kill the sidebar or the observers.
      console.warn("[Procedure Detector] scan failed:", e);
    }
  }

  async function runDetectionInner() {
    const ticketId = getTicketIdFromUrl();

    // Switched tickets -> reset in-memory state and reload from storage.
    if (ticketId !== currentTicketId) {
      currentTicketId = ticketId;
      lastScanSignature = "";
      if (!ticketId) {
        removePanel();
        return;
      }
      currentState = await loadState(ticketId);
    }
    if (!ticketId) {
      removePanel();
      return;
    }

    const text = collectConversationText();
    const signature = ticketId + "::" + text.length;

    const result = detectProcedure(text, PROCEDURES);

    // If the user has NOT manually overridden, adopt the auto-detection.
    if (!currentState.overridden) {
      const detectedId = result.procedure ? result.procedure.id : null;
      // Reset checkboxes only when the detected procedure actually changes.
      if (detectedId !== currentState.procedureId) {
        currentState.procedureId = detectedId;
        currentState.checked = {};
      }
      currentState.autoDetectedId = detectedId;
      currentState.matches = result.matches || [];
    } else {
      // Keep override choice; still refresh which keywords are visible.
      const overriddenEntry = (result.all || []).find(
        (e) => e.procedure.id === currentState.procedureId
      );
      currentState.matches = overriddenEntry ? overriddenEntry.matches : [];
      currentState.autoDetectedId = result.procedure ? result.procedure.id : null;
    }

    await saveState();
    renderPanel(result);
    lastScanSignature = signature;
  }

  // Debounced rescan used by the MutationObserver.
  function scheduleRescan() {
    if (rescanTimer) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => runDetection(), 600);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  function removePanel() {
    const el = document.getElementById(PANEL_ID);
    if (el) el.remove();
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === "html") node.innerHTML = v;
      else node.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = el("div", { id: PANEL_ID, class: "zpd-collapsed-false" });
      document.body.appendChild(panel);
    }
    return panel;
  }

  function renderPanel(result) {
    const panel = ensurePanel();
    panel.innerHTML = "";

    const procedure = getProcedureById(currentState.procedureId);
    const accent = procedure && procedure.color ? procedure.color : "#1f73b7";
    panel.style.setProperty("--zpd-accent", accent);

    // ---- Header ----------------------------------------------------------
    const collapseBtn = el("button", {
      class: "zpd-collapse-btn",
      title: "Collapse / expand",
      text: "—",
      onClick: () => panel.classList.toggle("zpd-collapsed")
    });
    const header = el("div", { class: "zpd-header" }, [
      el("span", { class: "zpd-title", text: "Procedure Detector" }),
      collapseBtn
    ]);
    panel.appendChild(header);

    const body = el("div", { class: "zpd-body" });
    panel.appendChild(body);

    // ---- No match --------------------------------------------------------
    if (!procedure) {
      body.appendChild(
        el("div", { class: "zpd-empty" }, [
          el("p", { text: "No procedure detected for this ticket." }),
          el("p", {
            class: "zpd-hint",
            text: "Pick one manually if you know which applies:"
          })
        ])
      );
      body.appendChild(buildOverrideControls());
      return;
    }

    // ---- Procedure name + auto/override badge ----------------------------
    const isOverridden = currentState.overridden;
    body.appendChild(
      el("div", { class: "zpd-procedure-head" }, [
        el("span", { class: "zpd-procedure-name", text: procedure.name }),
        el("span", {
          class: "zpd-badge " + (isOverridden ? "zpd-badge-manual" : "zpd-badge-auto"),
          text: isOverridden ? "Manual" : "Auto"
        })
      ])
    );

    // ---- Matched keywords ------------------------------------------------
    if (currentState.matches && currentState.matches.length) {
      const chips = el("div", { class: "zpd-keywords" }, [
        el("span", { class: "zpd-keywords-label", text: "Matched:" })
      ]);
      currentState.matches.forEach((m) => {
        chips.appendChild(
          el("span", {
            class: "zpd-chip",
            title: `${m.count} occurrence(s)`,
            text: `${m.keyword}${m.count > 1 ? " ×" + m.count : ""}`
          })
        );
      });
      body.appendChild(chips);
    }

    // ---- Progress bar ----------------------------------------------------
    const total = procedure.steps.length;
    const done = procedure.steps.filter((_, i) => currentState.checked[i]).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    const progressWrap = el("div", { class: "zpd-progress" }, [
      el("div", { class: "zpd-progress-track" }, [
        el("div", {
          class: "zpd-progress-fill",
          style: `width:${pct}%`
        })
      ]),
      el("span", { class: "zpd-progress-label", text: `${done}/${total} · ${pct}%` })
    ]);
    body.appendChild(progressWrap);

    // ---- Steps checklist -------------------------------------------------
    const list = el("ul", { class: "zpd-steps" });
    procedure.steps.forEach((step, i) => {
      const checked = !!currentState.checked[i];
      const checkbox = el("input", {
        type: "checkbox",
        class: "zpd-checkbox",
        id: `zpd-step-${i}`
      });
      checkbox.checked = checked;
      checkbox.addEventListener("change", async () => {
        currentState.checked[i] = checkbox.checked;
        await saveState();
        await logCompletionIfDone(procedure);
        renderPanel(result);
      });

      const li = el("li", { class: "zpd-step" + (checked ? " zpd-step-done" : "") }, [
        checkbox,
        el("label", { class: "zpd-step-label", for: `zpd-step-${i}`, text: step })
      ]);
      list.appendChild(li);
    });
    body.appendChild(list);

    // ---- Manual override controls ---------------------------------------
    body.appendChild(buildOverrideControls());
  }

  function buildOverrideControls() {
    const wrap = el("div", { class: "zpd-override" });

    const label = el("label", {
      class: "zpd-override-label",
      text: "Switch procedure:"
    });

    const select = el("select", { class: "zpd-select" });
    select.appendChild(el("option", { value: "", text: "— none —" }));
    PROCEDURES.forEach((p) => {
      const opt = el("option", { value: p.id, text: p.name });
      if (p.id === currentState.procedureId) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", async () => {
      const newId = select.value || null;
      currentState.overridden = true;
      if (newId !== currentState.procedureId) {
        currentState.procedureId = newId;
        currentState.checked = {};
      }
      await saveState();
      await runDetection();
    });

    const resetBtn = el("button", {
      class: "zpd-reset-btn",
      text: "Reset to auto",
      title: "Clear manual override and re-run auto-detection",
      onClick: async () => {
        currentState.overridden = false;
        currentState.procedureId = null; // force re-detect + checkbox reset
        currentState.checked = {};
        await saveState();
        await runDetection();
      }
    });

    wrap.appendChild(label);
    wrap.appendChild(select);
    wrap.appendChild(resetBtn);
    return wrap;
  }

  // -------------------------------------------------------------------------
  // SPA navigation + DOM change observers
  // -------------------------------------------------------------------------
  function hookHistory() {
    const fire = () => window.dispatchEvent(new Event("zpd:locationchange"));
    ["pushState", "replaceState"].forEach((fn) => {
      const orig = history[fn];
      history[fn] = function () {
        const ret = orig.apply(this, arguments);
        fire();
        return ret;
      };
    });
    window.addEventListener("popstate", fire);
    window.addEventListener("zpd:locationchange", () => {
      // Give Zendesk a moment to swap the ticket view in.
      setTimeout(() => runDetection(), 400);
    });
  }

  function observeMutations() {
    const observer = new MutationObserver((mutations) => {
      // Ignore mutations caused by our own sidebar re-rendering, otherwise
      // rendering the panel would retrigger the scan in a loop.
      const relevant = mutations.some((m) => {
        const t = m.target;
        return !(t && t.closest && t.closest("#" + PANEL_ID));
      });
      if (relevant) scheduleRescan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------
  function init() {
    if (!PROCEDURES.length) {
      console.warn(
        "[Procedure Detector] No procedures loaded — procedures.js did not run."
      );
      return;
    }
    console.info(
      `[Procedure Detector] active with ${PROCEDURES.length} procedure(s).`
    );
    hookHistory();
    observeMutations();
    // Initial pass (retry a couple of times while the app boots).
    runDetection();
    setTimeout(runDetection, 1500);
    setTimeout(runDetection, 4000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
