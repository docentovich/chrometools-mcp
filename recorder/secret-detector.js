/**
 * recorder/secret-detector.js
 *
 * Context-aware secret detection for form fields.
 * Only detects secrets in authentication forms (login, registration).
 * Regular forms (search, posts, profiles) are NOT scanned for secrets.
 */

/**
 * Secret field types that should be stored separately
 */
export const SECRET_FIELD_TYPES = {
  EMAIL: 'email',
  PASSWORD: 'password',
  PHONE: 'phone',
  OTP: 'otp',
  TOKEN: 'token'
};

/**
 * Keywords indicating authentication forms (multilingual)
 */
const AUTH_FORM_KEYWORDS = {
  login: ['login', 'log in', 'sign in', 'signin', 'войти', 'вход', 'авторизация', 'entrar', 'connexion', 'anmelden'],
  register: ['register', 'sign up', 'signup', 'регистрация', 'создать аккаунт', 'registro', 'inscription', 'registrieren'],
  forgot: ['forgot', 'reset', 'restore', 'recovery', 'забыли', 'восстановление', 'olvidé', 'oublié', 'vergessen'],
  verify: ['verify', 'verification', 'confirm', 'code', 'подтверждение', 'verificación', 'vérification', 'bestätigung']
};

/**
 * Detect if a field is a secret based on element and form context
 * @param {Object} elementInfo - Element metadata
 * @param {Object} formInfo - Parent form metadata
 * @returns {Object} - { isSecret: boolean, fieldType: string | null, reason: string }
 */
export function detectSecretField(elementInfo, formInfo) {
  // First check: Is this an authentication form?
  if (!isAuthenticationForm(formInfo)) {
    return {
      isSecret: false,
      fieldType: null,
      reason: 'Not an authentication form'
    };
  }

  // Now check field type
  const detection = detectFieldType(elementInfo, formInfo);

  return {
    isSecret: detection.fieldType !== null,
    fieldType: detection.fieldType,
    reason: detection.reason
  };
}

/**
 * Determine if a form is authentication-related
 * @param {Object} formInfo - Form metadata
 * @returns {boolean}
 */
function isAuthenticationForm(formInfo) {
  if (!formInfo) {
    return false;
  }

  const searchText = [
    formInfo.id || '',
    formInfo.action || '',
    formInfo.classes?.join(' ') || '',
    formInfo.ariaLabel || '',
    formInfo.title || ''
  ].join(' ').toLowerCase();

  // Check for authentication keywords
  const isAuth = Object.values(AUTH_FORM_KEYWORDS).some(keywords =>
    keywords.some(keyword => searchText.includes(keyword.toLowerCase()))
  );

  // Additional heuristic: forms with password fields are usually auth forms
  const hasPasswordField = formInfo.fields?.some(field =>
    field.type === 'password' || field.name?.includes('password') || field.name?.includes('pass')
  );

  return isAuth || hasPasswordField;
}

/**
 * Detect specific secret field type
 * @param {Object} elementInfo - Element metadata
 * @param {Object} formInfo - Parent form metadata
 * @returns {Object} - { fieldType: string | null, reason: string }
 */
function detectFieldType(elementInfo, formInfo) {
  const {
    type,
    name,
    id,
    placeholder,
    ariaLabel,
    autocomplete
  } = elementInfo;

  const searchText = [name, id, placeholder, ariaLabel, autocomplete].join(' ').toLowerCase();

  // 1. Password detection (highest priority)
  if (type === 'password') {
    return {
      fieldType: SECRET_FIELD_TYPES.PASSWORD,
      reason: 'Input type="password"'
    };
  }

  if (matchesKeywords(searchText, ['password', 'passwd', 'pwd', 'пароль', 'contraseña', 'mot de passe', 'passwort'])) {
    return {
      fieldType: SECRET_FIELD_TYPES.PASSWORD,
      reason: 'Password keyword in attributes'
    };
  }

  // 2. Email detection
  if (type === 'email') {
    return {
      fieldType: SECRET_FIELD_TYPES.EMAIL,
      reason: 'Input type="email"'
    };
  }

  if (matchesKeywords(searchText, ['email', 'e-mail', 'mail', 'почта', 'correo', 'courriel'])) {
    return {
      fieldType: SECRET_FIELD_TYPES.EMAIL,
      reason: 'Email keyword in attributes'
    };
  }

  // 3. Phone detection (ONLY in auth forms)
  if (type === 'tel') {
    return {
      fieldType: SECRET_FIELD_TYPES.PHONE,
      reason: 'Input type="tel" in auth form'
    };
  }

  if (matchesKeywords(searchText, ['phone', 'mobile', 'tel', 'телефон', 'teléfono', 'téléphone'])) {
    return {
      fieldType: SECRET_FIELD_TYPES.PHONE,
      reason: 'Phone keyword in auth form'
    };
  }

  // 4. OTP/verification code detection
  if (matchesKeywords(searchText, ['otp', 'code', 'verification', 'verify', 'token', 'код', 'подтверждение', 'código', 'vérification'])) {
    // Additional check: OTP fields are usually short (4-6 digits)
    const maxLength = elementInfo.maxLength;
    if (maxLength && maxLength >= 4 && maxLength <= 8) {
      return {
        fieldType: SECRET_FIELD_TYPES.OTP,
        reason: 'OTP/verification code pattern'
      };
    }

    // Check if form is verification/2FA form
    const isVerifyForm = formInfo && Object.values(AUTH_FORM_KEYWORDS.verify).some(keyword =>
      (formInfo.id || '').toLowerCase().includes(keyword) ||
      (formInfo.action || '').toLowerCase().includes(keyword)
    );

    if (isVerifyForm) {
      return {
        fieldType: SECRET_FIELD_TYPES.OTP,
        reason: 'Code field in verification form'
      };
    }
  }

  // 5. Token detection (API keys, access tokens)
  if (matchesKeywords(searchText, ['token', 'apikey', 'api_key', 'secret', 'ключ', 'секрет'])) {
    return {
      fieldType: SECRET_FIELD_TYPES.TOKEN,
      reason: 'Token/API key keyword'
    };
  }

  // Not a secret field
  return {
    fieldType: null,
    reason: 'No secret pattern detected'
  };
}

