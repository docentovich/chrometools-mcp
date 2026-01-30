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
   * Type text into the input using keyboard simulation
   * @param {string} value - Text to type
   * @param {object} options - { delay, clearFirst }
   */
  async setValue(value, options = {}) {
    const { delay = 0, clearFirst = true } = options;
    const opTimeout = 5000; // 5s timeout per operation

    // Focus element first
    await withTimeout(
      () => this.element.focus(),
      opTimeout,
      'focus'
    );

    if (clearFirst) {
      // Triple-click to select all with timeout
      await withTimeout(
        () => this.element.click({ clickCount: 3 }),
        opTimeout,
        'triple-click'
      );

      // Delete selected text
      await withTimeout(
        () => this.page.keyboard.press('Backspace'),
        opTimeout,
        'backspace'
      );
    }

    // Type text with timeout (longer for long text)
    const typeTimeout = Math.max(opTimeout, value.length * delay + 5000);
    await withTimeout(
      () => this.element.type(value, { delay }),
      typeTimeout,
      'type'
    );
  }

  getActionDescription(value, identifier) {
    return `Typed "${value}" into ${identifier}`;
  }
}
