/**
 * models/DateInputModel.js
 *
 * Model for date-related input fields.
 * Handles: date, datetime-local, month, week
 * Sets value directly via JavaScript since keyboard input doesn't work reliably.
 *
 * Expected formats:
 * - date: "YYYY-MM-DD"
 * - datetime-local: "YYYY-MM-DDTHH:MM" or "YYYY-MM-DDTHH:MM:SS"
 * - month: "YYYY-MM"
 * - week: "YYYY-Www" (e.g., "2024-W01")
 */

import { BaseInputModel } from './BaseInputModel.js';

export class DateInputModel extends BaseInputModel {
  static get inputTypes() {
    return ['date', 'datetime-local', 'month', 'week'];
  }

  /**
   * Set date value directly via JavaScript
   * @param {string} value - Date in appropriate format for input type
   * @param {object} options - (unused, for interface compatibility)
   */
  async setValue(value, options = {}) {
    const inputType = await this.element.evaluate(el => el.type);

    // Validate format based on input type
    this._validateFormat(value, inputType);

    await this.element.evaluate((el, val) => {
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  }

  _validateFormat(value, inputType) {
    const formats = {
      'date': /^\d{4}-\d{2}-\d{2}$/,
      'datetime-local': /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
      'month': /^\d{4}-\d{2}$/,
      'week': /^\d{4}-W\d{2}$/,
    };

    const regex = formats[inputType];
    if (regex && !regex.test(value)) {
      console.warn(`DateInputModel: Value "${value}" may not be in correct format for ${inputType}`);
    }
  }

  async getMetadata() {
    const base = await super.getMetadata();
    const extra = await this.element.evaluate(el => ({
      min: el.min || null,
      max: el.max || null,
      step: el.step || null,
    }));
    return { ...base, ...extra };
  }

  getActionDescription(value, identifier) {
    return `Set date "${value}" on ${identifier}`;
  }
}
