/**
 * UI Framework Detector
 * Detects and extracts information from various UI component libraries
 */

/**
 * Detect UI framework used by an element
 * @param {HTMLElement} element - DOM element to analyze
 * @returns {Object} Framework information
 */
function detectUIFramework(element) {
  const classes = Array.from(element.classList || []);
  const dataAttrs = Array.from(element.attributes || [])
    .filter(attr => attr.name.startsWith('data-'))
    .map(attr => attr.name);

  // Material-UI (MUI) detection
  if (classes.some(c => c.startsWith('Mui')) ||
      classes.some(c => c.startsWith('MuiInput')) ||
      classes.some(c => c.startsWith('MuiSelect')) ||
      classes.some(c => c.startsWith('MuiButton'))) {
    return {
      name: 'mui',
      version: detectMUIVersion(element),
      component: detectMUIComponent(element, classes)
    };
  }

  // Ant Design detection
  if (classes.some(c => c.startsWith('ant-')) ||
      dataAttrs.includes('data-antd')) {
    return {
      name: 'antd',
      version: null, // Can be enhanced
      component: detectAntDComponent(element, classes)
    };
  }

  // Chakra UI detection
  if (classes.some(c => c.startsWith('chakra-')) ||
      dataAttrs.includes('data-chakra-component')) {
    return {
      name: 'chakra',
      version: null,
      component: element.getAttribute('data-chakra-component') || 'unknown'
    };
  }

  // Bootstrap detection
  if (classes.some(c => c.startsWith('form-')) ||
      classes.some(c => c.startsWith('btn-')) ||
      classes.includes('form-control') ||
      classes.includes('form-select')) {
    return {
      name: 'bootstrap',
      version: detectBootstrapVersion(element),
      component: detectBootstrapComponent(element, classes)
    };
  }

  // Vuetify detection
  if (classes.some(c => c.startsWith('v-')) ||
      dataAttrs.includes('data-v-')) {
    return {
      name: 'vuetify',
      version: null,
      component: detectVuetifyComponent(element, classes)
    };
  }

  // Semantic UI detection
  if (classes.includes('ui') &&
      (classes.includes('input') || classes.includes('dropdown') || classes.includes('button'))) {
    return {
      name: 'semantic-ui',
      version: null,
      component: detectSemanticUIComponent(element, classes)
    };
  }

  // Default: vanilla HTML
  return {
    name: 'vanilla',
    version: null,
    component: element.tagName.toLowerCase()
  };
}

/**
 * Detect MUI version
 */
function detectMUIVersion(element) {
  // MUI v5 uses different class naming than v4
  const classes = Array.from(element.classList || []);

  // v5: MuiInputBase-root, MuiOutlinedInput-root
  if (classes.some(c => c.match(/^Mui[A-Z][a-z]+Base-/))) {
    return '5.x';
  }

  // v4: MuiInput-root, MuiSelect-root
  if (classes.some(c => c.match(/^Mui[A-Z][a-z]+-root$/))) {
    return '4.x';
  }

  return null;
}

/**
 * Detect MUI component type
 */
function detectMUIComponent(element, classes) {
  if (classes.some(c => c.includes('TextField'))) return 'TextField';
  if (classes.some(c => c.includes('Select'))) return 'Select';
  if (classes.some(c => c.includes('Autocomplete'))) return 'Autocomplete';
  if (classes.some(c => c.includes('Button'))) return 'Button';
  if (classes.some(c => c.includes('Checkbox'))) return 'Checkbox';
  if (classes.some(c => c.includes('Radio'))) return 'Radio';
  if (classes.some(c => c.includes('Switch'))) return 'Switch';
  return 'unknown';
}

/**
 * Detect Ant Design component type
 */
function detectAntDComponent(element, classes) {
  if (classes.includes('ant-input')) return 'Input';
  if (classes.includes('ant-select')) return 'Select';
  if (classes.includes('ant-picker')) return 'DatePicker';
  if (classes.includes('ant-btn')) return 'Button';
  if (classes.includes('ant-checkbox')) return 'Checkbox';
  if (classes.includes('ant-radio')) return 'Radio';
  if (classes.includes('ant-switch')) return 'Switch';
  return 'unknown';
}

/**
 * Detect Bootstrap version
 */
function detectBootstrapVersion(element) {
  // Check for Bootstrap 5 specific classes
  const classes = Array.from(element.classList || []);
  if (classes.includes('form-select')) return '5.x';

  // Bootstrap 4 and earlier use 'custom-select'
  if (classes.includes('custom-select')) return '4.x';

  return null;
}

/**
 * Detect Bootstrap component type
 */
function detectBootstrapComponent(element, classes) {
  if (classes.includes('form-control')) {
    if (element.tagName === 'SELECT') return 'Select';
    if (element.tagName === 'TEXTAREA') return 'Textarea';
    return 'Input';
  }
  if (classes.includes('form-select')) return 'Select';
  if (classes.includes('form-check-input')) {
    if (element.type === 'checkbox') return 'Checkbox';
    if (element.type === 'radio') return 'Radio';
  }
  if (classes.some(c => c.startsWith('btn'))) return 'Button';
  return 'unknown';
}

/**
 * Detect Vuetify component type
 */
function detectVuetifyComponent(element, classes) {
  if (classes.includes('v-text-field')) return 'TextField';
  if (classes.includes('v-select')) return 'Select';
  if (classes.includes('v-autocomplete')) return 'Autocomplete';
  if (classes.includes('v-btn')) return 'Button';
  if (classes.includes('v-checkbox')) return 'Checkbox';
  if (classes.includes('v-radio')) return 'Radio';
  if (classes.includes('v-switch')) return 'Switch';
  return 'unknown';
}

