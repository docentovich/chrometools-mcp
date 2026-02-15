# DatePicker Models Implementation Plan

**Status**: Architecture approved, implementation pending
**Date**: 2026-02-15
**Decision**: Separate models for each UI framework (approved)

---

## Architecture Decision

### ✅ APPROVED: Separate Models for Each Framework

**Rationale**:
- DatePickers are fundamentally different across frameworks (input-based vs popup vs custom render)
- Impossible to create universal logic without brittle code
- Each framework has specific interactions and edge cases
- Easier to maintain, test, and extend
- API remains unified for AI - `executeModelAction` works the same way

**Structure**:
```
models/
  ├── mui-datepicker-model.js       → MuiDatePickerModel
  ├── ant-datepicker-model.js       → AntDatePickerModel
  ├── react-datepicker-model.js     → ReactDatePickerModel
  └── vuetify-datepicker-model.js   → VuetifyDatePickerModel (future)

utils/actions/
  ├── mui-datepicker-action.js      → executeMuiDatePickerAction
  ├── ant-datepicker-action.js      → executeAntDatePickerAction
  └── react-datepicker-action.js    → executeReactDatePickerAction
```

---

## Current Status

### ✅ Implemented

1. **Model System with Strategy Pattern**
   - ✅ `models/ElementModel.js` - base class
   - ✅ `models/index.js` - 13 concrete models
   - ✅ `models/ModelRegistry.js` - registry with findModel()
   - ✅ Integration in `apom-tree-converter.js`

2. **executeModelAction Tool**
   - ✅ Supports APOM ID (`id` parameter)
   - ✅ Supports CSS selector (`selector` parameter)
   - ✅ Routing via ModelRegistry.getActionHandler()
   - ✅ Action parameters via `params`

3. **Action Handlers (Reusable)**
   - ✅ `executeClickAction` - used by all models
   - ✅ `executeTypeAction` - TxtInp, DateInp, Range, Color
   - ✅ `executeHoverAction` - all models
   - ✅ `executeScreenshotAction` - all models
   - ✅ `executeSelectOptionAction` - Sel (select)
   - ✅ `executeCheckAction` - Chk, Radio (check/uncheck/toggle)

4. **APOM Tree Integration**
   - ✅ Models appear in `analyzePage` with model name
   - ✅ `models` map shows available actions per model
   - ✅ Checkboxes with `opacity:0` are now visible (fixed `isVisible()`)

5. **Material UI DatePicker Detection** (Session Fix)
   - ✅ Updated `DatePickerModel.matches()` to detect MUI DatePicker
   - ✅ Detection logic:
     ```javascript
     if (classes.includes('MuiFormControl') || classes.includes('MuiTextField')) {
       const hasInput = element.querySelector('input[type="text"]');
       const hasCalendarIcon = element.querySelector('button[aria-label*="date"]');
       return hasInput && hasCalendarIcon;
     }
     ```

---

## ❌ NOT Implemented (TODO)

### 1. Material UI DatePicker Model & Action

**File**: `models/mui-datepicker-model.js`

```javascript
class MuiDatePickerModel extends ElementModel {
  getName() {
    return 'MuiDatePicker';
  }

  getActions() {
    return ['SetDate', 'SetDateTime', 'SetTime', 'click', 'clear'];
  }

  getPriority() {
    return 100; // Check before generic DatePickerModel
  }

  matches(element, elementType) {
    const classes = element.className || '';

    // MUI v5/v6 DatePicker: MuiFormControl/MuiTextField + input + calendar button
    if (classes.includes('MuiFormControl') || classes.includes('MuiTextField')) {
      const hasInput = element.querySelector('input[type="text"]');
      const hasCalendarIcon = element.querySelector('button[aria-label*="date" i], button[aria-label*="calendar" i]');
      return hasInput && hasCalendarIcon;
    }

    return false;
  }

  getActionHandler(actionName) {
    const handlers = {
      'SetDate': 'executeMuiDatePickerAction',
      'SetDateTime': 'executeMuiDatePickerAction',
      'SetTime': 'executeMuiDatePickerAction',
      'click': 'executeClickAction',
      'clear': 'executeMuiDatePickerAction'
    };
    return handlers[actionName] || null;
  }
}
```

**File**: `utils/actions/mui-datepicker-action.js`

```javascript
/**
 * Material UI DatePicker Action Handler
 * Handles SetDate, SetDateTime, SetTime, clear actions for MUI DatePicker
 */

export async function executeMuiDatePickerAction(page, element, action, params) {
  const identifier = params.identifier || 'MUI DatePicker';

  if (action === 'SetDate' || action === 'SetDateTime') {
    // Find input inside MUI DatePicker
    const input = await element.$('input[type="text"]');
    if (!input) {
      throw new Error(`Input not found inside ${identifier}`);
    }

    // Strategy 1: Direct input.value set (works for MUI v5/v6)
    await input.evaluate((el, date) => {
      el.value = date;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, params.date || params.datetime);

    return {
      content: [
        { type: "text", text: `Set ${action} to "${params.date || params.datetime}" in ${identifier}` }
      ]
    };
  }

  if (action === 'SetTime') {
    // MUI TimePicker logic (similar to SetDate)
    const input = await element.$('input[type="text"]');
    await input.evaluate((el, time) => {
      el.value = time;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, params.time);

    return {
      content: [
        { type: "text", text: `Set time to "${params.time}" in ${identifier}` }
      ]
    };
  }

  if (action === 'clear') {
    const input = await element.$('input[type="text"]');
    await input.evaluate(el => {
      el.value = '';
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    });

    return {
      content: [
        { type: "text", text: `Cleared ${identifier}` }
      ]
    };
  }

  throw new Error(`Unknown action: ${action}`);
}
```

