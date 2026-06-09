/**
 * Map ElevenLabs language codes (ISO-639-1) → a representative country + label,
 * so the voice picker can render a country-flag emoji per supported language.
 *
 * A language is NOT a country, so each code maps to ONE representative flag
 * (e.g. English → GB, Portuguese → PT). This is an intentional approximation.
 * Covers the languages ElevenLabs' multilingual models support.
 */

interface LangInfo {
  label: string;
  country: string; // ISO 3166-1 alpha-2, used to derive the flag emoji
}

const LANGUAGES: Record<string, LangInfo> = {
  en: { label: 'English', country: 'GB' },
  es: { label: 'Spanish', country: 'ES' },
  fr: { label: 'French', country: 'FR' },
  de: { label: 'German', country: 'DE' },
  it: { label: 'Italian', country: 'IT' },
  pt: { label: 'Portuguese', country: 'PT' },
  pl: { label: 'Polish', country: 'PL' },
  nl: { label: 'Dutch', country: 'NL' },
  ja: { label: 'Japanese', country: 'JP' },
  ko: { label: 'Korean', country: 'KR' },
  zh: { label: 'Chinese', country: 'CN' },
  hi: { label: 'Hindi', country: 'IN' },
  ar: { label: 'Arabic', country: 'SA' },
  tr: { label: 'Turkish', country: 'TR' },
  ru: { label: 'Russian', country: 'RU' },
  id: { label: 'Indonesian', country: 'ID' },
  fil: { label: 'Filipino', country: 'PH' },
  tl: { label: 'Filipino', country: 'PH' },
  sv: { label: 'Swedish', country: 'SE' },
  bg: { label: 'Bulgarian', country: 'BG' },
  ro: { label: 'Romanian', country: 'RO' },
  cs: { label: 'Czech', country: 'CZ' },
  el: { label: 'Greek', country: 'GR' },
  fi: { label: 'Finnish', country: 'FI' },
  hr: { label: 'Croatian', country: 'HR' },
  ms: { label: 'Malay', country: 'MY' },
  sk: { label: 'Slovak', country: 'SK' },
  da: { label: 'Danish', country: 'DK' },
  ta: { label: 'Tamil', country: 'IN' },
  uk: { label: 'Ukrainian', country: 'UA' },
  hu: { label: 'Hungarian', country: 'HU' },
  no: { label: 'Norwegian', country: 'NO' },
  nb: { label: 'Norwegian', country: 'NO' },
  vi: { label: 'Vietnamese', country: 'VN' },
};

/** Convert an ISO 3166 alpha-2 country code to its flag emoji (regional indicators). */
export function countryToFlag(country: string): string {
  if (!country || country.length !== 2) return '🏳️';
  return country
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

/** Normalize a raw language value ("en", "en-US", "English") to a base code key. */
export function normalizeLangCode(raw: string): string {
  return String(raw || '').toLowerCase().split(/[-_]/)[0];
}

export interface LanguageFlag {
  code: string;
  /** Emoji flag (does NOT render on Windows — prefer the image via flagCdnUrl). */
  flag: string;
  label: string;
  /** ISO 3166 alpha-2 (lowercase), for rendering an image flag. '' if unknown. */
  country: string;
}

/** Resolve a language code to { code, flag, label, country }. Unknown → white flag + raw label. */
export function languageFlag(rawCode: string): LanguageFlag {
  const code = normalizeLangCode(rawCode);
  const info = LANGUAGES[code];
  if (!info) return { code, flag: '🏳️', label: code.toUpperCase() || 'Unknown', country: '' };
  return { code, flag: countryToFlag(info.country), label: info.label, country: info.country.toLowerCase() };
}

/**
 * Image-flag URL for a country code (SVG from flagcdn.com). Used instead of emoji
 * because Windows has no flag-emoji glyphs. Returns null for unknown codes.
 */
export function flagCdnUrl(country: string): string | null {
  const cc = (country || '').toLowerCase();
  if (cc.length !== 2) return null;
  return `https://flagcdn.com/${cc}.svg`;
}

/** The full known-language list, for filter dropdowns (sorted by label). */
export const KNOWN_LANGUAGES: LanguageFlag[] = Object.keys(LANGUAGES)
  // de-dupe label collisions (fil/tl, no/nb) by code — keep all codes, UI can group by label
  .map((code) => languageFlag(code))
  .sort((a, b) => a.label.localeCompare(b.label));
