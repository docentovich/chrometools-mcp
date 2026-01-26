# Component Mapping Specification

**Status:** 🔴 Draft / Under Discussion
**Created:** 2026-01-26
**Goal:** Link DOM elements to component source code (React/Vue/Angular/Svelte)

---

## Problem Statement

AI agents can interact with DOM elements but don't understand the relationship between:
- HTML elements in browser → Component code in codebase
- Button on page → `Button.jsx:42` in source files

This makes it difficult for AI to:
- Find which file to edit when user wants to change UI
- Understand component hierarchy and data flow
- Debug state management issues
- Navigate between visual elements and code

---

## Existing Solutions Analysis

### React DevTools Approach

React stores component metadata in DOM via Fiber:

```javascript
domElement.__reactFiber$xxxxx = fiberNode

// Fiber contains:
{
  type: Component,           // Component function/class
  _debugSource: {           // Source map info
    fileName: "src/Button.jsx",
    lineNumber: 42,
    columnNumber: 10
  },
  elementType: Button,
  stateNode: domElement,
  return: parentFiber,      // Parent component
  memoizedState: {...},     // Hooks state
  memoizedProps: {...}      // Props
}
```

**Pros:**
- ✅ Works out of the box in dev mode
- ✅ Accurate file paths and line numbers
- ✅ Access to component hierarchy

**Cons:**
- ⚠️ Limited in production (minified, no debug info)
- ⚠️ Internal API can change between React versions

---

### Vue DevTools Approach

Vue stores component instance directly:

```javascript
// Vue 3
domElement.__vueParentComponent = componentInstance

// Component instance contains:
{
  type: {
    __file: "src/Button.vue",  // File path
    name: "Button"
  },
  props: {...},
  setupState: {...},  // Composition API state
  data: {...}         // Options API data
}
```

**Pros:**
- ✅ Excellent state access (reactive properties)
- ✅ Clear component boundaries
- ✅ Works well in both dev and production

---

### Angular Approach

```javascript
// Angular debug utilities
ng.getComponent(domElement)
ng.getContext(domElement)

// Returns:
{
  componentRef: ComponentRef,
  viewData: ViewData
}
```

---

## Proposed Approaches

### Approach A: Passive Detection (Lightweight)

**Description:** Inject detection script that scans existing framework metadata

**Implementation:**

```javascript
// Inject via content.js or executeScript
function detectComponentMapping() {
  const map = new Map(); // DOM element → Component info

  // React detection
  function scanReactFiber(element) {
    const fiberKey = Object.keys(element).find(key =>
      key.startsWith('__reactFiber') ||
      key.startsWith('__reactInternalInstance')
    );

    if (fiberKey) {
      const fiber = element[fiberKey];
      return extractReactComponentInfo(fiber);
    }
  }

  // Vue detection
  function scanVueComponent(element) {
    const vueKey = Object.keys(element).find(key =>
      key.startsWith('__vue') ||
      key === '__vueParentComponent'
    );

    if (vueKey) {
      const instance = element[vueKey];
      return extractVueComponentInfo(instance);
    }
  }

  // Scan all elements
  document.querySelectorAll('*').forEach(el => {
    const reactInfo = scanReactFiber(el);
    const vueInfo = scanVueComponent(el);

    if (reactInfo || vueInfo) {
      map.set(el, reactInfo || vueInfo);
    }
  });

  return map;
}

function extractReactComponentInfo(fiber) {
  // Walk up fiber tree to find component
  let current = fiber;
  while (current) {
    if (current.type && typeof current.type === 'function') {
      return {
        framework: 'react',
        componentName: current.type.name || current.type.displayName,
        fileName: current._debugSource?.fileName,
        lineNumber: current._debugSource?.lineNumber,
        props: current.memoizedProps,
        state: current.memoizedState,
        componentPath: buildComponentPath(current)
      };
    }
    current = current.return;
  }
}

function buildComponentPath(fiber) {
  const path = [];
  let current = fiber;
  while (current) {
    if (current.type && typeof current.type === 'function') {
      path.unshift(current.type.name || 'Anonymous');
    }
    current = current.return;
  }
  return path.join(' > ');
}
```

**Pros:**
- ✅ No build configuration required
- ✅ Works immediately in dev mode
- ✅ Universal for different frameworks

**Cons:**
- ⚠️ Limited in production builds (minified)
- ⚠️ Depends on framework internals
- ⚠️ May break with framework updates

