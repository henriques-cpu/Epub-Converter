/**
 * Minimal, dependency-free tests for the detection logic.
 * Run with:  node tests/detector.test.js
 */
const path = require("path");
const PROCEDURES = require(path.join(__dirname, "..", "procedures.js"));
const { detectProcedure } = require(path.join(__dirname, "..", "detector.js"));

let passed = 0;
let failed = 0;

function assert(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ok   - ${name}`);
  } else {
    failed++;
    console.error(`  FAIL - ${name}`);
  }
}

// --- Canceled account ------------------------------------------------------
let r = detectProcedure(
  "Hi, I would like to cancel my subscription and delete account please.",
  PROCEDURES
);
assert("detects canceled account", r.procedure && r.procedure.id === "canceled_account");
assert("reports matched keywords", r.matches.some((m) => m.keyword === "cancel"));
assert("counts multiple keywords", r.score >= 2);

// --- Postpone account ------------------------------------------------------
r = detectProcedure(
  "Can we reschedule? I'd like to postpone to a later date and come back next month.",
  PROCEDURES
);
assert("detects postpone account", r.procedure && r.procedure.id === "postpone_account");
assert("matches multi-word phrase 'later date'", r.matches.some((m) => m.keyword === "later date"));

// --- No match --------------------------------------------------------------
r = detectProcedure("Thanks for the great service, everything works well!", PROCEDURES);
assert("returns no procedure when nothing matches", r.procedure === null);

// --- Word boundary ---------------------------------------------------------
r = detectProcedure("The patient has cancer treatment scheduled.", PROCEDURES);
assert("does not fire 'cancel' inside 'cancer'", r.procedure === null);

// --- Highest score wins ----------------------------------------------------
r = detectProcedure(
  "cancel cancel cancellation. also postpone once.",
  PROCEDURES
);
assert("picks the higher-scoring procedure", r.procedure.id === "canceled_account");

// --- Alternatives exposed for override -------------------------------------
assert("exposes all procedure scores", Array.isArray(r.all) && r.all.length === PROCEDURES.length);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
