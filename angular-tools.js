/**
 * angular-tools.js
 *
 * Angular-specific tool implementations for MCP server
 */

/**
 * List all Angular components on the page
 */
export async function listAngularComponents(page, includeHidden = false) {
  const components = await page.evaluate((includeHidden) => {
    // Check if Angular is available
    if (typeof ng === 'undefined') {
      return { error: 'Angular not detected on this page. ng global is not available.' };
    }

    const result = [];
    const allElements = document.querySelectorAll('*');

    for (const el of allElements) {
      try {
        // Skip hidden elements unless requested
        if (!includeHidden) {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || el.hidden) {
            continue;
          }
        }

        const component = ng.getComponent(el);
        if (component && component.constructor && component.constructor.name !== 'Object') {
          // Get selector (filter out Tailwind classes with special characters)
          const tagName = el.tagName.toLowerCase();
          const id = el.id ? `#${CSS.escape(el.id)}` : '';
          const stableClasses = el.className
            ? el.className.split(' ')
                .filter(c => c && !/[:\/\[\]]/.test(c))
                .slice(0, 3)
                .map(c => CSS.escape(c))
            : [];
          const classes = stableClasses.length > 0 ? `.${stableClasses.join('.')}` : '';
          const selector = id || `${tagName}${classes}` || tagName;

          // Get methods (public only by default)
          const proto = Object.getPrototypeOf(component);
          const methods = Object.getOwnPropertyNames(proto)
            .filter(name => {
              if (name === 'constructor') return false;
              if (name.startsWith('_')) return false; // Skip private
              if (name.startsWith('ng')) return false; // Skip Angular lifecycle hooks
              return typeof component[name] === 'function';
            });

          // Get properties (public only)
          const properties = Object.keys(component).filter(key => {
            if (key.startsWith('_')) return false;
            return true;
          }).slice(0, 10); // Limit to first 10 properties

          result.push({
            selector,
            tagName: el.tagName,
            componentName: component.constructor.name,
            methods,
            propertiesCount: Object.keys(component).length,
            sampleProperties: properties,
          });
        }
      } catch (e) {
        // Skip elements that can't be inspected
      }
    }

    return { components: result, count: result.length };
  }, includeHidden);

  if (components.error) {
    throw new Error(components.error);
  }

  return components;
}

/**
 * Get detailed information about a specific Angular component
 */
export async function getAngularComponent(page, selector, includePrivate = false) {
  const componentInfo = await page.evaluate((selector, includePrivate) => {
    if (typeof ng === 'undefined') {
      return { error: 'Angular not detected on this page' };
    }

    const el = document.querySelector(selector);
    if (!el) {
      return { error: `Element not found: ${selector}` };
    }

    const component = ng.getComponent(el);
    if (!component) {
      return { error: `No Angular component found at: ${selector}` };
    }

    // Get all methods
    const proto = Object.getPrototypeOf(component);
    const methods = Object.getOwnPropertyNames(proto)
      .filter(name => {
        if (name === 'constructor') return false;
        if (!includePrivate && name.startsWith('_')) return false;
        return typeof component[name] === 'function';
      });

    // Get all properties with their types
    const properties = {};
    for (const key of Object.keys(component)) {
      if (!includePrivate && key.startsWith('_')) continue;

      const value = component[key];
      const type = Array.isArray(value) ? 'array' : typeof value;

      // For forms, include validation state
      if (value && typeof value === 'object' && value.constructor && value.constructor.name === 'FormGroup') {
        properties[key] = {
          type: 'FormGroup',
          valid: value.valid,
          dirty: value.dirty,
          touched: value.touched,
          errors: value.errors
        };
      } else if (type === 'object' && value !== null) {
        properties[key] = {
          type: value.constructor ? value.constructor.name : 'object',
          keys: Object.keys(value).slice(0, 5)
        };
      } else {
        properties[key] = { type, value: type === 'function' ? undefined : value };
      }
    }

    return {
      selector,
      componentName: component.constructor.name,
      methods,
      properties
    };
  }, selector, includePrivate);

  if (componentInfo.error) {
    throw new Error(componentInfo.error);
  }

  return componentInfo;
}

/**
 * Call a method on an Angular component
 */
export async function callAngularMethod(page, selector, method, args = []) {
  const result = await page.evaluate((selector, method, args) => {
    if (typeof ng === 'undefined') {
      return { error: 'Angular not detected on this page' };
    }

    const el = document.querySelector(selector);
    if (!el) {
      return { error: `Element not found: ${selector}` };
    }

    const component = ng.getComponent(el);
    if (!component) {
      return { error: `No Angular component found at: ${selector}` };
    }

    if (typeof component[method] !== 'function') {
      // Get available methods for suggestion
      const proto = Object.getPrototypeOf(component);
      const availableMethods = Object.getOwnPropertyNames(proto)
        .filter(name => typeof component[name] === 'function' && name !== 'constructor')
        .slice(0, 10);

      return {
        error: `Method '${method}' not found on component`,
        availableMethods,
        suggestion: `Available methods: ${availableMethods.join(', ')}`
      };
    }

    try {
      const returnValue = component[method](...args);

      // Trigger change detection
      if (typeof ng.applyChanges === 'function') {
        ng.applyChanges(component);
      }

      return {
        success: true,
        returnValue: returnValue !== undefined ? returnValue : null,
        method
      };
    } catch (error) {
      return {
        error: `Error calling method '${method}': ${error.message}`,
        stack: error.stack
      };
    }
  }, selector, method, args);

  if (result.error) {
    throw new Error(result.error + (result.suggestion ? '\n' + result.suggestion : ''));
  }

  return result;
}

