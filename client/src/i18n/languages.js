export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', shortLabel: 'EN', flag: '🇬🇧' },
  { code: 'de', label: 'Deutsch', shortLabel: 'DE', flag: '🇩🇪' },
  { code: 'fr', label: 'Français', shortLabel: 'FR', flag: '🇫🇷' },
  { code: 'it', label: 'Italiano', shortLabel: 'IT', flag: '🇮🇹' },
  { code: 'es', label: 'Español', shortLabel: 'ES', flag: '🇪🇸' },
  { code: 'ru', label: 'Русский', shortLabel: 'RU', flag: '🇷🇺' },
];

export const SUPPORTED_LANGUAGE_CODES = new Set(SUPPORTED_LANGUAGES.map(language => language.code));

export function languageDefinition(code) {
  return SUPPORTED_LANGUAGES.find(language => language.code === code) || SUPPORTED_LANGUAGES[0];
}
