/**
 * Browser-based element model implementations (Strategy Pattern)
 * These models define WHAT actions are available for each element type
 * Actual execution is delegated to utils/actions/ handlers
 *
 * Used by: analyzePage (for models map), executeModelAction (for action routing)
 *
 * NOTE: ElementModel base class is loaded separately (ElementModel.js)
 * Don't redeclare it here to avoid "already declared" errors
 */

/**
 * Text Input Model
 * Handles: text, email, password, number, search, url, tel inputs
 */
class TextInputModel extends ElementModel {
  getName() {
    return 'TxtInp';
  }

  getActions() {
    return ['type', 'clear', 'click', 'hover', 'screenshot'];
  }

  matches(element, elementType) {
    if (elementType.type !== 'input') return false;
    const inputType = elementType.metadata?.inputType;
    const textTypes = ['text', 'email', 'password', 'number', 'search', 'url', 'tel'];
    return textTypes.includes(inputType) || !inputType;
  }

  getActionHandler(actionName) {
    const handlers = {
      'type': 'executeTypeAction',
      'clear': 'executeTypeAction',
      'click': 'executeClickAction',
      'hover': 'executeHoverAction',
      'screenshot': 'executeScreenshotAction'
    };
    return handlers[actionName] || null;
  }
}

/**
 * Select Model
 * Handles: <select> dropdowns
 */
class SelectModel extends ElementModel {
  getName() {
    return 'Sel';
  }

  getActions() {
    return ['selectOption', 'click', 'hover', 'screenshot'];
  }

  matches(element, elementType) {
    return elementType.type === 'select';
  }

  getActionHandler(actionName) {
    const handlers = {
      'selectOption': 'executeSelectOptionAction',
      'click': 'executeClickAction',
      'hover': 'executeHoverAction',
      'screenshot': 'executeScreenshotAction'
    };
    return handlers[actionName] || null;
  }
}

/**
 * Button Model
 * Handles: buttons, submit/reset inputs
 */
class ButtonModel extends ElementModel {
  getName() {
    return 'Btn';
  }

  getActions() {
    return ['click', 'hover', 'screenshot'];
  }

  matches(element, elementType) {
    return elementType.type === 'button';
  }

  getActionHandler(actionName) {
    const handlers = {
      'click': 'executeClickAction',
      'hover': 'executeHoverAction',
      'screenshot': 'executeScreenshotAction'
    };
    return handlers[actionName] || null;
  }
}

/**
 * Checkbox Model
 * Handles: <input type="checkbox">
 */
class CheckboxModel extends ElementModel {
  getName() {
    return 'Chk';
  }

  getActions() {
    return ['check', 'uncheck', 'toggle', 'click', 'hover', 'screenshot'];
  }

  matches(element, elementType) {
    if (elementType.type !== 'input') return false;
    return elementType.metadata?.inputType === 'checkbox';
  }

  getActionHandler(actionName) {
    const handlers = {
      'check': 'executeCheckAction',
      'uncheck': 'executeCheckAction',
      'toggle': 'executeCheckAction',
      'click': 'executeClickAction',
      'hover': 'executeHoverAction',
      'screenshot': 'executeScreenshotAction'
    };
    return handlers[actionName] || null;
  }
}

/**
 * Radio Button Model
 * Handles: <input type="radio">
 */
class RadioModel extends ElementModel {
  getName() {
    return 'Radio';
  }

  getActions() {
    return ['select', 'click', 'hover', 'screenshot'];
  }

  matches(element, elementType) {
    if (elementType.type !== 'input') return false;
    return elementType.metadata?.inputType === 'radio';
  }

  getActionHandler(actionName) {
    const handlers = {
      'select': 'executeCheckAction',
      'click': 'executeClickAction',
      'hover': 'executeHoverAction',
      'screenshot': 'executeScreenshotAction'
    };
    return handlers[actionName] || null;
  }
}

