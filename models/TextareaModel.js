/**
 * models/TextareaModel.js
 *
 * Model for textarea elements.
 * Similar to TextInputModel but handles multiline text.
 */

import { BaseInputModel } from './BaseInputModel.js';

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
   * Type text into the textarea
   * @param {string} value - Text to type (can include newlines)
   * @param {object} options - { delay, clearFirst }
   */
  async setValue(value, options = {}) {
    const { delay = 0, clearFirst = true } = options;

    if (clearFirst) {
      await this.element.click({ clickCount: 3 });
      await this.page.keyboard.press('Backspace');
      // For multiline, also clear with Ctrl+A
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('a');
      await this.page.keyboard.up('Control');
      await this.page.keyboard.press('Backspace');
    }

    await this.element.type(value, { delay });
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
