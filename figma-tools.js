// Figma API integration tools
// Provides utilities for working with Figma API: file browsing, design system extraction, and more

/**
 * Parse Figma URL to extract fileKey and nodeId
 * Supports various Figma URL formats:
 * - https://www.figma.com/file/FILE_KEY/title?node-id=NODE_ID
 * - https://www.figma.com/design/FILE_KEY/title?node-id=NODE_ID
 * - https://figma.com/file/FILE_KEY
 */
export function parseFigmaUrl(url) {
  if (!url) {
    throw new Error('Figma URL is required');
  }

  // If it's not a URL (just fileKey or nodeId), return as-is
  if (!url.includes('figma.com')) {
    return { fileKey: url, nodeId: null };
  }

  try {
    const urlObj = new URL(url);

    // Extract fileKey from path: /file/FILE_KEY or /design/FILE_KEY
    const pathMatch = urlObj.pathname.match(/\/(file|design)\/([^\/]+)/);
    if (!pathMatch) {
      throw new Error('Invalid Figma URL format. Expected: figma.com/file/FILE_KEY or figma.com/design/FILE_KEY');
    }

    const fileKey = pathMatch[2];

    // Extract nodeId from query parameters
    // Formats: ?node-id=123:456 or ?node-id=123-456
    const nodeIdParam = urlObj.searchParams.get('node-id');
    let nodeId = null;

    if (nodeIdParam) {
      // Convert URL format (123-456) to API format (123:456)
      nodeId = nodeIdParam.replace(/-/g, ':');
    }

    return { fileKey, nodeId };
  } catch (error) {
    throw new Error(`Failed to parse Figma URL: ${error.message}`);
  }
}

/**
 * Normalize Figma node ID
 * Converts URL format (123-456) to API format (123:456)
 */
export function normalizeFigmaNodeId(nodeId) {
  if (!nodeId) return null;
  return nodeId.replace(/-/g, ':');
}

/**
 * Fetch data from Figma API
 */