---

### Approach B: Active Integration (Build Plugin)

**Description:** Babel/Vite plugin that injects metadata during build

**Implementation:**

```javascript
// react-chrometools-plugin.js
export function ChromeToolsReactPlugin() {
  return {
    name: 'chrometools-react-plugin',

    // Babel plugin to add metadata
    visitor: {
      JSXElement(path, state) {
        const componentName = getComponentName(path);
        const fileName = state.file.opts.filename;
        const { line, column } = path.node.loc.start;

        // Add data-attributes with component info
        path.node.openingElement.attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier('data-chrometools-component'),
            t.stringLiteral(componentName)
          ),
          t.jsxAttribute(
            t.jsxIdentifier('data-chrometools-file'),
            t.stringLiteral(fileName)
          ),
          t.jsxAttribute(
            t.jsxIdentifier('data-chrometools-line'),
            t.stringLiteral(String(line))
          )
        );
      }
    }
  };
}
```

**Usage:**

```javascript
// vite.config.js
import { ChromeToolsReactPlugin } from 'chrometools-react-plugin';

export default {
  plugins: [
    react({
      babel: {
        plugins: [ChromeToolsReactPlugin()]
      }
    })
  ]
}
```

**Result in DOM:**

```html
<button
  data-chrometools-component="Button"
  data-chrometools-file="src/components/Button.jsx"
  data-chrometools-line="42"
>
  Click me
</button>
```

**Pros:**
- ✅ Works in production builds
- ✅ Accurate metadata always available
- ✅ No framework API dependencies

**Cons:**
- ❌ Requires build configuration
- ❌ Increases bundle size (data attributes)
- ❌ User must install and configure plugin

---

### Approach C: Hybrid (Recommended?)

**Description:** Combine passive detection + source map resolution

**Flow:**

```javascript
// 1. Passive detection (works always)
const componentInfo = detectFromDevToolsAPI(element);

// 2. Source map resolution (if available)
if (componentInfo.fileName && componentInfo.lineNumber) {
  const sourceMapInfo = await resolveSourceMap(
    componentInfo.fileName,
    componentInfo.lineNumber
  );

  componentInfo.originalFile = sourceMapInfo.source;
  componentInfo.originalLine = sourceMapInfo.line;
}

// 3. Code search in codebase (optional)
if (componentInfo.componentName) {
  const codebaseMatches = await searchComponentInCodebase(
    componentInfo.componentName,
    componentInfo.originalFile
  );

  componentInfo.possibleFiles = codebaseMatches;
}
```

**Source Map Resolution:**

```javascript
// server/source-map-resolver.js
import { SourceMapConsumer } from 'source-map';

export async function resolveSourceMap(fileName, line, column) {
  // Find corresponding .map file
  const mapUrl = fileName + '.map';
  const mapContent = await fetchSourceMap(mapUrl);

  const consumer = await new SourceMapConsumer(mapContent);
  const original = consumer.originalPositionFor({ line, column });

  return {
    source: original.source,      // "webpack://./src/Button.jsx"
    line: original.line,
    column: original.column,
    name: original.name
  };
}
```

**Pros:**
- ✅ Works out of the box in dev
- ✅ Can work in production with source maps
- ✅ No build configuration required (but enhanced if configured)

**Cons:**
- ⚠️ More complex implementation
- ⚠️ Source maps may not be available in production

---

## Comparison Table

| Approach | Complexity | User Setup Required | Accuracy | Production Support |
|----------|------------|---------------------|----------|-------------------|
| **Passive Detection** | Low | None | Medium | ⚠️ Depends on minification |
| **Active Plugin** | High | Yes (build config) | High | ✅ Always works |
| **Hybrid** | Medium | Optional | High | ✅ Works in both modes |

---

## Proposed MCP Tools

### Tool 1: `getComponentMapping`

```javascript
{
  name: "getComponentMapping",
  description: "Get React/Vue/Angular component information for DOM elements",
  inputSchema: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector (optional, scans all if not provided)"
      },
      includeProps: {
        type: "boolean",
        description: "Include component props/state",
        default: false
      },
      includeState: {
        type: "boolean",
        description: "Include component state",
        default: false
      }
    }
  }
}
```

**Response Format:**

