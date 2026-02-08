/**
 * AI Hints Generator
 * Generates contextual hints for AI to understand what to do next
 */

/**
 * Generate hints after page navigation
 */
export async function generateNavigationHints(page, url) {
  // Wait for SPA frameworks (Angular, React, Vue) to render after navigation
  await new Promise(resolve => setTimeout(resolve, 500));

  return page.evaluate(() => {
    // Helper to get safe class selector (filters Tailwind special chars)
    function getSafeClassSelector(element) {
      if (!element.className || typeof element.className !== 'string') return null;
      const classes = element.className.split(' ')
        .filter(c => c && !/[:\/\[\]]/.test(c))
        .slice(0, 1);
      if (classes.length === 0) return null;
      try {
        return `.${CSS.escape(classes[0])}`;
      } catch (e) {
        return null;
      }
    }

    const hints = {
      pageType: 'unknown',
      availableActions: [],
      keyElements: [],
      suggestedNext: [],
      commonSelectors: {},
    };

    // Extract page heading (h1 first, then common framework title patterns)
    // Helper: check if element is truly visible (not sr-only / visually-hidden)
    function isReallyVisible(el) {
      if (!el || el.offsetWidth === 0) return false;
      if (el.offsetWidth <= 1 && el.offsetHeight <= 1) return false; // sr-only pattern
      const style = getComputedStyle(el);
      if (style.clip === 'rect(1px, 1px, 1px, 1px)' || style.clipPath === 'inset(50%)') return false;
      if (style.visibility === 'hidden' || style.opacity === '0') return false;
      return true;
    }
    const headingCandidates = [
      document.querySelector('h1'),
      document.querySelector('.page-title, [class*="page-title"]'),
      document.querySelector('[class*="page-header"] h1, [class*="page-header"] h2'),
    ];
    for (const el of headingCandidates) {
      if (el && isReallyVisible(el)) {
        hints.heading = el.textContent.trim().substring(0, 100);
        break;
      }
    }

    // Detect page type
    if (document.querySelector('form input[type="password"]')) {
      hints.pageType = 'login';
      hints.suggestedNext.push('Fill login credentials and submit');
      hints.commonSelectors.usernameField = 'input[type="email"], input[name*="user"], input[name*="email"]';
      hints.commonSelectors.passwordField = 'input[type="password"]';
      hints.commonSelectors.submitButton = 'button[type="submit"], input[type="submit"]';
    } else if (document.querySelector('form') && document.querySelectorAll('form input').length > 3) {
      hints.pageType = 'registration';
      hints.suggestedNext.push('Fill registration form and submit');
    } else if (document.querySelector('[class*="dashboard"], [id*="dashboard"]')) {
      hints.pageType = 'dashboard';
      hints.suggestedNext.push('Navigate to desired section');
    } else if (document.querySelector('form input[type="search"], input[placeholder*="search" i]')) {
      hints.pageType = 'search';
      hints.suggestedNext.push('Enter search query');
    } else if (document.querySelectorAll('article, .post, .product').length > 3) {
      hints.pageType = 'listing';
      hints.suggestedNext.push('Browse items or use filters');
    }

    // Available actions
    const forms = document.querySelectorAll('form');
    if (forms.length > 0) {
      hints.availableActions.push(`submit ${forms.length} form(s)`);
    }

    const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
    if (buttons.length > 0) {
      hints.availableActions.push(`click ${buttons.length} button(s)`);
    }

    const links = document.querySelectorAll('a[href]');
    if (links.length > 5) {
      hints.availableActions.push(`navigate to ${links.length} links`);
    }

    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea');
    if (inputs.length > 0) {
      hints.availableActions.push(`fill ${inputs.length} input field(s)`);
    }

    // Key elements
    const mainButton = document.querySelector('button.primary, button[class*="primary"], .btn-primary');
    if (mainButton && mainButton.offsetWidth > 0) {
      hints.keyElements.push({
        type: 'primary-button',
        text: mainButton.textContent.trim(),
        selector: mainButton.id ? `#${CSS.escape(mainButton.id)}` : (getSafeClassSelector(mainButton) || 'button'),
      });
    }

    const alerts = document.querySelectorAll('.alert, [role="alert"], .notification, .message');
    alerts.forEach(alert => {
      if (alert.offsetWidth > 0) {
        hints.keyElements.push({
          type: 'notification',
          text: alert.textContent.trim().substring(0, 100),
          selector: getSafeClassSelector(alert) || '[role="alert"]',
        });
      }
    });

    return hints;
  });
}

/**
 * Generate hints after click action
 */
