/**
 * models/CheckboxModel.js
 *
 * Model for checkbox and radio button inputs.
 * Supports check, uncheck, toggle, and click operations.
 */

import { BaseInputModel } from './BaseInputModel.js';

export class CheckboxModel extends BaseInputModel {
  static get inputTypes() {
    return ['checkbox', 'radio'];
  }

  /**
   * Set checkbox/radio state
   * @param {string|boolean} value - 'check', 'uncheck', 'toggle', true, false
   * @param {object} options - (unused, for interface compatibility)
   */
  async setValue(value, options = {}) {
    const normalizedValue = this._normalizeValue(value);

    await this.element.evaluate((el, shouldBeChecked) => {
      if (shouldBeChecked === 'toggle') {
        el.checked = !el.checked;
      } else {
        el.checked = shouldBeChecked;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, normalizedValue);
  }

  _normalizeValue(value) {
    if (typeof value === 'boolean') {
      return value;
    }

    const strValue = String(value).toLowerCase();

    if (['check', 'checked', 'true', 'yes', '1', 'on'].includes(strValue)) {
      return true;
    }
    if (['uncheck', 'unchecked', 'false', 'no', '0', 'off'].includes(strValue)) {
      return false;
    }
    if (strValue === 'toggle') {
      return 'toggle';
    }

    // Default: treat as check
    return true;
  }

  /**
   * Check the checkbox/radio
   */
  async check() {
    await this.setValue(true);
  }

  /**
   * Uncheck the checkbox (not applicable to radio)
   */
  async uncheck() {
    await this.setValue(false);
  }

  /**
   * Toggle the checkbox state
   */
  async toggle() {
    await this.setValue('toggle');
  }

  /**
   * Check if currently checked
   */
  async isChecked() {
    return await this.element.evaluate(el => el.checked);
  }

  async getValue() {
    return await this.isChecked();
  }

  async getMetadata() {
    const base = await super.getMetadata();
    const extra = await this.element.evaluate(el => ({
      checked: el.checked,
      inputValue: el.value, // The value attribute (sent when checked)
    }));
    return { ...base, ...extra };
  }

  getActionDescription(value, identifier) {
    const normalizedValue = this._normalizeValue(value);
    if (normalizedValue === 'toggle') {
      return `Toggled ${identifier}`;
    }
    return normalizedValue ? `Checked ${identifier}` : `Unchecked ${identifier}`;
  }
}