```json
{
  "framework": "react",
  "mappings": [
    {
      "selector": "button.MuiButton-root",
      "apomId": "button_45",
      "component": {
        "name": "Button",
        "displayName": "Button",
        "fileName": "src/components/Button.jsx",
        "lineNumber": 42,
        "columnNumber": 10,
        "componentPath": "App > Layout > Header > Button",
        "props": {
          "variant": "contained",
          "color": "primary",
          "onClick": "[Function]"
        },
        "state": null
      }
    }
  ]
}
```

---

### Tool 2: Enhanced `analyzePage`

Add component mapping to existing analyzePage:

```javascript
await analyzePage({
  includeComponents: true  // ⭐ NEW option
});
```

**Response includes component info:**

```json
{
  "buttons": [
    {
      "id": "button_45",
      "text": "Submit",
      "component": {
        "name": "Button",
        "file": "src/components/Button.jsx",
        "line": 42,
        "path": "App > Layout > Header > Button"
      }
    }
  ]
}
```

---

### Tool 3: `findComponentInCodebase`

Search for component definition in project files:

```javascript
{
  name: "findComponentInCodebase",
  description: "Search for component definition in codebase",
  inputSchema: {
    type: "object",
    properties: {
      componentName: {
        type: "string",
        description: "Component name (e.g., 'Button')"
      },
      projectPath: {
        type: "string",
        description: "Project root path"
      }
    },
    required: ["componentName"]
  }
}
```

**Implementation:**

```javascript
async function findComponentInCodebase(componentName, projectPath) {
  // 1. Search by filename
  const fileMatches = await glob(`**/${componentName}.{jsx,tsx,vue}`, {
    cwd: projectPath
  });

  // 2. Search by content (function/class declaration)
  const contentMatches = await grep({
    pattern: `(function|class|const)\\s+${componentName}`,
    path: projectPath,
    glob: "**/*.{js,jsx,ts,tsx,vue}"
  });

  return {
    exactFileMatches: fileMatches,
    contentMatches: contentMatches,
    confidence: calculateConfidence(fileMatches, contentMatches)
  };
}
```

---

## Component State Access

### React State Extraction

**Class Components:**

```javascript
function getReactComponentState(element) {
  const fiber = element.__reactFiber$xxxxx;

  // Class component
  if (fiber.stateNode && fiber.stateNode.state) {
    return {
      type: 'class',
      state: fiber.stateNode.state,
      componentName: fiber.type?.name
    };
  }

  // Function component (hooks)
  if (fiber.memoizedState) {
    return {
      type: 'hooks',
      state: extractHooksState(fiber.memoizedState),
      componentName: fiber.type?.name
    };
  }
}
```

**Hooks Extraction:**

```javascript
function extractHooksState(memoizedState) {
  const hooks = [];
  let current = memoizedState;
  let hookIndex = 0;

  while (current) {
    hooks.push({
      index: hookIndex,
      value: current.memoizedState,
      type: detectHookType(current)
    });

    current = current.next;
    hookIndex++;
  }

  return hooks;
}

function detectHookType(hook) {
  if (hook.queue) return 'useState';
  if (hook.create) return 'useEffect';
  if (hook.memoizedState && !hook.next) return 'useMemo';
  return 'unknown';
}
```

**React Hooks Problem:**

```javascript
// Component code:
function TodoList() {
  const [todos, setTodos] = useState([]);
  const [filter, setFilter] = useState('all');
  const [username, setUsername] = useState('');
}

// What we see in fiber:
{
  memoizedState: value1,  // todos - NO VARIABLE NAME!
  next: {
    memoizedState: value2,  // filter - NO NAME!
    next: {
      memoizedState: value3,  // username - NO NAME!
      next: null
    }
  }
}
```

**Problem:** No variable names, only indices!

**Solution 1: Heuristics for guessing names**

```javascript
function guessHookName(hookValue, componentName) {
  if (Array.isArray(hookValue)) {
    if (hookValue.length > 0 && hookValue[0].id) {
      return 'items/todos/list';  // Array of objects with id
    }
    return 'array';
  }

  if (typeof hookValue === 'string') {
    if (hookValue.includes('@')) return 'email';
    if (hookValue.length < 50) return 'text/name/title';
    return 'string';
  }

  if (typeof hookValue === 'boolean') {
    return 'isLoading/isOpen/isActive';
  }

  return 'unknown';
}
```

**Solution 2: Babel plugin for dev builds**

