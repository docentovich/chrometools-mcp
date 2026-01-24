/**
 * pom/apom-converter.js
 *
 * Converts analyzePage output to APOM (Agent Page Object Model) format
 * Adds unique IDs and registers elements in selector resolver
 */

/**
 * Convert analyzePage result to APOM format
 * This function runs in browser context via page.evaluate()
 *
 * @param {Object} analysis - Result from analyzePage
 * @param {Object} options - Conversion options
 * @returns {Object} APOM formatted result
 */
function convertToAPOM(analysis, options = {}) {
  const {
    registerElements = true,
    groupBy = 'type'
  } = options;

  // Generate pageId from URL + timestamp
  const pageId = `page_${btoa(analysis.url).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20)}_${Date.now()}`;

  const result = {
    pageId,
    url: analysis.url,
    title: analysis.title,
    timestamp: Date.now(),
    elements: {},
    groups: {},
    metadata: {
      totalElements: 0,
      interactiveCount: 0,
      formCount: analysis.forms?.length || 0
    }
  };

  const elementsToRegister = [];
  let elementCounter = { form: 0, input: 0, textarea: 0, select: 0, button: 0, link: 0, element: 0 };

  // Process forms
  if (analysis.forms && analysis.forms.length > 0) {
    result.groups.forms = [];

    analysis.forms.forEach((form, formIdx) => {
      const formId = generateElementId(null, 'form', elementCounter.form++);

      const formElement = {
        id: formId,
        type: 'form',
        selector: form.selector,
        method: form.method || 'GET',
        action: form.action || '',
        fields: {
          inputs: {},
          textareas: {},
          selects: {},
          checkboxes: {},
          radios: {}
        },
        submitButtons: [],
        resetButtons: [],
        validation: {
          valid: false,
          requiredFields: [],
          invalidFields: []
        }
      };

      // Process form fields
      if (form.fields) {
        form.fields.forEach((field, fieldIdx) => {
          let fieldType = 'input';
          if (field.type === 'textarea') fieldType = 'textarea';
          else if (field.type === 'select') fieldType = 'select';
          else if (field.type === 'checkbox') fieldType = 'checkbox';
          else if (field.type === 'radio') fieldType = 'radio';

          const fieldId = generateElementId(null, fieldType, elementCounter[fieldType] || 0);
          elementCounter[fieldType] = (elementCounter[fieldType] || 0) + 1;

          const fieldElement = {
            id: fieldId,
            type: fieldType,
            selector: field.selector,
            name: field.name,
            placeholder: field.placeholder,
            required: field.required || false,
            label: field.label,
            value: field.value || '',
            disabled: field.disabled || false
          };

          // Add select-specific data
          if (fieldType === 'select' && field.options) {
            fieldElement.options = field.options;
            fieldElement.selectedValue = field.selectedValue;
            fieldElement.selectedText = field.selectedText;
            fieldElement.selectedIndex = field.selectedIndex || -1;
            fieldElement.multiple = field.multiple || false;
          }

          // Add UI framework info
          if (field.uiFramework) {
            fieldElement.uiFramework = field.uiFramework;
          }

          // Add to form fields
          if (fieldType === 'checkbox') {
            formElement.fields.checkboxes[fieldId] = fieldElement;
          } else if (fieldType === 'radio') {
            formElement.fields.radios[fieldId] = fieldElement;
          } else if (fieldType === 'select') {
            formElement.fields.selects[fieldId] = fieldElement;
          } else if (fieldType === 'textarea') {
            formElement.fields.textareas[fieldId] = fieldElement;
          } else {
            formElement.fields.inputs[fieldId] = fieldElement;
          }

          // Add to global elements
          result.elements[fieldId] = fieldElement;
          elementsToRegister.push({ id: fieldId, selector: field.selector });

          // Track required fields
          if (field.required) {
            formElement.validation.requiredFields.push(fieldId);
          }
        });
      }

      // Process submit button
      if (form.submitButton) {
        const buttonId = generateElementId(null, 'button', elementCounter.button++);
        const buttonElement = {
          id: buttonId,
          type: 'button',
          buttonType: 'submit',
          selector: form.submitButton.selector,
          text: form.submitButton.text,
          disabled: false
        };

        formElement.submitButtons.push(buttonElement);
        result.elements[buttonId] = buttonElement;
        elementsToRegister.push({ id: buttonId, selector: form.submitButton.selector });
      }

      // Add form to elements and groups
      result.elements[formId] = formElement;
      result.groups.forms.push(formElement);
      elementsToRegister.push({ id: formId, selector: form.selector });
    });
  }

  // Process inputs (that are not in forms)
  if (analysis.inputs && analysis.inputs.length > 0) {
    result.groups.inputs = [];

    analysis.inputs.forEach(input => {
      let inputType = 'input';
      if (input.type === 'select') inputType = 'select';
      else if (input.type === 'textarea') inputType = 'textarea';

      const inputId = generateElementId(null, inputType, elementCounter[inputType]++);

      const inputElement = {
        id: inputId,
        type: inputType,
        selector: input.selector,
        name: input.name,
        placeholder: input.placeholder
      };

      // Add select-specific data
      if (inputType === 'select' && input.options) {
        inputElement.options = input.options;
        inputElement.selectedValue = input.selectedValue;
        inputElement.selectedText = input.selectedText;
        inputElement.selectedIndex = input.selectedIndex || -1;
        inputElement.multiple = input.multiple || false;
      }

      // Add UI framework info
      if (input.uiFramework) {
        inputElement.uiFramework = input.uiFramework;
      }

      result.elements[inputId] = inputElement;
      result.groups.inputs.push(inputElement);
      elementsToRegister.push({ id: inputId, selector: input.selector });
    });
  }

  // Process buttons
  if (analysis.buttons && analysis.buttons.length > 0) {
    result.groups.buttons = [];

    analysis.buttons.forEach(button => {
      const buttonId = generateElementId(null, 'button', elementCounter.button++);

      const buttonElement = {
        id: buttonId,
        type: 'button',
        buttonType: button.type || 'button',
        selector: button.selector,
        text: button.text,
        inForm: button.inForm || false
      };

      result.elements[buttonId] = buttonElement;
      result.groups.buttons.push(buttonElement);
      elementsToRegister.push({ id: buttonId, selector: button.selector });
    });
  }

  // Process links
  if (analysis.links && analysis.links.length > 0) {
    result.groups.links = [];

    analysis.links.forEach(link => {
      const linkId = generateElementId(null, 'link', elementCounter.link++);

      const linkElement = {
        id: linkId,
        type: 'link',
        selector: link.selector,
        text: link.text,
        href: link.href
      };

      result.elements[linkId] = linkElement;
      result.groups.links.push(linkElement);
      elementsToRegister.push({ id: linkId, selector: link.selector });
    });
  }

  // Update metadata
  result.metadata.totalElements = Object.keys(result.elements).length;
  result.metadata.interactiveCount = result.metadata.totalElements;

  // Register elements if requested (registerElements is boolean flag in options)
  // The actual registration happens in the calling code in index.js after conversion

  return result;
}

// Helper function: generateElementId
// Simple version - uses type + context + index
function generateElementId(element, type, index) {
  return `${type}_${index}`;
}

// Export for use in both Node.js and browser context
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    convertToAPOM,
    generateElementId
  };
}

// Make available globally in browser context
if (typeof window !== 'undefined') {
  window.convertToAPOM = convertToAPOM;
  window.generateElementId = generateElementId;
}
