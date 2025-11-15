/**
 * recorder/scenario-storage.js
 *
 * Manages scenario and secrets storage:
 * 1. Save/load scenarios to/from files
 * 2. Save/load secrets separately
 * 3. Maintain scenario index with metadata
 * 4. Ensure .gitignore for secrets directory
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default storage directories (relative to project root)
const DEFAULT_SCENARIOS_DIR = path.join(process.cwd(), 'scenarios');
const DEFAULT_SECRETS_DIR = path.join(process.cwd(), 'secrets');
const INDEX_FILE = 'index.json';
const GITIGNORE_FILE = '.gitignore';

/**
 * Initialize storage directories
 * Creates directories and ensures .gitignore exists
 */
export async function initializeStorage() {
  // Create scenarios directory
  await fs.mkdir(DEFAULT_SCENARIOS_DIR, { recursive: true });

  // Create secrets directory
  await fs.mkdir(DEFAULT_SECRETS_DIR, { recursive: true });

  // Ensure .gitignore in secrets directory
  await ensureSecretsGitignore();

  // Create empty index if doesn't exist
  const indexPath = path.join(DEFAULT_SCENARIOS_DIR, INDEX_FILE);
  try {
    await fs.access(indexPath);
  } catch {
    await saveIndex({});
  }
}

/**
 * Ensure .gitignore exists in secrets directory
 */
async function ensureSecretsGitignore() {
  const gitignorePath = path.join(DEFAULT_SECRETS_DIR, GITIGNORE_FILE);

  const content = `# Ignore all secret files
*
!.gitignore
`;

  try {
    await fs.writeFile(gitignorePath, content, 'utf-8');
  } catch (e) {
    console.error('Error creating .gitignore in secrets directory:', e);
  }
}

/**
 * Save scenario to file
 * @param {Object} scenario - Scenario data
 * @returns {Object} - { success: boolean, path: string, error?: string }
 */
