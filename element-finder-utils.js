/**
 * Element Finder Utilities
 * Provides intelligent element finding with scoring and context analysis
 */

// Multilingual submit keywords
const SUBMIT_KEYWORDS = {
  ru: ['войти', 'отправить', 'подтвердить', 'сохранить', 'зарегистрироваться',
       'применить', 'продолжить', 'далее', 'готово', 'ок', 'добавить', 'создать',
       'загрузить', 'вход', 'регистрация', 'авторизация', 'логин'],
  en: ['submit', 'login', 'send', 'save', 'register', 'sign in', 'sign up',
       'continue', 'next', 'confirm', 'apply', 'ok', 'done', 'add', 'create',
       'upload', 'go', 'enter', 'join', 'search', 'find'],
  es: ['enviar', 'iniciar', 'guardar', 'registrarse', 'continuar', 'confirmar', 'aceptar'],
  de: ['senden', 'einloggen', 'speichern', 'registrieren', 'weiter', 'bestätigen', 'ok'],
  fr: ['envoyer', 'connexion', 'sauvegarder', 'enregistrer', 'continuer', 'confirmer', 'ok'],
  it: ['invia', 'accedi', 'salva', 'registrati', 'continua', 'conferma', 'ok'],
  pt: ['enviar', 'entrar', 'salvar', 'registrar', 'continuar', 'confirmar', 'ok'],
  zh: ['提交', '登录', '保存', '注册', '继续', '确认', '确定'],
  ja: ['送信', 'ログイン', '保存', '登録', '続ける', '確認', 'ok'],
};

// Negative keywords (buttons that are NOT submit)
const NEGATIVE_KEYWORDS = {
  ru: ['отмена', 'отменить', 'назад', 'закрыть', 'удалить', 'очистить', 'сбросить', 'выход', 'выйти'],
  en: ['cancel', 'back', 'close', 'delete', 'clear', 'reset', 'remove', 'dismiss', 'decline', 'logout', 'exit'],
  es: ['cancelar', 'atrás', 'cerrar', 'eliminar', 'borrar', 'restablecer'],
  de: ['abbrechen', 'zurück', 'schließen', 'löschen', 'zurücksetzen'],
  fr: ['annuler', 'retour', 'fermer', 'supprimer', 'effacer', 'réinitialiser'],
  it: ['annulla', 'indietro', 'chiudi', 'elimina', 'cancella', 'ripristina'],
  pt: ['cancelar', 'voltar', 'fechar', 'excluir', 'limpar', 'redefinir'],
  zh: ['取消', '返回', '关闭', '删除', '清除', '重置'],
  ja: ['キャンセル', '戻る', '閉じる', '削除', 'クリア', 'リセット'],
};

// Link/anchor keywords
const LINK_KEYWORDS = {
  ru: ['подробнее', 'узнать', 'читать', 'перейти', 'смотреть', 'открыть'],
  en: ['learn more', 'read more', 'view', 'see', 'details', 'info', 'about', 'help'],
  es: ['más información', 'leer más', 'ver', 'detalles'],
  de: ['mehr erfahren', 'weiterlesen', 'ansehen', 'details'],
  fr: ['en savoir plus', 'lire plus', 'voir', 'détails'],
  it: ['per saperne di più', 'leggi di più', 'vedi', 'dettagli'],
  pt: ['saiba mais', 'leia mais', 'ver', 'detalhes'],
  zh: ['了解更多', '阅读更多', '查看', '详情'],
  ja: ['詳細を見る', 'もっと読む', '表示', '詳細'],
};