**Registration**:
1. Add to `models/index.js` MODELS array
2. Add to `utils/actions/index.js` exports
3. Add to `index.js` imports and actionHandlers map
4. Add invocation logic in executeModelAction handler

---

### 2. Ant Design DatePicker Model & Action

**File**: `models/ant-datepicker-model.js`

```javascript
class AntDatePickerModel extends ElementModel {
  getName() {
    return 'AntDatePicker';
  }

  getActions() {
    return ['SetDate', 'SetRange', 'SetDateTime', 'click', 'clear'];
  }

  getPriority() {
    return 100;
  }

  matches(element, elementType) {
    const classes = element.className || '';
    return classes.includes('ant-picker');
  }

  getActionHandler(actionName) {
    const handlers = {
      'SetDate': 'executeAntDatePickerAction',
      'SetRange': 'executeAntDatePickerAction',
      'SetDateTime': 'executeAntDatePickerAction',
      'click': 'executeClickAction',
      'clear': 'executeAntDatePickerAction'
    };
    return handlers[actionName] || null;
  }
}
```

**File**: `utils/actions/ant-datepicker-action.js`

```javascript
/**
 * Ant Design DatePicker Action Handler
 * Handles SetDate, SetRange, SetDateTime, clear actions for Ant Design DatePicker
 *
 * Note: Ant DatePicker uses popup calendar, requires complex interaction
 */

export async function executeAntDatePickerAction(page, element, action, params) {
  const identifier = params.identifier || 'Ant DatePicker';

  if (action === 'SetDate' || action === 'SetDateTime') {
    // Strategy 1: Try direct input value set (works for some Ant versions)
    const input = await element.$('input');
    if (input) {
      try {
        await input.evaluate((el, date) => {
          el.value = date;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        }, params.date || params.datetime);

        return {
          content: [
            { type: "text", text: `Set ${action} to "${params.date || params.datetime}" in ${identifier}` }
          ]
        };
      } catch (e) {
        // Fallback to popup interaction
      }
    }

    // Strategy 2: Popup interaction (more reliable but complex)
    // 1. Click to open popup
    await element.click();
    await page.waitForSelector('.ant-picker-dropdown', { timeout: 2000 });

    // 2. Parse date and navigate calendar
    // ... (complex calendar interaction logic)

    throw new Error('Popup interaction not implemented yet - use direct input strategy');
  }

  if (action === 'SetRange') {
    // Range picker specific logic (two dates)
    throw new Error('SetRange action not implemented yet');
  }

  if (action === 'clear') {
    const clearBtn = await element.$('.ant-picker-clear');
    if (clearBtn) {
      await clearBtn.click();
    } else {
      const input = await element.$('input');
      await input.evaluate(el => {
        el.value = '';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    return {
      content: [
        { type: "text", text: `Cleared ${identifier}` }
      ]
    };
  }

  throw new Error(`Unknown action: ${action}`);
}
```

---

### 3. react-datepicker Model & Action

**File**: `models/react-datepicker-model.js`

```javascript
class ReactDatePickerModel extends ElementModel {
  getName() {
    return 'ReactDatePicker';
  }

  getActions() {
    return ['SetDate', 'SetDateTime', 'click', 'clear'];
  }

  getPriority() {
    return 100;
  }

  matches(element, elementType) {
    const classes = element.className || '';
    return classes.includes('react-datepicker-wrapper') ||
           classes.includes('react-datepicker__input-container');
  }

  getActionHandler(actionName) {
    const handlers = {
      'SetDate': 'executeReactDatePickerAction',
      'SetDateTime': 'executeReactDatePickerAction',
      'click': 'executeClickAction',
      'clear': 'executeReactDatePickerAction'
    };
    return handlers[actionName] || null;
  }
}
```

**File**: `utils/actions/react-datepicker-action.js`

```javascript
/**
 * react-datepicker Action Handler
 */

export async function executeReactDatePickerAction(page, element, action, params) {
  const identifier = params.identifier || 'React DatePicker';

  if (action === 'SetDate' || action === 'SetDateTime') {
    const input = await element.$('input');

    await input.evaluate((el, date) => {
      el.value = date;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, params.date || params.datetime);

    return {
      content: [
        { type: "text", text: `Set ${action} to "${params.date || params.datetime}" in ${identifier}` }
      ]
    };
  }

  if (action === 'clear') {
    const input = await element.$('input');
    await input.evaluate(el => {
      el.value = '';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    return {
      content: [
        { type: "text", text: `Cleared ${identifier}` }
      ]
    };
  }

  throw new Error(`Unknown action: ${action}`);
}
```

