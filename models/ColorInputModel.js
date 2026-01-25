/**
 * models/ColorInputModel.js
 *
 * Model for color picker inputs.
 * Sets value directly via JavaScript.
 *
 * Expected format: "#RRGGBB" (hex color)
 */

import { BaseInputModel } from './BaseInputModel.js';

export class ColorInputModel extends BaseInputModel {
  static get inputTypes() {
    return ['color'];
  }

  /**
   * Set color value directly via JavaScript
   * @param {string} value - Color in hex format "#RRGGBB"
   * @param {object} options - (unused, for interface compatibility)
   */
  async setValue(value, options = {}) {
    // Normalize color format
    let normalizedValue = value;

    // Add # if missing
    if (!normalizedValue.startsWith('#')) {
      normalizedValue = '#' + normalizedValue;
    }

    // Convert 3-char hex to 6-char
    if (/^#[0-9A-Fa-f]{3}$/.test(normalizedValue)) {
      normalizedValue = '#' + normalizedValue[1] + normalizedValue[1] +
                              normalizedValue[2] + normalizedValue[2] +
                              normalizedValue[3] + normalizedValue[3];
    }

    // Validate hex color format
    if (!/^#[0-9A-Fa-f]{6}$/.test(normalizedValue)) {
      console.warn(`ColorInputModel: Value "${value}" may not be a valid hex color`);
    }

    await this.element.evaluate((el, val) => {
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, normalizedValue.toLowerCase());
  }

  getActionDescription(value, identifier) {
    return `Set color "${value}" on ${identifier}`;
  }
}
