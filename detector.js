/**
 * detector.js
 * ---------------------------------------------------------------------------
 * Pure detection logic. Given a block of ticket text and the procedures
 * configuration, it decides which procedure the ticket most likely belongs to
 * and reports which keywords triggered the match.
 *
 * This file has no DOM or Chrome-API dependencies so it can be unit-tested in
 * isolation (see tests/).
 * ---------------------------------------------------------------------------
 */
(function (root) {
  "use strict";

  /**
   * Build a case-insensitive, global RegExp for a keyword.
   * - RegExp keywords are used as-is (but forced global + case-insensitive).
   * - Single-word strings get word boundaries so "cancel" does not fire on
   *   "cancer". Multi-word phrases are matched literally.
   */
  function keywordToRegExp(keyword) {
    if (keyword instanceof RegExp) {
      const flags = keyword.flags.includes("g")
        ? keyword.flags
        : keyword.flags + "g";
      return new RegExp(keyword.source, flags.includes("i") ? flags : flags + "i");
    }
    const escaped = String(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const isSingleWord = /^\w+$/.test(keyword);
    const source = isSingleWord ? `\\b${escaped}\\b` : escaped;
    return new RegExp(source, "gi");
  }

  /**
   * Count how many times each keyword of a procedure appears in `text`.
   * Returns { score, matches: [{ keyword, count }] } for matched keywords only.
   */
  function scoreProcedure(procedure, text) {
    const matches = [];
    let score = 0;
    for (const keyword of procedure.keywords) {
      const re = keywordToRegExp(keyword);
      const found = text.match(re);
      if (found && found.length > 0) {
        score += found.length;
        matches.push({
          keyword: keyword instanceof RegExp ? keyword.source : keyword,
          count: found.length
        });
      }
    }
    return { score, matches };
  }

  /**
   * Detect the best-matching procedure for the given text.
   *
   * @param {string} text        Combined ticket conversation text.
   * @param {Array}  procedures  Procedure config (defaults to ZPD_PROCEDURES).
   * @returns {null | {
   *            procedure, score, matches, all
   *          }}  `null` when nothing matched. `all` holds per-procedure scores
   *              so the UI can show alternatives for manual override.
   */
  function detectProcedure(text, procedures) {
    const list = procedures || root.ZPD_PROCEDURES || [];
    const safeText = (text || "").toString();

    const scored = list.map((procedure) => {
      const { score, matches } = scoreProcedure(procedure, safeText);
      return { procedure, score, matches };
    });

    // Highest score wins; ties resolve to the earlier procedure in config order.
    let best = null;
    for (const entry of scored) {
      if (entry.score > 0 && (best === null || entry.score > best.score)) {
        best = entry;
      }
    }

    if (!best) {
      return { procedure: null, score: 0, matches: [], all: scored };
    }
    return {
      procedure: best.procedure,
      score: best.score,
      matches: best.matches,
      all: scored
    };
  }

  const api = { detectProcedure, scoreProcedure, keywordToRegExp };

  root.ZPD_DETECTOR = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : this);
