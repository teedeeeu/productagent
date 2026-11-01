import type { Dimension, Severity } from "./types";

/**
 * Attribute catalog. Each attribute describes:
 *  - how to recognise it in a spec label (labelMatch / labelExclude)
 *  - how to recognise it in free text (textMatch / textExclude, per clause)
 *  - how serious a contradiction or a missing value is for a shopper
 *
 * Patterns cover English and Dutch, since the first validation store
 * (FitnessKing) publishes in Dutch.
 */

export type Impact = "safety" | "core" | "secondary";

interface BaseAttr {
  key: string;
  label: string;
  impact: Impact;
  contradictionSeverity: Severity;
  labelMatch: RegExp;
  labelExclude?: RegExp;
  textMatch?: RegExp;
  textExclude?: RegExp;
}

export interface NumberAttr extends BaseAttr {
  kind: "number";
  dimension: Dimension;
  /** For ranges such as "1 - 16 km/h": which end is the attribute value. */
  pick: "max" | "value";
}

export interface BooleanAttr extends BaseAttr {
  kind: "boolean";
}

export interface EnumAttr extends BaseAttr {
  kind: "enum";
  options: { value: string; match: RegExp }[];
}

export interface PresenceAttr extends BaseAttr {
  kind: "present";
  /** Pattern that, on its own, proves the attribute is present in text. */
  valuePattern?: RegExp;
}

export type AttributeDef = NumberAttr | BooleanAttr | EnumAttr | PresenceAttr;

const EXCLUDE_PRODUCT_WEIGHT =
  /(product|netto|bruto|eigen\s*gewicht|verpakking|apparaat|machine|vliegwiel|flywheel|package|shipping|verzend|item\s*weight)/i;