export async function fetchFigmaAPI(endpoint, figmaToken) {
  if (!figmaToken) {
    throw new Error('Figma token is required. Get it from https://www.figma.com/developers/api#access-tokens');
  }

  const response = await fetch(`https://api.figma.com/v1/${endpoint}`, {
    headers: {
      'X-Figma-Token': figmaToken
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Figma API error: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Get file metadata and structure
 */
export async function getFigmaFile(fileKey, figmaToken) {
  const data = await fetchFigmaAPI(`files/${fileKey}`, figmaToken);
  return data;
}

/**
 * Get all pages and frames from Figma file
 * Returns hierarchical structure: pages -> frames
 */
export async function listFigmaPages(fileKey, figmaToken) {
  const fileData = await getFigmaFile(fileKey, figmaToken);

  const pages = fileData.document.children.map(page => {
    // Extract frames/top-level nodes from each page
    const frames = page.children ? page.children.map(frame => ({
      id: frame.id,
      name: frame.name,
      type: frame.type,
      visible: frame.visible !== false,
      dimensions: frame.absoluteBoundingBox ? {
        width: frame.absoluteBoundingBox.width,
        height: frame.absoluteBoundingBox.height
      } : null
    })) : [];

    return {
      id: page.id,
      name: page.name,
      type: page.type,
      framesCount: frames.length,
      frames: frames
    };
  });

  return {
    fileName: fileData.name,
    lastModified: fileData.lastModified,
    version: fileData.version,
    pagesCount: pages.length,
    pages: pages
  };
}

/**
 * Search for frames/components by name
 */
export async function searchFigmaFrames(fileKey, figmaToken, searchQuery) {
  const fileData = await getFigmaFile(fileKey, figmaToken);
  const results = [];

  function searchNode(node, pageName = 'Unknown Page', depth = 0) {
    // Check if node name matches search query (case-insensitive)
    if (node.name && node.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      results.push({
        id: node.id,
        name: node.name,
        type: node.type,
        page: pageName,
        depth: depth,
        dimensions: node.absoluteBoundingBox ? {
          width: node.absoluteBoundingBox.width,
          height: node.absoluteBoundingBox.height
        } : null
      });
    }

    // Recursively search children
    if (node.children) {
      node.children.forEach(child => searchNode(child, pageName, depth + 1));
    }
  }

  // Search through all pages
  fileData.document.children.forEach(page => {
    searchNode(page, page.name, 0);
  });

  return {
    query: searchQuery,
    resultsCount: results.length,
    results: results
  };
}

/**
 * Get all components from Figma file (Design System)
 */
export async function getFigmaComponents(fileKey, figmaToken) {
  const fileData = await getFigmaFile(fileKey, figmaToken);
  const components = [];

  function extractComponents(node) {
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      components.push({
        id: node.id,
        name: node.name,
        type: node.type,
        description: node.description || null,
        dimensions: node.absoluteBoundingBox ? {
          width: node.absoluteBoundingBox.width,
          height: node.absoluteBoundingBox.height
        } : null
      });
    }

    if (node.children) {
      node.children.forEach(child => extractComponents(child));
    }
  }

  fileData.document.children.forEach(page => extractComponents(page));

  return {
    fileName: fileData.name,
    componentsCount: components.length,
    components: components
  };
}

/**
 * Get all styles from Figma file (colors, text styles, effects)
 */
export async function getFigmaStyles(fileKey, figmaToken) {
  const fileData = await getFigmaFile(fileKey, figmaToken);

  const styles = {
    fileName: fileData.name,
    styles: {
      fill: [],
      text: [],
      effect: [],
      grid: []
    }
  };

  // Extract styles from file metadata
  if (fileData.styles) {
    Object.entries(fileData.styles).forEach(([styleId, style]) => {
      const styleInfo = {
        id: styleId,
        name: style.name,
        description: style.description || null,
        type: style.styleType
      };

      switch (style.styleType) {
        case 'FILL':
          styles.styles.fill.push(styleInfo);
          break;
        case 'TEXT':
          styles.styles.text.push(styleInfo);
          break;
        case 'EFFECT':
          styles.styles.effect.push(styleInfo);
          break;
        case 'GRID':
          styles.styles.grid.push(styleInfo);
          break;
      }
    });
  }

  styles.totalStyles =
    styles.styles.fill.length +
    styles.styles.text.length +
    styles.styles.effect.length +
    styles.styles.grid.length;

  return styles;
}

/**
 * Extract color palette from Figma file
 */
export async function getFigmaColorPalette(fileKey, figmaToken) {
  const fileData = await getFigmaFile(fileKey, figmaToken);
  const colors = new Map(); // Use Map to avoid duplicates

  function rgbaToHex(r, g, b, a) {
    const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
    const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    return a < 1 ? { hex, rgba: `rgba(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)}, ${a})` } : { hex };
  }

  function extractColors(node) {
    // Extract fill colors
    if (node.fills && Array.isArray(node.fills)) {
      node.fills.forEach(fill => {
        if (fill.type === 'SOLID' && fill.color) {
          const { r, g, b } = fill.color;
          const a = fill.opacity !== undefined ? fill.opacity : 1;
          const colorInfo = rgbaToHex(r, g, b, a);
          const key = colorInfo.rgba || colorInfo.hex;

          if (!colors.has(key)) {
            colors.set(key, {
              ...colorInfo,
              usedIn: []
            });
          }
          colors.get(key).usedIn.push({ node: node.name, type: 'fill' });
        }
      });
    }

    // Extract stroke colors
    if (node.strokes && Array.isArray(node.strokes)) {
      node.strokes.forEach(stroke => {
        if (stroke.type === 'SOLID' && stroke.color) {
          const { r, g, b } = stroke.color;
          const a = stroke.opacity !== undefined ? stroke.opacity : 1;
          const colorInfo = rgbaToHex(r, g, b, a);
          const key = colorInfo.rgba || colorInfo.hex;

          if (!colors.has(key)) {
            colors.set(key, {
              ...colorInfo,
              usedIn: []
            });
          }
          colors.get(key).usedIn.push({ node: node.name, type: 'stroke' });
        }
      });
    }

    // Recursively search children
    if (node.children) {
      node.children.forEach(child => extractColors(child));
    }
  }

  fileData.document.children.forEach(page => extractColors(page));

  // Convert Map to array and limit usage examples
  const colorArray = Array.from(colors.values()).map(color => ({
    hex: color.hex,
    rgba: color.rgba,
    usageCount: color.usedIn.length,
    usageExamples: color.usedIn.slice(0, 3) // Limit to 3 examples
  }));

  return {
    fileName: fileData.name,
    totalColors: colorArray.length,
    colors: colorArray.sort((a, b) => b.usageCount - a.usageCount) // Sort by usage
  };
}

/**
 * Extract text from node tree (recursive)
 */
export function extractTextFromNode(node, depth = 0) {
  const result = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible !== false
  };

  // Extract text content for TEXT nodes
  if (node.type === 'TEXT' && node.characters) {
    result.text = node.characters;
  }

  // Add dimensions if available
  if (node.absoluteBoundingBox) {
    result.dimensions = {
      width: node.absoluteBoundingBox.width,
      height: node.absoluteBoundingBox.height,
      x: node.absoluteBoundingBox.x,
      y: node.absoluteBoundingBox.y
    };
  }

  // Recursively process children
  if (node.children && node.children.length > 0) {
    result.children = node.children.map(child => extractTextFromNode(child, depth + 1));
  }

  return result;
}

/**
 * Collect all text content from node tree
 */
export function collectAllText(node, texts = []) {
  if (node.type === 'TEXT' && node.characters) {
    texts.push({
      name: node.name,
      text: node.characters,
      visible: node.visible !== false
    });
  }
  if (node.children) {
    node.children.forEach(child => collectAllText(child, texts));
  }
  return texts;
}

/**
 * Simplify Figma node structure for code generation
 * Extracts only essential properties: layout, styling, text, and children
 */
export function simplifyNode(node) {
  if (!node) return null;

  const simplified = {
    type: node.type,
    name: node.name,
  };

  // Dimensions
  if (node.absoluteBoundingBox) {
    simplified.size = {
      width: Math.round(node.absoluteBoundingBox.width),
      height: Math.round(node.absoluteBoundingBox.height),
    };
  }

  // Layout properties (Auto Layout / Flexbox)
  if (node.layoutMode) {
    simplified.layout = {
      mode: node.layoutMode, // HORIZONTAL or VERTICAL
      padding: (node.paddingLeft || node.paddingTop || node.paddingRight || node.paddingBottom) ? {
        top: node.paddingTop || 0,
        right: node.paddingRight || 0,
        bottom: node.paddingBottom || 0,
        left: node.paddingLeft || 0,
      } : undefined,
      gap: node.itemSpacing,
      align: node.primaryAxisAlignItems,
      justify: node.counterAxisAlignItems,
    };
  }

  // Border radius
  if (node.cornerRadius) {
    simplified.borderRadius = node.cornerRadius;
  } else if (node.rectangleCornerRadii) {
    simplified.borderRadius = node.rectangleCornerRadii;
  }

  // Fills (backgrounds)
  if (node.fills && node.fills.length > 0) {
    simplified.fills = node.fills
      .filter(fill => fill.visible !== false)
      .map(fill => ({
        type: fill.type,
        color: fill.color ? {
          r: Math.round(fill.color.r * 255),
          g: Math.round(fill.color.g * 255),
          b: Math.round(fill.color.b * 255),
          a: fill.color.a !== undefined ? Math.round(fill.color.a * 100) / 100 : 1,
        } : undefined,
        opacity: fill.opacity,
      }));
  }

  // Strokes (borders)
  if (node.strokes && node.strokes.length > 0) {
    simplified.strokes = node.strokes
      .filter(stroke => stroke.visible !== false)
      .map(stroke => ({
        type: stroke.type,
        color: stroke.color ? {
          r: Math.round(stroke.color.r * 255),
          g: Math.round(stroke.color.g * 255),
          b: Math.round(stroke.color.b * 255),
          a: stroke.color.a !== undefined ? Math.round(stroke.color.a * 100) / 100 : 1,
        } : undefined,
      }));

    if (node.strokeWeight) {
      simplified.strokeWeight = node.strokeWeight;
    }
  }

  // Effects (shadows, blurs)
  if (node.effects && node.effects.length > 0) {
    simplified.effects = node.effects
      .filter(effect => effect.visible !== false)
      .map(effect => ({
        type: effect.type,
        radius: effect.radius,
        offset: effect.offset,
        color: effect.color ? {
          r: Math.round(effect.color.r * 255),
          g: Math.round(effect.color.g * 255),
          b: Math.round(effect.color.b * 255),
          a: Math.round(effect.color.a * 100) / 100,
        } : undefined,
      }));
  }

  // Text properties
  if (node.type === 'TEXT') {
    simplified.text = node.characters;
    if (node.style) {
      simplified.textStyle = {
        fontFamily: node.style.fontFamily,
        fontWeight: node.style.fontWeight,
        fontSize: node.style.fontSize,
        lineHeight: node.style.lineHeightPx,
        letterSpacing: node.style.letterSpacing,
        textAlign: node.style.textAlignHorizontal,
      };
    }
  }

  // Recursively simplify children
  if (node.children && node.children.length > 0) {
    simplified.children = node.children
      .map(child => simplifyNode(child))
      .filter(Boolean); // Remove null values
  }

  return simplified;
}
