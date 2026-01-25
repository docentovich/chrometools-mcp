/**
 * models/SelectModel.js
 *
 * Model for select (dropdown) elements.
 * Supports selection by value, text, or index.
 */

import { BaseInputModel } from './BaseInputModel.js';

export class SelectModel extends BaseInputModel {
  static get inputTypes() {
    return ['select', 'select-one', 'select-multiple'];
  }

  /**
   * Check if this model handles the given element
   * Override to check tagName for select elements
   */
  static handlesElement(tagName, inputType) {
    return tagName?.toLowerCase() === 'select';
  }

  /**
   * Select option by value, text, or index
   * @param {string|number} value - Value to select
   * @param {object} options - { by: 'value'|'text'|'index' }
   */
  async setValue(value, options = {}) {
    const { by = 'value' } = options;

    await this.element.evaluate((el, val, selectBy) => {
      let found = false;

      for (let i = 0; i < el.options.length; i++) {
        const option = el.options[i];
        let match = false;

        switch (selectBy) {
          case 'index':
            match = i === parseInt(val, 10);
            break;
          case 'text':
            match = option.text === val || option.text.includes(val);
            break;
          case 'value':
          default:
            match = option.value === val;
            break;
        }

        if (match) {
          el.selectedIndex = i;
          found = true;
          break;
        }
      }

      if (!found) {
        throw new Error(`Option not found: ${val} (by ${selectBy})`);
      }

      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value, by);
  }

  /**
   * Get all available options
   */
  async getOptions() {
    return await this.element.evaluate(el => {
      return Array.from(el.options).map((opt, i) => ({
        index: i,
        value: opt.value,
        text: opt.text,
        selected: opt.selected,
      }));
    });
  }

  async getMetadata() {
    const base = await super.getMetadata();
    const extra = await this.element.evaluate(el => ({
      multiple: el.multiple,
      selectedIndex: el.selectedIndex,
      options: Array.from(el.options).map(opt => ({
        value: opt.value,
        text: opt.text,
        selected: opt.selected,
      })),
    }));
    return { ...base, ...extra };
  }

  getActionDescription(value, identifier) {
    return `Selected "${value}" on ${identifier}`;
  }
}