```javascript
// Add metadata to hooks during compilation:
const [todos, setTodos] = useState([]);

// ↓ compiles to:
const [todos, setTodos] = useState([], {
  __devHookName: 'todos',
  __devHookType: 'useState'
});
```

---

### Vue State Extraction

Vue provides direct access to reactive state:

```javascript
function getVueComponentState(element) {
  // Vue 3
  const vueInstance = element.__vueParentComponent;
  if (vueInstance) {
    return {
      framework: 'vue3',
      componentName: vueInstance.type?.name,

      // Data
      data: vueInstance.data,

      // Setup state (Composition API)
      setupState: vueInstance.setupState,

      // Props
      props: vueInstance.props,

      // Computed
      computed: extractComputedProperties(vueInstance)
    };
  }

  // Vue 2
  const vue2Instance = element.__vue__;
  if (vue2Instance) {
    return {
      framework: 'vue2',
      componentName: vue2Instance.$options.name,
      data: vue2Instance._data,
      props: vue2Instance._props,
      computed: vue2Instance._computedWatchers
    };
  }
}
```

**Example Response:**

```json
{
  "framework": "vue3",
  "componentName": "TodoList",
  "setupState": {
    "todos": [
      { "id": 1, "text": "Buy milk", "done": false },
      { "id": 2, "text": "Write code", "done": true }
    ],
    "username": "John Doe",
    "isLoading": false
  },
  "props": {
    "title": "My Todos"
  },
  "computed": {
    "completedCount": 1,
    "remainingCount": 1
  }
}
```

---

### Angular State Extraction

```javascript
function getAngularComponentState(element) {
  const component = ng.getComponent(element);
  const context = ng.getContext(element);

  if (!component) return null;

  // Get all public properties
  const state = {};
  for (const key in component) {
    if (!key.startsWith('_') && typeof component[key] !== 'function') {
      state[key] = component[key];
    }
  }

  return {
    framework: 'angular',
    componentName: component.constructor.name,
    state: state,
    inputs: extractInputs(component),
    outputs: extractOutputs(component)
  };
}
```

---

## Tool 4: `getComponentState`

```javascript
{
  name: "getComponentState",
  description: "Get component state (React/Vue/Angular) for element",
  inputSchema: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description: "CSS selector or APOM ID"
      },
      includeProps: {
        type: "boolean",
        description: "Include component props",
        default: true
      },
      includeComputed: {
        type: "boolean",
        description: "Include computed properties (Vue)",
        default: false
      },
      depth: {
        type: "number",
        description: "Max depth for nested objects (default: 3)",
        default: 3
      }
    },
    required: ["selector"]
  }
}
```

**Response Format:**

```json
{
  "framework": "react",
  "componentName": "TodoList",
  "componentPath": "App > Dashboard > TodoList",
  "file": "src/components/TodoList.jsx",
  "line": 15,

  "state": {
    "type": "hooks",
    "hooks": [
      {
        "index": 0,
        "type": "useState",
        "guessedName": "todos",
        "value": [
          { "id": 1, "text": "Buy milk", "done": false },
          { "id": 2, "text": "Write code", "done": true }
        ],
        "confidence": "high"
      },
      {
        "index": 1,
        "type": "useState",
        "guessedName": "filter",
        "value": "all",
        "confidence": "medium"
      }
    ]
  },

  "props": {
    "title": "My Todos",
    "onComplete": "[Function]",
    "userId": 42
  },

  "context": {
    "theme": "dark",
    "user": { "name": "John", "role": "admin" }
  }
}
```

---

## State Serialization

Handle circular references and non-serializable values:

```javascript
function serializeState(state, depth = 3, visited = new WeakSet()) {
  if (depth === 0) return '[Max Depth]';
  if (state === null || state === undefined) return state;

  // Primitive types
  if (typeof state !== 'object') {
    return state;
  }

  // Circular reference
  if (visited.has(state)) {
    return '[Circular]';
  }
  visited.add(state);

  // Function
  if (typeof state === 'function') {
    return `[Function: ${state.name || 'anonymous'}]`;
  }

  // Promise
  if (state instanceof Promise) {
    return '[Promise]';
  }

  // Array
  if (Array.isArray(state)) {
    return state.map(item => serializeState(item, depth - 1, visited));
  }

  // Object
  const serialized = {};
  for (const key in state) {
    try {
      serialized[key] = serializeState(state[key], depth - 1, visited);
    } catch (err) {
      serialized[key] = `[Error: ${err.message}]`;
    }
  }

  return serialized;
}
```

