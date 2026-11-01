import {
  ATTRIBUTES,
  COMPAT_LABEL,
  COMPAT_POSITIVE,
  CONTINUOUS_WORDS,
  NEGATION,
  PEAK_WORDS,
  PLATFORMS,
  POWER_ATTRS,
  POWER_LABEL,
  POWER_LABEL_EXCLUDE,
  compatKey,
  parseBoolean,
  type AttributeDef,
  type EnumAttr,
  type NumberAttr,
} from "./attributes";
import { extractModelTokens } from "./models";
import {
  htmlToText,
  parseKeyValueLine,
  splitClauses,
  splitPowerSegments,
  splitSentences,
  truncate,
} from "./text";
import type { Extraction, KeyValue, ProductInput, Source } from "./types";
import { describeQuantity, findQuantities, formatBase, type Quantity } from "./units";

/**
 * Deterministic extraction: reads measurable attributes out of every product
 * field and records exactly where each value came from.
 *
 * It only extracts values that are literally present in the text. It never
 * fills in defaults or guesses values.
 */

type Push = (e: Extraction) => void;

const MODEL_LABEL = /^(model(?:nummer)?|model\s*(?:number|no\.?|nr\.?)|type\s*nummer|typenummer|mpn|fabrikant\s*artikelnummer)$/i;

function numberExtraction(
  attr: NumberAttr,
  q: Quantity,
  snippet: string,
  source: Source,
  certainty: Extraction["certainty"],
): Extraction {
  return {
    attribute: attr.key,
    value: {
      kind: "number",
      dimension: attr.dimension,
      base: q.base,
      display: q.rangeMin !== undefined ? `${q.raw}` : describeQuantity(q, attr.dimension),
    },
    snippet: truncate(snippet),
    source,
    certainty,
  };
}

function pickQuantities(attr: NumberAttr, qs: Quantity[]): Quantity[] {
  if (!qs.length) return [];
  if (attr.pick === "max") {
    // A range "1 - 16 km/h" yields one quantity whose max is the value.
    // Several separate numbers in the same clause ("van 1 tot 16") → take max.
    if (qs.length > 1) {
      const max = qs.reduce((a, b) => (b.base > a.base ? b : a));
      return [max];
    }
  }
  return qs;
}

function boolValue(value: boolean, raw: string) {
  return { kind: "boolean" as const, value, display: raw };
}

/** Boolean parse that refuses values containing measurements ("0 - 15%"). */
function parseBoolStrict(raw: string): boolean | null {
  const v = raw.trim();
  if (/\d/.test(v) && !/^[01]$/.test(v)) return null;
  return parseBoolean(v);
}

function enumValues(attr: EnumAttr, text: string): string[] {
  return attr.options.filter((o) => o.match.test(text)).map((o) => o.value);
}

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------