export const ATTRIBUTES: AttributeDef[] = [
  {
    key: "max_user_weight",
    label: "Maximum user weight",
    kind: "number",
    dimension: "mass",
    pick: "max",
    impact: "safety",
    contradictionSeverity: "high",
    labelMatch:
      /(gebruikers?gewicht|gewicht\s*gebruiker|user\s*weight|belastba\w*|draagvermogen|weight\s*capacity|max(?:imum|imaal|imale|\.)?\s*(?:belasting|load|gewicht|weight|capaciteit|capacity))/i,
    labelExclude: EXCLUDE_PRODUCT_WEIGHT,
    textMatch:
      /(gebruikers?gewicht|user\s*weight|belastba\w*|draagvermogen|weight\s*capacity|gebruikers?\s+(?:tot|van\s+maximaal|t\/m)|users?\s+(?:up\s+to|of\s+up\s+to|weighing\s+up\s+to)|personen\s+(?:tot|van\s+maximaal)|max(?:imum|imaal|imale|\.)?\s+(?:belasting|load))/i,
    textExclude: EXCLUDE_PRODUCT_WEIGHT,
  },
  {
    key: "max_user_height",
    label: "Maximum user height",
    kind: "number",
    dimension: "length",
    pick: "max",
    impact: "safety",
    contradictionSeverity: "medium",
    labelMatch:
      /(gebruikers?lengte|lichaamslengte|lengte\s*gebruiker|user\s*height|body\s*height|max(?:imum|imale|\.)?\s*(?:lengte|height)\s*(?:gebruiker|user)?$)/i,
    textMatch:
      /(gebruikers?lengte|lichaamslengte|user\s*height|gebruikers?\s+(?:tot|van)\b|users?\s+(?:up\s+to|of\s+up\s+to)|personen\s+tot|lengte\s+van\s+maximaal)/i,
    textExclude: /(loopvlak|running|afmeting|dimension|kabel|cable)/i,
  },
  {
    key: "max_speed",
    label: "Maximum speed",
    kind: "number",
    dimension: "speed",
    pick: "max",
    impact: "core",
    contradictionSeverity: "medium",
    labelMatch: /(snelheid|speed)/i,
    labelExclude: /(min(?:imum|imale|\.)?\s|minimale|toets|knop|keys?|buttons?|programma)/i,
    textMatch: /(snelheid|speed|km\s?\/\s?[hu]|mph)/i,
    textExclude: /(min(?:imum|imale|\.)?\s*snelheid|min(?:imum|\.)?\s*speed|start(?:snelheid|\s+speed))/i,
  },
  {
    key: "incline_max",
    label: "Maximum incline",
    kind: "number",
    dimension: "percent",
    pick: "max",
    impact: "core",
    contradictionSeverity: "medium",
    labelMatch: /(helling|incline|stijging)/i,
    labelExclude: /(snelkeuze|toets|knop|quick|keys?|buttons?|controls?|niveaus?|levels?|programma)/i,
    textMatch: /(helling|incline|stijging)/i,
    textExclude: /(snelkeuze|toets|knop|quick|keys?|buttons?)/i,
  },
  {
    key: "incline_adjustable",
    label: "Adjustable incline",
    kind: "boolean",
    impact: "core",
    contradictionSeverity: "medium",
    labelMatch:
      /(verstelbare?\s*helling|helling\s*(?:verstelbaar|instelbaar|functie)|hellingsverstelling|hellingsfunctie|elektrische\s*helling|motorische\s*helling|hellingshoek|^helling$|^incline$|adjustable\s*incline|incline\s*(?:adjust\w*|function))/i,
    labelExclude: /(snelkeuze|toets|knop|quick|keys?|buttons?|controls?|max|niveaus?|levels?)/i,
    textMatch:
      /(verstelbare\s*helling|instelbare\s*helling|hellingsverstelling|hellingsfunctie|elektrische\s*helling|motorische\s*helling|adjustable\s*incline|incline\s*(?:function|adjustment)|auto(?:matic)?\s*incline)/i,
    textExclude: /(snelkeuze|toets|knop|quick|keys?|buttons?)/i,
  },
  {
    key: "incline_controls",
    label: "Incline quick-access controls",
    kind: "boolean",
    impact: "secondary",
    contradictionSeverity: "low",
    labelMatch:
      /(snelkeuze\w*\s*(?:toetsen\s*)?helling|helling\w*\s*(?:snelkeuze|toetsen|knoppen)|incline\s*(?:quick|keys|buttons|controls?)|quick[-\s]*(?:access\s*)?(?:incline|keys?\s*(?:for\s*)?incline))/i,
    textMatch:
      /(snelkeuze\w*\s*(?:toetsen\s*)?(?:voor\s*(?:de\s*)?)?helling|helling\w*\s*(?:snelkeuze|toetsen|knoppen)|incline\s*(?:quick[-\s]*(?:access\s*)?)?(?:keys|buttons|controls)|quick[-\s]*(?:access\s*)?(?:incline|keys?\s*(?:for\s*)?incline))/i,
  },
  {
    key: "resistance_type",
    label: "Resistance type",
    kind: "enum",
    impact: "core",
    contradictionSeverity: "medium",
    labelMatch: /(weerstand(?:s)?(?:type|systeem|soort)?|resistance(?:\s*type|\s*system)?|remsysteem|braking\s*system)/i,
    labelExclude: /(niveau|level|\bstand(?:en)?\b|traps|aantal|number|programma)/i,
    textMatch: /(weerstand|resistance|remsysteem|braking)/i,
    options: [
      { value: "electromagnetic", match: /(elektro-?magn|electro-?magn|\bem[-\s]?(?:rem|brake)|inductie)/i },
      { value: "magnetic", match: /(?<!elektro-?|electro-?)(magneet|magnetis|magnetic)/i },
      { value: "air", match: /(lucht|\bair\b|wind)/i },
      { value: "water", match: /\bwater/i },
      { value: "hydraulic", match: /hydraul/i },
      { value: "friction", match: /(wrijving|friction|vilt|\bfelt\b)/i },
    ],
  },
  {
    key: "dimensions",
    label: "Product dimensions",
    kind: "present",
    impact: "secondary",
    contradictionSeverity: "low",
    labelMatch: /(afmeting|dimension|maten|opgesteld|l\s*x\s*b\s*x\s*h|lxbxh|measurements|^size$|^formaat$)/i,
    labelExclude: /(loopvlak|running|verpakking|package|scherm|display|doos|box)/i,
    textExclude: /(loopvlak|running|verpakking|package|doos|box)/i,
    valuePattern: /\d+(?:[.,]\d+)?\s*(?:x|×)\s*\d+(?:[.,]\d+)?\s*(?:x|×)\s*\d+(?:[.,]\d+)?\s*(?:cm|mm|in|m)\b/i,
  },
  {
    key: "running_surface",
    label: "Running surface size",
    kind: "present",
    impact: "core",
    contradictionSeverity: "low",
    labelMatch: /(loopvlak|running\s*(?:surface|area|belt|deck)|belt\s*size|afmeting\s*loopband)/i,
    textMatch: /(loopvlak|running\s*(?:surface|area|belt|deck)|belt\s*size)/i,
    valuePattern: /\d+(?:[.,]\d+)?\s*(?:x|×)\s*\d+(?:[.,]\d+)?\s*(?:cm|mm|in)\b/i,
  },
];

