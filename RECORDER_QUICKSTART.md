# Scenario Recorder - Quick Start Guide

## What is the Scenario Recorder?

The Scenario Recorder allows you to **visually record browser interactions** and save them as reusable scenarios. Instead of writing selectors manually, you interact with the page normally while the recorder captures all your actions.

## Key Features

✅ **Visual Recording** - Browser UI widget for start/stop/save
✅ **9 Action Types** - Click, type, select, scroll, hover, keypress, wait, upload, drag
✅ **Smart Secrets** - Auto-detects passwords/emails in auth forms only
✅ **Action Optimization** - Combines sequential actions automatically
✅ **Dependency Chaining** - Link scenarios together
✅ **Retry Logic** - Auto-recovery if selectors fail

## Basic Workflow

### 1. Enable Recorder in Browser

```javascript
// MCP Tool: enableRecorder
await enableRecorder()
```

This injects a floating widget into the page.

### 2. Start Recording

Click **"Start"** button in the widget. The widget shows:
- 🟢 Green dot when recording
- Action count in real-time
- Visual highlighting of interactions

### 3. Perform Actions

Interact with the page normally:
- Click buttons/links
- Fill form fields
- Select dropdowns
- Scroll to elements
- Upload files
- Press keyboard shortcuts

The recorder captures everything!

### 4. Fill Metadata (Optional)

Click ⚙️ to expand metadata:
- **Scenario Name** (required)
- Description
- Tags (comma-separated)

### 5. Stop & Save

Click **"Stop & Save"** button.

The scenario is saved to:
- `scenarios/<name>.json` - Shareable scenario
- `secrets/<name>.json` - Private credentials (auto .gitignore)

## Using Recorded Scenarios

### Execute a Scenario

```javascript
// MCP Tool: executeScenario
await executeScenario({
  name: "login_flow",
  parameters: {
    email: "user@example.com",
    password: "secret123"
  }
})
```

### List Available Scenarios

```javascript
// MCP Tool: listScenarios
await listScenarios()
// Returns: [{ name, description, tags, dependencies, createdAt, updatedAt }, ...]
```

### Search Scenarios

```javascript
// MCP Tool: searchScenarios
await searchScenarios({
  text: "checkout",
  tags: ["ecommerce"]
})
```

## Advanced Features

### 1. Dependency Chaining

Scenarios can depend on other scenarios:

```json
{
  "name": "checkout_flow",
  "metadata": {
    "dependencies": [
      {
        "scenario": "login_flow",
        "optional": false,
        "condition": {
          "check": "isAuthenticated",
          "skipIf": true
        }
      }
    ]
  }
}
```

When you execute `checkout_flow`, it automatically runs `login_flow` first (if not already authenticated).

### 2. Parameter Substitution

Use `{{paramName}}` in recorded values:

```json
{
  "type": "type",
  "selector": { "value": "input[name='search']" },
  "data": {
    "text": "{{searchQuery}}"
  }
}
```

At execution time, provide the parameter:

```javascript
executeScenario({
  name: "search_products",
  parameters: {
    searchQuery: "laptop"
  }
})
```

### 3. Secret Detection

Secrets are **automatically detected** in authentication forms:

**✅ Detected as secrets:**
- Password fields in login/register forms
- Email fields in login/register forms
- Phone fields in login/register forms
- OTP/verification codes

**❌ NOT detected as secrets:**
- Search boxes
- Comment fields
- Profile update forms (non-auth)
- Phone fields in checkout forms

Secrets are:
- Stored separately in `secrets/<name>.json`
- Automatically .gitignored
- Masked in UI (shown as ***)
- Substituted with {{parameter}} in scenarios

### 4. Custom Selects

The recorder detects custom select components (React Select, Material UI, etc.) and records them as multi-step actions:

```json
{
  "type": "select",
  "data": {
    "selectType": "custom",
    "steps": [
      { "action": "click", "selector": ".select-container" },
      { "action": "wait", "duration": 300 },
      { "action": "click", "selector": ".option[data-value='US']" }
    ]
  }
}
```

### 5. Action Optimization

After recording, actions are automatically optimized:

**Before optimization:**
```json
[
  { "type": "type", "data": { "text": "H" } },
  { "type": "type", "data": { "text": "e" } },
  { "type": "type", "data": { "text": "l" } },
  { "type": "type", "data": { "text": "l" } },
  { "type": "type", "data": { "text": "o" } }
]
```

**After optimization:**
```json
[
  { "type": "type", "data": { "text": "Hello" } }
]
```

Other optimizations:
- Removes duplicate clicks
- Merges sequential waits
- Detects custom select patterns
- Removes unnecessary scrolls/hovers

## File Structure

