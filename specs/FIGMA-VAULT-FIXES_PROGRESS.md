# Progress: Figma compare hang + vault fill verification

- [x] 1. figmaFetch with timeout and proxy, used by all Figma requests
- [x] 2. compareFigmaToElement: step timing, common canvas, outputDir
- [x] 3. typeCredential: clear, key events, verify value stuck
- [x] 4. listCredentials: currentUrl, otherOpenTabs
- [x] README + tool definitions, chrome-extension.zip rebuilt
- [x] Verification
  - [x] npm run build
  - [x] figma-net-test.mjs: direct, redirect, via CONNECT proxy, NO_PROXY, timeout, compareImages without stretching (7/7)
  - [x] e2e-vault.mjs 29/29, e2e-multi.mjs 11/11
  - [x] e2e-fill.mjs 15/15: required form submits, no doubling, reset field returns error, otherOpenTabs, query string hidden
- [ ] Live check: compareFigmaToElement on localhost:8090 with the real Figma file (user)
- [ ] Live check: GitLab LDAP login (user, after checking the saved password in the popup)