---

## State Support Matrix

| Framework | State Access | Confidence | Notes |
|-----------|-------------|------------|-------|
| **React Class** | ✅ Full | High | Direct access to `this.state` |
| **React Hooks** | ✅ Partial | Medium | No variable names, only indices |
| **Vue 2** | ✅ Full | High | Reactive `_data` |
| **Vue 3** | ✅ Full | High | `setupState` and reactive props |
| **Angular** | ✅ Good | High | Public properties accessible |
| **Svelte** | ❓ TBD | Unknown | Needs investigation |

---

## Production vs Development

### Development Mode (More Info Available):

```json
{
  "state": {
    "hooks": [
      {
        "index": 0,
        "type": "useState",
        "guessedName": "todos",
        "value": [...],
        "debugInfo": {
          "fileName": "TodoList.jsx",
          "lineNumber": 15
        }
      }
    ]
  }
}
```

### Production Mode (Minimal):

```json
{
  "state": {
    "hooks": [
      {
        "index": 0,
        "type": "unknown",
        "guessedName": "array_of_objects",
        "value": [...],
        "confidence": "low"
      }
    ]
  }
}
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   Chrome Browser                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  DOM Elements with Framework Metadata            │   │
│  │  ├─ button.__reactFiber → Component Info         │   │
│  │  ├─ div.__vue → Vue Instance                     │   │
│  │  └─ data-chrometools-* attributes (if plugin)    │   │
│  └──────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ↓
┌─────────────────────────────────────────────────────────┐
│              Component Detection Script                  │
│  (Injected via Extension/Puppeteer)                     │
│  ├─ detectReactFiber()                                  │
│  ├─ detectVueComponent()                                │
│  ├─ detectAngularComponent()                            │
│  └─ extractComponentMetadata()                          │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ↓
┌─────────────────────────────────────────────────────────┐
│              MCP Server (chrometools-mcp)                │
│  ┌──────────────────────────────────────────────────┐   │
│  │  getComponentMapping()                           │   │
│  │  ├─ Get component info from page                │   │
│  │  ├─ Resolve source maps (if production)         │   │
│  │  └─ Enrich with file paths                      │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  getComponentState()                             │   │
│  │  ├─ Extract state from framework APIs           │   │
│  │  ├─ Serialize with depth limit                  │   │
│  │  └─ Guess variable names (React Hooks)          │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  analyzePage({ includeComponents: true })       │   │
│  │  ├─ Standard APOM analysis                      │   │
│  │  ├─ Merge with component info                   │   │
│  │  └─ Return enriched elements                    │   │
│  └──────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ↓
┌─────────────────────────────────────────────────────────┐
│         Optional: Codebase Integration                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  findComponentInCodebase()                       │   │
│  │  ├─ Search by file name (glob)                  │   │
│  │  ├─ Search by content (grep)                    │   │
│  │  └─ Return file paths + confidence              │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Passive Detection (2-3 days)
- [ ] Create detection script for React
- [ ] Create detection script for Vue
- [ ] Integrate with analyzePage
- [ ] Add tool `getComponentMapping`
- [ ] Testing on dev builds

### Phase 2: State Extraction (2-3 days)
- [ ] React Class Component state
- [ ] React Hooks state with guessing
- [ ] Vue 2/3 state
- [ ] Add tool `getComponentState`
- [ ] State serialization with depth limit

### Phase 3: Source Map Resolution (2-3 days)
- [ ] Add source-map library
- [ ] Implement resolveSourceMap()
- [ ] Integrate with component detection
- [ ] Testing on production builds

### Phase 4: Codebase Search (1-2 days)
- [ ] Implement findComponentInCodebase()
- [ ] Add confidence scoring
- [ ] Integrate with MCP tools

### Phase 5: Advanced Features (Optional)
- [ ] Angular support
- [ ] Svelte support
- [ ] Component hierarchy visualization
- [ ] Hot reload detection
- [ ] Build plugin for data-attributes

---

## Open Questions

❓ **Which frameworks are priority?**
- React, Vue, Angular, Svelte?
- Order of implementation?

❓ **Should we support production builds?**
- Source map resolution adds complexity
- Many apps don't publish source maps
- Worth the effort?

❓ **Should we integrate with codebase search?**
- File search via glob/grep
- Requires project path
- Confidence scoring needed

❓ **Should we require build plugin or work without config?**
- Passive detection = no setup, but limited
- Build plugin = requires config, but always accurate
- Hybrid approach?

❓ **How important is state access vs just component mapping?**
- State adds significant complexity
- React Hooks have no variable names
- Is it worth the effort for debugging use cases?

❓ **Performance concerns?**
- Scanning all DOM elements can be slow
- State serialization can be expensive
- Should we cache? Lazy load?

❓ **Security considerations?**
- State may contain sensitive data (tokens, passwords)
- Should we have opt-in for state access?
- Depth limits sufficient?

---

## Use Case Examples

### Example 1: AI Agent Finding Component to Edit

**Without component mapping:**
```
AI: "Submit button found at button.MuiButton-root"
User: "Where is this in code?"
AI: "I don't know, need to search codebase"
```

**With component mapping:**
```
AI: "Submit button found at button.MuiButton-root
    Component: Button (src/components/Button.jsx:42)
    Path: App > Layout > Header > Button
    Props: { variant: 'contained', onClick: handleSubmit }"

