import { POWER_ATTRS } from "../attributes";
import { CATEGORY_LABELS, REQUIREMENTS } from "../categories";
import { baseFinding, evidenceFrom, labelOf, sourceLabel } from "../findings";
import type { Category, Extraction, Finding, ProductInput } from "../types";

/**
 * Missing-attribute rule. Only attributes that matter for the product's
 * category are checked. When a verified manufacturer reference contains the
 * value, it is suggested as the correction; otherwise no value is suggested.
 */
export function detectMissing(product: ProductInput, category: Category, extractions: Extraction[]): Finding[] {
  const findings: Finding[] = [];
  const merchant = extractions.filter((e) => e.source.field !== "manufacturer");
  const has = (attr: string) => merchant.some((e) => e.attribute === attr);

  const checked = [
    "title",
    "description",
    product.specifications.length ? `specifications (${product.specifications.length} rows)` : null,
    product.metafields.length ? `metafields (${product.metafields.length})` : null,
    product.variants.length ? `variants (${product.variants.length})` : null,
  ].filter(Boolean);

  for (const req of REQUIREMENTS[category]) {
    if (has(req.attribute)) continue;
    // Peak-only or unqualified power is an ambiguity, reported by the ambiguity rule.
    if (
      req.attribute === POWER_ATTRS.continuous.key &&
      (has(POWER_ATTRS.peak.key) || has(POWER_ATTRS.unqualified.key))
    )
      continue;

    const label = labelOf(req.attribute);
    const mfr = extractions.find((e) => e.source.field === "manufacturer" && e.attribute === req.attribute);
    const verified = Boolean(mfr?.hasEvidence);

    findings.push(
      baseFinding(product, {
        issueType: "missing_attribute",
        severity: req.severity,
        attributes: [req.attribute],
        title: `Missing ${label.toLowerCase()}`,
        evidence: [
          {
            source: { field: "description", url: product.url },
            sourceLabel: "Searched fields",
            text: `No ${label.toLowerCase()} found in: ${checked.join(", ")}.`,
          },
          ...(mfr ? [evidenceFrom(mfr)] : []),
        ],
        explanation: `${req.why} This is expected information for a ${CATEGORY_LABELS[category].toLowerCase()}, and it is not stated anywhere in the product data.${
          mfr ? ` The manufacturer reference lists ${mfr.value.display}.` : ""
        }`,
        recommendedAction: mfr
          ? verified
            ? `Add ${label.toLowerCase()} (${mfr.value.display}, per the manufacturer reference) to the product specifications.`
            : `The manufacturer value ${mfr.value.display} has no source link or quote yet. Add one, then publish the value in the specifications.`
          : `Add the ${label.toLowerCase()} from the manufacturer documentation to the product specifications. Do not estimate it.`,
        suggestedCorrections:
          mfr && verified
            ? [
                {
                  source: { field: "specifications" },
                  sourceLabel: sourceLabel({ field: "specifications" }),
                  currentValue: "(missing)",
                  suggestedValue: mfr.value.display,
                  basis: "manufacturer_reference",
                },
              ]
            : [],
        // Pattern matching can miss unusual wording, so absence is medium confidence.
        confidence: "medium",
        verificationStatus: verified ? "manufacturer_verified" : "unverified",
      }),
    );
  }
  return findings;
}

