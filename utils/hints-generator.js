/**
 * AI Hints Generator
 * Generates contextual hints for AI to understand what to do next
 */

/**
 * Generate hints after page navigation
 */
export function generateNavigationHints(page, url) {
  return page.evaluate(() => {
    const hints = {
      pageType: 'unknown',
      availableActions: [],
      keyElements: [],
      suggestedNext: [],
      commonSelectors: {},
    };

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
        selector: mainButton.id ? `#${mainButton.id}` : `.${mainButton.className.split(' ')[0]}`,
      });
    }

    const alerts = document.querySelectorAll('.alert, [role="alert"], .notification, .message');
    alerts.forEach(alert => {
      if (alert.offsetWidth > 0) {
        hints.keyElements.push({
          type: 'notification',
          text: alert.textContent.trim().substring(0, 100),
          selector: alert.className ? `.${alert.className.split(' ')[0]}` : 'notification',
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
    const hints = {
      pageChanged: false,
      newElements: [],
      modalOpened: false,
      suggestedNext: [],
    };

    // Check for modals
    const modals = document.querySelectorAll('[role="dialog"], .modal, [class*="modal"]');
    modals.forEach(modal => {
      if (modal.offsetWidth > 0 && modal.offsetHeight > 0) {
        hints.modalOpened = true;
        hints.newElements.push({
          type: 'modal',
          selector: modal.className ? `.${modal.className.split(' ')[0]}` : '[role="dialog"]',
        });
        hints.suggestedNext.push('Interact with modal or close it');
      }
    });

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

    // Check for dropdowns
    const dropdowns = document.querySelectorAll('[class*="dropdown"][class*="open"], [aria-expanded="true"]');
    if (dropdowns.length > 0) {
      hints.newElements.push({
        type: 'dropdown',
        count: dropdowns.length,
      });
      hints.suggestedNext.push('Select option from dropdown');
    }

    return hints;
  }, selector);
}

/**
 * Generate hints after form submission
 */
export async function generateFormSubmitHints(page) {
  await new Promise(resolve => setTimeout(resolve, 500));

  return page.evaluate(() => {
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
          selector: el.className ? `.${el.className.split(' ')[0]}` : 'error-element',
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