---

### 4. Update models/index.js

Remove generic DatePickerModel, add specific models:

```javascript
// Remove or deprecate:
// class DatePickerModel extends ElementModel { ... }

// Add new imports at the top:
import { MuiDatePickerModel } from './mui-datepicker-model.js';
import { AntDatePickerModel } from './ant-datepicker-model.js';
import { ReactDatePickerModel } from './react-datepicker-model.js';

// Update MODELS array:
const MODELS = [
  TextInputModel,
  SelectModel,
  ButtonModel,
  CheckboxModel,
  RadioModel,
  TextAreaModel,
  LinkModel,
  RangeInputModel,
  MuiDatePickerModel,      // ← Add
  AntDatePickerModel,      // ← Add
  ReactDatePickerModel,    // ← Add
  DateInputModel,          // Native HTML5 date input
  FileInputModel,
  ColorInputModel,
  DefaultModel
];
```

---

### 5. Update index.js

**Imports** (around line 73):
```javascript
import {
  executeClickAction,
  executeTypeAction,
  executeHoverAction,
  executeScreenshotAction,
  executeSelectOptionAction,
  executeCheckAction,
  executeMuiDatePickerAction,     // ← Add
  executeAntDatePickerAction,     // ← Add
  executeReactDatePickerAction    // ← Add
} from './utils/actions/index.js';
```

**actionHandlers map** (around line 633):
```javascript
const actionHandlers = {
  'executeClickAction': executeClickAction,
  'executeTypeAction': executeTypeAction,
  'executeHoverAction': executeHoverAction,
  'executeScreenshotAction': executeScreenshotAction,
  'executeSelectOptionAction': executeSelectOptionAction,
  'executeCheckAction': executeCheckAction,
  'executeMuiDatePickerAction': executeMuiDatePickerAction,        // ← Add
  'executeAntDatePickerAction': executeAntDatePickerAction,        // ← Add
  'executeReactDatePickerAction': executeReactDatePickerAction     // ← Add
};
```

**Invocation logic** (around line 653):
```javascript
// After executeCheckAction block
} else if (handlerInfo.handlerName === 'executeMuiDatePickerAction') {
  result = await handlerFunction(page, element, validatedArgs.action, actionParams);
} else if (handlerInfo.handlerName === 'executeAntDatePickerAction') {
  result = await handlerFunction(page, element, validatedArgs.action, actionParams);
} else if (handlerInfo.handlerName === 'executeReactDatePickerAction') {
  result = await handlerFunction(page, element, validatedArgs.action, actionParams);
```

---

## Implementation Order (Recommended)

1. **Start with Material UI DatePicker** (most common in enterprise apps)
   - Create `models/mui-datepicker-model.js`
   - Create `utils/actions/mui-datepicker-action.js`
   - Register in `models/index.js` and `index.js`
   - Test on real MUI app

2. **Then react-datepicker** (simpler, widely used in React apps)
   - Similar structure to MUI
   - Test on react-datepicker demo

3. **Finally Ant Design** (most complex due to popup)
   - Requires calendar interaction logic
   - May need iterative refinement

4. **Future: Vuetify, PrimeReact, etc.**
   - Follow same pattern as above

---

## Testing Strategy

1. **Manual testing** on real apps:
   - Material UI Kitchen Sink demo
   - Ant Design DatePicker demo
   - react-datepicker Storybook

2. **Test cases** for each model:
   - Detection (matches() returns true for correct elements)
   - SetDate with various formats (YYYY-MM-DD, MM/DD/YYYY)
   - SetDateTime with time
   - Clear action
   - Error handling (invalid dates)

3. **Cross-framework consistency**:
   - Same API works across all DatePicker models
   - analyzePage shows correct model name
   - executeModelAction routes to correct handler

---

## Session Fixes Applied

### 1. executeCheckAction Implementation
- ✅ Created `utils/actions/check-action.js` with scrollIntoView + timeout wrapper
- ✅ Fixed timeout issue (required server restart)
- ✅ Tested with React TodoMVC checkboxes

### 2. Checkboxes Not Appearing in APOM Tree
- ✅ Root cause: `isVisible()` filtered `opacity:0` elements
- ✅ Fix: Added exception for stylable inputs (checkbox, radio, file)
- ✅ Code change in `pom/apom-tree-converter.js:432-443`
- ✅ Tested: Checkboxes now appear with model "Chk"

### 3. Browser Context Caching Issue
- ✅ Problem: `buildAPOMTree` loaded once via `eval()`, changes not applied
- ✅ Solution: Reload page after server restart to clear browser context
- ✅ Documented: Always refresh page after apom-tree-converter.js changes

---

## Notes

- **Priority system**: Higher priority models are checked first (e.g., MuiDatePickerModel before generic DatePickerModel)
- **Fallback**: If no specific model matches, element falls back to TextInputModel or DefaultModel
- **Extensibility**: Adding new UI framework = create new model class, no core changes needed
- **Testing**: Each model should be tested independently on framework-specific demo pages

---

**End of Document**
