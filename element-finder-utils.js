/**
 * Element Finder Utilities
 * Provides intelligent element finding with scoring and context analysis
 */

// Multilingual submit keywords
export const SUBMIT_KEYWORDS = {
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
export const NEGATIVE_KEYWORDS = {
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
export const LINK_KEYWORDS = {
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
export const INPUT_KEYWORDS = {
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
export function matchesSubmitKeyword(text, description) {
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
export function matchesNegativeKeyword(text) {
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
export function matchesLinkKeyword(text) {
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
export function analyzeButtonContextInPage(element) {
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
export function scoreSubmitButton(element, context, description) {
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
 * Generate unique CSS selector for an element
 */
export function getUniqueSelectorInPage(element) {
  // Try ID first
  if (element.id) {
    return `#${element.id}`;
  }

  // Try unique class combination
  if (element.className) {
    const classes = element.className.split(' ').filter(c => c.trim());
    if (classes.length > 0) {
      const selector = `${element.tagName.toLowerCase()}.${classes.join('.')}`;
      if (document.querySelectorAll(selector).length === 1) {
        return selector;
      }
      // Try with first class only
      const firstClassSelector = `${element.tagName.toLowerCase()}.${classes[0]}`;
      if (document.querySelectorAll(firstClassSelector).length === 1) {
        return firstClassSelector;
      }
    }
  }

  // Try name attribute
  if (element.name) {
    const selector = `${element.tagName.toLowerCase()}[name="${element.name}"]`;
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  // Try data attributes
  const dataAttrs = Array.from(element.attributes)
    .filter(attr => attr.name.startsWith('data-'))
    .slice(0, 2);

  for (const attr of dataAttrs) {
    const selector = `${element.tagName.toLowerCase()}[${attr.name}="${attr.value}"]`;
    if (document.querySelectorAll(selector).length === 1) {
      return selector;
    }
  }

  // Fallback: nth-child
  let current = element;
  const path = [];

  while (current && current.tagName) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector = `#${current.id}`;
      path.unshift(selector);
      break;
    }

    let sibling = current;
    let nth = 1;

    while (sibling.previousElementSibling) {
      sibling = sibling.previousElementSibling;
      if (sibling.tagName === current.tagName) {
        nth++;
      }
    }

    if (nth > 1) {
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
export function explainScore(context, description, score) {
  const reasons = [];

  if (context.hasSubmitAttr) reasons.push('type=submit (+40)');
  if (context.inForm) reasons.push('in form (+20)');
  if (context.isLastInForm) reasons.push('last in form (+15)');
  if (context.hasSubmitClass) reasons.push('submit class (+10)');
  if (context.hasSubmitIcon) reasons.push('submit icon (+5)');
  if (context.isPrimary) reasons.push('primary style (+15)');
  if (context.isVisible) reasons.push('visible (+10)');
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

  return reasons.length > 0 ? reasons.join(', ') : 'no matching criteria';
}

/**
 * Determine element type from description
 */
export function determineElementType(description) {
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
