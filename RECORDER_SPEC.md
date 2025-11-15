# Scenario Recorder & Executor - Technical Specification

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [User Scenarios](#user-scenarios)
4. [Data Structures](#data-structures)
5. [Recording Flow](#recording-flow)
6. [Execution Flow](#execution-flow)
7. [Dependency Management](#dependency-management)
8. [Secret Management](#secret-management)
9. [Action Types](#action-types)
10. [Corner Cases](#corner-cases)
11. [Block Diagrams](#block-diagrams)
12. [API Reference](#api-reference)

---

## Overview

The Scenario Recorder allows users to record browser interactions and replay them with different parameters. It supports:

- **Visual recording** via injected UI widget in browser
- **Automatic optimization** of recorded actions
- **Secret detection** and separate storage
- **Dependency chaining** between scenarios
- **Parameter substitution** for reusable scenarios
- **AI-assisted** dependency analysis

---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Chrome)                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  recorder-script.js (Injected)                             │ │
│  │  ├─ UI Widget (Start/Stop/Save)                            │ │
│  │  ├─ Event Listeners (click, type, scroll, select)          │ │
│  │  ├─ SecretDetector (identifies sensitive fields)           │ │
│  │  └─ ActionOptimizer (combines related actions)             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                          ↓ page.exposeFunction                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Server (Node.js)                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  scenario-storage.js                                       │ │
│  │  ├─ Save/Load scenarios                                    │ │
│  │  ├─ Manage index.json                                      │ │
│  │  └─ Encrypt/Decrypt secrets                                │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  scenario-executor.js                                      │ │
│  │  ├─ Execute scenario chains                                │ │
│  │  ├─ Parameter substitution                                 │ │
│  │  └─ Error handling & retry                                 │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  dependency-resolver.js                                    │ │
│  │  ├─ Resolve dependency chains                              │ │
│  │  ├─ Check prerequisites                                    │ │
│  │  └─ Conditional execution                                  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                 File System (~/.chrometools-scenarios/)          │
│  scenarios/                  secrets/                            │
│  ├─ index.json              ├─ .gitignore                       │
│  ├─ login_flow.json         ├─ login_credentials.json           │
│  ├─ search_dashboard.json   └─ api_keys.json                    │
│  └─ checkout_flow.json                                          │
└─────────────────────────────────────────────────────────────────┘
```

### Module Responsibilities

| Module | Responsibility | Size |
|--------|---------------|------|
| `recorder-script.js` | Browser-side recording, UI, event capture | ~800 lines |
| `scenario-executor.js` | Execution engine, action dispatch | ~400 lines |
| `scenario-storage.js` | File I/O, indexing, encryption | ~300 lines |
| `secret-detector.js` | Identify sensitive fields | ~200 lines |
| `dependency-resolver.js` | Dependency graph, execution order | ~250 lines |
| `action-optimizer.js` | Combine/simplify actions | ~200 lines |

---

## User Scenarios

### Scenario 1: Record Login Flow

```
User Actions:
1. AI calls: enableRecorder()
2. Browser shows recorder UI widget
3. User clicks "Start Recording"
4. User enters scenario name: "login_flow"
5. User navigates to https://example.com/login
6. User types email in email field
7. User types password in password field
8. User clicks "Login" button
9. Page navigates to dashboard
10. User clicks "Stop & Save" in widget

System Actions:
1. Recorder captures all events
2. Detects email + password = authentication form
3. Marks email and password as secrets
4. Auto-inserts wait after click
5. Shows UI: "Detected 2 secrets, 4 actions"
6. User confirms secrets to save separately
7. Saves to:
   - scenarios/login_flow.json (with {{email}}, {{password}})
   - secrets/login_flow_credentials.json
8. Updates scenarios/index.json

Result:
- Reusable login scenario
- Secrets stored separately
- Available for AI to use
```

### Scenario 2: Record with Dependencies

```
User Actions:
1. Wants to record "checkout_flow"
2. Starts recording
3. Already on cart page (after manual navigation & login)
4. Clicks "Proceed to Checkout"
5. Fills shipping form
6. Clicks "Place Order"
7. Stops recording

System Actions:
1. Detects first action is on cart page
2. AI analyzes: suggests dependencies
   - "login_flow" (authentication required)
   - "add_to_cart" (cart must have items)
3. Shows dependency UI with suggestions
4. User confirms dependencies
5. Saves with metadata.dependencies array

Result:
- Scenario with explicit dependencies
- AI can execute full chain automatically
```

### Scenario 3: Execute Scenario Chain

```
User Request to AI:
"Purchase iPhone 15 on example.com"

AI Flow:
1. Searches scenarios: listScenarios({ search: "purchase checkout" })
2. Finds "checkout_flow"
3. Sees dependencies: ["login_flow", "add_to_cart"]
4. Calls: executeScenario({
     name: "checkout_flow",
     parameters: {
       productId: "iphone-15",
       quantity: 1,
       shippingAddress: {...}
     }
   })

MCP Server Flow:
1. Loads checkout_flow.json
2. Resolves dependencies:
   a. Executes login_flow (loads secrets automatically)
   b. Executes add_to_cart with productId parameter
3. Executes checkout_flow
4. Returns success + screenshot

Result:
- Full purchase completed
- Only 1 MCP call from AI
- Automatic dependency handling
```

---

## Data Structures

### Scenario File Format

```json
{
  "name": "checkout_flow",
  "version": "1.0",

  "metadata": {
    "title": "Checkout and Complete Order",
    "description": "Completes the checkout process for a product",
    "tags": ["ecommerce", "checkout", "purchase"],
    "url": "https://example.com/cart",
    "recordedAt": "2025-01-15T10:30:00Z",
    "author": "user",

    "dependencies": [
      {
        "scenario": "login_flow",
        "optional": false,
        "reason": "Must be authenticated",
        "condition": {
          "check": "isAuthenticated",
          "skipIf": true
        }
      },
      {
        "scenario": "add_to_cart",
        "optional": false,
        "reason": "Cart must have items",
        "parameters": {
          "productId": "{{productId}}",
          "quantity": "{{quantity}}"
        },
        "captureOutput": "cartItemId"
      }
    ],

    "parameters": {
      "productId": {
        "type": "string",
        "required": true,
        "description": "Product to purchase",
        "example": "iphone-15"
      },
      "quantity": {
        "type": "number",
        "required": false,
        "default": 1
      },
      "shippingAddress": {
        "type": "object",
        "required": true,
        "properties": {
          "street": "string",
          "city": "string",
          "zip": "string"
        }
      }
    },

    "secrets": ["email", "password", "creditCard"]
  },

  "chain": [
    {
      "id": "action-1",
      "type": "click",
      "clickType": "button",
      "selector": {
        "type": "class",
        "value": ".checkout-button"
      },
      "element": {
        "tag": "button",
        "text": "Proceed to Checkout",
        "type": "button"
      },
      "timestamp": 1705320600000
    },
    {
      "id": "action-2",
      "type": "wait",
      "waitType": "navigation",
      "urlChange": {
        "from": "/cart",
        "to": "/checkout"
      },
      "timeout": 5000
    },
    {
      "id": "action-3",
      "type": "type",
      "fieldType": "text",
      "selector": {
        "type": "name",
        "value": "[name='street']"
      },
      "value": "{{shippingAddress.street}}",
      "clearFirst": true
    }
  ]
}
```

### Secrets File Format

```json
{
  "name": "login_flow_credentials",
  "createdAt": "2025-01-15T10:30:00Z",
  "lastModified": "2025-01-15T10:30:00Z",

  "secrets": {
    "email": "user@example.com",
    "password": "MySecretPassword123",
    "phone": "+1234567890"
  }
}
```

### Index File Format

```json
{
  "version": "1.0",
  "lastUpdated": "2025-01-15T12:00:00Z",

  "scenarios": [
    {
      "name": "login_flow",
      "title": "Login to Example.com",
      "description": "Authenticates user on example.com",
      "tags": ["authentication", "login"],
      "dependencies": [],
      "parameters": [],
      "secrets": ["email", "password"],
      "file": "scenarios/login_flow.json"
    },
    {
      "name": "checkout_flow",
      "title": "Checkout and Complete Order",
      "description": "Completes the checkout process",
      "tags": ["ecommerce", "checkout"],
      "dependencies": ["login_flow", "add_to_cart"],
      "parameters": ["productId", "quantity", "shippingAddress"],
      "secrets": ["creditCard"],
      "file": "scenarios/checkout_flow.json"
    }
  ],

  "stats": {
    "totalScenarios": 2,
    "totalSecrets": 2,
    "lastRecorded": "2025-01-15T12:00:00Z"
  }
}
```

---

## Recording Flow

### Block Diagram: Recording Session

```
┌─────────────────────────────────────────────────────────────────┐
│                     START RECORDING                              │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. AI calls: enableRecorder({ options })                        │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. MCP injects recorder-script.js into page                     │
│     - Creates UI widget (hidden initially)                       │
│     - Sets up page.exposeFunction('saveScenarioToMCP')          │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. User clicks "Start Recording" in browser widget              │
│     - Enters scenario name                                       │
│     - Widget shows: 🔴 RECORDING                                 │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Event listeners capture:                                     │
│     □ Click → recordClick()                                      │
│     □ Input → recordInput() → detectSecret()                     │
│     □ Select → recordSelect()                                    │
│     □ Scroll → recordScroll() (debounced)                        │
│     □ Keypress → recordKeypress() (important keys only)          │
│     □ Navigation → recordNavigation()                            │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Actions stored in array with timestamps                      │
│     - Real-time display in widget                                │
│     - Visual feedback (e.g., 🔒 for secrets)                     │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. User clicks "Stop & Save"                                    │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. optimizeChain(actions)                                       │
│     - Combine sequential types into one                          │
│     - Detect patterns (login, search, etc.)                      │
│     - Insert auto-waits after navigation                         │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  8. extractSecrets(optimizedChain)                               │
│     - Identify secret fields by context                          │
│     - Replace values with {{parameterName}}                      │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  9. Show confirmation UI:                                        │
│     □ Detected secrets (checkbox to save separately)             │
│     □ Parameterizable values (checkbox to make parameter)        │
│     □ Suggested dependencies (AI analysis)                       │
│     □ Metadata (title, description, tags)                        │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  10. User confirms → saveScenarioToMCP(scenarioData)             │
│      via page.exposeFunction                                     │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  11. MCP Server saves:                                           │
│      - scenarios/{name}.json                                     │
│      - secrets/{name}_credentials.json (if has secrets)          │
│      - Updates scenarios/index.json                              │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  12. Show success message in widget                              │
│      "✅ Scenario 'login_flow' saved! (4 actions, 2 secrets)"    │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      END RECORDING                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Execution Flow

### Block Diagram: Scenario Execution

```
┌─────────────────────────────────────────────────────────────────┐
│  START: AI calls executeScenario({ name, parameters })          │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Load scenario file: scenarios/{name}.json                    │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Check metadata.dependencies                                  │
│     Has dependencies? ──Yes──┐                                   │
│            │                  │                                   │
│           No                  │                                   │
│            │                  │                                   │
│            ▼                  ▼                                   │
│        Skip to 6    ┌──────────────────────┐                     │
│                     │ 3. For each dependency│                    │
│                     └──────────┬────────────┘                    │
│                                │                                  │
│                                ▼                                  │
│                     ┌──────────────────────┐                     │
│                     │ Check condition       │                    │
│                     │ (e.g., isAuthenticated)│                   │
│                     └──────────┬────────────┘                    │
│                                │                                  │
│                    ┌───────────┴────────────┐                    │
│                    │                        │                    │
│                Skip?                      Run?                   │
│                    │                        │                    │
│                    ▼                        ▼                    │
│             Next dependency    executeScenario(dep)              │
│                                (recursive)                       │
│                                     │                            │
│                                     ▼                            │
│                              Capture output                      │
│                              (if captureOutput)                  │
│                                     │                            │
│                                     ▼                            │
│                              Success? ──No──> optional? ──No─┐   │
│                                  │                    │       │   │
│                                 Yes                  Yes      │   │
│                                  │                    │    Throw │
│                                  │                    │    Error │
│                                  ▼                    ▼       │   │
│                           Next dependency      Warn & Continue  │
│                                  │                    │       │   │
└──────────────────────────────────┼────────────────────┼───────┼───┘
                                   │                    │       │
                                   ▼                    ▼       ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. All dependencies resolved                                    │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. Load secrets (if metadata.secrets exists)                    │
│     - Load secrets/{name}_credentials.json                       │
│     - Merge with provided parameters                             │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  8. Execute chain: for each action in scenario.chain             │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  9. Substitute parameters in action                              │
│     "{{email}}" → "user@example.com"                             │
│     "{{shippingAddress.street}}" → "123 Main St"                 │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  10. Execute action based on type:                               │
│      - click → page.click(selector)                              │
│      - type → page.type(selector, value)                         │
│      - select → selectOption(selector, value)                    │
│      - scroll → page.evaluate(scroll)                            │
│      - wait → page.waitFor...()                                  │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  11. Error handling                                              │
│      Retry on element not found (up to 3 times)                  │
│      Use smartFindElement for alternative selectors              │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  12. Generate hints after action                                 │
│      - Modal opened?                                             │
│      - Page changed?                                             │
│      - Errors appeared?                                          │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  13. All actions completed                                       │
│      Return: { success, results, screenshots, hints }            │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                         END                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Dependency Management

### Dependency Resolution Algorithm

```javascript
function resolveDependencies(scenario, providedParams) {
  const executionPlan = [];
  const visited = new Set();
  const executing = new Set();

  function visit(scenarioName, params) {
    // Cycle detection
    if (executing.has(scenarioName)) {
      throw new Error(`Circular dependency detected: ${scenarioName}`);
    }

    if (visited.has(scenarioName)) {
      return; // Already resolved
    }

    executing.add(scenarioName);

    const scenario = loadScenario(scenarioName);

    // Recursively resolve dependencies
    if (scenario.metadata.dependencies) {
      for (const dep of scenario.metadata.dependencies) {
        const depParams = resolveParams(dep.parameters, params);
        visit(dep.scenario, depParams);
      }
    }

    // Add to execution plan
    executionPlan.push({ scenario: scenarioName, params });

    executing.delete(scenarioName);
    visited.add(scenarioName);
  }

  visit(scenario.name, providedParams);

  return executionPlan;
}
```

---

## Corner Cases

### 1. Custom Select (React Select, Material UI)

**Problem:** Standard `<select>` recording doesn't work.

**Solution:**
```javascript
recordClick(event) {
  // Detect custom select patterns
  if (this.isCustomSelectOption(event.target)) {
    const container = event.target.closest('[role="listbox"], .select-container');
    const option = event.target;

    this.actions.push({
      type: 'select',
      selectType: 'custom',
      containerSelector: this.generateSmartSelector(container),
      optionSelector: this.generateSmartSelector(option),
      optionText: option.textContent.trim(),
      steps: [
        { action: 'click', selector: containerSelector },
        { action: 'wait', duration: 300 },
        { action: 'click', selector: optionSelector }
      ]
    });

    return; // Don't record as regular click
  }
}
```

### 2. Multi-step Forms

**Problem:** Forms span multiple pages, how to record as one scenario?

**Solution:**
- Record entire flow including page transitions
- Auto-insert waits after each submit
- Detect common multi-step patterns

```javascript
detectMultiStepForm() {
  // Indicators of multi-step form
  const stepIndicators = document.querySelectorAll(
    '.step-indicator, .progress-bar, [class*="step"]'
  );

  if (stepIndicators.length > 0) {
    this.isMultiStepForm = true;
    this.currentStep = detectCurrentStep();
  }
}
```

### 3. Conditional Dependencies

**Problem:** Run login only if not already authenticated.

**Solution:**
```json
{
  "dependencies": [
    {
      "scenario": "login_flow",
      "condition": {
        "check": "isAuthenticated",
        "skipIf": true
      }
    }
  ]
}
```

```javascript
async function shouldRunDependency(dep, page) {
  if (!dep.condition) return true;

  const checkResult = await checks[dep.condition.check](page);

  if (dep.condition.skipIf && checkResult) {
    console.log(`⏭️ Skipping ${dep.scenario} (condition met)`);
    return false;
  }

  return true;
}

const checks = {
  async isAuthenticated(page) {
    const hints = await generatePageHints(page);
    return hints.pageType === 'dashboard' || hints.sessionActive;
  },

  async hasItemsInCart(page) {
    const cartCount = await page.$eval('.cart-count', el => el.textContent);
    return parseInt(cartCount) > 0;
  }
};
```

### 4. Secrets in Non-Auth Forms

**Problem:** Phone number in "Create Post" form shouldn't be a secret.

**Solution:**
```javascript
detectSecretField(element, formElement) {
  // ONLY in authentication forms
  if (!this.isAuthenticationForm(formElement)) {
    return { isSecret: false };
  }

  // Now check field types...
  if (element.type === 'tel') {
    return { isSecret: true, secretType: 'phone' };
  }
}

isAuthenticationForm(form) {
  const hasPassword = form.querySelector('input[type="password"]');
  const url = window.location.href.toLowerCase();
  const hasAuthUrl = /login|signin|register|signup/.test(url);

  return hasPassword && hasAuthUrl;
}
```

### 5. Parameter vs Hardcoded Value

**Problem:** When to parameterize, when to hardcode?

**Solution:**
- Search queries → always parameterize
- Emails/passwords → always secret
- Names, titles → offer parameterization in UI
- Static text (e.g., category selection) → hardcode

```javascript
shouldParameterize(action) {
  // Always parameterize
  if (action.fieldType === 'search') return true;
  if (action.isSecret) return true; // Secrets are special params

  // Offer to user
  if (action.fieldType === 'text' && action.value.length > 0) {
    return 'offer'; // Show in UI
  }

  // Hardcode
  return false;
}
```

### 6. Stale Selectors

**Problem:** Selector works during recording but fails during playback.

**Solution:**
```javascript
async function executeClickWithRetry(selector, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.click(selector.value);
      return { success: true };
    } catch (error) {
      if (attempt === maxRetries) throw error;

      // Try to find element using smartFind
      const alternatives = await smartFindElement({
        description: selector.originalElement.text || selector.originalElement.id
      });

      if (alternatives.candidates.length > 0) {
        selector.value = alternatives.candidates[0].selector;
        console.log(`🔄 Retry with alternative selector: ${selector.value}`);
      } else {
        await new Promise(r => setTimeout(r, 1000)); // Wait and retry
      }
    }
  }
}
```

---

## API Reference

### MCP Tools

#### `enableRecorder(options)`

Enables the recorder UI widget in the current page.

```javascript
enableRecorder({
  options: {
    autoStart: false,
    recordPasswords: true,
    smartOptimize: true
  }
})
```

**Returns:** Success confirmation

#### `listScenarios(filter)`

Lists all available scenarios with optional filtering.

```javascript
listScenarios({
  search: "login",
  tags: ["authentication"],
  hasDependencies: false
})
```

**Returns:**
```json
{
  "scenarios": [
    {
      "name": "login_flow",
      "title": "Login to Example.com",
      "description": "...",
      "tags": [...],
      "dependencies": [...],
      "parameters": [...],
      "file": "scenarios/login_flow.json"
    }
  ]
}
```

#### `executeScenario(config)`

Executes a scenario with parameters.

```javascript
executeScenario({
  name: "checkout_flow",
  parameters: {
    productId: "iphone-15",
    quantity: 1,
    shippingAddress: {
      street: "123 Main St",
      city: "New York",
      zip: "10001"
    }
  },
  overrideSecrets: {
    // Optional: override stored secrets
    email: "temp@example.com"
  }
})
```

**Returns:**
```json
{
  "success": true,
  "scenario": "checkout_flow",
  "dependenciesExecuted": ["login_flow", "add_to_cart"],
  "actionsExecuted": 12,
  "duration": 8500,
  "screenshots": [...],
  "hints": {...}
}
```

---

## Implementation Checklist

- [ ] Create directory structure
- [ ] Implement `recorder-script.js`
- [ ] Implement `scenario-executor.js`
- [ ] Implement `scenario-storage.js`
- [ ] Implement `secret-detector.js`
- [ ] Implement `dependency-resolver.js`
- [ ] Implement `action-optimizer.js`
- [ ] Add MCP tools to `index.js`
- [ ] Create tests for corner cases
- [ ] Update documentation

---

## Version History

- **v1.0** - Initial specification (2025-01-15)
