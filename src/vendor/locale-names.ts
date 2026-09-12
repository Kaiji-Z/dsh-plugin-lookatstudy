/**
 * Vendored from LookatStudy shared/locales.ts (MIT License,
 * https://github.com/Kaiji-Z/LookatStudy), upstream v0.33.2 — only the
 * name-map + lookup function (the language-course round's BCP-47 → display
 * name need). Unmodified except this provenance header.
 *
 * locales —— BCP-47 → 人类可读语言名的共享映射(纯函数)。
 * 未知 locale 一律原样返回(如 "pt" → "pt"),不猜名字。
 */

/** locale → 该语言的自称名(尽量用母语写法,语言学习者认得出) */
export const LOCALE_LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: 'English',
  'zh-CN': '中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  'pt-BR': 'Português',
  ru: 'Русский',
  it: 'Italiano',
  ar: 'العربية',
  hi: 'हिन्दी',
  tr: 'Türkçe',
  pl: 'Polski',
  nl: 'Nederlands',
  id: 'Indonesia',
  vi: 'Tiếng Việt',
  th: 'ไทย',
  sv: 'Svenska',
  fi: 'Suomi',
}

/** BCP-47 → 语言名;未映射的 locale 原样返回 */
export function localeToLanguageName(locale: string): string {
  return LOCALE_LANGUAGE_NAMES[locale] ?? locale
}