export async function saveScenario(scenario) {
  try {
    await initializeStorage();

    const { name, metadata, chain, secrets } = scenario;

    // Validate scenario
    if (!name || !chain) {
      return {
        success: false,
        error: 'Scenario must have name and chain'
      };
    }

    // Save main scenario file (without secrets)
    const scenarioData = {
      name,
      metadata: metadata || {},
      chain,
      version: '1.0',
      createdAt: new Date().toISOString()
    };

    const scenarioPath = path.join(DEFAULT_SCENARIOS_DIR, `${name}.json`);
    await fs.writeFile(scenarioPath, JSON.stringify(scenarioData, null, 2), 'utf-8');

    // Save secrets separately if exist
    if (secrets && Object.keys(secrets).length > 0) {
      await saveSecrets(name, secrets);
    }

    // Update index
    await updateIndex(name, metadata);

    return {
      success: true,
      path: scenarioPath
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Load scenario from file
 * @param {string} name - Scenario name
 * @param {boolean} includeSecrets - Whether to load secrets
 * @returns {Object} - Scenario data or null
 */
export async function loadScenario(name, includeSecrets = false) {
  try {
    const scenarioPath = path.join(DEFAULT_SCENARIOS_DIR, `${name}.json`);
    const content = await fs.readFile(scenarioPath, 'utf-8');
    const scenario = JSON.parse(content);

    // Load secrets if requested
    if (includeSecrets) {
      const secrets = await loadSecrets(name);
      if (secrets) {
        scenario.secrets = secrets;
      }
    }

    return scenario;
  } catch (error) {
    console.error(`Error loading scenario "${name}":`, error.message);
    return null;
  }
}

/**
 * Save secrets for a scenario
 * @param {string} scenarioName - Scenario name
 * @param {Object} secrets - Secrets object { paramName: value }
 */
async function saveSecrets(scenarioName, secrets) {
  try {
    const secretsPath = path.join(DEFAULT_SECRETS_DIR, `${scenarioName}.json`);
    await fs.writeFile(secretsPath, JSON.stringify(secrets, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error saving secrets for "${scenarioName}":`, error.message);
  }
}

/**
 * Load secrets for a scenario
 * @param {string} scenarioName - Scenario name
 * @returns {Object|null} - Secrets object or null
 */
export async function loadSecrets(scenarioName) {
  try {
    const secretsPath = path.join(DEFAULT_SECRETS_DIR, `${scenarioName}.json`);
    const content = await fs.readFile(secretsPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    // Secrets file may not exist (not an error)
    return null;
  }
}

/**
 * Update scenario index
 * @param {string} scenarioName - Scenario name
 * @param {Object} metadata - Scenario metadata
 */
async function updateIndex(scenarioName, metadata) {
  const index = await loadIndex();

  index[scenarioName] = {
    name: scenarioName,
    description: metadata.description || '',
    tags: metadata.tags || [],
    dependencies: metadata.dependencies || [],
    parameters: metadata.parameters || {},
    outputs: metadata.outputs || [],
    createdAt: index[scenarioName]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await saveIndex(index);
}

/**
 * Load scenario index
 * @returns {Object} - Index object
 */
export async function loadIndex() {
  try {
    const indexPath = path.join(DEFAULT_SCENARIOS_DIR, INDEX_FILE);
    const content = await fs.readFile(indexPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    // Index doesn't exist yet
    return {};
  }
}

/**
 * Save scenario index
 * @param {Object} index - Index object
 */
async function saveIndex(index) {
  try {
    const indexPath = path.join(DEFAULT_SCENARIOS_DIR, INDEX_FILE);
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving index:', error.message);
  }
}

/**
 * List all available scenarios
 * @returns {Array} - Array of scenario metadata
 */
export async function listScenarios() {
  const index = await loadIndex();
  return Object.values(index);
}

/**
 * Search scenarios by query
 * @param {Object} query - Search query { tags?, text?, dependencies? }
 * @returns {Array} - Matching scenarios
 */
export async function searchScenarios(query) {
  const index = await loadIndex();
  const scenarios = Object.values(index);

  let results = scenarios;

  // Filter by tags
  if (query.tags && query.tags.length > 0) {
    results = results.filter(s =>
      query.tags.some(tag => s.tags.includes(tag))
    );
  }

  // Filter by text (name or description)
  if (query.text) {
    const textLower = query.text.toLowerCase();
    results = results.filter(s =>
      s.name.toLowerCase().includes(textLower) ||
      s.description.toLowerCase().includes(textLower)
    );
  }

  // Filter by dependencies
  if (query.dependencies) {
    results = results.filter(s =>
      s.dependencies.some(dep => dep.scenario === query.dependencies)
    );
  }

  return results;
}

/**
 * Delete scenario
 * @param {string} name - Scenario name
 * @returns {boolean} - Success
 */
export async function deleteScenario(name) {
  try {
    // Delete scenario file
    const scenarioPath = path.join(DEFAULT_SCENARIOS_DIR, `${name}.json`);
    await fs.unlink(scenarioPath);

    // Delete secrets file if exists
    const secretsPath = path.join(DEFAULT_SECRETS_DIR, `${name}.json`);
    try {
      await fs.unlink(secretsPath);
    } catch {
      // Secrets file may not exist
    }

    // Remove from index
    const index = await loadIndex();
    delete index[name];
    await saveIndex(index);

    return true;
  } catch (error) {
    console.error(`Error deleting scenario "${name}":`, error.message);
    return false;
  }
}

/**
 * Rename scenario
 * @param {string} oldName - Current name
 * @param {string} newName - New name
 * @returns {boolean} - Success
 */
export async function renameScenario(oldName, newName) {
  try {
    // Load scenario
    const scenario = await loadScenario(oldName, true);
    if (!scenario) {
      return false;
    }

    // Update name
    scenario.name = newName;

    // Save with new name
    await saveScenario(scenario);

    // Delete old scenario
    await deleteScenario(oldName);

    return true;
  } catch (error) {
    console.error(`Error renaming scenario "${oldName}" to "${newName}":`, error.message);
    return false;
  }
}

/**
 * Export scenario (with optional secrets)
 * Returns JSON string for sharing
 * @param {string} name - Scenario name
 * @param {boolean} includeSecrets - Whether to include secrets
 * @returns {string} - JSON string
 */
export async function exportScenario(name, includeSecrets = false) {
  const scenario = await loadScenario(name, includeSecrets);

  if (!scenario) {
    throw new Error(`Scenario "${name}" not found`);
  }

  return JSON.stringify(scenario, null, 2);
}

/**
 * Import scenario from JSON string
 * @param {string} jsonString - Scenario JSON
 * @param {boolean} overwrite - Overwrite if exists
 * @returns {Object} - { success: boolean, name: string, error?: string }
 */
export async function importScenario(jsonString, overwrite = false) {
  try {
    const scenario = JSON.parse(jsonString);

    // Validate
    if (!scenario.name || !scenario.chain) {
      return {
        success: false,
        error: 'Invalid scenario format'
      };
    }

    // Check if exists
    if (!overwrite) {
      const existing = await loadScenario(scenario.name);
      if (existing) {
        return {
          success: false,
          error: `Scenario "${scenario.name}" already exists. Use overwrite=true to replace.`
        };
      }
    }

    // Save scenario
    const result = await saveScenario(scenario);

    return {
      success: result.success,
      name: scenario.name,
      error: result.error
    };
  } catch (error) {
    return {
      success: false,
      error: `Import failed: ${error.message}`
    };
  }
}

/**
 * Get storage statistics
 * @returns {Object} - Statistics
 */
export async function getStorageStats() {
  const index = await loadIndex();
  const scenarios = Object.values(index);

  // Count scenarios with secrets
  let scenariosWithSecrets = 0;
  for (const scenario of scenarios) {
    const secrets = await loadSecrets(scenario.name);
    if (secrets && Object.keys(secrets).length > 0) {
      scenariosWithSecrets++;
    }
  }

  // Collect tags
  const allTags = new Set();
  scenarios.forEach(s => {
    (s.tags || []).forEach(tag => allTags.add(tag));
  });

  return {
    totalScenarios: scenarios.length,
    scenariosWithSecrets,
    scenariosWithDependencies: scenarios.filter(s => s.dependencies.length > 0).length,
    totalTags: allTags.size,
    tags: Array.from(allTags)
  };
}

/**
 * Validate storage integrity
 * Checks for orphaned files, broken dependencies, etc.
 * @returns {Object} - { valid: boolean, errors: string[], warnings: string[] }
 */
export async function validateStorage() {
  const result = {
    valid: true,
    errors: [],
    warnings: []
  };

  const index = await loadIndex();

  // Check for scenario files without index entry
  try {
    const files = await fs.readdir(DEFAULT_SCENARIOS_DIR);
    const scenarioFiles = files.filter(f => f.endsWith('.json') && f !== INDEX_FILE);

    for (const file of scenarioFiles) {
      const name = file.replace('.json', '');
      if (!index[name]) {
        result.warnings.push(`Scenario file "${file}" has no index entry`);
      }
    }
  } catch (error) {
    result.errors.push(`Error reading scenarios directory: ${error.message}`);
    result.valid = false;
  }

  // Check for broken dependencies
  for (const [name, scenario] of Object.entries(index)) {
    if (scenario.dependencies) {
      for (const dep of scenario.dependencies) {
        if (!index[dep.scenario]) {
          result.errors.push(`Scenario "${name}" depends on "${dep.scenario}" which doesn't exist`);
          result.valid = false;
        }
      }
    }
  }

  return result;
}