```
your-project/
├── scenarios/           # Shareable scenarios (commit to git)
│   ├── index.json      # Scenario metadata index
│   ├── login_flow.json
│   └── checkout_flow.json
│
└── secrets/            # Private credentials (auto .gitignore)
    ├── .gitignore      # Auto-created
    ├── login_flow.json
    └── checkout_flow.json
```

## Example Scenario

Here's what a recorded login scenario looks like:

```json
{
  "name": "login_flow",
  "version": "1.0",
  "createdAt": "2025-01-15T10:30:00.000Z",
  "metadata": {
    "description": "Standard login flow",
    "tags": ["auth", "login"],
    "dependencies": [],
    "parameters": {
      "email": { "type": "string", "required": true },
      "password": { "type": "string", "required": true }
    }
  },
  "chain": [
    {
      "type": "click",
      "selector": { "primary": "a.login-link" },
      "timestamp": 1705320000000,
      "data": { "text": "Login" }
    },
    {
      "type": "type",
      "selector": { "primary": "input[name='email']" },
      "timestamp": 1705320001000,
      "data": { "text": "{{email}}", "isSecret": true }
    },
    {
      "type": "type",
      "selector": { "primary": "input[type='password']" },
      "timestamp": 1705320002000,
      "data": { "text": "{{password}}", "isSecret": true }
    },
    {
      "type": "click",
      "selector": { "primary": "button[type='submit']" },
      "timestamp": 1705320003000,
      "data": { "text": "Sign In" }
    }
  ]
}
```

## Troubleshooting

### Recorder UI Not Visible

**Problem:** Widget doesn't appear after calling `enableRecorder()`

**Solutions:**
1. Check browser console for errors
2. Ensure page has finished loading
3. Try refreshing page and enabling again

### Selector Fails During Playback

**Problem:** "Element not found" error during execution

**Solutions:**
1. **Automatic:** Executor retries with fallback selectors
2. **Automatic:** Executor uses smartFindElement with element text
3. **Manual:** Edit scenario JSON and update selector

### Secret Not Detected

**Problem:** Password field not marked as secret

**Check:**
1. Is the field in a `<form>` element?
2. Does the form have auth keywords (login/register/reset)?
3. Is the field type="password" or has password-related name/id?

**Note:** Phone/email in non-auth forms are NOT secrets by design!

### Actions Too Granular

**Problem:** Too many small actions recorded

**Solution:** Action optimizer runs automatically, but you can also:
1. Increase debounce time in recorder settings
2. Manually edit scenario JSON after recording

## Best Practices

### 1. Naming Scenarios

✅ Good:
- `login_flow`
- `search_products`
- `checkout_guest`

❌ Bad:
- `test1`
- `scenario_2025_01_15`
- `my_recording`

### 2. Using Tags

Group related scenarios:

```javascript
tags: ["auth", "login"]           // Login scenario
tags: ["auth", "register"]        // Register scenario
tags: ["ecommerce", "checkout"]   // Checkout scenario
tags: ["admin", "users"]          // Admin user management
```

### 3. Dependency Design

**Keep dependencies simple:**

✅ Good:
```
checkout_flow → login_flow
```

❌ Bad (deep nesting):
```
scenario_5 → scenario_4 → scenario_3 → scenario_2 → scenario_1
```

### 4. Parameter Naming

Use clear, descriptive parameter names:

✅ Good:
- `email`
- `password`
- `searchQuery`
- `productId`

❌ Bad:
- `param1`
- `val`
- `x`

## Performance Tips

### Execution Speed

Typical execution times:
- Simple form fill: **2-5 seconds**
- Multi-page flow: **10-15 seconds**
- Complex workflow: **30-60 seconds**

### Optimization

1. **Use dependencies** instead of duplicating actions
2. **Combine scenarios** when they're always used together
3. **Remove unnecessary waits** from recorded scenarios
4. **Use specific selectors** (ID, data-testid) when possible

## API Reference

### MCP Tools for Recorder

| Tool | Purpose |
|------|---------|
| `enableRecorder()` | Inject recorder widget into page |
| `executeScenario(name, params)` | Run a scenario with parameters |
| `listScenarios()` | Get all scenarios |
| `searchScenarios(query)` | Search by text/tags |
| `getScenarioInfo(name)` | Get scenario details |
| `deleteScenario(name)` | Delete a scenario |
| `importScenario(json)` | Import from JSON |
| `exportScenario(name)` | Export to JSON |
| `getStorageStats()` | Get statistics |
| `validateStorage()` | Check integrity |

## Next Steps

1. **Try recording** a simple login flow
2. **Execute the scenario** with different credentials
3. **Create dependencies** between scenarios
4. **Share scenarios** with your team (commit `scenarios/` directory)

For detailed technical information, see [RECORDER_SPEC.md](RECORDER_SPEC.md).
