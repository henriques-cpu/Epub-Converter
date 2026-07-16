/**
 * procedures.js
 * ---------------------------------------------------------------------------
 * Central configuration for the Zendesk Procedure Auto-Detector.
 *
 * This is the ONLY file you need to edit to add, remove, or tweak procedures.
 * Each procedure is a plain data object:
 *
 *   {
 *     id:       unique string, used as the storage key           (required)
 *     name:     human-readable label shown in the sidebar         (required)
 *     color:    accent colour for the header / progress bar       (optional)
 *     keywords: array of strings OR /regex/ that trigger a match  (required)
 *     steps:    array of step labels shown as checkboxes          (required)
 *   }
 *
 * Keyword matching is case-insensitive. Plain strings are matched as whole
 * phrases (word boundaries are applied automatically for single words).
 * You can also pass a RegExp for advanced matching.
 *
 * See README.md -> "Adding or modifying procedures" for a worked example.
 * ---------------------------------------------------------------------------
 */
(function (root) {
  "use strict";

  const PROCEDURES = [
    {
      id: "canceled_account",
      name: "Canceled Account",
      color: "#d93f4c",
      keywords: [
        "cancel",
        "cancellation",
        "remove account",
        "delete account",
        "stop service"
      ],
      steps: [
        "Send email confirmation",
        "Update account status in CRM",
        "Add note in CRM",
        "Add to canceled accounts Google Sheet"
      ]
    },
    {
      id: "postpone_account",
      name: "Postpone Account",
      color: "#2f6f9f",
      keywords: [
        "postpone",
        "delay",
        "reschedule",
        "pause",
        "later date",
        "come back"
      ],
      steps: [
        "Check postponement date (from patient message)",
        "Expire current voucher",
        "Set up new date",
        "Explain new date to patient"
      ]
    }
  ];

  // Expose both to the content-script world and to any importing module.
  root.ZPD_PROCEDURES = PROCEDURES;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = PROCEDURES;
  }
})(typeof window !== "undefined" ? window : this);
