/**
 * recorder/dependency-resolver.js
 *
 * Resolves scenario dependencies with:
 * 1. Dependency graph construction
 * 2. Cycle detection
 * 3. Topological sorting
 * 4. Conditional dependency execution
 * 5. Parameter passing between scenarios
 */

/**
 * Resolve dependency chain for a scenario
 * @param {string} scenarioName - Target scenario name
 * @param {Object} scenarioIndex - Full scenario index
 * @param {Object} options - { skipConditions: boolean }
 * @returns {Object} - { chain: string[], cycles: string[][], errors: string[] }
 */
export function resolveDependencies(scenarioName, scenarioIndex, options = {}) {
  const result = {
    chain: [],
    cycles: [],
    errors: [],
    graph: {}
  };

  // Build dependency graph
  result.graph = buildDependencyGraph(scenarioIndex);

  // Check if scenario exists
  if (!scenarioIndex[scenarioName]) {
    result.errors.push(`Scenario "${scenarioName}" not found`);
    return result;
  }

  // Detect cycles
  const cycles = detectCycles(result.graph, scenarioName);
  if (cycles.length > 0) {
    result.cycles = cycles;
    result.errors.push(`Circular dependencies detected: ${cycles.map(c => c.join(' → ')).join(', ')}`);
    return result;
  }

  // Build execution chain using topological sort
  const visited = new Set();
  const chain = [];

  function visit(name) {
    if (visited.has(name)) {
      return;
    }

    visited.add(name);

    // Visit dependencies first
    const scenario = scenarioIndex[name];
    if (scenario.dependencies && scenario.dependencies.length > 0) {
      for (const dep of scenario.dependencies) {
        // Handle both string format and object format { scenario: "name" }
        const depName = typeof dep === 'string' ? dep : dep.scenario;

        // Skip if conditional and skipConditions is true
        if (options.skipConditions && dep.optional && dep.condition) {
          continue;
        }

        if (depName) {
          visit(depName);
        }
      }
    }

    chain.push(name);
  }

  visit(scenarioName);
  result.chain = chain;

  return result;
}

/**
 * Build dependency graph from scenario index
 * @param {Object} scenarioIndex - Full scenario index
 * @returns {Object} - Graph: { scenarioName: [dependencies...] }
 */
function buildDependencyGraph(scenarioIndex) {
  const graph = {};

  for (const [name, scenario] of Object.entries(scenarioIndex)) {
    graph[name] = [];

    if (scenario.dependencies && scenario.dependencies.length > 0) {
      for (const dep of scenario.dependencies) {
        // Handle both string format and object format { scenario: "name" }
        const depName = typeof dep === 'string' ? dep : dep.scenario;
        if (depName) {
          graph[name].push(depName);
        }
      }
    }
  }

  return graph;
}

/**
 * Detect circular dependencies using DFS
 * @param {Object} graph - Dependency graph
 * @param {string} startNode - Starting scenario
 * @returns {Array} - Array of cycles (each cycle is array of scenario names)
 */
function detectCycles(graph, startNode) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();

  function dfs(node, path = []) {
    if (visiting.has(node)) {
      // Cycle detected
      const cycleStart = path.indexOf(node);
      const cycle = [...path.slice(cycleStart), node];
      cycles.push(cycle);
      return;
    }

    if (visited.has(node)) {
      return;
    }

    visiting.add(node);
    path.push(node);

    const dependencies = graph[node] || [];
    for (const dep of dependencies) {
      if (graph[dep]) {
        dfs(dep, [...path]);
      }
    }

    visiting.delete(node);
    visited.add(node);
  }

  dfs(startNode);

  return cycles;
}

/**
 * Check if dependency condition is satisfied
 * @param {Object} condition - Condition from dependency metadata
 * @param {Object} context - Execution context (page state, variables)
 * @returns {boolean} - True if condition is satisfied
 */
export async function checkDependencyCondition(condition, context) {
  if (!condition || !condition.check) {
    return true; // No condition means always execute
  }

  const { check, skipIf } = condition;

  // Common condition checks
  let result = false;

  switch (check) {
    case 'isAuthenticated':
      result = await checkIsAuthenticated(context);
      break;

    case 'hasData':
      result = await checkHasData(condition.key, context);
      break;

    case 'urlMatches':
      result = await checkUrlMatches(condition.pattern, context);
      break;

    case 'elementExists':
      result = await checkElementExists(condition.selector, context);
      break;

    case 'variableExists':
      result = checkVariableExists(condition.variable, context);
      break;

    default:
      // Custom condition - evaluate as JavaScript expression
      result = await evaluateCustomCondition(check, context);
  }

  // Apply skipIf logic
  return skipIf ? !result : result;
}

/**
 * Check if user is authenticated
 */
async function checkIsAuthenticated(context) {
  const { page } = context;

  // Common authentication indicators
  const indicators = [
    // Check for auth tokens in localStorage
    await page.evaluate(() => {
      return !!(localStorage.getItem('token') ||
                localStorage.getItem('authToken') ||
                localStorage.getItem('accessToken') ||
                localStorage.getItem('jwt'));
    }),

    // Check for auth cookies
    (await page.cookies()).some(cookie =>
      cookie.name.toLowerCase().includes('auth') ||
      cookie.name.toLowerCase().includes('session') ||
      cookie.name.toLowerCase().includes('token')
    ),

    // Check for logout button (indicates logged in)
    await page.evaluate(() => {
      const logoutKeywords = ['logout', 'log out', 'sign out', 'signout', 'выход', 'выйти'];
      const buttons = Array.from(document.querySelectorAll('button, a'));
      return buttons.some(btn => {
        const text = btn.textContent.toLowerCase();
        return logoutKeywords.some(kw => text.includes(kw));
      });
    })
  ];

  return indicators.some(i => i === true);
}