User: "Change color to secondary"
AI: "Opening src/components/Button.jsx:42 and changing color prop..."
```

---

### Example 2: Debugging Form State

**With component state:**
```
AI: analyzePage({ includeState: true })

AI: "Form TodoForm has state:
     - inputValue: 'Buy groceries'
     - errors: { text: 'Too short' }
     - isSubmitting: false

     I see validation error. Text 'Buy groceries' (13 chars)
     is considered too short. Checking component..."

AI: getComponentState({ selector: 'form.todo-form' })

AI: "Found in src/components/TodoForm.jsx:42
     Minimum text length: 15 characters
     Should we change to 10?"
```

---

## Performance Considerations

### Optimization 1: Caching

```javascript
// Cache component info between requests
const componentCache = new Map(); // selector → component info

// Invalidate on DOM mutations
const observer = new MutationObserver(() => {
  componentCache.clear();
});
```

### Optimization 2: Lazy Loading for Large State

```javascript
{
  "state": {
    "todos": {
      "type": "array",
      "length": 1000,
      "preview": [...first 10 items...],
      "loadMore": "Use getComponentState({ selector, expandPath: 'todos' })"
    }
  }
}
```

### Optimization 3: Selective Scanning

```javascript
// Don't scan entire page if selector provided
if (selector) {
  const element = document.querySelector(selector);
  return detectComponent(element);
} else {
  // Scan only interactive elements
  return scanInteractiveElements();
}
```

---

## Security & Privacy

### Concerns:

1. **Sensitive data in state**
   - Passwords, tokens, PII
   - Should be filtered or masked

2. **Function serialization**
   - May expose business logic
   - Convert to `[Function: name]`

3. **Source maps in production**
   - Exposes original source code paths
   - Many companies don't publish source maps for this reason

### Mitigations:

```javascript
// Option 1: Opt-in for state access
getComponentState({
  includeState: true,  // Explicit opt-in
  maskSensitive: true  // Mask fields like 'password', 'token'
})

// Option 2: Depth limits
serializeState(state, depth = 3)

// Option 3: Exclude patterns
{
  excludeKeys: ['password', 'token', 'secret', 'key', 'auth']
}
```

---

## Alternative Approaches Considered

### Browser Extension with Native Hooks

**Pros:**
- Could hook into React DevTools APIs directly
- More stable than internal APIs

**Cons:**
- Requires separate extension installation
- Chrome-only (not cross-browser)

### Server-Side Rendering (SSR) Metadata

**Pros:**
- Component info embedded during SSR
- Works without client-side detection

**Cons:**
- Only works for SSR apps
- Client-side components not covered

### AST Analysis of Build Output

**Pros:**
- Works offline (no browser needed)
- Can analyze before deployment

**Cons:**
- Doesn't show runtime state
- Complex with code splitting

---

## References

- [React DevTools Implementation](https://github.com/facebook/react/tree/main/packages/react-devtools-shared)
- [Vue DevTools Source](https://github.com/vuejs/devtools)
- [Source Map Specification](https://sourcemaps.info/spec.html)
- [Babel Plugin Handbook](https://github.com/jamiebuilds/babel-handbook)

---

**Status:** 🔴 Awaiting decision on approach and priorities

**Next Steps:**
1. Choose approach (A, B, or C)
2. Prioritize frameworks
3. Decide on state access scope
4. Create implementation plan
