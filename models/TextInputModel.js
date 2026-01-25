/**
 * models/TextInputModel.js
 *
 * Model for standard text-based inputs.
 * Handles: text, email, tel, password, search, url, number
 */

import { BaseInputModel } from './BaseInputModel.js';

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

    if (clearFirst) {
      await this.element.click({ clickCount: 3 });
      await this.page.keyboard.press('Backspace');
    }

    await this.element.type(value, { delay });
  }

  getActionDescription(value, identifier) {
    return `Typed "${value}" into ${identifier}`;
  }
}
