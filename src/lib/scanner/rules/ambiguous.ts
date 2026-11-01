import { NEGATION, PLATFORMS, POWER_ATTRS } from "../attributes";
import { baseFinding, evidenceFrom, fingerprint, sourceLabel } from "../findings";
import { htmlToText, splitSentences, truncate } from "../text";
import type { Evidence, Extraction, Finding, ProductInput, Source } from "../types";
import { findQuantities } from "../units";

/**
 * Ambiguity rule: claims that a shopper (or an AI assistant) cannot act on
 * because a measurable detail is missing.
 */

const TALL_USERS =
  /(geschikt\s+voor\s+(?:zeer\s+)?(?:lange|grote|langere)\s+(?:mensen|personen|gebruikers|lopers|sporters)|ideaal\s+voor\s+(?:lange|grote)\s+(?:mensen|personen|gebruikers|lopers)|suitable\s+for\s+(?:very\s+)?tall(?:er)?\s+(?:users|people|runners|persons)|ideal\s+for\s+tall(?:er)?\s+(?:users|people|runners)|perfect\s+for\s+tall(?:er)?\s+(?:users|people|runners)|great\s+for\s+tall(?:er)?\s+(?:users|people|runners))/i;

const VAGUE_COMPAT =
  /((?:compatib\w*|werkt|geschikt|koppel\w*|verbind\w*|connect\w*|works?|integrat\w*)\s+(?:\w+\s+){0,4}(?:(?:populaire|diverse|verschillende|alle|bekende|de\s+meeste|veel|popular|various|most|many|all|leading|third[-\s]party)\s+)?(?:fitness[-\s]?|trainings?[-\s]?|training\s+|sport[-\s]?)?(?:apps?|platforms?|software|programma'?s)\b)/i;

interface TextSentence {
  sentence: string;
  source: Source;
}

function textSentences(product: ProductInput): TextSentence[] {
  const out: TextSentence[] = [];
  const url = product.url || undefined;
  for (const s of splitSentences(product.title)) out.push({ sentence: s, source: { field: "title", url } });
  for (const s of splitSentences(htmlToText(product.descriptionHtml)))
    out.push({ sentence: s, source: { field: "description", url } });
  for (const kv of [...product.specifications])
    out.push({ sentence: `${kv.key}: ${kv.value}`, source: { field: "specifications", key: kv.key, url } });
  for (const kv of [...product.metafields])
    out.push({ sentence: `${kv.key}: ${kv.value}`, source: { field: "metafield", key: kv.key, url } });
  return out;
}

function ev(t: TextSentence): Evidence {
  return { source: t.source, sourceLabel: sourceLabel(t.source), text: truncate(t.sentence) };
}

export function detectAmbiguities(product: ProductInput, extractions: Extraction[]): Finding[] {
  const findings: Finding[] = [];
  const merchant = extractions.filter((e) => e.source.field !== "manufacturer");

  // 1. Motor power without "continuous" or "peak".
  const unqualified = merchant.filter((e) => e.attribute === POWER_ATTRS.unqualified.key);
  if (unqualified.length) {
    const hasContinuous = merchant.some((e) => e.attribute === POWER_ATTRS.continuous.key);
    findings.push(
      baseFinding(product, {
        issueType: "ambiguous",
        severity: hasContinuous ? "low" : "medium",
        attributes: [POWER_ATTRS.unqualified.key],
        title: "Motor power does not say continuous or peak",
        evidence: unqualified.map(evidenceFrom),
        explanation: `Motor power is listed as ${[...new Set(unqualified.map((e) => e.value.display))].join(", ")} without saying whether it is continuous or peak power. Peak power is often 1.5–2× higher than continuous power, so a shopping assistant may compare it against other products' continuous power and overstate this motor.${
          hasContinuous ? " A continuous value is stated elsewhere, so this is mainly a clarity issue." : ""
        }`,
        recommendedAction:
          "State the power type explicitly, for example “2.0 HP continuous (3.5 HP peak)”, using the values from the manufacturer documentation.",
        confidence: "high",
        verificationStatus: "unverified",
      }),
    );
  }

  const sentences = textSentences(product);

  // 2. "Suitable for tall users" without a measurable height.
  const hasHeight = merchant.some((e) => e.attribute === "max_user_height");
  if (!hasHeight) {
    const vague = sentences.filter((t) => TALL_USERS.test(t.sentence) && !findQuantities(t.sentence, "length").length);
    if (vague.length) {
      findings.push(
        baseFinding(product, {
          issueType: "ambiguous",
          severity: "medium",
          attributes: ["max_user_height"],
          title: "“Suitable for tall users” without a height limit",
          evidence: vague.map(ev),
          explanation:
            "The product claims to suit tall users but gives no measurable height. A shopping assistant cannot tell a 1.95 m customer whether the product fits them, and may guess.",
          recommendedAction:
            "Replace or support the claim with a measurable value from the manufacturer, such as a maximum user height or running surface length.",
          confidence: "high",
          verificationStatus: "unverified",
        }),
      );
    }
  }

  // 3. Compatibility claims that do not name any platform.
  const vagueCompat = sentences.filter(
    (t) =>
      VAGUE_COMPAT.test(t.sentence) &&
      !PLATFORMS.some((p) => p.match.test(t.sentence)) &&
      !NEGATION.test(t.sentence),
  );
  if (vagueCompat.length) {
    const namesPlatformsElsewhere = merchant.some((e) => e.attribute.startsWith("compat_"));
    findings.push(
      baseFinding(product, {
        issueType: "ambiguous",
        severity: namesPlatformsElsewhere ? "low" : "medium",
        attributes: ["app_compatibility"],
        title: "Compatibility claim without named apps",
        evidence: vagueCompat.map(ev),
        explanation: `The product says it works with apps or platforms but does not name which ones${
          namesPlatformsElsewhere ? " in this sentence (some platforms are named elsewhere)" : ""
        }. Customers often ask assistants “does this work with Zwift/Kinomap?”, and an unspecific claim invites a wrong yes.`,
        recommendedAction:
          "List the supported apps by name (and the connection type, e.g. Bluetooth FTMS), based on the manufacturer's compatibility list.",
        confidence: "medium",
        verificationStatus: "unverified",
        fingerprint: fingerprint(product.externalId, "ambiguous", ["app_compatibility"]),
      }),
    );
  }

  return findings;
}