/**
 * Check if specific data exists in context
 */
async function checkHasData(key, context) {
  return context.variables && context.variables[key] !== undefined;
}

/**
 * Check if current URL matches pattern
 */
async function checkUrlMatches(pattern, context) {
  const { page } = context;
  const currentUrl = page.url();

  if (pattern instanceof RegExp) {
    return pattern.test(currentUrl);
  }

  return currentUrl.includes(pattern);
}

/**
 * Check if element exists on page
 */
async function checkElementExists(selector, context) {
  const { page } = context;

  try {
    const element = await page.$(selector);
    return element !== null;
  } catch (e) {
    return false;
  }
}

/**
 * Check if variable exists in context
 */
function checkVariableExists(variable, context) {
  return context.variables && context.variables[variable] !== undefined;
}

/**
 * Evaluate custom condition (JavaScript expression)
 */
async function evaluateCustomCondition(expression, context) {
  try {
    // Create safe evaluation context
    const { page, variables } = context;

    // Allow access to page methods and variables
    const evaluationContext = {
      url: page.url(),
      title: await page.title(),
      variables: variables || {},
      page: {
        url: () => page.url(),
        title: () => page.title()
      }
    };

    // Simple eval (in real implementation, use safer alternative like vm2)
    const func = new Function('context', `with(context) { return ${expression}; }`);
    return func(evaluationContext);
  } catch (e) {
    console.error('Error evaluating custom condition:', e);
    return false;
  }
}

/**
 * Extract parameters from scenario execution result
 * Used to pass data between chained scenarios
 * @param {Object} scenarioResult - Execution result
 * @param {Array} parameterMappings - Parameter mappings from dependency metadata
 * @returns {Object} - Extracted parameters
 */
export function extractParameters(scenarioResult, parameterMappings) {
  const params = {};

  if (!parameterMappings || parameterMappings.length === 0) {
    return params;
  }

  for (const mapping of parameterMappings) {
    const { from, to, transform } = mapping;

    let value = scenarioResult[from];

    // Apply transformation if specified
    if (transform && value !== undefined) {
      value = applyTransform(value, transform);
    }

    if (value !== undefined) {
      params[to] = value;
    }
  }

  return params;
}

/**
 * Apply transformation to parameter value
 */
function applyTransform(value, transform) {
  switch (transform) {
    case 'toString':
      return String(value);

    case 'toNumber':
      return Number(value);

    case 'toLowerCase':
      return String(value).toLowerCase();

    case 'toUpperCase':
      return String(value).toUpperCase();

    case 'trim':
      return String(value).trim();

    default:
      // Custom transform function
      if (typeof transform === 'function') {
        return transform(value);
      }
      return value;
  }
}

/**
 * Validate dependency chain before execution
 * @param {Array} chain - Execution chain
 * @param {Object} scenarioIndex - Full scenario index
 * @param {Object} providedParams - Parameters provided by user
 * @returns {Object} - { valid: boolean, errors: string[], warnings: string[] }
 */
export function validateDependencyChain(chain, scenarioIndex, providedParams = {}) {
  const result = {
    valid: true,
    errors: [],
    warnings: []
  };

  const availableParams = { ...providedParams };

  for (const scenarioName of chain) {
    const scenario = scenarioIndex[scenarioName];

    if (!scenario) {
      result.valid = false;
      result.errors.push(`Scenario "${scenarioName}" not found in index`);
      continue;
    }

    // Check required parameters
    if (scenario.metadata?.parameters) {
      for (const [paramName, paramDef] of Object.entries(scenario.metadata.parameters)) {
        if (paramDef.required && availableParams[paramName] === undefined) {
          result.valid = false;
          result.errors.push(`Scenario "${scenarioName}" requires parameter "${paramName}" which is not available`);
        }

        // Type validation
        if (availableParams[paramName] !== undefined && paramDef.type) {
          const actualType = typeof availableParams[paramName];
          const expectedType = paramDef.type;

          if (actualType !== expectedType) {
            result.warnings.push(
              `Parameter "${paramName}" type mismatch in "${scenarioName}": expected ${expectedType}, got ${actualType}`
            );
          }
        }
      }
    }

    // Add output parameters to available params for next scenarios
    if (scenario.metadata?.outputs) {
      for (const output of scenario.metadata.outputs) {
        availableParams[output] = `<from ${scenarioName}>`;
      }
    }
  }

  return result;
}

/**
 * Visualize dependency graph (for debugging)
 * @param {Object} graph - Dependency graph
 * @returns {string} - ASCII visualization
 */
export function visualizeDependencyGraph(graph) {
  const lines = [];
  const visited = new Set();

  function printNode(name, indent = 0) {
    if (visited.has(name)) {
      lines.push(`${'  '.repeat(indent)}${name} (circular)`);
      return;
    }

    visited.add(name);
    lines.push(`${'  '.repeat(indent)}${name}`);

    const deps = graph[name] || [];
    for (const dep of deps) {
      printNode(dep, indent + 1);
    }
  }

  for (const root of Object.keys(graph)) {
    if (!visited.has(root)) {
      printNode(root);
      lines.push('');
    }
  }

  return lines.join('\n');
}
