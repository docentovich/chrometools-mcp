# Progress: Chrome attach hang + screenshots of a minimized window

- [x] 1. connectToChrome: 15 s timeout, skip empty-URL pages at connect, used by all three connect paths
- [x] 2. Attach timeout on an existing Chrome: clear error, no second launch
- [x] 3. utils/capture.js: restore minimized window, bring tab to front, 15 s capture timeout; used by screenshot, saveScreenshot, executeScript screenshot, compareFigmaToElement, click/action screenshots
- [x] 4. Launch flags against occlusion/background throttling
- [x] README (env vars, troubleshooting), CHANGELOG 3.7.0
- [x] Verification
  - [x] npm run build
  - [x] e2e-capture.mjs 10/10: silent CDP endpoint -> error in ~6 s and next call retries; minimized window screenshot (window restored); saveScreenshot minimized; background tab screenshot; click
  - [x] e2e-vault 29/29 (one flaky popup-open in the test itself, passes on rerun), e2e-multi 11/11, e2e-fill 15/15
- [ ] Live check in the work session (hidden empty-URL tab case cannot be reproduced on demand)
