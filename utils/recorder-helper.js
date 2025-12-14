import { injectRecorder } from '../recorder/recorder-script.js';

// Track pages with recorder injected
const pagesWithRecorder = new WeakSet();

async function setupRecorderAutoReinjection(page) {
  let reinjectionTimeout = null;
  let lastUrl = null;

  // Handle navigation events (form submits, link clicks, history API)
  page.on('framenavigated', async (frame) => {
    // Only handle main frame navigation
    if (frame !== page.mainFrame()) return;

    // Get current URL
    const currentUrl = frame.url();

    // Skip if URL hasn't changed (prevents duplicate injections on same page)
    if (currentUrl === lastUrl) {
      return;
    }
    lastUrl = currentUrl;

    // Clear any pending reinjection
    if (reinjectionTimeout) {
      clearTimeout(reinjectionTimeout);
    }

    // Debounce reinjection (wait 100ms for navigation to settle)
    reinjectionTimeout = setTimeout(async () => {
      // Check if this page had recorder before
      if (pagesWithRecorder.has(page)) {
        try {
          await injectRecorder(page);
        } catch (error) {
          console.error('[chrometools-mcp] Failed to re-inject recorder:', error.message);
        }
      }
    }, 100);
  });

  // Handle page reloads (F5, Ctrl+R) - use 'load' event
  page.on('load', async () => {
    // Check if this page had recorder before
    if (pagesWithRecorder.has(page)) {
      try {
        await injectRecorder(page);
      } catch (error) {
        console.error('[chrometools-mcp] Failed to re-inject recorder after reload:', error.message);
      }
    }
  });
}

function markPageWithRecorder(page) {
  pagesWithRecorder.add(page);
}

function hasRecorder(page) {
  return pagesWithRecorder.has(page);
}

export {
  setupRecorderAutoReinjection,
  markPageWithRecorder,
  hasRecorder
};