/**
 * Check if text matches any of the keywords
 */
function matchesKeywords(text, keywords) {
  return keywords.some(keyword => text.includes(keyword.toLowerCase()));
}

/**
 * Generate parameter name for secret field
 * Used for {{parameter}} substitution in scenarios
 * @param {string} fieldType - Secret field type
 * @param {Object} elementInfo - Element metadata
 * @returns {string} - Parameter name (e.g., "email", "password", "phone")
 */
export function generateSecretParameterName(fieldType, elementInfo) {
  const baseName = fieldType;

  // If multiple fields of same type exist, add suffix
  // (e.g., "password" and "password_confirm")
  const { name, id } = elementInfo;
  if (name?.includes('confirm') || id?.includes('confirm') || name?.includes('repeat') || id?.includes('repeat')) {
    return `${baseName}_confirm`;
  }

  if (name?.includes('new') || id?.includes('new')) {
    return `${baseName}_new`;
  }

  if (name?.includes('old') || name?.includes('current') || id?.includes('old') || id?.includes('current')) {
    return `${baseName}_old`;
  }

  return baseName;
}

/**
 * Browser-side secret detection
 * Injected into page for real-time detection during recording
 */
export const browserSecretDetector = `
(function() {
  const AUTH_FORM_KEYWORDS = {
    all: ['login', 'log in', 'sign in', 'signin', 'register', 'sign up', 'signup',
          'forgot', 'reset', 'restore', 'verify', 'verification',
          'войти', 'вход', 'авторизация', 'регистрация', 'забыли', 'восстановление', 'подтверждение',
          'entrar', 'registro', 'olvidé', 'verificación',
          'connexion', 'inscription', 'oublié', 'vérification',
          'anmelden', 'registrieren', 'vergessen', 'bestätigung']
  };

  function isAuthenticationForm(form) {
    const searchText = [
      form.id || '',
      form.action || '',
      form.className || '',
      form.getAttribute('aria-label') || '',
      form.title || ''
    ].join(' ').toLowerCase();

    const hasAuthKeyword = AUTH_FORM_KEYWORDS.all.some(kw => searchText.includes(kw.toLowerCase()));
    const hasPasswordField = form.querySelector('input[type="password"]') !== null;

    return hasAuthKeyword || hasPasswordField;
  }

  function detectSecretField(element) {
    // Find parent form
    const form = element.closest('form');

    // If not in form or not auth form, not a secret
    if (!form || !isAuthenticationForm(form)) {
      return { isSecret: false, fieldType: null };
    }

    const type = element.type || '';
    const searchText = [
      element.name || '',
      element.id || '',
      element.placeholder || '',
      element.getAttribute('aria-label') || '',
      element.autocomplete || ''
    ].join(' ').toLowerCase();

    // Password
    if (type === 'password' || searchText.includes('password') || searchText.includes('passwd') || searchText.includes('pwd')) {
      return { isSecret: true, fieldType: 'password' };
    }

    // Email
    if (type === 'email' || searchText.includes('email') || searchText.includes('mail')) {
      return { isSecret: true, fieldType: 'email' };
    }

    // Phone (only in auth form)
    if (type === 'tel' || searchText.includes('phone') || searchText.includes('mobile') || searchText.includes('tel')) {
      return { isSecret: true, fieldType: 'phone' };
    }

    // OTP
    const maxLength = element.maxLength;
    if ((searchText.includes('otp') || searchText.includes('code') || searchText.includes('verify')) &&
        maxLength >= 4 && maxLength <= 8) {
      return { isSecret: true, fieldType: 'otp' };
    }

    // Token
    if (searchText.includes('token') || searchText.includes('apikey') || searchText.includes('api_key')) {
      return { isSecret: true, fieldType: 'token' };
    }

    return { isSecret: false, fieldType: null };
  }

  function generateParameterName(fieldType, element) {
    const name = element.name || element.id || '';
    const nameLower = name.toLowerCase();

    if (nameLower.includes('confirm') || nameLower.includes('repeat')) {
      return fieldType + '_confirm';
    }
    if (nameLower.includes('new')) {
      return fieldType + '_new';
    }
    if (nameLower.includes('old') || nameLower.includes('current')) {
      return fieldType + '_old';
    }

    return fieldType;
  }

  window.secretDetector = {
    isAuthenticationForm,
    detectSecretField,
    generateParameterName
  };
  return window.secretDetector;
})();
`;