export async function generateClickHints(page, selector) {
  // Wait a bit for any DOM changes
  await new Promise(resolve => setTimeout(resolve, 100));

  return page.evaluate((clickedSelector) => {
    // Helper to get safe class selector (filters Tailwind special chars)
    function getSafeClassSelector(element) {
      if (!element.className || typeof element.className !== 'string') return null;
      const classes = element.className.split(' ')
        .filter(c => c && !/[:\/\[\]]/.test(c))
        .slice(0, 1);
      if (classes.length === 0) return null;
      try {
        return `.${CSS.escape(classes[0])}`;
      } catch (e) {
        return null;
      }
    }

    const hints = {
      pageChanged: false,
      newElements: [],
      modalOpened: false,
      suggestedNext: [],
    };

    // Check for modals — find the topmost visible one
    const modalEls = document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], mat-dialog-container, .cdk-overlay-pane [role="dialog"], [class*="dialog"]');
    const visibleModals = Array.from(modalEls).filter(m => m.offsetWidth > 0 && m.offsetHeight > 0);
    // Deduplicate: skip modals nested inside another visible modal
    const topModals = visibleModals.filter(modal => {
      return !visibleModals.some(other => other !== modal && other.contains(modal));
    });
    // Take only the topmost modal (highest z-index or last in DOM)
    const topModal = topModals.length > 0 ? topModals[topModals.length - 1] : null;
    if (topModal) {
      hints.modalOpened = true;
      // Extract modal title
      const titleEl = topModal.querySelector('h1, h2, h3, .modal-title, [mat-dialog-title], .dialog-title');
      const title = titleEl ? titleEl.textContent.trim().substring(0, 100) : null;
      // Extract body text (excluding title and buttons)
      let bodyText = null;
      const bodyEl = topModal.querySelector('.modal-body, [mat-dialog-content], .dialog-content, .dialog-body');
      if (bodyEl) {
        bodyText = bodyEl.textContent.trim().substring(0, 200);
      } else if (!titleEl) {
        // Fallback: get modal text directly
        bodyText = topModal.textContent.trim().substring(0, 200);
      }
      // Extract action buttons (from footer or dialog-actions, limit to 5)
      const actionButtons = [];
      const actionsContainer = topModal.querySelector('.modal-footer, [mat-dialog-actions], .dialog-actions, .dialog-footer');
      const btnScope = actionsContainer || topModal;
      btnScope.querySelectorAll('button, [mat-button], [mat-raised-button], [mat-flat-button], a[role="button"]').forEach(btn => {
        const text = btn.textContent.trim();
        if (text && text.length < 50 && actionButtons.length < 5) actionButtons.push(text);
      });
      hints.newElements.push({
        type: 'modal',
        selector: getSafeClassSelector(topModal) || '[role="dialog"]',
        title: title,
        text: bodyText,
        actions: actionButtons.length > 0 ? actionButtons : undefined,
      });
      hints.suggestedNext.push('Interact with modal or close it');
    }

    // Check for new alerts/notifications
    const alerts = document.querySelectorAll('.alert, [role="alert"], .notification');
    alerts.forEach(alert => {
      if (alert.offsetWidth > 0) {
        hints.newElements.push({
          type: 'alert',
          text: alert.textContent.trim().substring(0, 100),
          severity: alert.className.includes('error') ? 'error' :
                   alert.className.includes('success') ? 'success' : 'info',
        });
      }
    });

    // Check for dropdowns, overlays, menus
    const overlaySelectors = [
      '[class*="dropdown"][class*="open"]',
      '[class*="dropdown"][class*="show"]',
      '.cdk-overlay-pane',
      '[role="listbox"]',
      '[role="menu"]',
      '.mat-select-panel',
      '.mat-mdc-select-panel',
      '[class*="overlay"][class*="open"]',
      '.p-dropdown-panel',
      '.ant-dropdown:not(.ant-dropdown-hidden)',
      '[class*="select-options"]',
    ].join(', ');
    const overlayEls = document.querySelectorAll(overlaySelectors);
    // Deduplicate: skip overlays that are children of another matched overlay
    const overlays = Array.from(overlayEls).filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);
    const dedupedOverlays = overlays.filter(overlay => {
      return !overlays.some(other => other !== overlay && other.contains(overlay));
    });
    dedupedOverlays.forEach(overlay => {
      // Determine type: explicit menu roles, or custom select-options pattern (but NOT mat-option-text)
      const isMenu = overlay.matches('[role="menu"]') ||
        overlay.querySelector('[role="menuitem"]') !== null ||
        (overlay.matches('[class*="select-options"]') && !overlay.querySelector('mat-option'));
      const isDropdown = overlay.matches('[role="listbox"]') ||
        overlay.querySelector('mat-option, [role="option"]') !== null;
      const type = isMenu ? 'menu' : 'dropdown';
      // Extract items — use specific selectors to avoid duplicates from nested matches
      let itemEls;
      if (isDropdown) {
        itemEls = overlay.querySelectorAll('mat-option, [role="option"]');
      } else if (isMenu) {
        itemEls = overlay.querySelectorAll('[role="menuitem"], [class*="option-text"]');
      } else {
        itemEls = overlay.querySelectorAll('mat-option, [role="option"], [role="menuitem"], li, .dropdown-item, .p-dropdown-item, .ant-dropdown-menu-item, [class*="option-text"]');
      }
      const items = [];
      const totalCount = itemEls.length;
      itemEls.forEach((item, i) => {
        if (i < 10 && item.textContent.trim()) {
          items.push(item.textContent.trim().substring(0, 80));
        }
      });
      hints.newElements.push({
        type,
        items: items.length > 0 ? items : undefined,
        totalCount: totalCount,
      });
      hints.suggestedNext.push(type === 'menu' ? 'Select menu item' : 'Select option from dropdown');
    });

    return hints;
  }, selector);
}

