/**
 * Model-number detection, e.g. "TM4500s", "R325", "C-680".
 * Used to spot titles, specs and descriptions that refer to different models.
 */

// Letter prefixes that are units, standards or tech terms rather than models.
const NOT_A_MODEL_PREFIX = new Set([
  "KG", "CM", "MM", "KM", "PK", "HP", "KW", "W", "V", "MPH", "KMH", "LB", "LBS", "IN", "X", "BT",
  "USB", "LED", "LCD", "TFT", "HD", "IP", "CE", "EN", "ISO", "DIN", "NR", "NO", "H", "U", "A",
  "MAH", "HZ", "DB", "S", "M", "L", "XL", "XXL", "VAN", "TOT", "MET", "UP", "TO", "PS", "CHP",
]);

export interface ModelToken {
  prefix: string;
  digits: string;
  suffix: string;
  normalized: string;
  raw: string;
}

const MODEL_RE = /(?<![A-Za-z0-9])([A-Za-z]{1,4})[-\s]?(\d{2,5})([A-Za-z]{0,3})(?![A-Za-z0-9])/g;

export function parseModelTokens(text: string): ModelToken[] {
  const out: ModelToken[] = [];
  for (const m of text.matchAll(MODEL_RE)) {
    const prefix = m[1].toUpperCase();
    if (NOT_A_MODEL_PREFIX.has(prefix)) continue;
    // "van 120" / "tot 16" style words are caught above; also skip years.
    if (/^(19|20)\d\d$/.test(m[2]) && m[1].length > 2) continue;
    const suffix = m[3].toUpperCase();
    // Units glued to the number ("125kg", "16kmh") are not models.
    if (/^(KG|CM|MM|KM|W|KW|PK|HP|LB|LBS|MPH|V)$/.test(suffix)) continue;
    out.push({
      prefix,
      digits: m[2],
      suffix,
      normalized: `${prefix}${m[2]}${suffix}`,
      raw: m[0].trim(),
    });
  }
  return out;
}

export function extractModelTokens(text: string): string[] {
  return parseModelTokens(text).map((t) => t.normalized);
}

/**
 * Two tokens refer to clearly different models when they share the letter
 * prefix but the number differs (TM4500 vs TM4000). A different suffix only
 * (TM4500 vs TM4500s) is not flagged: descriptions often drop suffixes.
 */
export function isDifferentModel(a: ModelToken, b: ModelToken): boolean {
  return a.prefix === b.prefix && a.digits !== b.digits;
}
