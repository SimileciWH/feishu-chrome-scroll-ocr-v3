Implementation notes:
- MV3 extension with popup/content/background.
- Selected region in viewport coordinates; each scroll step captures visible tab and crops same region.
- DOM extraction + OCR fusion exported as txt.
Validation PR update: 2026-03-03 08:41:39 CST
Protection smoke 2026-03-03 08:45:17 CST

Bugfix 2026-03-05:
- Fixed batch queue stale completion bug when processing multiple tabs.
- Root cause: `extractProgress_<tabId>` from a previous run could remain `done`, causing next run to be marked complete immediately.
- Fix: added per-run `runId`, queued reset before dispatch, stale-run filtering in `waitForExtractionDone`, and error state propagation.
- CI: added static tests to verify runId gating and queued reset behavior in background/content scripts.
