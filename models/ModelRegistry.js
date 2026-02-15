/**
 * Model Registry - Strategy Pattern Implementation
 * Manages registration and selection of element models
 */

class ModelRegistry {
  constructor() {
    this.models = [];
    this.modelsMap = null; // Cached models -> actions map
  }

  /**
   * Register a model class (not instance)
   * @param {Class} ModelClass - Element model class
   */
  register(ModelClass) {
    const instance = new ModelClass();
    this.models.push(instance);

    // Sort by priority (higher first)
    this.models.sort((a, b) => b.getPriority() - a.getPriority());

    // Invalidate cache
    this.modelsMap = null;
  }

  /**
   * Register multiple models at once
   * @param {Array<Class>} modelClasses - Array of model classes
   */
  registerAll(modelClasses) {
    for (const ModelClass of modelClasses) {
      this.register(ModelClass);
    }
  }

  /**
   * Find matching model for element (Strategy Pattern)
   * @param {HTMLElement} element - DOM element
   * @param {Object} elementType - Result from determineElementType()
   * @returns {ElementModel} Matching model instance
   */
  findModel(element, elementType) {
    for (const model of this.models) {
      if (model.matches(element, elementType)) {
        return model;
      }
    }

    // This should never happen if DefaultModel is registered
    throw new Error('No matching model found (is DefaultModel registered?)');
  }

  /**
   * Get models map for APOM output (cached)
   * @returns {Object} Map of model names to actions
   */
  getModelsMap() {
    if (this.modelsMap === null) {
      this.modelsMap = {};
      for (const model of this.models) {
        this.modelsMap[model.getName()] = model.getActions();
      }
    }
    return this.modelsMap;
  }

  /**
   * Get model by name
   * @param {string} modelName - Model name
   * @returns {ElementModel|null} Model instance or null
   */
  getModelByName(modelName) {
    return this.models.find(m => m.getName() === modelName) || null;
  }

  /**
   * Get action handler name for element action
   * @param {HTMLElement} element - Target element
   * @param {Object} elementType - Element type info
   * @param {string} actionName - Action to execute
   * @returns {Object} { handlerName: string, modelName: string } or { error: string }
   */
  getActionHandler(element, elementType, actionName) {
    const model = this.findModel(element, elementType);

    // Check if action is available
    const actions = model.getActions();
    if (!actions.includes(actionName)) {
      return {
        error: `Action "${actionName}" not available for model "${model.getName()}". Available: ${actions.join(', ')}`
      };
    }

    const handlerName = model.getActionHandler(actionName);
    if (!handlerName) {
      return {
        error: `Action "${actionName}" has no handler in model "${model.getName()}"`
      };
    }

    return {
      handlerName,
      modelName: model.getName()
    };
  }
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ModelRegistry;
}
if (typeof window !== 'undefined') {
  window.ModelRegistry = ModelRegistry;
}
