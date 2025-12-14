// CSS property categorization
export const CSS_CATEGORIES = {
  layout: [
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'position', 'top', 'right', 'bottom', 'left', 'z-index',
    'display', 'float', 'clear', 'overflow', 'overflow-x', 'overflow-y',
    'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
    'justify-content', 'align-items', 'align-content', 'align-self', 'order',
    'grid', 'grid-template', 'grid-template-columns', 'grid-template-rows', 'grid-gap',
    'gap', 'row-gap', 'column-gap',
    'box-sizing', 'visibility', 'clip', 'clip-path'
  ],
  typography: [
    'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-decoration',
    'text-transform', 'text-indent', 'text-overflow', 'white-space', 'word-break',
    'word-wrap', 'overflow-wrap', 'hyphens', 'direction', 'unicode-bidi',
    'writing-mode', 'vertical-align'
  ],
  colors: [
    'color', 'background', 'background-color', 'background-image', 'background-position',
    'background-size', 'background-repeat', 'background-attachment', 'background-clip',
    'background-origin', 'background-blend-mode',
    'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'outline-color', 'text-decoration-color', 'caret-color', 'column-rule-color'
  ],
  visual: [
    'opacity', 'transform', 'transform-origin', 'transform-style', 'perspective',
    'perspective-origin', 'backface-visibility',
    'transition', 'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay',
    'animation', 'animation-name', 'animation-duration', 'animation-timing-function', 'animation-delay',
    'animation-iteration-count', 'animation-direction', 'animation-fill-mode', 'animation-play-state',
    'filter', 'backdrop-filter', 'mix-blend-mode', 'isolation',
    'box-shadow', 'text-shadow',
    'border', 'border-width', 'border-style', 'border-radius',
    'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'outline', 'outline-width', 'outline-style', 'outline-offset',
    'cursor', 'pointer-events', 'user-select'
  ]
};

// Common default CSS values to filter out
export const CSS_DEFAULTS = {
  'display': 'inline',
  'position': 'static',
  'float': 'none',
  'clear': 'none',
  'visibility': 'visible',
  'overflow': 'visible',
  'overflow-x': 'visible',
  'overflow-y': 'visible',
  'z-index': 'auto',
  'opacity': '1',
  'transform': 'none',
  'filter': 'none',
  'backdrop-filter': 'none',
  'box-shadow': 'none',
  'text-shadow': 'none',
  'border-style': 'none',
  'border-width': '0px',
  'outline-style': 'none',
  'outline-width': '0px',
  'margin': '0px',
  'margin-top': '0px',
  'margin-right': '0px',
  'margin-bottom': '0px',
  'margin-left': '0px',
  'padding': '0px',
  'padding-top': '0px',
  'padding-right': '0px',
  'padding-bottom': '0px',
  'padding-left': '0px',
  'background-image': 'none',
  'transition': 'all 0s ease 0s',
  'animation': 'none',
  'pointer-events': 'auto',
  'user-select': 'auto',
  'cursor': 'auto',
  'text-decoration': 'none',
  'text-transform': 'none',
  'font-weight': '400',
  'font-style': 'normal',
  'font-variant': 'normal',
  'letter-spacing': 'normal',
  'word-spacing': 'normal',
  'text-align': 'start',
  'white-space': 'normal',
  'word-break': 'normal',
  'overflow-wrap': 'normal',
  'hyphens': 'manual'
};

// Filter computed CSS styles based on options
export function filterCssStyles(computedStyle, options = {}) {
  const { category, properties, includeDefaults = false } = options;

  let filtered = computedStyle;

  // Filter by specific properties (highest priority)
  if (properties && properties.length > 0) {
    filtered = filtered.filter(prop =>
      properties.some(p => prop.name.toLowerCase() === p.toLowerCase())
    );
  }
  // Filter by category
  else if (category && category !== 'all') {
    const categoryProps = CSS_CATEGORIES[category] || [];
    filtered = filtered.filter(prop =>
      categoryProps.some(p => prop.name.toLowerCase().startsWith(p.toLowerCase()))
    );
  }

  // Filter out default values if requested
  if (!includeDefaults) {
    filtered = filtered.filter(prop => {
      const defaultValue = CSS_DEFAULTS[prop.name];
      if (!defaultValue) return true;

      // Normalize values for comparison
      const normalizedValue = prop.value.replace(/\s+/g, ' ').trim();
      const normalizedDefault = defaultValue.replace(/\s+/g, ' ').trim();

      return normalizedValue !== normalizedDefault;
    });
  }

  return filtered;
}
