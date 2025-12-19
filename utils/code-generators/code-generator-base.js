/**
 * utils/code-generators/code-generator-base.js
 *
 * Base class for test code generators.
 * Provides common functionality for all test frameworks.
 */

import { cleanSelector, getBestSelector, analyzeSelectorStability } from '../selector-cleaner.js';

/**
 * Base code generator class
 */
export class CodeGeneratorBase {
  constructor(options = {}) {
    this.options = {
      cleanSelectors: true,
      includeComments: true,
      generatePageObjects: false,
      indentSize: 2,
      ...options
    };
  }

  /**
   * Generate test code from scenario
   * @param {Object} scenario - Scenario object
   * @param {Object} options - Generation options
   * @returns {string} - Generated test code
   */
  generate(scenario, options = {}) {
    this.options = { ...this.options, ...options };

    const testName = scenario.metadata?.name || 'test';
    const description = scenario.metadata?.description || '';
    const entryUrl = scenario.metadata?.entryUrl || '';
    const exitUrl = scenario.metadata?.exitUrl || '';

    const lines = [];

    // Generate imports
    lines.push(...this.generateImports());
    lines.push('');

    // Generate test function/method
    lines.push(...this.generateTestHeader(testName, description));
    lines.push('');

    // Generate navigation to entry URL
    if (entryUrl) {
      lines.push(...this.generateNavigate(entryUrl));
    }

    // Generate actions
    for (const action of scenario.chain) {
      const actionCode = this.generateAction(action);
      if (actionCode && actionCode.length > 0) {
        lines.push(...actionCode);
      }
    }

    // Generate exit URL validation
    if (exitUrl) {
      lines.push('');
      if (this.options.includeComments) {
        lines.push(this.indent(this.generateComment('Validate final URL'), 1));
      }
      lines.push(...this.generateUrlAssertion(exitUrl));
    }

    // Generate test footer
    lines.push(...this.generateTestFooter());

    return lines.join('\n');
  }

  /**
   * Prepare selector for use in test
   * @param {Object} action - Action with selector
   * @returns {string} - Prepared selector
   */
  prepareSelector(action) {
    const selectorObj = action.selector;

    if (!selectorObj) {
      return null;
    }

    if (this.options.cleanSelectors) {
      return getBestSelector(selectorObj);
    }

    // Return primary selector without cleaning
    return selectorObj.primary || selectorObj.value || String(selectorObj);
  }

  /**
   * Indent line(s) by specified level
   * @param {string} text - Text to indent
   * @param {number} level - Indentation level
   * @returns {string} - Indented text
   */
  indent(text, level = 1) {
    const spaces = ' '.repeat(this.options.indentSize * level);
    return spaces + text;
  }

  /**
   * Escape string for use in code
   * @param {string} str - String to escape
   * @returns {string} - Escaped string
   */
  escapeString(str) {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  /**
   * Get action type description for comments
   * @param {Object} action - Action object
   * @returns {string} - Human-readable description
   */
  getActionDescription(action) {
    const type = action.type;
    const selector = this.prepareSelector(action);

    switch (type) {
      case 'click':
        return `Click ${selector}`;
      case 'type':
        return `Type into ${selector}`;
      case 'select':
        return `Select option in ${selector}`;
      case 'hover':
        return `Hover over ${selector}`;
      case 'scroll':
        return `Scroll to ${selector}`;
      case 'navigate':
        return `Navigate to ${action.data?.url}`;
      case 'wait':
        return `Wait ${action.data?.duration}ms`;
      case 'keypress':
        return `Press key: ${action.data?.key}`;
      case 'upload':
        return `Upload file to ${selector}`;
      case 'drag':
        return `Drag ${selector}`;
      default:
        return `Execute ${type}`;
    }
  }

  /**
   * Generate inline comment (can be overridden for language-specific syntax)
   * @param {string} text - Comment text
   * @returns {string} - Comment with language-specific syntax
   */
  generateComment(text) {
    return `// ${text}`;
  }

  /**
   * Generate action comment
   * @param {Object} action - Action object
   * @param {number} indent - Indentation level
   * @returns {string[]} - Comment lines
   */
  generateActionComment(action, indentLevel = 1) {
    if (!this.options.includeComments) {
      return [];
    }

    const description = this.getActionDescription(action);
    return [this.indent(this.generateComment(description), indentLevel)];
  }

  // ========================================
  // ABSTRACT METHODS (must be implemented by subclasses)
  // ========================================

  /**
   * Generate import statements
   * @returns {string[]} - Import lines
   */
  generateImports() {
    throw new Error('generateImports() must be implemented by subclass');
  }

  /**
   * Generate test header (function/method declaration)
   * @param {string} testName - Test name
   * @param {string} description - Test description
   * @returns {string[]} - Header lines
   */
  generateTestHeader(testName, description) {
    throw new Error('generateTestHeader() must be implemented by subclass');
  }

  /**
   * Generate test footer (closing braces, etc.)
   * @returns {string[]} - Footer lines
   */
  generateTestFooter() {
    throw new Error('generateTestFooter() must be implemented by subclass');
  }

  /**
   * Generate navigation code
   * @param {string} url - URL to navigate to
   * @returns {string[]} - Navigation code lines
   */
  generateNavigate(url) {
    throw new Error('generateNavigate() must be implemented by subclass');
  }

  /**
   * Generate action code
   * @param {Object} action - Action object
   * @returns {string[]} - Action code lines
   */
  generateAction(action) {
    throw new Error('generateAction() must be implemented by subclass');
  }

  /**
   * Generate URL assertion
   * @param {string} expectedUrl - Expected URL
   * @returns {string[]} - Assertion code lines
   */
  generateUrlAssertion(expectedUrl) {
    throw new Error('generateUrlAssertion() must be implemented by subclass');
  }
}
