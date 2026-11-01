import { contradictionSeverity, isSafetyAttribute, POWER_ATTRS } from "../attributes";
import {
  baseFinding,
  confidenceFor,
  evidenceFrom,
  fingerprint,
  labelOf,
  sourceLabel,
  sourcePhrase,
} from "../findings";
import type { Extraction, Finding, ProductInput, Severity, SuggestedCorrection } from "../types";
import { sameValue } from "../units";

/**
 * Contradiction rule: the same attribute has different values in different
 * places (or twice in the same place). The scanner never picks a winner on its
 * own; it only recommends a value when a manufacturer reference supports it.
 */

const SKIP = new Set(["model", POWER_ATTRS.unqualified.key, "dimensions", "running_surface"]);

type Cluster = Extraction[];

function sameExtractionValue(a: Extraction, b: Extraction): boolean {
  const va = a.value;
  const vb = b.value;
  if (va.kind === "number" && vb.kind === "number") return sameValue(va.base, vb.base, va.dimension);
  if (va.kind === "boolean" && vb.kind === "boolean") return va.value === vb.value;
  if (va.kind === "enum" && vb.kind === "enum") return va.values.some((v) => vb.values.includes(v));
  return va.kind === vb.kind;
}

export function clusterValues(exts: Extraction[]): Cluster[] {
  const sorted = [...exts].sort((a, b) =>
    a.value.kind === "number" && b.value.kind === "number" ? a.value.base - b.value.base : 0,
  );
  const clusters: Cluster[] = [];
  for (const e of sorted) {
    const c = clusters.find((cl) => sameExtractionValue(cl[0], e));
    if (c) c.push(e);
    else clusters.push([e]);
  }
  return clusters;
}

function quoted(e: Extraction): string {
  return e.value.kind === "number" ? e.value.display : `“${e.value.display}”`;
}

function clusterSummary(c: Cluster): string {
  const places = [...new Set(c.map((e) => sourcePhrase(e.source)))];
  return `${places.join(" and ")} ${places.length > 1 ? "say" : "says"} ${quoted(c[0])}`;
}

/** Label for use mid-sentence: "maximum user weight", but "Zwift compatibility". */
function inSentence(attribute: string): string {
  const label = labelOf(attribute);
  return attribute.startsWith("compat_") ? label : label.toLowerCase();
}

function higherThan(a: Extraction, b: Extraction): boolean {
  return a.value.kind === "number" && b.value.kind === "number" && a.value.base > b.value.base;
}

function powerHint(attribute: string, clusters: Cluster[], all: Extraction[]): string {
  if (attribute !== POWER_ATTRS.continuous.key) return "";
  const peaks = all.filter((e) => e.attribute === POWER_ATTRS.peak.key);
  for (const c of clusters) {
    const p = peaks.find((pk) => pk.value.kind === "number" && c[0].value.kind === "number" && sameValue(pk.value.base, c[0].value.base, "power"));
    if (p) {
      return ` Note: ${c[0].value.display} is the same as the peak power listed in ${sourcePhrase(p.source)}, so ${sourcePhrase(c[0].source)} may be quoting peak power as continuous power.`;
    }
  }
  return "";
}