/**
 * TextArea Model
 * Handles: <textarea>
 */
class TextAreaModel extends ElementModel {
  getName() {
    return 'TxtArea';
  }

  getActions() {
    return ['type', 'append', 'clear', 'click', 'hover', 'screenshot'];
  }

  matches(element, elementType) {
    return elementType.type === 'textarea';
  }

  getActionHandler(actionName) {
    const handlers = {
      'type': 'executeTypeAction',
      'append': 'executeTypeAction',
      'clear': 'executeTypeAction',
      'click': 'executeClickAction',
      'hover': 'executeHoverAction',
      'screenshot': 'executeScreenshotAction'
    };
    return handlers[actionName] || null;
  }
}

/**
 * Link Model
 * Handles: <a> links
 */
class LinkModel extends ElementModel {
  getName() {
    return 'Link';
  }

  getActions() {
    return ['click', 'hover', 'screenshot'];
  }

  matches(element, elementType) {
    return elementType.type === 'link';
  }

  getActionHandler(actionName) {
    const handlers = {
      'click': 'executeClickAction',
      'hover': 'executeHoverAction',
      'screenshot': 'executeScreenshotAction'
    };
    return handlers[actionName] || null;
  }
}

/**
 * Range Input Model
 * Handles: <input type="range">
 */
class RangeInputModel extends ElementModel {
  getName() {
    return 'Range';
  }

  getActions() {
    return ['setValue', 'click', 'hover', 'screenshot'];
  }

  matches(element, elementType) {
    if (elementType.type !== 'input') return false;
    return elementType.metadata?.inputType === 'range';
  }

  getActionHandler(actionName) {
    const handlers = {
      'setValue': 'executeTypeAction', // Reuse type action for setting value
      'click': 'executeClickAction',
      'hover': 'executeHoverAction',
      'screenshot': 'executeScreenshotAction'
    };
    return handlers[actionName] || null;
  }
}

/**
 * DatePicker Model (Custom Component Example)
 * Handles: Date picker UI components (not native <input type="date">)
 */
class DatePickerModel extends ElementModel {
  getName() {
    return 'DatePicker';
  }

  getActions() {
    return ['SetDate', 'SetDateTime', 'SetTime', 'click', 'clear'];
  }

  getPriority() {
    return 100; // Check before DateInputModel
  }

  matches(element, elementType) {
    const classes = element.className || '';
    const datePickerPatterns = [
      'datepicker', 'date-picker', 'datetime-picker',
      'react-datepicker', 'flatpickr', 'pikaday',
      'ant-picker', 'el-date-picker'
    ];

    // Check for common datepicker class patterns
    if (datePickerPatterns.some(pattern => classes.toLowerCase().includes(pattern))) {
      return true;
    }

    // Material UI DatePicker detection (v5/v6):
    // Look for MuiFormControl with input + calendar icon button
    if (classes.includes('MuiFormControl') || classes.includes('MuiTextField')) {
      const hasInput = element.querySelector('input[type="text"]');
      const hasCalendarIcon = element.querySelector('button[aria-label*="date" i], button[aria-label*="calendar" i]');
      return hasInput && hasCalendarIcon;
    }

    return false;
  }

  getActionHandler(actionName) {
    const handlers = {
      'SetDate': 'executeDatePickerAction',
      'SetDateTime': 'executeDatePickerAction',
      'SetTime': 'executeDatePickerAction',
      'click': 'executeClickAction',
      'clear': 'executeDatePickerAction'
    };
    return handlers[actionName] || null;
  }
}

/**
 * Date Input Model (Native HTML5)
 * Handles: <input type="date|datetime-local|month|week">
 */
class DateInputModel extends ElementModel {
  getName() {
    return 'DateInp';
  }

  getActions() {
    return ['type', 'click', 'hover', 'screenshot'];
  }

