/**
 * models/BaseInputModel.js
 *
 * Base class for all input element models.
 * Provides common interface for interacting with form elements.
 */

export class BaseInputModel {
  constructor(element, page) {
    this.element = element;
    this.page = page;
  }

  /**
   * Get the input type (to be overridden by subclasses)
   */
  static get inputTypes() {
    return [];
  }

  /**
   * Check if this model handles the given input type
   */
  static handles(inputType) {
    return this.inputTypes.includes(inputType?.toLowerCase());
  }

  /**
   * Set value on the element
   * @param {string} value - Value to set
   * @param {object} options - Additional options (delay, clearFirst, etc.)
   */
  async setValue(value, options = {}) {
    throw new Error('setValue must be implemented by subclass');
  }

  /**
   * Get current value from the element
   */
  async getValue() {
    return await this.element.evaluate(el => el.value);
  }

  /**
   * Clear the element value
   */
  async clear() {
    await this.element.evaluate(el => {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  /**
   * Focus on the element
   */
  async focus() {
    await this.element.focus();
  }

  /**
   * Dispatch input and change events (for framework compatibility)
   */
  async dispatchEvents() {
    await this.element.evaluate(el => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  /**
   * Get element metadata
   */
  async getMetadata() {
    return await this.element.evaluate(el => ({
      tagName: el.tagName.toLowerCase(),
      type: el.type,
      name: el.name,
      id: el.id,
      disabled: el.disabled,
      required: el.required,
      value: el.value,
    }));
  }

  /**
   * Get description of the action performed (for logging)
   */
  getActionDescription(value, identifier) {
    return `Set value "${value}" on ${identifier}`;
  }
}
