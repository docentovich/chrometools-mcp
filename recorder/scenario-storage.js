/**
 * recorder/scenario-storage.js
 *
 * Manages scenario and secrets storage:
 * 1. Save/load scenarios to/from files
 * 2. Save/load secrets separately
 * 3. Maintain project-specific and global indexes
 * 4. Ensure .gitignore for secrets directory
 */

import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import { homedir } from 'os';

// Constants
const INDEX_FILE = 'index.json';
const GITIGNORE_FILE = '.gitignore';
const BASE_STORAGE_DIR = path.join(homedir(), '.config', 'chrometools-mcp');
const GLOBAL_INDEX_PATH = path.join(BASE_STORAGE_DIR, 'index.json');
const PROJECTS_DIR = path.join(BASE_STORAGE_DIR, 'projects');

/**
 * Load global index from ~/.config/chrometools-mcp/index.json
 * @returns {object} - Global index object
 */
function loadGlobalIndex() {
  try {
    const data = fssync.readFileSync(GLOBAL_INDEX_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    // Index doesn't exist yet, return empty structure
    return {
      version: '2.0',
      projects: {}
    };
  }
}

/**
 * Save global index to ~/.config/chrometools-mcp/index.json
 * @param {object} index - Global index object
 */
async function saveGlobalIndex(index) {
  await fs.mkdir(BASE_STORAGE_DIR, { recursive: true });
  await fs.writeFile(GLOBAL_INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * Update global index with scenario metadata
 * @param {string} projectId - Project identifier
 * @param {string} projectPath - Full path to project root
 * @param {string} scenarioName - Scenario name
 * @param {object} metadata - Scenario metadata
 */
async function updateGlobalIndex(projectId, projectPath, scenarioName, metadata) {
  const index = loadGlobalIndex();

  if (!index.projects[projectId]) {
    index.projects[projectId] = {
      projectPath,
      lastAccessed: new Date().toISOString(),
      scenarios: {}
    };
  }

  index.projects[projectId].scenarios[scenarioName] = {
    name: scenarioName,
    description: metadata.description || '',
    tags: metadata.tags || [],
    dependencies: metadata.dependencies || [],
    parameters: metadata.parameters || {},
    outputs: metadata.outputs || [],
    entryUrl: metadata.entryUrl || null,
    exitUrl: metadata.exitUrl || null,
    createdAt: index.projects[projectId].scenarios[scenarioName]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  index.projects[projectId].lastAccessed = new Date().toISOString();

  await saveGlobalIndex(index);
}

/**
 * Remove scenario from global index
 * @param {string} projectId - Project identifier
 * @param {string} scenarioName - Scenario name
 */
async function removeFromGlobalIndex(projectId, scenarioName) {
  const index = loadGlobalIndex();

  if (index.projects[projectId]?.scenarios[scenarioName]) {
    delete index.projects[projectId].scenarios[scenarioName];

    // Remove project if no scenarios left
    if (Object.keys(index.projects[projectId].scenarios).length === 0) {
      delete index.projects[projectId];
    }

    await saveGlobalIndex(index);
  }
}

/**
 * Find scenario in global index
 * @param {string} scenarioName - Scenario name
 * @param {string|null} projectId - Optional project filter
 * @returns {object|null} - { projectId, metadata } or null
 */
/**
 * Find all scenarios with the given name across all projects
 * @param {string} scenarioName - Scenario name
 * @returns {Array} - Array of { projectId, metadata } objects
 */
function findAllScenariosWithName(scenarioName) {
  const index = loadGlobalIndex();
  const results = [];

  for (const [pid, project] of Object.entries(index.projects)) {
    if (project.scenarios[scenarioName]) {
      results.push({
        projectId: pid,
        metadata: project.scenarios[scenarioName]
      });
    }
  }

  return results;
}

function findScenarioInGlobalIndex(scenarioName, projectId = null) {
  const index = loadGlobalIndex();

  if (projectId) {
    // Search in specific project
    if (index.projects[projectId]?.scenarios[scenarioName]) {
      return {
        projectId,
        metadata: index.projects[projectId].scenarios[scenarioName]
      };
    }
    return null;
  }

  // Search in all projects - check for collisions
  const allMatches = findAllScenariosWithName(scenarioName);

  if (allMatches.length === 0) {
    return null;
  }

  if (allMatches.length > 1) {
    // Multiple scenarios with same name - return collision error
    return {
      collision: true,
      matches: allMatches.map(m => m.projectId)
    };
  }

  // Single match - return it
  return allMatches[0];
}

/**
 * Initialize storage directories
 * Creates directories and ensures .gitignore exists
 * @param {string} baseDir - Base directory for scenarios and secrets (project directory)
 */
export async function initializeStorage(baseDir) {
  const scenariosDir = path.join(baseDir, 'scenarios');
  const secretsDir = path.join(baseDir, 'secrets');

  // Create scenarios directory
  await fs.mkdir(scenariosDir, { recursive: true });

  // Create secrets directory
  await fs.mkdir(secretsDir, { recursive: true });

  // Ensure .gitignore in secrets directory
  await ensureSecretsGitignore(secretsDir);

  // Create empty index if doesn't exist
  const indexPath = path.join(scenariosDir, INDEX_FILE);
  try {
    await fs.access(indexPath);
  } catch {
    await saveIndex({}, scenariosDir);
  }
}

/**
 * Ensure .gitignore exists in secrets directory
 * @param {string} secretsDir - Path to secrets directory
 */
async function ensureSecretsGitignore(secretsDir) {
  const gitignorePath = path.join(secretsDir, GITIGNORE_FILE);

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
 * @param {string} urlProjectId - Project identifier extracted from URL (e.g., "google", "localhost-3000")
 * @returns {Object} - { success: boolean, path: string, error?: string }
 */
export async function saveScenario(scenario, urlProjectId) {
  try {
    // Use URL-based projectId directly
    const projectId = urlProjectId;
    const projectPath = `url://${urlProjectId}`;

    // Get project directory
    const projectDir = path.join(PROJECTS_DIR, projectId);
    await initializeStorage(projectDir);

    const { name, metadata, chain, secrets } = scenario;

    // Validate scenario
    if (!name || !chain) {
      return {
        success: false,
        error: 'Scenario must have name and chain'
      };
    }

    const scenariosDir = path.join(projectDir, 'scenarios');
    const secretsDir = path.join(projectDir, 'secrets');

    // Add project info to metadata
    const enhancedMetadata = {
      ...(metadata || {}),
      projectId,
      projectPath
    };

    // Save main scenario file (without secrets)
    const scenarioData = {
      name,
      metadata: enhancedMetadata,
      chain,
      version: '1.0',
      createdAt: new Date().toISOString()
    };

    const scenarioPath = path.join(scenariosDir, `${name}.json`);
    await fs.writeFile(scenarioPath, JSON.stringify(scenarioData, null, 2), 'utf-8');

    // Save secrets separately if exist
    if (secrets && Object.keys(secrets).length > 0) {
      await saveSecrets(name, secrets, secretsDir);
    }

    // Update project-local index
    await updateIndex(name, enhancedMetadata, scenariosDir);

    // Update global index
    await updateGlobalIndex(projectId, projectPath, name, enhancedMetadata);

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
 * @param {string|null} projectId - Optional project ID filter
 * @returns {Object} - Scenario data or null
 */
export async function loadScenario(name, includeSecrets = false, projectId = null) {
  try {
    // Find scenario in global index
    const result = findScenarioInGlobalIndex(name, projectId);

    if (!result) {
      console.error(`Scenario "${name}" not found${projectId ? ` in project "${projectId}"` : ''}`);
      return null;
    }

    // Check for name collision
    if (result.collision) {
      const error = {
        collision: true,
        message: `Multiple scenarios named "${name}" found. Please specify projectId.`,
        availableProjectIds: result.matches
      };
      console.error(error.message, 'Available projectIds:', result.matches);
      return error;
    }

    // Load from project directory
    const projectDir = path.join(PROJECTS_DIR, result.projectId);
    const scenariosDir = path.join(projectDir, 'scenarios');
    const scenarioPath = path.join(scenariosDir, `${name}.json`);
    const content = await fs.readFile(scenarioPath, 'utf-8');
    const scenario = JSON.parse(content);

    // Load secrets if requested
    if (includeSecrets) {
      const secretsDir = path.join(projectDir, 'secrets');
      const secrets = await loadSecrets(name, secretsDir);
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
 * @param {string} secretsDir - Secrets directory path
 */
async function saveSecrets(scenarioName, secrets, secretsDir) {
  try {
    const secretsPath = path.join(secretsDir, `${scenarioName}.json`);
    await fs.writeFile(secretsPath, JSON.stringify(secrets, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error saving secrets for "${scenarioName}":`, error.message);
  }
}

/**
 * Load secrets for a scenario
 * @param {string} scenarioName - Scenario name
 * @param {string} secretsDir - Secrets directory path
 * @returns {Object|null} - Secrets object or null
 */
export async function loadSecrets(scenarioName, secretsDir) {
  try {
    const secretsPath = path.join(secretsDir, `${scenarioName}.json`);
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
 * @param {string} scenariosDir - Scenarios directory path
 */
async function updateIndex(scenarioName, metadata, scenariosDir) {
  const index = await loadIndex(scenariosDir);

  index[scenarioName] = {
    name: scenarioName,
    description: metadata.description || '',
    tags: metadata.tags || [],
    dependencies: metadata.dependencies || [],
    parameters: metadata.parameters || {},
    outputs: metadata.outputs || [],
    entryUrl: metadata.entryUrl || null,
    exitUrl: metadata.exitUrl || null,
    createdAt: index[scenarioName]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await saveIndex(index, scenariosDir);
}

/**
 * Load scenario index
 * @param {string} scenariosDir - Scenarios directory path
 * @returns {Object} - Index object
 */
export async function loadIndex(scenariosDir) {
  try {
    const indexPath = path.join(scenariosDir, INDEX_FILE);
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
 * @param {string} scenariosDir - Scenarios directory path
 */
async function saveIndex(index, scenariosDir) {
  try {
    const indexPath = path.join(scenariosDir, INDEX_FILE);
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving index:', error.message);
  }
}

/**
 * List all available scenarios
 * @param {string} currentProjectId - Current project identifier
 * @param {boolean} allProjects - Whether to list scenarios from all projects
 * @returns {Array} - Array of scenario metadata
 */
export async function listScenarios(currentProjectId, allProjects = false) {
  const globalIndex = loadGlobalIndex();
  const results = [];

  if (allProjects) {
    // Return scenarios from all projects
    for (const [projectId, project] of Object.entries(globalIndex.projects)) {
      for (const scenario of Object.values(project.scenarios)) {
        results.push({
          ...scenario,
          projectId,
          projectPath: project.projectPath
        });
      }
    }
  } else {
    // Return scenarios from current project only
    if (globalIndex.projects[currentProjectId]) {
      for (const scenario of Object.values(globalIndex.projects[currentProjectId].scenarios)) {
        results.push({
          ...scenario,
          projectId: currentProjectId,
          projectPath: globalIndex.projects[currentProjectId].projectPath
        });
      }
    }
  }

  return results;
}

/**
 * Search scenarios by query
 * @param {Object} query - Search query { tags?, text?, dependencies? }
 * @param {string} currentProjectId - Current project identifier
 * @param {boolean} allProjects - Whether to search in all projects
 * @returns {Array} - Matching scenarios
 */
export async function searchScenarios(query, currentProjectId, allProjects = false) {
  // Get all scenarios based on allProjects flag
  const scenarios = await listScenarios(currentProjectId, allProjects);

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
 * @param {string|null} projectId - Optional project ID filter
 * @returns {boolean} - Success
 */
export async function deleteScenario(name, projectId = null) {
  try {
    // Find scenario in global index
    const result = findScenarioInGlobalIndex(name, projectId);

    if (!result) {
      console.error(`Scenario "${name}" not found${projectId ? ` in project "${projectId}"` : ''}`);
      return false;
    }

    const projectDir = path.join(PROJECTS_DIR, result.projectId);
    const scenariosDir = path.join(projectDir, 'scenarios');
    const secretsDir = path.join(projectDir, 'secrets');

    // Delete scenario file
    const scenarioPath = path.join(scenariosDir, `${name}.json`);
    await fs.unlink(scenarioPath);

    // Delete secrets file if exists
    const secretsPath = path.join(secretsDir, `${name}.json`);
    try {
      await fs.unlink(secretsPath);
    } catch {
      // Secrets file may not exist
    }

    // Remove from project-local index
    const index = await loadIndex(scenariosDir);
    delete index[name];
    await saveIndex(index, scenariosDir);

    // Remove from global index
    await removeFromGlobalIndex(result.projectId, name);

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
 * @param {string} baseDir - Base directory for storage
 * @returns {boolean} - Success
 */
export async function renameScenario(oldName, newName, baseDir) {
  try {
    // Load scenario
    const scenario = await loadScenario(oldName, true, baseDir);
    if (!scenario) {
      return false;
    }

    // Update name
    scenario.name = newName;

    // Save with new name
    await saveScenario(scenario, baseDir);

    // Delete old scenario
    await deleteScenario(oldName, baseDir);

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
 * @param {string} baseDir - Base directory for storage
 * @returns {string} - JSON string
 */
export async function exportScenario(name, includeSecrets = false, baseDir) {
  const scenario = await loadScenario(name, includeSecrets, baseDir);

  if (!scenario) {
    throw new Error(`Scenario "${name}" not found`);
  }

  return JSON.stringify(scenario, null, 2);
}

/**
 * Import scenario from JSON string
 * @param {string} jsonString - Scenario JSON
 * @param {boolean} overwrite - Overwrite if exists
 * @param {string} baseDir - Base directory for storage
 * @returns {Object} - { success: boolean, name: string, error?: string }
 */
export async function importScenario(jsonString, overwrite = false, baseDir) {
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
      const existing = await loadScenario(scenario.name, false, baseDir);
      if (existing) {
        return {
          success: false,
          error: `Scenario "${scenario.name}" already exists. Use overwrite=true to replace.`
        };
      }
    }

    // Save scenario
    const result = await saveScenario(scenario, baseDir);

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
 * @param {string} baseDir - Base directory for storage
 * @returns {Object} - Statistics
 */
export async function getStorageStats(baseDir) {
  const scenariosDir = path.join(baseDir, 'scenarios');
  const secretsDir = path.join(baseDir, 'secrets');
  const index = await loadIndex(scenariosDir);
  const scenarios = Object.values(index);

  // Count scenarios with secrets
  let scenariosWithSecrets = 0;
  for (const scenario of scenarios) {
    const secrets = await loadSecrets(scenario.name, secretsDir);
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
 * @param {string} baseDir - Base directory for storage
 * @returns {Object} - { valid: boolean, errors: string[], warnings: string[] }
 */
export async function validateStorage(baseDir) {
  const result = {
    valid: true,
    errors: [],
    warnings: []
  };

  const scenariosDir = path.join(baseDir, 'scenarios');
  const index = await loadIndex(scenariosDir);

  // Check for scenario files without index entry
  try {
    const files = await fs.readdir(scenariosDir);
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