/**
 * Detect Semantic UI component type
 */
function detectSemanticUIComponent(element, classes) {
  if (classes.includes('input')) return 'Input';
  if (classes.includes('dropdown')) return 'Dropdown';
  if (classes.includes('button')) return 'Button';
  if (classes.includes('checkbox')) return 'Checkbox';
  if (classes.includes('radio')) return 'Radio';
  return 'unknown';
}

/**
 * Extract options from a select/dropdown element
 * Handles both native <select> and custom UI framework dropdowns
 */
function extractSelectOptions(element) {
  const framework = detectUIFramework(element);

  switch (framework.name) {
    case 'vanilla':
      return extractVanillaSelectOptions(element);

    case 'mui':
      return extractMUISelectOptions(element);

    case 'antd':
      return extractAntDSelectOptions(element);

    case 'chakra':
      return extractChakraSelectOptions(element);

    case 'bootstrap':
      return extractVanillaSelectOptions(element); // Bootstrap uses native select

    case 'vuetify':
      return extractVuetifySelectOptions(element);

    case 'semantic-ui':
      return extractSemanticUISelectOptions(element);

    default:
      return extractVanillaSelectOptions(element);
  }
}

/**
 * Extract options from vanilla HTML <select>
 */
function extractVanillaSelectOptions(element) {
  if (element.tagName !== 'SELECT') return null;

  const options = [];
  let currentGroup = null;

  Array.from(element.children).forEach((child, idx) => {
    if (child.tagName === 'OPTGROUP') {
      currentGroup = child.label;
      Array.from(child.children).forEach((opt, subIdx) => {
        if (opt.tagName === 'OPTION') {
          options.push({
            value: opt.value,
            text: opt.textContent.trim(),
            index: options.length,
            selected: opt.selected,
            disabled: opt.disabled,
            group: currentGroup
          });
        }
      });
    } else if (child.tagName === 'OPTION') {
      options.push({
        value: child.value,
        text: child.textContent.trim(),
        index: idx,
        selected: child.selected,
        disabled: child.disabled,
        group: null
      });
    }
  });

  return {
    options,
    selectedIndex: element.selectedIndex,
    selectedValue: element.value,
    selectedText: element.options[element.selectedIndex]?.textContent.trim() || null,
    multiple: element.multiple
  };
}

/**
 * Extract options from MUI Select
 */
function extractMUISelectOptions(element) {
  // MUI Select renders native select or custom menu
  const nativeSelect = element.querySelector('select');
  if (nativeSelect) {
    return extractVanillaSelectOptions(nativeSelect);
  }

  // For custom MUI Select, options are in menu (not always rendered)
  // We need to look for data attributes or aria-attributes
  const selectedValue = element.getAttribute('aria-activedescendant') ||
                       element.querySelector('input')?.value || '';

  return {
    options: [], // Options may not be in DOM until dropdown opens
    selectedValue,
    selectedText: element.textContent.trim(),
    note: 'MUI Select options may require opening the dropdown to extract'
  };
}

/**
 * Extract options from Ant Design Select
 */
function extractAntDSelectOptions(element) {
  // Ant Design Select stores value in hidden input
  const input = element.querySelector('.ant-select-selection-item');
  const selectedText = input?.textContent.trim() || '';

  // Options are rendered in dropdown (may not be in DOM)
  const dropdown = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
  const options = [];

  if (dropdown) {
    dropdown.querySelectorAll('.ant-select-item-option').forEach((opt, idx) => {
      options.push({
        value: opt.getAttribute('data-value') || opt.textContent.trim(),
        text: opt.textContent.trim(),
        index: idx,
        selected: opt.classList.contains('ant-select-item-option-selected'),
        disabled: opt.classList.contains('ant-select-item-option-disabled'),
        group: null
      });
    });
  }

  return {
    options,
    selectedText,
    note: 'Ant Design Select options may require opening the dropdown to extract'
  };
}

/**
 * Extract options from Chakra UI Select
 */
function extractChakraSelectOptions(element) {
  // Chakra UI typically uses native select
  const nativeSelect = element.querySelector('select');
  if (nativeSelect) {
    return extractVanillaSelectOptions(nativeSelect);
  }

  return {
    options: [],
    note: 'Chakra UI Select options need specific extraction logic'
  };
}

/**
 * Extract options from Vuetify Select
 */
function extractVuetifySelectOptions(element) {
  // Vuetify stores selected value in data attributes or input
  const input = element.querySelector('input');
  const selectedText = input?.value || '';

  // Options are in menu (may not be rendered)
  return {
    options: [],
    selectedText,
    note: 'Vuetify Select options may require opening the dropdown to extract'
  };
}

/**
 * Extract options from Semantic UI Dropdown
 */
function extractSemanticUISelectOptions(element) {
  const options = [];

  element.querySelectorAll('.item').forEach((item, idx) => {
    options.push({
      value: item.getAttribute('data-value') || item.textContent.trim(),
      text: item.textContent.trim(),
      index: idx,
      selected: item.classList.contains('selected'),
      disabled: item.classList.contains('disabled'),
      group: null
    });
  });

  const selectedText = element.querySelector('.text')?.textContent.trim() || '';

  return {
    options,
    selectedText
  };
}

// Export for use in page context
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    detectUIFramework,
    extractSelectOptions
  };
}