  matches(element, elementType) {
    if (elementType.type !== 'input') return false;
    const inputType = elementType.metadata?.inputType;
    return ['date', 'datetime-local', 'month', 'week', 'time'].includes(inputType);
  }

  getActionHandler(actionName) {
    const handlers = {
      'type': 'executeTypeAction',
      'click': 'executeClickAction',
      'hover': 'executeHoverAction',
      'screenshot': 'executeScreenshotAction'
    };
    return handlers[actionName] || null;
  }
}

/**
 * File Input Model
 * Handles: <input type="file">
 */
class FileInputModel extends ElementModel {
  getName() {
    return 'FileInp';
  }

  getActions() {
    return ['click', 'hover', 'screenshot'];
  }

  matches(element, elementType) {
    if (elementType.type !== 'input') return false;
    return elementType.metadata?.inputType === 'file';
  }

  getActionHandler(actionName) {
    const handlers = {
      'click': 'executeClickAction',
      'hover': 'executeHoverAction',
      'screenshot': 'executeScreenshotAction'
    };
    return handlers[actionName] || null;
  }
}

/**
 * Color Input Model
 * Handles: <input type="color">
 */
class ColorInputModel extends ElementModel {
  getName() {
    return 'ColorInp';
  }

  getActions() {
    return ['setValue', 'click', 'hover', 'screenshot'];
  }

  matches(element, elementType) {
    if (elementType.type !== 'input') return false;
    return elementType.metadata?.inputType === 'color';
  }

  getActionHandler(actionName) {
    const handlers = {
      'setValue': 'executeTypeAction',
      'click': 'executeClickAction',
      'hover': 'executeHoverAction',
      'screenshot': 'executeScreenshotAction'
    };
    return handlers[actionName] || null;
  }
}

/**
 * Modal/Dialog Model
 * Handles: Modal dialogs, popups, overlays (React Portals, framework modals)
 * Detects elements rendered via portals outside the main React tree
 */
class ModalModel extends ElementModel {
  getName() {
    return 'Modal';
  }

  getActions() {
    return ['screenshot', 'close', 'scrollTo'];
  }

  getPriority() {
    return 200; // High priority — check before containers
  }

  matches(element, elementType) {
    // Only match actual dialog elements, not framework wrappers
    // Framework wrappers are detected separately for portal inclusion
    if (element.getAttribute('role') === 'dialog') return true;
    if (element.getAttribute('aria-modal') === 'true') return true;
    return false;
  }

  getActionHandler(actionName) {
    const handlers = {
      'screenshot': 'executeScreenshotAction',
      'close': 'executeClickAction',
      'scrollTo': 'executeScrollToAction'
    };
    return handlers[actionName] || null;
  }
}

/**
 * Default Model (fallback for non-interactive elements)
 */
class DefaultModel extends ElementModel {
  getName() {
    return 'default';
  }

  getActions() {
    return ['screenshot', 'scrollTo'];
  }

  matches(element, elementType) {
    return true; // Always matches (fallback)
  }

  getPriority() {
    return -1000; // Checked last
  }

  getActionHandler(actionName) {
    const handlers = {
      'screenshot': 'executeScreenshotAction',
      'scrollTo': 'executeScrollToAction'
    };
    return handlers[actionName] || null;
  }
}

// Export all models
const MODELS = [
  TextInputModel,
  SelectModel,
  ButtonModel,
  CheckboxModel,
  RadioModel,
  TextAreaModel,
  LinkModel,
  RangeInputModel,
  DatePickerModel,
  DateInputModel,
  FileInputModel,
  ColorInputModel,
  ModalModel,
  DefaultModel
];

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  // In Node.js, ElementModel needs to be imported
  const ElementModel = require('./ElementModel');
  module.exports = { ElementModel, MODELS };
}

// Export for browser (ElementModel already loaded via ElementModel.js)
if (typeof window !== 'undefined') {
  window.ELEMENT_MODELS_CLASSES = MODELS;
}
