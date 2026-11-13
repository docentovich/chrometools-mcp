# Chrome attach hang + screenshots of a minimized window

Source: work session 2026-11-10, openBrowser / screenshot hung 120 s several times.

## Findings

- `puppeteer.connect` to an existing Chrome waits for every target to initialize. A hidden page target with an empty URL (not in `/json/list`) never answered, so connect hung forever. `connect` has no timeout, `browserPromise` stayed pending, every later tool call awaited it, even after Chrome was closed. Only `/mcp` helped.
- Screenshots hang when the Chrome window is minimized: Chrome stops rendering (`visibilityState: hidden`, no `requestAnimationFrame`), `Page.captureScreenshot` waits for a frame forever. First screenshot after openBrowser worked, later ones hung after the user minimized the window.

## Changes

1. `browser-manager.js`: `connectToChrome(endpoint)` used by all three connect paths.
   - Timeout `CHROMETOOLS_CONNECT_TIMEOUT_MS` (default 15000). On timeout the error is thrown, `browserPromise` resets (existing catch), a late connection is disconnected.
   - `targetFilter` skips page targets with an empty URL present at connect time; targets created later are not filtered.
2. Existing Chrome found on the port but attach timed out: throw a clear error ("Chrome on port N does not respond to attach, fully quit it") instead of launching a second Chrome on the busy port.
3. `utils/capture.js` `capture(page, fn)` for `screenshot`, `saveScreenshot`, `executeScript({screenshot})`, `compareFigmaToElement`, action screenshots:
   - window minimized (`Browser.getWindowForTarget`) -> `Browser.setWindowBounds({windowState:'normal'})`;
   - page not visible -> `page.bringToFront()`, wait up to 2 s for `visible`;
   - capture timeout `CHROMETOOLS_CAPTURE_TIMEOUT_MS` (default 15000) with an error that says Chrome is not rendering the tab.
4. Launch flags for Chrome started by chrometools: `--disable-features=CalculateNativeWinOcclusion`, `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`.

## Verification

- `npm run build`
- Script: Chrome launched by chrometools, window minimized via CDP, `screenshot` tool returns an image (window restored).
- Script: background tab screenshot works.
- Script: fake CDP endpoint that accepts the WebSocket but never answers -> tool error within ~15 s, next call retries (not stuck).
- e2e-vault, e2e-multi, e2e-fill pass.