// Input field keywords
const INPUT_KEYWORDS = {
  email: {
    ru: ['email', 'почта', 'эл. почта', 'e-mail', 'электронная почта'],
    en: ['email', 'e-mail', 'mail', 'email address'],
    all: ['@', 'mail']
  },
  password: {
    ru: ['пароль', 'password'],
    en: ['password', 'pwd', 'pass'],
    all: ['password', 'pwd']
  },
  username: {
    ru: ['имя пользователя', 'логин', 'username', 'пользователь'],
    en: ['username', 'user', 'login', 'account'],
    all: ['user', 'login']
  },
  search: {
    ru: ['поиск', 'искать', 'найти'],
    en: ['search', 'find', 'query'],
    all: ['search']
  }
};

/**
 * Check if text matches submit keywords
 */
function matchesSubmitKeyword(text, description) {
  if (!text) return false;

  const textLower = text.toLowerCase();
  const descLower = description.toLowerCase();

  // Direct match with description
  if (textLower.includes(descLower) || descLower.includes(textLower)) {
    return true;
  }

  // Check against submit keywords
  for (const lang in SUBMIT_KEYWORDS) {
    for (const keyword of SUBMIT_KEYWORDS[lang]) {
      if (textLower.includes(keyword)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if text matches negative keywords
 */
function matchesNegativeKeyword(text) {
  if (!text) return false;

  const textLower = text.toLowerCase();

  for (const lang in NEGATIVE_KEYWORDS) {
    for (const keyword of NEGATIVE_KEYWORDS[lang]) {
      if (textLower.includes(keyword)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if text matches link keywords
 */
function matchesLinkKeyword(text) {
  if (!text) return false;

  const textLower = text.toLowerCase();

  for (const lang in LINK_KEYWORDS) {
    for (const keyword of LINK_KEYWORDS[lang]) {
      if (textLower.includes(keyword)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Analyze button context
 * This function is designed to be injected into the page context
 */
function analyzeButtonContextInPage(element) {
  const context = {
    // Element type
    isButton: element.tagName === 'BUTTON',
    isSubmitInput: element.type === 'submit',
    isLink: element.tagName === 'A',

    // Role
    hasSubmitRole: element.getAttribute('role') === 'button',

    // Form context
    inForm: element.closest('form') !== null,
    isLastInForm: false,

    // Classes and ID
    hasSubmitClass: /submit|send|login|register|confirm|save|apply|continue|next/i.test(
      (element.className || '') + ' ' + (element.id || '')
    ),

    // Attributes
    hasSubmitAttr: element.type === 'submit' || element.getAttribute('type') === 'submit',

    // Icons (common submit icons)
    hasSubmitIcon: /check|arrow-right|send|chevron-right|angle-right|caret-right|play|forward/i.test(
      element.innerHTML
    ),

    // Visibility
    isVisible: element.offsetWidth > 0 && element.offsetHeight > 0,

    // Position
    offsetWidth: element.offsetWidth,
    offsetHeight: element.offsetHeight,

    // Text content
    text: element.textContent || element.value || element.getAttribute('aria-label') || '',

    // Primary button indicators
    isPrimary: /primary|main|btn-primary|button-primary/i.test(element.className || ''),
  };

  // Check if it's the last button in form
  if (context.inForm) {
    const form = element.closest('form');
    const buttons = form.querySelectorAll('button, input[type="submit"], input[type="button"]');
    context.isLastInForm = element === buttons[buttons.length - 1];
    context.formButtonCount = buttons.length;
  }

  return context;
}

/**
 * Score element as submit button
 * Higher score = more likely to be a submit button
 */
function scoreSubmitButton(element, context, description) {
  let score = 0;
  const text = context.text.toLowerCase();
  const descLower = description.toLowerCase();

  // Exact match with description (+50)
  if (text.includes(descLower)) {
    score += 50;
  }

  // Keyword matching (+30)
  if (matchesSubmitKeyword(context.text, description)) {
    score += 30;
  }

  // Technical submit indicators
  if (context.hasSubmitAttr) score += 40;      // type="submit"
  if (context.inForm) score += 20;              // inside form
  if (context.isLastInForm) score += 15;        // last button in form
  if (context.hasSubmitClass) score += 10;      // submit in class/id
  if (context.hasSubmitIcon) score += 5;        // submit icon
  if (context.isPrimary) score += 15;           // primary button style

  // Visibility bonus
  if (context.isVisible) score += 10;

  // Size bonus (larger buttons are more likely to be submit)
  if (context.offsetWidth > 100 && context.offsetHeight > 30) {
    score += 5;
  }

  // Penalty for negative keywords (-30)
  if (matchesNegativeKeyword(context.text)) {
    score -= 30;
  }

  // Penalty for links without submit keywords
  if (context.isLink && !matchesSubmitKeyword(context.text, description)) {
    score -= 20;
  }

  return score;
}

/**
 * Score element as input field
 * Higher score = more likely to match the description
 */
function scoreInputField(element, context, description) {
  let score = 0;
  const descLower = description.toLowerCase();
  const elementType = element.type || '';
  const elementName = (element.name || '').toLowerCase();
  const elementId = (element.id || '').toLowerCase();
  const elementPlaceholder = (element.placeholder || '').toLowerCase();

  // Type matching with description
  if (elementType === 'email' && descLower.includes('email')) {
    score += 20;
  }
  if (elementType === 'password' && descLower.includes('password')) {
    score += 20;
  }
  if (elementType === 'tel' && (descLower.includes('phone') || descLower.includes('tel'))) {
    score += 20;
  }
  if (elementType === 'search' && descLower.includes('search')) {
    score += 20;
  }

  // ID/Name matching with description
  if (elementId && descLower.includes(elementId)) {
    score += 15;
  }
  if (elementName && descLower.includes(elementName)) {
    score += 15;
  }

  // Placeholder matching
  if (elementPlaceholder && descLower.includes(elementPlaceholder)) {
    score += 10;
  }

  // Form context bonus
  if (context.inForm) {
    score += 20;
  }

  // Visibility bonus
  if (context.isVisible) {
    score += 10;
  }

  // Required field bonus
  if (element.required) {
    score += 5;
  }

  return score;
}

/**
 * Check if attribute value is safe to use in CSS selector
 * Returns false if value contains characters that could break selector syntax
 */
function isSafeSelectorValue(value) {
  if (!value || typeof value !== 'string') return false;
  // Check for problematic characters: quotes, brackets, backslashes
  return !/["'\\[\]{}()]/.test(value);
}

/**
 * Check if a class name is a Tailwind CSS utility class
 * Tailwind classes contain special characters that break CSS selectors:
 * - Colons (:) for variants like hover:, focus:, md:, etc.
 * - Slashes (/) for fractions like w-1/2
 * - Brackets ([]) for arbitrary values like bg-[#1da1f2]
 * - Dots (.) in decimal values
 */
function isTailwindClass(className) {
  if (!className || typeof className !== 'string') return false;

  // Check for special characters that indicate Tailwind variants/utilities
  if (/[:\/\[\]]/.test(className)) {
    return true;
  }

  // Common Tailwind utility prefixes
  const tailwindPrefixes = [
    'bg-', 'text-', 'border-', 'rounded-', 'shadow-', 'font-', 'leading-',
    'flex-', 'grid-', 'p-', 'px-', 'py-', 'pt-', 'pb-', 'pl-', 'pr-',
    'm-', 'mx-', 'my-', 'mt-', 'mb-', 'ml-', 'mr-', 'space-',
    'w-', 'h-', 'min-', 'max-', 'gap-', 'inset-', 'top-', 'right-', 'bottom-', 'left-',
    'justify-', 'items-', 'content-', 'self-', 'place-',
    'overflow-', 'opacity-', 'cursor-', 'transition-', 'transform-',
    'duration-', 'ease-', 'delay-', 'animate-', 'scale-', 'rotate-', 'translate-',
    'z-', 'order-', 'col-', 'row-', 'auto-', 'tracking-', 'select-',
    'sr-', 'not-', 'pointer-', 'resize-', 'list-', 'appearance-',
    'underline', 'line-through', 'no-underline', 'uppercase', 'lowercase', 'capitalize',
    'italic', 'not-italic', 'ordinal', 'slashed-zero', 'lining-nums', 'oldstyle-nums',
    'proportional-nums', 'tabular-nums', 'diagonal-fractions', 'stacked-fractions',
    'hidden', 'block', 'inline', 'flex', 'grid', 'table', 'contents',
    'absolute', 'relative', 'fixed', 'sticky', 'static'
  ];

  // Check if className starts with known Tailwind prefix
  return tailwindPrefixes.some(prefix => className.startsWith(prefix));
}

/**
 * Generate unique CSS selector for an element
 * Priority: id → data-testid → data-* → aria-label → role → semantic classes → nth-child
 * Filters out Tailwind CSS classes to avoid invalid selectors
 */
function getUniqueSelectorInPage(element) {
  const tagName = element.tagName.toLowerCase();

  // 1. Try ID first (highest priority)
  if (element.id && isSafeSelectorValue(element.id)) {
    try {
      return `#${CSS.escape(element.id)}`;
    } catch (e) {
      // CSS.escape not available in old browsers, use simple escape
      return `#${element.id.replace(/[^\w-]/g, '\\$&')}`;
    }
  }

  // 2. Try data-testid (very common in modern apps)
  if (element.dataset && element.dataset.testid && isSafeSelectorValue(element.dataset.testid)) {
    const selector = `[data-testid="${element.dataset.testid}"]`;
    try {
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    } catch (e) {
      // Invalid selector, continue
    }
  }

  // 3. Try other data-* attributes (only if values are safe)
  const dataAttrs = Array.from(element.attributes)
    .filter(attr => attr.name.startsWith('data-') &&
                    attr.name !== 'data-testid' &&
                    isSafeSelectorValue(attr.value))
    .slice(0, 2);

  for (const attr of dataAttrs) {
    const selector = `${tagName}[${attr.name}="${attr.value}"]`;
    try {
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    } catch (e) {
      continue;
    }
  }

  // 4. Try aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && isSafeSelectorValue(ariaLabel)) {
    const selector = `${tagName}[aria-label="${ariaLabel}"]`;
    try {
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    } catch (e) {
      // Invalid selector, continue
    }
  }

  // 5. Try role attribute
  const role = element.getAttribute('role');
  if (role && isSafeSelectorValue(role)) {
    const selector = `${tagName}[role="${role}"]`;
    try {
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    } catch (e) {
      // Invalid selector, continue
    }
  }

  // 6. Try name attribute (common for form inputs)
  if (element.name && isSafeSelectorValue(element.name)) {
    const selector = `${tagName}[name="${element.name}"]`;
    try {
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
    } catch (e) {
      // Invalid selector, continue
    }
  }

  // 7. Try semantic classes (filter out Tailwind)
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(' ')
      .filter(c => c.trim() && !isTailwindClass(c))
      .slice(0, 3); // Limit to 3 classes max

    if (classes.length > 0) {
      try {
        // Try with all filtered classes
        const escapedClasses = classes.map(c => {
          try {
            return CSS.escape(c);
          } catch (e) {
            return c.replace(/[^\w-]/g, '\\$&');
          }
        });
        const selector = `${tagName}.${escapedClasses.join('.')}`;
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }

        // Try with first class only
        const firstClassSelector = `${tagName}.${escapedClasses[0]}`;
        if (document.querySelectorAll(firstClassSelector).length === 1) {
          return firstClassSelector;
        }
      } catch (e) {
        // Invalid selector, continue to fallback
      }
    }
  }

  // 8. Fallback: nth-of-type with path
  let current = element;
  const path = [];

  while (current && current.tagName) {
    let selector = current.tagName.toLowerCase();

    // Stop at element with ID
    if (current.id && isSafeSelectorValue(current.id)) {
      try {
        selector = `#${CSS.escape(current.id)}`;
      } catch (e) {
        selector = `#${current.id.replace(/[^\w-]/g, '\\$&')}`;
      }
      path.unshift(selector);
      break;
    }

    // Calculate nth-of-type
    let sibling = current;
    let nth = 1;

    while (sibling.previousElementSibling) {
      sibling = sibling.previousElementSibling;
      if (sibling.tagName === current.tagName) {
        nth++;
      }
    }

    // Only add nth-of-type if there are multiple siblings of same type
    if (nth > 1 || (current.parentElement &&
        Array.from(current.parentElement.children).filter(c => c.tagName === current.tagName).length > 1)) {
      selector += `:nth-of-type(${nth})`;
    }

    path.unshift(selector);
    current = current.parentElement;

    // Stop at body or after 5 levels
    if (!current || current.tagName === 'BODY' || path.length >= 5) {
      break;
    }
  }

  return path.join(' > ');
}

/**
 * Explain score for debugging
 */
function explainScore(element, context, description, score) {
  const reasons = [];
  const descLower = description.toLowerCase();
  const elementType = element.type || '';

  // Input field scoring reasons
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    if (elementType === 'email' && descLower.includes('email')) {
      reasons.push('type=email matches description (+20)');
    }
    if (elementType === 'password' && descLower.includes('password')) {
      reasons.push('type=password matches description (+20)');
    }
    if (elementType === 'tel' && (descLower.includes('phone') || descLower.includes('tel'))) {
      reasons.push('type=tel matches description (+20)');
    }
    if (element.id && descLower.includes(element.id.toLowerCase())) {
      reasons.push(`id="${element.id}" matches description (+15)`);
    }
    if (element.name && descLower.includes(element.name.toLowerCase())) {
      reasons.push(`name="${element.name}" matches description (+15)`);
    }
    if (element.placeholder && descLower.includes(element.placeholder.toLowerCase())) {
      reasons.push('placeholder matches (+10)');
    }
    if (element.required) {
      reasons.push('required field (+5)');
    }
  }

  // Button scoring reasons
  if (context.hasSubmitAttr) reasons.push('type=submit (+40)');
  if (context.hasSubmitClass) reasons.push('submit class (+10)');
  if (context.hasSubmitIcon) reasons.push('submit icon (+5)');
  if (context.isPrimary) reasons.push('primary style (+15)');
  if (context.isLastInForm) reasons.push('last in form (+15)');
  if (matchesSubmitKeyword(context.text, description)) {
    reasons.push('keyword match (+30)');
  }
  if (context.text.toLowerCase().includes(description.toLowerCase())) {
    reasons.push('exact text match (+50)');
  }
  if (matchesNegativeKeyword(context.text)) {
    reasons.push('negative keyword (-30)');
  }
  if (context.isLink && !matchesSubmitKeyword(context.text, description)) {
    reasons.push('link without submit keyword (-20)');
  }

  // Common reasons
  if (context.inForm) reasons.push('in form (+20)');
  if (context.isVisible) reasons.push('visible (+10)');

  return reasons.length > 0 ? reasons.join(', ') : 'no matching criteria';
}

/**
 * Determine element type from description
 */
function determineElementType(description) {
  const lower = description.toLowerCase();

  // Check for input fields
  for (const type in INPUT_KEYWORDS) {
    const keywords = INPUT_KEYWORDS[type];
    for (const lang in keywords) {
      for (const keyword of keywords[lang]) {
        if (lower.includes(keyword)) {
          return { type: 'input', inputType: type };
        }
      }
    }
  }

  // Check for links
  if (matchesLinkKeyword(description)) {
    return { type: 'link' };
  }

  // Check for buttons
  if (matchesSubmitKeyword('', description)) {
    return { type: 'button' };
  }

  return { type: 'any' };
}