/** Power is handled separately: continuous, peak, and unqualified are distinct attributes. */
export const POWER_ATTRS = {
  continuous: {
    key: "motor_power_continuous",
    label: "Continuous motor power",
    contradictionSeverity: "high" as Severity,
  },
  peak: { key: "motor_power_peak", label: "Peak motor power", contradictionSeverity: "medium" as Severity },
  unqualified: {
    key: "motor_power_unqualified",
    label: "Motor power (continuous or peak not stated)",
    contradictionSeverity: "low" as Severity,
  },
};

export const POWER_LABEL = /(vermogen|power|motor|\bpk\b|\bhp\b|\bchp\b)/i;
export const POWER_LABEL_EXCLUDE = /(snelheid|speed|weerstand|resistance|verbruik|consumption|voeding|supply|adapter|aansluiting|spanning|voltage|luidspreker|speaker)/i;
export const CONTINUOUS_WORDS = /(continu|continuous|doorlopend|duurvermogen|nominaal|nominal|rated|\bchp\b)/i;
export const PEAK_WORDS = /(piek|peak|max(?:imaal|imum|imale|\.)?(?![a-z])|\btop\b|\bhpp\b)/i;

/** Compatibility platforms we can check claims against. */
export const PLATFORMS: { key: string; label: string; match: RegExp }[] = [
  { key: "zwift", label: "Zwift", match: /zwift/i },
  { key: "kinomap", label: "Kinomap", match: /kinomap/i },
  { key: "ifit", label: "iFit", match: /\bi-?fit\b/i },
  { key: "fitshow", label: "FitShow", match: /fit\s?show/i },
  { key: "rouvy", label: "Rouvy", match: /rouvy/i },
  { key: "peloton", label: "Peloton", match: /peloton/i },
  { key: "strava", label: "Strava", match: /strava/i },
  { key: "apple_health", label: "Apple Health", match: /apple\s*(?:health|gezondheid)/i },
];

export const COMPAT_LABEL = /(compatib|apps?\b|connectiviteit|connectivity|koppel|verbind|software|platform|integrat)/i;
export const COMPAT_POSITIVE =
  /(compatib\w*|geschikt\s+voor|werkt\s+met|works\s+with|ondersteun\w*|support\w*|koppel\w*|verbind\w*|connect\w*|apps?\s+(?:zoals|als|like|such\s+as)|integrat\w*|te\s+gebruiken\s+met|use\s+with|train(?:en)?\s+met)/i;
export const NEGATION =
  /(\bniet\b(?!\s+alleen)|\bgeen\b|\bnot\b(?!\s+only)|\bno\b|\bzonder\b|\bwithout\b|\bnon[-\s]|incompatib\w*|unsupported|n't\b)/i;

export function compatKey(platformKey: string): string {
  return `compat_${platformKey}`;
}

export function attributeLabel(key: string): string {
  const a = ATTRIBUTES.find((x) => x.key === key);
  if (a) return a.label;
  const p = Object.values(POWER_ATTRS).find((x) => x.key === key);
  if (p) return p.label;
  if (key.startsWith("compat_")) {
    const pl = PLATFORMS.find((x) => compatKey(x.key) === key);
    return `${pl?.label ?? key.slice(7)} compatibility`;
  }
  if (key === "model") return "Model number";
  return key;
}

export function contradictionSeverity(key: string): Severity {
  const a = ATTRIBUTES.find((x) => x.key === key);
  if (a) return a.contradictionSeverity;
  const p = Object.values(POWER_ATTRS).find((x) => x.key === key);
  if (p) return p.contradictionSeverity;
  if (key.startsWith("compat_")) return "high";
  return "medium";
}

export function isSafetyAttribute(key: string): boolean {
  return ATTRIBUTES.find((x) => x.key === key)?.impact === "safety";
}

/** Parse "Ja" / "No" / "Niet beschikbaar" / "✓" into a boolean (null when unclear). */
export function parseBoolean(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (
    /^(nee|neen|no|n|geen|niet|not|none|nvt|n\.v\.t\.?|n\/a|-|–|✗|✘|false|0|unavailable|incompatib\w*|uit|off)\b/.test(v) ||
    /^(niet|not)\s/.test(v) ||
    /(niet\s+(?:beschikbaar|aanwezig|mogelijk|compatib\w*|inbegrepen|verstelbaar))|(not\s+(?:available|included|supported|compatible|adjustable))/.test(v)
  )
    return false;
  if (
    /^(ja|yes|y|j|✓|✔|true|1|aanwezig|beschikbaar|available|included|inclusief|inbegrepen|standaard|compatib\w*|wel|present|ondersteund|supported|aan|on|elektrisch|electric|motorisch|automatisch|automatic|handmatig|manual|verstelbaar|adjustable)\b/.test(
      v,
    ) || /^[✓✔]/.test(v)
  )
    return true;
  return null;
}