export function detectContradictions(product: ProductInput, extractions: Extraction[]): Finding[] {
  const findings: Finding[] = [];
  const byAttr = new Map<string, Extraction[]>();
  for (const e of extractions) {
    if (SKIP.has(e.attribute) || e.value.kind === "present") continue;
    byAttr.set(e.attribute, [...(byAttr.get(e.attribute) ?? []), e]);
  }

  for (const [attribute, exts] of byAttr) {
    const merchant = exts.filter((e) => e.source.field !== "manufacturer");
    const manufacturer = exts.filter((e) => e.source.field === "manufacturer");
    const verifiedMfr = manufacturer.filter((e) => e.hasEvidence);
    const label = labelOf(attribute);
    const clusters = clusterValues(merchant);
    const baseSeverity = contradictionSeverity(attribute);
    const safety = isSafetyAttribute(attribute);

    // Case 1: the merchant's own data disagrees with itself.
    if (clusters.length >= 2) {
      const variantOnlyCluster = clusters.some((c) => c.every((e) => e.source.field === "variant"));
      const issueType = variantOnlyCluster ? "misleading" : "contradiction";
      const mfrMatch = verifiedMfr.length
        ? clusters.find((c) => verifiedMfr.some((m) => sameExtractionValue(m, c[0])))
        : undefined;
      const mfr = verifiedMfr[0] ?? manufacturer[0];

      const corrections: SuggestedCorrection[] = [];
      if (mfrMatch && mfr) {
        for (const c of clusters) {
          if (c === mfrMatch) continue;
          for (const e of c) {
            corrections.push({
              source: e.source,
              sourceLabel: sourceLabel(e.source),
              currentValue: e.value.display,
              suggestedValue: mfr.value.display,
              basis: "manufacturer_reference",
            });
          }
        }
      }

      let severity: Severity = baseSeverity;
      if (safety && verifiedMfr.length && !mfrMatch) severity = "critical";

      const statements = clusters.map(clusterSummary).join("; ");
      let explanation = `${label} is stated differently in different places: ${statements}.`;
      explanation += powerHint(attribute, clusters, extractions);
      if (safety) {
        explanation += ` Because this is a safety limit, a shopping assistant could recommend the product to someone it is not rated for.`;
      } else if (attribute.startsWith("compat_")) {
        explanation += ` A shopping assistant may tell a customer the product works with this platform when it does not (or the reverse).`;
      } else {
        explanation += ` A shopping assistant may repeat either value, so a customer could buy a product that does not match what they need.`;
      }

      let recommendedAction: string;
      if (mfrMatch && mfr) {
        explanation += ` The manufacturer reference${mfr.source.url ? ` (${mfr.source.url})` : ""} states ${mfr.value.display}, which matches ${sourcePhrase(mfrMatch[0].source)}.`;
        recommendedAction = `Update ${corrections.map((c) => sourcePhrase(c.source)).filter((v, i, a) => a.indexOf(v) === i).join(" and ")} to ${mfr.value.display} so every field matches the manufacturer documentation.`;
      } else if (verifiedMfr.length) {
        explanation += ` The manufacturer reference states ${verifiedMfr[0].value.display}, which matches none of the merchant values.`;
        recommendedAction = `Re-check the manufacturer documentation, then update every field to the confirmed ${inSentence(attribute)}.`;
      } else {
        recommendedAction = `Check the manufacturer's documentation for the correct ${inSentence(attribute)}, update every field so they match, and add the manufacturer value as a reference so the correction is verified.`;
      }

      findings.push(
        baseFinding(product, {
          issueType,
          severity,
          attributes: [attribute],
          title: issueType === "misleading" ? `Variant contradicts the product's ${inSentence(attribute)}` : `${label} is inconsistent`,
          evidence: [...merchant, ...manufacturer].map(evidenceFrom),
          explanation,
          recommendedAction,
          suggestedCorrections: corrections,
          confidence: confidenceFor(merchant),
          verificationStatus: verifiedMfr.length ? "manufacturer_verified" : "unverified",
          fingerprint: fingerprint(product.externalId, "contradiction", [attribute]),
        }),
      );
      continue;
    }

    // Case 2: the merchant is consistent, but disagrees with the manufacturer.
    if (clusters.length === 1 && manufacturer.length) {
      const mfr = verifiedMfr[0] ?? manufacturer[0];
      if (sameExtractionValue(mfr, clusters[0][0])) continue;
      let severity = baseSeverity;
      // Merchant overstates a safety limit compared with the manufacturer.
      if (safety && mfr.hasEvidence && clusters[0].every((e) => higherThan(e, mfr))) severity = "critical";
      const verified = Boolean(mfr.hasEvidence);
      findings.push(
        baseFinding(product, {
          issueType: "contradiction",
          severity,
          attributes: [attribute],
          title: `${label} differs from the manufacturer`,
          evidence: [...merchant, mfr].map(evidenceFrom),
          explanation:
            `${clusterSummary(clusters[0])}, but the manufacturer reference states ${mfr.value.display}.` +
            (verified ? "" : " The manufacturer value was entered without a source link or quote, so it is not verified."),
          recommendedAction: verified
            ? `Update ${[...new Set(clusters[0].map((e) => sourcePhrase(e.source)))].join(" and ")} to ${mfr.value.display}, the value in the manufacturer documentation.`
            : `Add a link or quote from the manufacturer documentation to verify ${mfr.value.display}, then update the product data.`,
          suggestedCorrections: verified
            ? clusters[0].map((e) => ({
                source: e.source,
                sourceLabel: sourceLabel(e.source),
                currentValue: e.value.display,
                suggestedValue: mfr.value.display,
                basis: "manufacturer_reference" as const,
              }))
            : [],
          confidence: confidenceFor(clusters[0]),
          verificationStatus: verified ? "manufacturer_verified" : "unverified",
          fingerprint: fingerprint(product.externalId, "contradiction", [attribute]),
        }),
      );
    }
  }
  return findings;
}

/**
 * Implied-feature rule: a feature is marked unavailable, but another field
 * lists something that only makes sense if the feature exists (e.g. "incline:
 * no" next to "incline quick keys: yes"). This is a *potential* contradiction:
 * it needs a human to check.
 */
export function detectImpliedContradictions(product: ProductInput, extractions: Extraction[]): Finding[] {
  const merchant = extractions.filter((e) => e.source.field !== "manufacturer");
  const inclineFalse = merchant.filter(
    (e) => e.attribute === "incline_adjustable" && e.value.kind === "boolean" && !e.value.value,
  );
  const inclineTrue = merchant.filter(
    (e) => e.attribute === "incline_adjustable" && e.value.kind === "boolean" && e.value.value,
  );
  if (!inclineFalse.length || inclineTrue.length) return []; // direct contradiction handled elsewhere

  const implying = merchant.filter(
    (e) =>
      (e.attribute === "incline_controls" && e.value.kind === "boolean" && e.value.value) ||
      (e.attribute === "incline_max" && e.value.kind === "number" && e.value.base > 0),
  );
  if (!implying.length) return [];

  const implied = implying.map((e) => `${sourcePhrase(e.source)} lists ${labelOf(e.attribute).toLowerCase()} (“${e.value.display}”)`);
  return [
    baseFinding(product, {
      issueType: "contradiction",
      severity: "medium",
      attributes: ["incline_adjustable", ...new Set(implying.map((e) => e.attribute))],
      title: "Incline marked unavailable, but incline features are listed",
      evidence: [...inclineFalse, ...implying].map(evidenceFrom),
      explanation: `${sourcePhrase(inclineFalse[0].source).replace(/^the/, "The")} says adjustable incline is not available (“${inclineFalse[0].value.display}”), but ${implied.join(" and ")}. These cannot both be true for the same product. A shopping assistant could tell a customer the treadmill has no incline when it does, or the reverse.`,
      recommendedAction:
        "Check the manufacturer documentation to confirm whether this model has adjustable incline. Then either correct the incline field or remove the incline features that do not apply.",
      confidence: "medium",
      verificationStatus: "needs_verification",
      fingerprint: fingerprint(product.externalId, "contradiction", ["incline_adjustable"], "implied"),
    }),
  ];
}