/**
 * Get Angular form data and validation state
 */
export async function getAngularForm(page, selector, formProperty) {
  const formData = await page.evaluate((selector, formProperty) => {
    if (typeof ng === 'undefined') {
      return { error: 'Angular not detected on this page' };
    }

    const el = document.querySelector(selector);
    if (!el) {
      return { error: `Element not found: ${selector}` };
    }

    const component = ng.getComponent(el);
    if (!component) {
      return { error: `No Angular component found at: ${selector}` };
    }

    // Auto-detect form if not specified
    let form = null;
    if (formProperty) {
      form = component[formProperty];
    } else {
      // Look for common form property names
      const formProps = Object.keys(component).filter(key =>
        component[key] &&
        typeof component[key] === 'object' &&
        component[key].constructor &&
        (component[key].constructor.name === 'FormGroup' || component[key].constructor.name === 'FormControl')
      );

      if (formProps.length === 0) {
        return { error: 'No form found. Specify formProperty or ensure component has a FormGroup/FormControl property.' };
      }

      formProperty = formProps[0];
      form = component[formProperty];
    }

    if (!form) {
      return { error: `Form property '${formProperty}' not found on component` };
    }

    // Get form errors recursively
    const getFormErrors = (control, path = '') => {
      const errors = {};

      if (control.errors) {
        errors[path || 'form'] = control.errors;
      }

      if (control.controls) {
        for (const key of Object.keys(control.controls)) {
          const childPath = path ? `${path}.${key}` : key;
          Object.assign(errors, getFormErrors(control.controls[key], childPath));
        }
      }

      return errors;
    };

    // Get disabled controls info
    const hasRawValue = typeof form.getRawValue === 'function';
    const rawValue = hasRawValue ? form.getRawValue() : undefined;

    return {
      formProperty,
      valid: form.valid,
      invalid: form.invalid,
      dirty: form.dirty,
      pristine: form.pristine,
      touched: form.touched,
      untouched: form.untouched,
      value: form.value,
      rawValue: rawValue, // Includes disabled controls
      errors: getFormErrors(form),
      status: form.status,
      note: rawValue ? 'rawValue includes disabled controls that are excluded from value' : undefined
    };
  }, selector, formProperty);

  if (formData.error) {
    throw new Error(formData.error);
  }

  return formData;
}

/**
 * Submit Angular form with automatic fallback strategies
 */
export async function submitAngularForm(page, selector, formProperty, waitForResponse = true) {
  const result = await page.evaluate((selector, formProperty) => {
    if (typeof ng === 'undefined') {
      return { error: 'Angular not detected on this page' };
    }

    const el = document.querySelector(selector);
    if (!el) {
      return { error: `Element not found: ${selector}` };
    }

    const component = ng.getComponent(el);
    if (!component) {
      return { error: `No Angular component found at: ${selector}` };
    }

    const attempts = [];

    // Strategy 1: Look for submit/save/send methods
    const submitMethods = ['submit', 'submitForm', 'onSubmit', 'save', 'send', 'submitNotificationForm'];
    for (const methodName of submitMethods) {
      if (typeof component[methodName] === 'function') {
        try {
          const result = component[methodName]();
          attempts.push({ strategy: `component.${methodName}()`, success: true });

          // Trigger change detection
          if (typeof ng.applyChanges === 'function') {
            ng.applyChanges(component);
          }

          return { success: true, method: methodName, strategy: 'component method', result };
        } catch (e) {
          attempts.push({ strategy: `component.${methodName}()`, error: e.message });
        }
      }
    }

    // Strategy 2: If form property specified, try form.submit()
    if (formProperty && component[formProperty]) {
      const form = component[formProperty];
      if (typeof form.submit === 'function') {
        try {
          form.submit();
          attempts.push({ strategy: 'form.submit()', success: true });
          return { success: true, strategy: 'form.submit()' };
        } catch (e) {
          attempts.push({ strategy: 'form.submit()', error: e.message });
        }
      }
    }

    // Strategy 3: Find submit button and click it
    const submitButton = el.querySelector('button[type="submit"]') ||
                       el.querySelector('button[type="Submit"]') ||
                       el.querySelector('button.submit-btn') ||
                       el.querySelector('[type="submit"]');

    if (submitButton) {
      try {
        submitButton.click();
        attempts.push({ strategy: 'click submit button', success: true });
        return { success: true, strategy: 'submit button click' };
      } catch (e) {
        attempts.push({ strategy: 'click submit button', error: e.message });
      }
    }

    // Strategy 4: Dispatch submit event on form element
    const formEl = el.querySelector('form') || el.closest('form');
    if (formEl) {
      try {
        const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
        formEl.dispatchEvent(submitEvent);
        attempts.push({ strategy: 'dispatch submit event', success: true });
        return { success: true, strategy: 'submit event' };
      } catch (e) {
        attempts.push({ strategy: 'dispatch submit event', error: e.message });
      }
    }

    return {
      error: 'All submit strategies failed',
      attempts,
      suggestion: 'Use getAngularComponent to inspect available methods, or try callAngularMethod with specific method name'
    };
  }, selector, formProperty);

  if (result.error) {
    const errorMsg = result.error + '\n\nAttempts:\n' + JSON.stringify(result.attempts, null, 2);
    if (result.suggestion) {
      throw new Error(errorMsg + '\n\n' + result.suggestion);
    }
    throw new Error(errorMsg);
  }

  // Wait for network request if requested
  if (waitForResponse) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return result;
}
