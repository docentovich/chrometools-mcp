/**
 * models/RangeInputModel.js
 *
 * Model for range/slider inputs.
 * Sets value directly via JavaScript.
 *
 * Expected format: numeric value within min/max range
 */

import { BaseInputModel } from './BaseInputModel.js';

export class RangeInputModel extends BaseInputModel {
  static get inputTypes() {
    return ['range'];
  }

  /**
   * Set range value directly via JavaScript
   * @param {string|number} value - Numeric value
   * @param {object} options - (unused, for interface compatibility)
   */
  async setValue(value, options = {}) {
    const numericValue = parseFloat(value);

    if (isNaN(numericValue)) {
      console.warn(`RangeInputModel: Value "${value}" is not a valid number`);
    }

    // Get min/max and clamp value
    const { min, max } = await this.element.evaluate(el => ({
      min: parseFloat(el.min) || 0,
      max: parseFloat(el.max) || 100,
    }));

    const clampedValue = Math.max(min, Math.min(max, numericValue));
    if (clampedValue !== numericValue) {
      console.warn(`RangeInputModel: Value ${numericValue} clamped to ${clampedValue} (range: ${min}-${max})`);
    }

    await this.element.evaluate((el, val) => {
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, clampedValue.toString());
  }

  async getMetadata() {
    const base = await super.getMetadata();
    const extra = await this.element.evaluate(el => ({
      min: el.min || '0',
      max: el.max || '100',
      step: el.step || '1',
    }));
    return { ...base, ...extra };
  }

  getActionDescription(value, identifier) {
    return `Set range value "${value}" on ${identifier}`;
  }
}
