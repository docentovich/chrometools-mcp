/**
 * Base class for all element models
 * Defines interface that all models must implement
 */
class ElementModel {
  /**
   * Get short model name (used in APOM output)
   * @returns {string} Model name (e.g., "TxtInp", "DatePicker")
   */
  getName() {
    throw new Error('getName() must be implemented');
  }

  /**
   * Get list of available actions for this model
   * @returns {Array<string>} Action names (primary action first)
   */
  getActions() {
    throw new Error('getActions() must be implemented');
  }

  /**
   * Check if element matches this model
   * @param {HTMLElement} element - DOM element
   * @param {Object} elementType - Result from determineElementType()
   * @returns {boolean} True if element matches this model
   */
  matches(element, elementType) {
    throw new Error('matches() must be implemented');
  }

  /**
   * Get action handler name for given action
   * Returns the name of the function in utils/actions/ to execute
   * @param {string} actionName - Action name (e.g., "type", "click")
   * @returns {string|null} Handler function name or null if not supported
   */
  getActionHandler(actionName) {
    throw new Error('getActionHandler() must be implemented');
  }

  /**
   * Get priority for model matching (higher = checked first)
   * Used when multiple models might match the same element
   * @returns {number} Priority (default: 0)
   */
  getPriority() {
    return 0;
  }
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ElementModel;
}
if (typeof window !== 'undefined') {
  window.ElementModel = ElementModel;
}
