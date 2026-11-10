# Figma compare hang + vault fill verification + listCredentials tab

Source: report from a work session 2026-11-10 (GitLab login failed, compareFigmaToElement hung 120 s).

## 1. Figma network: timeouts and proxy

Problem: `fetch(figmaImageUrl)` has no timeout. Node `fetch` ignores `HTTPS_PROXY`, so where S3 is reachable only via proxy the call hangs forever (Python in the same env works because it reads the proxy vars).

- New helper `figmaFetch(url, { headers, timeoutMs })` in `figma-tools.js`: `https`/`http` request, `HttpsProxyAgent` when `getProxyForUrl(url)` (proxy-from-env, honours `NO_PROXY`) returns a proxy, follows up to 3 redirects, timeout 30 s per request (env `CHROMETOOLS_FIGMA_TIMEOUT_MS`).
- Used by `fetchFigmaAPI`, `getFigmaFrame` image download, `compareFigmaToElement` image download.
- Error text names the host and says to check `HTTPS_PROXY`.
- Direct deps `https-proxy-agent`, `proxy-from-env` (already in the tree via puppeteer).

## 2. compareFigmaToElement

- `debugLog` with elapsed ms after each step (export, download, screenshot, decode, compare, encode).
- No stretching: both images are placed top-left on a common canvas (max width x max height, transparent background). Size mismatch is reported in `dimensions` and counts as difference.
- New optional `outputDir`: saves `figma.png`, `page.png`, `diff.png`, `overlay.png` (page with 50% Figma on top) and returns the paths.

## 3. typeCredential: verify the value stuck

- In the extension after setting the value: dispatch `keydown`/`keyup` (Unidentified key), `input`, `change`, then re-read the field after one macrotask. If `el.value !== value` return `{ ok:false, error:'Value did not stick ...' }` (no value in the message).
- Field is cleared via native setter `''` + `input` before setting (explicit, covers masked inputs that append).

## 4. listCredentials current tab

- Response adds `currentUrl` (tab MCP works with) and `otherOpenTabs`: open http(s) tabs whose origin matches a credential, with `{ url, credentials }`, and a hint to `switchTab` when the current tab has no match but another does.

## Verification

- `npm run build`
- Unit-ish script: `figmaFetch` direct and through a local CONNECT proxy, timeout on a black-hole server.
- compareFigmaToElement on a local page with a fake Figma server (images of different sizes): no stretching, files saved.
- e2e-vault.mjs passes; new check: field whose framework resets value on input -> typeCredential returns error.
- listCredentials with two tabs: `otherOpenTabs` lists the matching one.
