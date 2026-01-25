/**
 * models/RadioGroupModel.js
 *
 * Model for radio button groups.
 * Allows selecting one option from a group by name, value, or label text.
 */

import { BaseInputModel } from './BaseInputModel.js';

export class RadioGroupModel extends BaseInputModel {
  /**
   * Create a RadioGroupModel
   * @param {string} groupName - The name attribute of the radio group
   * @param {Page} page - Puppeteer page
   */
  constructor(groupName, page) {
    super(null, page);
    this.groupName = groupName;
  }

  /**
   * Get all options in this radio group
   */
  async getOptions() {
    return await this.page.evaluate((name) => {
      const inputs = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
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
   * Get currently selected value
   */
  async getValue() {
    return await this.page.evaluate((name) => {
      const checked = document.querySelector(`input[type="radio"][name="${name}"]:checked`);
      return checked ? checked.value : null;
    }, this.groupName);
  }

  /**
   * Select a radio option by value or label text
   * @param {string} value - Value or label text to select
   * @param {object} options - { by: 'value'|'text'|'auto' }
   */
  async setValue(value, options = {}) {
    const { by = 'auto' } = options;

    const result = await this.page.evaluate((name, val, selectBy) => {
      const inputs = document.querySelectorAll(`input[type="radio"][name="${name}"]`);

      for (const input of inputs) {
        if (input.disabled) continue;

        let match = false;

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
            match = input.value === val;
            break;
          case 'text':
            match = label && (label === val || label.toLowerCase().includes(val.toLowerCase()));
            break;
          case 'auto':
          default:
            // Try value first, then label
            match = input.value === val ||
                    (label && (label === val || label.toLowerCase().includes(val.toLowerCase())));
            break;
        }

        if (match) {
          input.checked = true;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, selectedValue: input.value, selectedLabel: label };
        }
      }

      return { success: false, error: `No matching option found for "${val}" in radio group "${name}"` };
    }, this.groupName, value, by);

    if (!result.success) {
      throw new Error(result.error);
    }

    return result;
  }

  getActionDescription(value, identifier) {
    return `Selected "${value}" in radio group "${this.groupName}"`;
  }
}
