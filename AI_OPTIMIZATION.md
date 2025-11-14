# AI Optimization Features

This document describes the new AI optimization features added to chrometools-mcp that dramatically reduce the number of requests needed for browser automation.

## Problem

AI agents working with MCP often struggle with browser automation because:

1. **Iterative search** - Agent must request page, analyze, then try selectors step-by-step
2. **Trial and error** - If a selector is wrong, the entire cycle restarts
3. **Lack of context** - Agent doesn't know what's available on the page without multiple requests
4. **Slow feedback loop** - Each request-response cycle adds latency

## Solution

We implemented 3 optimization methods:

### Method 1: Batch Operations (Planned)
Multiple related operations in one request.

### Method 2: Smart Element Finding
**Tool: `smartFindElement`**

Instead of guessing selectors, describe what you want in natural language:

```javascript
// OLD WAY (3-5 requests):
getElement('button#submit')  // Not found
getElement('button.login')   // Not found
getElement('input[type="submit"]')  // Found!

// NEW WAY (1 request):
smartFindElement({ description: "login button" })
// Returns ranked candidates:
// [
//   { selector: 'button.login-btn', confidence: 0.95, text: 'Login' },
//   { selector: '#submit', confidence: 0.7, text: 'Submit' },
//   ...
// ]
```

**How it works:**
- Analyzes description to determine element type (button, input, link, etc.)
- Searches DOM for all matching candidates
- Scores each element based on:
  - Text content match
  - Technical attributes (type="submit", in form, etc.)
  - Context (last button in form, primary button class, etc.)
  - Visibility
- Returns top N candidates sorted by relevance

**Multilingual support:**
Keywords in English, Russian, Spanish, German, French, Italian, Portuguese, Chinese, Japanese.

### Method 3: Page Analysis Caching
**Tool: `analyzePage`**

Get complete page structure in ONE request, cached for subsequent use:

```javascript
// OLD WAY (10+ requests):
getElement('form')           // Get form
getElement('input[type="email"]')  // Get email field
getElement('input[type="password"]')  // Get password
getElement('button[type="submit"]')  // Get submit button
// ... and so on for every element

// NEW WAY (1 request):
analyzePage()
// Returns complete structure:
// {
//   forms: [{ selector, fields: [...], submitButton: {...} }],
//   buttons: [{ selector, text, type }],
//   inputs: [{ selector, type, name, placeholder }],
//   links: [{ selector, text, href }],
//   navigation: [...],
//   interactiveElements: [...]
// }
```

**Features:**
- Results are cached per URL - subsequent calls are instant
- Complete page structure in one response
- All selectors pre-computed
- Form analysis with all fields and submit buttons
- Interactive elements catalog

**Use this:**
- Right after opening a page
- To understand page structure before planning actions
- When you need to work with multiple elements

### Method 4: AI Hints
**Automatic hints in existing tools**

All navigation and interaction tools now include AI hints:

**openBrowser / navigateTo:**
```
Page type: login
Available actions: submit 1 form(s), click 3 button(s), fill 2 input field(s)
Suggested next: Fill login credentials and submit
Common selectors:
  usernameField: input[type="email"]
  passwordField: input[type="password"]
  submitButton: button[type="submit"]
```

**click:**
```
** AI HINTS **
Modal opened - interact with it or close
New elements appeared: modal, alert
Suggested next: Fill modal form or click close button
```

**How it works:**
- Analyzes page after each action
- Detects page type (login, dashboard, search, listing, etc.)
- Identifies new elements (modals, alerts, dropdowns)
- Suggests logical next steps
- Provides common selector patterns

## Additional Helper Tools

### `getAllInteractiveElements`
Get all clickable/fillable elements with selectors.

```javascript
getAllInteractiveElements()
// Returns:
// {
//   count: 15,
//   elements: [
//     { selector: '#login-btn', type: 'button', text: 'Login', visible: true },
//     { selector: 'input[name="email"]', type: 'input', text: '', visible: true },
//     ...
//   ]
// }
```

### `findElementsByText`
Find all elements containing specific text.

```javascript
findElementsByText({ text: "Sign up", exact: false })
// Returns all elements with "Sign up" text and their selectors
```

## Usage Patterns

### Pattern 1: Smart Login Flow
```javascript
// 1. Open page (with hints)
openBrowser({ url: "https://example.com/login" })
// Hints tell you: "Page type: login, fields: email, password, submit button"

// 2. Use hints or smart find
smartFindElement({ description: "email field" })
// Returns best match: input[name="email"]

smartFindElement({ description: "password field" })
// Returns best match: input[type="password"]

smartFindElement({ description: "login button" })
// Returns best match: button[type="submit"]

// 3. Fill and submit
type({ selector: 'input[name="email"]', text: 'user@example.com' })
type({ selector: 'input[type="password"]', text: 'secret' })
click({ selector: 'button[type="submit"]' })
// Hints tell you: "Success alert appeared" or "Error: invalid credentials"
```

### Pattern 2: Complete Page Understanding
```javascript
// 1. Open page
openBrowser({ url: "https://example.com/dashboard" })

// 2. Get full structure
analyzePage()
// Now you have complete map of all forms, buttons, inputs, links

// 3. Plan all actions based on the map
// No more guessing or trial-and-error!
```

### Pattern 3: Text-based Navigation
```javascript
// Find element by visible text
findElementsByText({ text: "Settings" })
// Returns: [{ selector: 'a[href="/settings"]', text: 'Settings' }]

// Click it
click({ selector: 'a[href="/settings"]' })
```

## Performance Improvements

**Before:**
- Login flow: 10-15 requests
- Time: 30-60 seconds
- Many failed attempts

**After:**
- Login flow: 3-5 requests
- Time: 5-10 seconds
- High success rate on first try

## Best Practices

1. **Use `analyzePage` first** when opening complex pages
2. **Use `smartFindElement`** when you know what you want but not the exact selector
3. **Read AI hints** - they tell you what happened and what to do next
4. **Use cached analysis** - `analyzePage` results are cached per URL
5. **Combine tools** - Use `findElementsByText` for visible text, `smartFindElement` for semantic search

## Implementation Details

### Element Scoring Algorithm

Elements are scored based on:
- **Text match** (0-50 points): Exact or partial match with description
- **Keywords** (0-30 points): Submit/action keywords in multiple languages
- **Technical attributes** (0-40 points): type="submit", in form, etc.
- **Context** (0-35 points): Position in form, primary button class, visibility
- **Penalties** (-30 points): Cancel/back/close keywords

Threshold: 5 points minimum
Confidence: score / 100 (capped at 1.0)

### Page Type Detection

Automatically detects:
- **Login page**: Has password field
- **Registration**: Form with 3+ fields
- **Dashboard**: Elements with "dashboard" class/id
- **Search**: Search input field
- **Listing**: Multiple article/post/product elements

### Caching Strategy

- Cache key: Page URL
- Cache invalidation: Manual via `refresh: true`
- Cache scope: Per MCP server instance
- Cache benefits: Instant subsequent access

## Future Enhancements

1. **Batch operations** - Multiple actions in one request
2. **Visual element finding** - Find by screenshot/description
3. **Smart form filling** - Auto-detect and fill entire forms
4. **Action suggestions** - Proactive next-step recommendations
5. **Error recovery** - Auto-retry with alternative selectors
