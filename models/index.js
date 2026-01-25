/**
 * models/index.js
 *
 * Input element models for chrometools-mcp.
 * Provides specialized handlers for different input types.
 *
 * Usage:
 *   import { getInputModel, InputModelFactory } from './models/index.js';
 *
 *   const model = await getInputModel(element, page);
 *   await model.setValue('some value');
 */

import { BaseInputModel } from './BaseInputModel.js';
import { TextInputModel } from './TextInputModel.js';
import { TimeInputModel } from './TimeInputModel.js';
import { DateInputModel } from './DateInputModel.js';
import { ColorInputModel } from './ColorInputModel.js';
import { RangeInputModel } from './RangeInputModel.js';
import { SelectModel } from './SelectModel.js';
import { CheckboxModel } from './CheckboxModel.js';
import { TextareaModel } from './TextareaModel.js';

/**
 * Registry of all input models in priority order.
 * More specific models should come before generic ones.
 */
const MODEL_REGISTRY = [
  TimeInputModel,
  DateInputModel,
  ColorInputModel,
  RangeInputModel,
  CheckboxModel,
  SelectModel,
  TextareaModel,
  TextInputModel,  // Default fallback for text-like inputs
];

/**
 * Factory class for creating appropriate input models
 */
export class InputModelFactory {
  /**
   * Get element info (tagName, inputType)
   */
  static async getElementInfo(element) {
    return await element.evaluate(el => ({
      tagName: el.tagName.toLowerCase(),
      inputType: el.type?.toLowerCase() || null,
    }));
  }

  /**
   * Find the appropriate model class for an element
   */
  static findModelClass(tagName, inputType) {
    // Check for element-specific handlers first (select, textarea)
    for (const ModelClass of MODEL_REGISTRY) {
      if (ModelClass.handlesElement && ModelClass.handlesElement(tagName, inputType)) {
        return ModelClass;
      }
    }

    // Then check input type handlers
    for (const ModelClass of MODEL_REGISTRY) {
      if (ModelClass.handles(inputType)) {
        return ModelClass;
      }
    }

    // Fallback to TextInputModel for unknown types
    return TextInputModel;
  }

  /**
   * Create a model instance for the given element
   * @param {ElementHandle} element - Puppeteer element handle
   * @param {Page} page - Puppeteer page
   * @returns {Promise<BaseInputModel>} Model instance
   */
  static async create(element, page) {
    const { tagName, inputType } = await this.getElementInfo(element);
    const ModelClass = this.findModelClass(tagName, inputType);
    return new ModelClass(element, page);
  }

  /**
   * Get model class name for an element (useful for logging)
   */
  static async getModelName(element) {
    const { tagName, inputType } = await this.getElementInfo(element);
    const ModelClass = this.findModelClass(tagName, inputType);
    return ModelClass.name;
  }
}

/**
 * Convenience function to get a model for an element
 * @param {ElementHandle} element - Puppeteer element handle
 * @param {Page} page - Puppeteer page
 * @returns {Promise<BaseInputModel>} Model instance
 */
export async function getInputModel(element, page) {
  return await InputModelFactory.create(element, page);
}

// Export all models for direct use if needed
export {
  BaseInputModel,
  TextInputModel,
  TimeInputModel,
  DateInputModel,
  ColorInputModel,
  RangeInputModel,
  SelectModel,
  CheckboxModel,
  TextareaModel,
};