function extractPower(
  text: string,
  snippet: string,
  source: Source,
  labelQualifier: "continuous" | "peak" | null,
  labelIsPower: boolean,
  push: Push,
) {
  for (const seg of splitPowerSegments(text)) {
    const qs = findQuantities(seg, "power");
    if (!qs.length) continue;
    if (POWER_LABEL_EXCLUDE.test(seg) && !labelIsPower) continue;
    const segMentionsMotor = /(motor|vermogen|power|aandrijving|drive)/i.test(seg);
    let segQualifier: "continuous" | "peak" | null = null;
    const cont = CONTINUOUS_WORDS.test(seg);
    const peak = PEAK_WORDS.test(seg);
    if (cont && !peak) segQualifier = "continuous";
    else if (peak && !cont) segQualifier = "peak";
    for (const q of qs) {
      const isHorsepower = q.unit === "PK" || q.unit === "HP";
      // Watts can describe many things (speakers, generators): require motor context.
      if (!isHorsepower && !labelIsPower && !segMentionsMotor) continue;
      let qualifier = segQualifier ?? labelQualifier;
      if (/chp/i.test(q.raw)) qualifier = "continuous";
      const attr =
        qualifier === "continuous"
          ? POWER_ATTRS.continuous
          : qualifier === "peak"
            ? POWER_ATTRS.peak
            : POWER_ATTRS.unqualified;
      push({
        attribute: attr.key,
        value: {
          kind: "number",
          dimension: "power",
          base: q.base,
          display: `${q.raw}${q.unit === "W" ? "" : ` (≈ ${formatBase(q.base, "power")})`}`,
        },
        snippet: truncate(snippet),
        source,
        certainty: "explicit",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Compatibility
// ---------------------------------------------------------------------------

function extractCompatFromKeyValue(kv: KeyValue, snippet: string, source: Source, push: Push): boolean {
  let matched = false;
  const labelPlatforms = PLATFORMS.filter((p) => p.match.test(kv.key));
  for (const p of labelPlatforms) {
    let b = parseBoolStrict(kv.value);
    if (b === null && kv.value.trim()) b = !NEGATION.test(kv.value);
    if (b === null) continue;
    matched = true;
    push({
      attribute: compatKey(p.key),
      value: boolValue(b, kv.value),
      snippet,
      source,
      certainty: "explicit",
    });
  }
  if (labelPlatforms.length || !COMPAT_LABEL.test(kv.key)) return matched;
  // Label like "Compatibele apps: Zwift, Kinomap (niet: iFit)"
  const segments = kv.value.split(/,|;|\/|\||\s+(?:en|and)\s+/i);
  const labelNegated = NEGATION.test(kv.key);
  for (const seg of segments) {
    for (const p of PLATFORMS) {
      if (!p.match.test(seg)) continue;
      matched = true;
      const negated = labelNegated !== NEGATION.test(seg);
      push({
        attribute: compatKey(p.key),
        value: boolValue(!negated, seg.trim()),
        snippet,
        source,
        certainty: "explicit",
      });
    }
  }
  return matched;
}

function extractCompatFromClause(clause: string, snippet: string, source: Source, push: Push) {
  for (const p of PLATFORMS) {
    if (!p.match.test(clause)) continue;
    const negated = NEGATION.test(clause);
    const positive = COMPAT_POSITIVE.test(clause);
    if (!negated && !positive) continue; // a bare mention is not a claim
    push({
      attribute: compatKey(p.key),
      value: boolValue(!negated, negated ? "not compatible" : "compatible"),
      snippet: truncate(snippet),
      source,
      certainty: negated ? "inferred" : "explicit",
    });
  }
}

// ---------------------------------------------------------------------------
// Key/value (spec table rows, metafields, manufacturer references)
// ---------------------------------------------------------------------------

export function extractFromKeyValue(kv: KeyValue, source: Source, outerPush: Push) {
  let count = 0;
  const push: Push = (e) => {
    count++;
    outerPush(e);
  };
  const key = kv.key.trim();
  const value = kv.value.trim();
  if (!key || !value) return;
  const snippet = truncate(`${key}: ${value}`);
  const src: Source = { ...source, key };
  let matched = false;

  if (MODEL_LABEL.test(key)) {
    const tokens = extractModelTokens(value);
    const values = tokens.length ? tokens : [value.toUpperCase().replace(/[\s-]/g, "")];
    push({
      attribute: "model",
      value: { kind: "enum", values, display: value },
      snippet,
      source: src,
      certainty: "explicit",
    });
    return;
  }

  const powerLabel = POWER_LABEL.test(key) && !POWER_LABEL_EXCLUDE.test(key);
  if (powerLabel || findQuantities(value, "power").some((q) => q.unit === "PK" || q.unit === "HP")) {
    const before = count;
    const labelQualifier = CONTINUOUS_WORDS.test(key) ? "continuous" : PEAK_WORDS.test(key) ? "peak" : null;
    extractPower(value, snippet, src, labelQualifier, powerLabel, push);
    if (count > before) matched = true;
  }

  // A label recognised by an attribute but explicitly excluded (e.g. "Min. snelheid")
  // must not be re-read as free text either.
  let labelRecognised = false;
  for (const attr of ATTRIBUTES) {
    if (!attr.labelMatch.test(key)) continue;
    labelRecognised = true;
    if (attr.labelExclude?.test(key)) continue;
    if (attr.kind === "number") {
      const qs = pickQuantities(attr, findQuantities(value, attr.dimension));
      for (const q of qs) {
        push(numberExtraction(attr, q, snippet, src, "explicit"));
        matched = true;
      }
    } else if (attr.kind === "boolean") {
      const b = parseBoolStrict(value);
      if (b !== null) {
        push({ attribute: attr.key, value: boolValue(b, value), snippet, source: src, certainty: "explicit" });
        matched = true;
      }
    } else if (attr.kind === "enum") {
      const values = enumValues(attr, value);
      if (values.length) {
        push({
          attribute: attr.key,
          value: { kind: "enum", values, display: value },
          snippet,
          source: src,
          certainty: "explicit",
        });
        matched = true;
      }
    } else if (attr.kind === "present") {
      const negative = parseBoolStrict(value) === false;
      if (!negative && (attr.valuePattern ? attr.valuePattern.test(value) || /\d/.test(value) : true)) {
        push({ attribute: attr.key, value: { kind: "present", display: value }, snippet, source: src, certainty: "explicit" });
        matched = true;
      }
    }
  }

  if (extractCompatFromKeyValue({ key, value }, snippet, src, push)) matched = true;

  // Unrecognised label: still read the row as text ("Kenmerken: Zwift compatibel").
  if (!matched && !labelRecognised) extractFromText(`${key}: ${value}`, src, push, { skipKeyValue: true });
}

// ---------------------------------------------------------------------------
// Free text
// ---------------------------------------------------------------------------

function extractFromSentence(sentence: string, source: Source, push: Push) {
  const clauses = splitClauses(sentence);
  for (const clause of clauses) {
    for (const attr of ATTRIBUTES) {
      if (attr.textExclude?.test(clause)) continue;
      if (attr.kind === "number") {
        if (!attr.textMatch?.test(clause)) continue;
        const qs = pickQuantities(attr, findQuantities(clause, attr.dimension));
        for (const q of qs) push(numberExtraction(attr, q, sentence, source, "explicit"));
      } else if (attr.kind === "boolean") {
        if (!attr.textMatch?.test(clause)) continue;
        const negated = NEGATION.test(clause);
        push({
          attribute: attr.key,
          value: boolValue(!negated, negated ? "not available" : "available"),
          snippet: truncate(sentence),
          source,
          certainty: negated ? "inferred" : "explicit",
        });
      } else if (attr.kind === "enum") {
        if (!attr.textMatch?.test(clause) || NEGATION.test(clause)) continue;
        const values = enumValues(attr, clause);
        if (values.length)
          push({
            attribute: attr.key,
            value: { kind: "enum", values, display: clause },
            snippet: truncate(sentence),
            source,
            certainty: "explicit",
          });
      } else if (attr.kind === "present") {
        const hit =
          (attr.textMatch ? attr.textMatch.test(clause) : true) && attr.valuePattern?.test(clause);
        if (hit)
          push({
            attribute: attr.key,
            value: { kind: "present", display: attr.valuePattern!.exec(clause)![0] },
            snippet: truncate(sentence),
            source,
            certainty: "explicit",
          });
      }
    }
    extractCompatFromClause(clause, sentence, source, push);
  }
  extractPower(sentence, sentence, source, null, false, push);
}

export function extractFromText(
  text: string,
  source: Source,
  push: Push,
  opts: { skipKeyValue?: boolean } = {},
) {
  for (const sentence of splitSentences(text)) {
    const kv = opts.skipKeyValue ? null : parseKeyValueLine(sentence);
    if (kv) extractFromKeyValue(kv, source, push);
    else extractFromSentence(sentence, source, push);
  }
}

// ---------------------------------------------------------------------------
// Whole product
// ---------------------------------------------------------------------------

function extractionKey(e: Extraction): string {
  const v = e.value;
  const val =
    v.kind === "number" ? v.base.toFixed(2) : v.kind === "boolean" ? String(v.value) : v.kind === "enum" ? v.values.join("+") : "present";
  return `${e.attribute}|${e.source.field}|${e.source.key ?? ""}|${val}|${e.snippet}`;
}

export function extractProduct(product: ProductInput): Extraction[] {
  const collected: Extraction[] = [];
  const seen = new Set<string>();
  const push: Push = (e) => {
    const k = extractionKey(e);
    if (seen.has(k)) return;
    seen.add(k);
    collected.push(e);
  };
  const url = product.url || undefined;

  extractFromText(product.title, { field: "title", url }, push, { skipKeyValue: true });
  extractFromText(htmlToText(product.descriptionHtml), { field: "description", url }, push);
  for (const kv of product.specifications) extractFromKeyValue(kv, { field: "specifications", url }, push);
  for (const kv of product.metafields) extractFromKeyValue(kv, { field: "metafield", url }, push);
  for (const variant of product.variants) {
    const src: Source = { field: "variant", key: variant.title, url };
    extractFromText(variant.title, src, push, { skipKeyValue: true });
    for (const [k, v] of Object.entries(variant.options ?? {})) {
      extractFromKeyValue({ key: k, value: v }, src, (e) => push({ ...e, source: src }));
    }
  }
  for (const ref of product.manufacturerReferences) {
    const hasEvidence = Boolean(ref.sourceUrl?.trim() || ref.evidenceText?.trim());
    const src: Source = { field: "manufacturer", url: ref.sourceUrl || product.manufacturerUrl || undefined };
    extractFromKeyValue({ key: ref.key, value: ref.value }, src, (e) =>
      push({ ...e, hasEvidence, snippet: ref.evidenceText?.trim() ? truncate(ref.evidenceText) : e.snippet }),
    );
  }
  return collected;
}

export type { AttributeDef };
