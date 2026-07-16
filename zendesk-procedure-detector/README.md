# Zendesk Procedure Auto-Detector

A Manifest V3 Chrome extension that watches the Zendesk agent workspace,
automatically detects which support **procedure** a ticket belongs to based on
its conversation text, and shows a persistent right-side **checklist sidebar**
with the required steps.

Out of the box it detects two procedures:

| Procedure          | Triggered by keywords                                                       | Steps |
|--------------------|------------------------------------------------------------------------------|-------|
| **Canceled Account** | `cancel`, `cancellation`, `remove account`, `delete account`, `stop service` | 4 |
| **Postpone Account** | `postpone`, `delay`, `reschedule`, `pause`, `later date`, `come back`        | 4 |

## Features

- **Auto-detection** on ticket load and whenever new messages arrive.
- Scans the **whole conversation** — the first message and every reply.
- **Highlights the matched keywords** that triggered the detection.
- **Checklist with checkboxes**, a **progress bar**, and completed steps
  struck through.
- **Per-ticket persistence** — checkbox state is stored and restored while you
  work the ticket (via `chrome.storage.local`).
- **Resets** automatically when you switch to a different ticket.
- **Manual override** — a dropdown to pick a different procedure if the
  detection was wrong, plus a "Reset to auto" button.
- **Productivity log** — completing every step of a procedure is recorded and
  shown in the toolbar popup ("Completed today").
- Collapsible sidebar, styled to match Zendesk's Garden UI.

## Project structure

```
zendesk-procedure-detector/
├── manifest.json        # MV3 manifest
├── procedures.js        # ← EDIT THIS to add/change procedures (data structure)
├── detector.js          # Pure keyword-detection logic (unit-tested)
├── content.js           # Injects the sidebar, handles SPA nav + persistence
├── sidebar.css          # Sidebar styling
├── popup.html/.css/.js  # Toolbar popup: procedure list + completion log
├── icons/               # Toolbar icons
└── tests/
    └── detector.test.js # `node tests/detector.test.js`
```

## Loading the unpacked extension in Chrome

1. Open `chrome://extensions` in Chrome (or any Chromium browser).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked**.
4. Select the `zendesk-procedure-detector/` folder.
5. Open any Zendesk ticket (`https://<your-subdomain>.zendesk.com/agent/tickets/...`).
   The **Procedure Detector** sidebar appears on the right.

> The extension only runs on `https://*.zendesk.com/*` pages. If your Zendesk
> instance uses a custom domain, add it to `host_permissions` and
> `content_scripts[0].matches` in `manifest.json`.

After editing any file, return to `chrome://extensions` and click the **reload**
(↻) icon on the extension card.

## Adding or modifying procedures

Everything is data-driven — you only need to edit **`procedures.js`**. Each
procedure is a plain object:

```js
{
  id: "refund_request",              // unique, used as a storage key
  name: "Refund Request",            // shown in the sidebar
  color: "#7a5cc2",                  // optional accent colour
  keywords: [                        // strings (case-insensitive) or /regex/
    "refund",
    "money back",
    "chargeback",
    /reimburse\w*/                   // RegExp allowed for advanced matching
  ],
  steps: [                           // rendered as checkboxes
    "Verify payment in Stripe",
    "Approve refund",
    "Notify the customer",
    "Log the refund in the finance sheet"
  ]
}
```

Add it to the `PROCEDURES` array in `procedures.js`, save, then reload the
extension in `chrome://extensions`. That's it — the sidebar, popup, and
detection all pick it up automatically.

Matching rules:
- Matching is **case-insensitive**.
- A **single-word** keyword (e.g. `cancel`) is matched on **word boundaries**,
  so it won't fire inside `cancer`.
- A **multi-word** keyword (e.g. `later date`) is matched as a literal phrase.
- Pass a **`RegExp`** for anything more advanced.
- When several procedures match, the one with the **most keyword hits** wins;
  ties resolve to the procedure listed first.

## Running the tests

The detection logic is pure and has no browser dependencies:

```bash
cd zendesk-procedure-detector
node tests/detector.test.js
```

## How auto-refresh & ticket switching work

Zendesk is a single-page app, so the extension:

- Patches `history.pushState`/`replaceState` and listens for `popstate` to
  notice when you open a different ticket (ticket id is read from the URL).
- Runs a debounced `MutationObserver` on the page to re-scan when new replies
  are added to the conversation.
- Keys all stored state by ticket id, so each ticket keeps its own checklist
  progress and manual-override choice, and switching tickets loads the right
  state.

## Optional: Google Sheets sync

The "Add to canceled accounts Google Sheet" step is a manual checklist item by
design (no credentials are bundled). To automate it you would add a background
service worker that calls the Google Sheets API with OAuth
(`chrome.identity`) — intentionally left out here to keep the extension
dependency-free and safe to load unpacked. The completion log already provides
the data (ticket id, procedure, timestamp) you'd push to a sheet.

## Notes & limitations

- Zendesk's DOM differs between themes/versions. `content.js` tries a list of
  known comment selectors and falls back to the main conversation region, so
  detection is resilient but text extraction may include some surrounding UI
  text. Keyword matching tolerates this well.
- All state is stored locally in the browser (`chrome.storage.local`); nothing
  is sent anywhere.
