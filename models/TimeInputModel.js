/**
 * models/TimeInputModel.js
 *
 * Model for time input fields.
 * Sets value directly via JavaScript since keyboard input doesn't work reliably.
 *
 * Expected format: "HH:MM" (24-hour) or "HH:MM:SS"
 */

import { BaseInputModel } from './BaseInputModel.js';

export class TimeInputModel extends BaseInputModel {
  static get inputTypes() {
    return ['time'];
  }

  /**
   * Set time value directly via JavaScript
   * @param {string} value - Time in format "HH:MM" or "HH:MM:SS"
   * @param {object} options - (unused, for interface compatibility)
   */
  async setValue(value, options = {}) {
    // Validate time format
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
    if (!timeRegex.test(value)) {
      console.warn(`TimeInputModel: Value "${value}" may not be in correct format (HH:MM or HH:MM:SS)`);
    }

    await this.element.evaluate((el, val) => {
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
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
    return `Set time "${value}" on ${identifier}`;
  }
}
