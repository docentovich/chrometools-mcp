/**
 * models/CheckboxGroupModel.js
 *
 * Model for checkbox groups.
 * Allows selecting multiple options from a group by name, values, or label texts.
 * Supports set (replace all), add, remove, and toggle modes.
 */

import { BaseInputModel } from './BaseInputModel.js';

export class CheckboxGroupModel extends BaseInputModel {
  /**
   * Create a CheckboxGroupModel
   * @param {string} groupName - The name attribute of the checkbox group
   * @param {Page} page - Puppeteer page
   */
  constructor(groupName, page) {
    super(null, page);
    this.groupName = groupName;
  }

  /**
   * Get all options in this checkbox group
   */
  async getOptions() {
    return await this.page.evaluate((name) => {
      const inputs = document.querySelectorAll(`input[type="checkbox"][name="${name}"]`);
      return Array.from(inputs).map(input => {
        // Find label text
        let label = null;
        const parentLabel = input.closest('label');
        if (parentLabel) {
          label = parentLabel.textContent?.trim();
        } else if (input.id) {
          const labelFor = document.querySelector(`label[for="${input.id}"]`);
          if (labelFor) {
            label = labelFor.textContent?.trim();
          }
        }
        label = label || input.getAttribute('aria-label') || input.value;

        return {
          value: input.value,
          label,
          checked: input.checked,
          disabled: input.disabled
        };
      });
    }, this.groupName);
  }

  /**
   * Get currently selected values
   */
  async getValue() {
    return await this.page.evaluate((name) => {
      const checked = document.querySelectorAll(`input[type="checkbox"][name="${name}"]:checked`);
      return Array.from(checked).map(input => input.value);
    }, this.groupName);
  }

  /**
   * Set checkbox values
   * @param {string|string[]} values - Value(s) or label text(s) to select
   * @param {object} options - { mode: 'set'|'add'|'remove'|'toggle', by: 'value'|'text'|'auto' }
   */
  async setValue(values, options = {}) {
    const { mode = 'set', by = 'auto' } = options;
    const valueList = Array.isArray(values) ? values : [values];

    const result = await this.page.evaluate((name, vals, selectMode, selectBy) => {
      const inputs = document.querySelectorAll(`input[type="checkbox"][name="${name}"]`);
      const changes = [];

      // Helper to check if value matches
      const matches = (input, val) => {
        // Get label text
        let label = null;
        const parentLabel = input.closest('label');
        if (parentLabel) {
          label = parentLabel.textContent?.trim();
        } else if (input.id) {
          const labelFor = document.querySelector(`label[for="${input.id}"]`);
          if (labelFor) {
            label = labelFor.textContent?.trim();
          }
        }
        label = label || input.getAttribute('aria-label');

        switch (selectBy) {
          case 'value':
            return input.value === val;
          case 'text':
            return label && (label === val || label.toLowerCase().includes(val.toLowerCase()));
          case 'auto':
          default:
            return input.value === val ||
                   (label && (label === val || label.toLowerCase().includes(val.toLowerCase())));
        }
      };

      // If mode is 'set', first uncheck all (that are not in values)
      if (selectMode === 'set') {
        for (const input of inputs) {
          if (input.disabled) continue;
          const shouldBeChecked = vals.some(val => matches(input, val));
          if (input.checked !== shouldBeChecked) {
            input.checked = shouldBeChecked;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            changes.push({ value: input.value, checked: shouldBeChecked });
          }
        }
      } else {
        // For add/remove/toggle modes
        for (const val of vals) {
          for (const input of inputs) {
            if (input.disabled) continue;
            if (!matches(input, val)) continue;

            let newState = input.checked;
            switch (selectMode) {
              case 'add':
                newState = true;
                break;
              case 'remove':
                newState = false;
                break;
              case 'toggle':
                newState = !input.checked;
                break;
            }

            if (input.checked !== newState) {
              input.checked = newState;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              changes.push({ value: input.value, checked: newState });
            }
            break; // Found matching input for this value
          }
        }
      }

      // Get final state
      const checked = document.querySelectorAll(`input[type="checkbox"][name="${name}"]:checked`);
      return {
        success: true,
        changes,
        selectedValues: Array.from(checked).map(input => input.value)
      };
    }, this.groupName, valueList, mode, by);

    return result;
  }

  /**
   * Check specific values (add mode)
   */
  async check(values) {
    return await this.setValue(values, { mode: 'add' });
  }

  /**
   * Uncheck specific values (remove mode)
   */
  async uncheck(values) {
    return await this.setValue(values, { mode: 'remove' });
  }

  /**
   * Toggle specific values
   */
  async toggle(values) {
    return await this.setValue(values, { mode: 'toggle' });
  }

  /**
   * Clear all checkboxes
   */
  async clear() {
    return await this.page.evaluate((name) => {
      const inputs = document.querySelectorAll(`input[type="checkbox"][name="${name}"]:checked`);
      inputs.forEach(input => {
        if (!input.disabled) {
          input.checked = false;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      return { success: true, cleared: inputs.length };
    }, this.groupName);
  }

  getActionDescription(values, identifier) {
    const valueList = Array.isArray(values) ? values : [values];
    return `Selected [${valueList.join(', ')}] in checkbox group "${this.groupName}"`;
  }
}
