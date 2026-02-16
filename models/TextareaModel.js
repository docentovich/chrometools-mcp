/**
 * models/TextareaModel.js
 *
 * Model for textarea elements.
 * Similar to TextInputModel but handles multiline text.
 */

import { BaseInputModel } from './BaseInputModel.js';

/**
 * Wrap operation with timeout to prevent hanging
 */
async function withTimeout(operation, timeoutMs, operationName) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([operation(), timeoutPromise]);
}

export class TextareaModel extends BaseInputModel {
  static get inputTypes() {
    return ['textarea'];
  }

  /**
   * Check if this model handles the given element
   * Override to check tagName for textarea elements
   */
  static handlesElement(tagName, inputType) {
    return tagName?.toLowerCase() === 'textarea';
  }

  /**
   * Type text into the textarea with timeout protection and JS fallback
   * @param {string} value - Text to type (can include newlines)
   * @param {object} options - { delay, clearFirst }
   */
  async setValue(value, options = {}) {
    const { delay = 0, clearFirst = true } = options;
    const opTimeout = 5000;

    // Suppress browser autocomplete to prevent interference
    // (Google search textarea triggers autocomplete on every keystroke)
    const savedAutocomplete = await this.element.evaluate(el => {
      const prev = el.getAttribute('autocomplete');
      el.setAttribute('autocomplete', 'off');
      return prev;
    });

    try {
      // Method 1: Try Puppeteer typing
      try {
        if (clearFirst) {
          await withTimeout(
            () => this.element.evaluate(el => {
              el.focus();
              // Use native setter to bypass React's value tracker
              const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
              )?.set;
              if (nativeSetter) {
                nativeSetter.call(el, '');
              } else {
                el.value = '';
              }
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }),
            opTimeout,
            'focus-and-clear'
          );
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Type with calculated timeout based on text length
        const typeTimeout = Math.max(opTimeout, value.length * delay + 5000);
        await withTimeout(
          () => this.element.type(value, { delay }),
          typeTimeout,
          'type'
        );

        // Verify value was set correctly
        const actualValue = await this.element.evaluate(el => el.value);
        const isValid = clearFirst ? actualValue === value : actualValue.endsWith(value);
        if (isValid) {
          return; // Success
        }
      } catch (e) {
        // Fall through to JS method
      }

      // Method 2: Fallback to direct JS value setting (with React-compatible native setter)
      await withTimeout(
        () => this.element.evaluate((el, newValue, shouldClear) => {
          el.focus();
          const finalValue = shouldClear ? newValue : el.value + newValue;
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          )?.set;
          if (nativeSetter) {
            nativeSetter.call(el, finalValue);
          } else {
            el.value = finalValue;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, value, clearFirst),
        opTimeout,
        'js-set-value'
      );
    } finally {
      // Restore original autocomplete attribute
      await this.element.evaluate((el, orig) => {
        if (orig === null) {
          el.removeAttribute('autocomplete');
        } else {
          el.setAttribute('autocomplete', orig);
        }
      }, savedAutocomplete).catch(() => {});
    }
  }

  async getMetadata() {
    const base = await super.getMetadata();
    const extra = await this.element.evaluate(el => ({
      rows: el.rows,
      cols: el.cols,
      maxLength: el.maxLength > 0 ? el.maxLength : null,
      placeholder: el.placeholder || null,
    }));
    return { ...base, ...extra };
  }

  getActionDescription(value, identifier) {
    const preview = value.length > 30 ? value.substring(0, 30) + '...' : value;
    return `Typed "${preview}" into ${identifier}`;
  }
}
