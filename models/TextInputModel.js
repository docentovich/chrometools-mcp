/**
 * models/TextInputModel.js
 *
 * Model for standard text-based inputs.
 * Handles: text, email, tel, password, search, url, number
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

export class TextInputModel extends BaseInputModel {
  static get inputTypes() {
    return ['text', 'email', 'tel', 'password', 'search', 'url', 'number', null];
  }

  /**
   * Type text into the input using keyboard simulation with JS fallback
   * @param {string} value - Text to type
   * @param {object} options - { delay, clearFirst }
   */
  async setValue(value, options = {}) {
    const { delay = 0, clearFirst = true } = options;
    const opTimeout = 5000; // 5s timeout per operation

    // Method 1: Try Puppeteer typing (works for most cases)
    try {
      // Focus and clear using JS (most reliable)
      await withTimeout(
        () => this.element.evaluate((el, shouldClear) => {
          el.focus();
          el.click();
          if (shouldClear) {
            el.select(); // Select all text
          }
        }, clearFirst),
        opTimeout,
        'focus-and-select'
      );

      // Small delay to ensure focus is established
      await new Promise(resolve => setTimeout(resolve, 50));

      // Type the new value
      const typeTimeout = Math.max(opTimeout, value.length * delay + 5000);
      await withTimeout(
        () => this.element.type(value, { delay }),
        typeTimeout,
        'type'
      );

      // Verify the value was set
      const actualValue = await this.element.evaluate(el => el.value);
      if (actualValue.includes(value)) {
        return; // Success
      }
    } catch (e) {
      // Fall through to JS method
    }

    // Method 2: Fallback to direct JS value setting
    await withTimeout(
      () => this.element.evaluate((el, newValue) => {
        el.focus();
        el.value = newValue;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, value),
      opTimeout,
      'js-set-value'
    );
  }

  getActionDescription(value, identifier) {
    return `Typed "${value}" into ${identifier}`;
  }
}