/**
 * Generate hints after form submission
 */
export async function generateFormSubmitHints(page) {
  await new Promise(resolve => setTimeout(resolve, 500));

  return page.evaluate(() => {
    // Helper to get safe class selector (filters Tailwind special chars)
    function getSafeClassSelector(element) {
      if (!element.className || typeof element.className !== 'string') return null;
      const classes = element.className.split(' ')
        .filter(c => c && !/[:\/\[\]]/.test(c))
        .slice(0, 1);
      if (classes.length === 0) return null;
      try {
        return `.${CSS.escape(classes[0])}`;
      } catch (e) {
        return null;
      }
    }

    const hints = {
      success: false,
      errors: [],
      redirected: false,
      suggestedNext: [],
    };

    // Check for success indicators
    const successIndicators = document.querySelectorAll(
      '.success, [class*="success"], [role="status"][class*="success"], .alert-success'
    );
    if (successIndicators.length > 0) {
      hints.success = true;
      successIndicators.forEach(el => {
        if (el.offsetWidth > 0) {
          hints.suggestedNext.push(`Success: ${el.textContent.trim().substring(0, 100)}`);
        }
      });
    }

    // Check for errors
    const errorIndicators = document.querySelectorAll(
      '.error, [class*="error"], .alert-error, .alert-danger, [aria-invalid="true"]'
    );
    errorIndicators.forEach(el => {
      if (el.offsetWidth > 0) {
        hints.errors.push({
          text: el.textContent.trim().substring(0, 100),
          selector: getSafeClassSelector(el) || '[aria-invalid="true"]',
        });
      }
    });

    if (hints.errors.length > 0) {
      hints.suggestedNext.push(`Fix ${hints.errors.length} error(s) and retry`);
    }

    return hints;
  });
}

/**
 * Generate hints for getElement results
 */
export function generateElementHints(element, selector) {
  const hints = {
    elementType: element.tagName ? element.tagName.toLowerCase() : 'unknown',
    isInteractive: false,
    suggestedActions: [],
  };

  if (element.tagName) {
    const tag = element.tagName.toLowerCase();

    if (tag === 'button' || tag === 'a') {
      hints.isInteractive = true;
      hints.suggestedActions.push('click');
    }

    if (tag === 'input' || tag === 'textarea') {
      hints.isInteractive = true;
      hints.suggestedActions.push('type text');

      if (element.type === 'checkbox' || element.type === 'radio') {
        hints.suggestedActions = ['click to toggle'];
      }
    }

    if (tag === 'select') {
      hints.isInteractive = true;
      hints.suggestedActions.push('select option');
    }

    if (tag === 'form') {
      hints.suggestedActions.push('fill fields and submit');
      hints.containedInputs = element.querySelectorAll('input, textarea, select').length;
    }
  }

  return hints;
}

/**
 * Generate comprehensive page hints
 */
export async function generatePageHints(page) {
  return page.evaluate(() => {
    const hints = {
      url: window.location.href,
      timestamp: new Date().toISOString(),
      quickStats: {
        forms: document.querySelectorAll('form').length,
        buttons: document.querySelectorAll('button, input[type="submit"]').length,
        inputs: document.querySelectorAll('input:not([type="hidden"]), textarea').length,
        links: document.querySelectorAll('a[href]').length,
      },
      commonPatterns: {},
      warnings: [],
    };

    // Common patterns
    const loginForm = document.querySelector('form input[type="password"]');
    if (loginForm) {
      const form = loginForm.closest('form');
      hints.commonPatterns.loginForm = form && form.id ? `#${form.id}` : 'form:has(input[type="password"])';
    }

    const searchInput = document.querySelector('input[type="search"], input[placeholder*="search" i]');
    if (searchInput) {
      hints.commonPatterns.searchInput = searchInput.id ? `#${searchInput.id}` : 'input[type="search"]';
    }

    // Warnings
    if (hints.quickStats.forms > 0 && hints.quickStats.buttons === 0) {
      hints.warnings.push('Forms found but no submit buttons detected');
    }

    const hiddenElements = document.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"], [hidden]');
    if (hiddenElements.length > hints.quickStats.buttons + hints.quickStats.inputs) {
      hints.warnings.push(`Many hidden elements (${hiddenElements.length}) - page may use dynamic content`);
    }

    return hints;
  });
}
