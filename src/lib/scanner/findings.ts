import { attributeLabel } from "./attributes";
import type {
  Confidence,
  Evidence,
  Extraction,
  Finding,
  IssueType,
  ProductInput,
  Severity,
  Source,
} from "./types";

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return severityRank(a) <= severityRank(b) ? a : b;
}

const FIELD_LABELS: Record<Source["field"], string> = {
  title: "Title",
  description: "Description",
  specifications: "Specifications",
  metafield: "Metafield",
  variant: "Variant",
  manufacturer: "Manufacturer reference",
};

export function sourceLabel(source: Source): string {
  const base = FIELD_LABELS[source.field];
  return source.key ? `${base} › ${source.key}` : base;
}

/** Shorter label for use in sentences: "the description", "the specifications (Continu vermogen)". */
export function sourcePhrase(source: Source): string {
  switch (source.field) {
    case "title":
      return "the title";
    case "description":
      return source.key ? `the description (“${source.key}”)` : "the description";
    case "specifications":
      return source.key ? `the specifications (“${source.key}”)` : "the specifications";
    case "metafield":
      return `metafield “${source.key}”`;
    case "variant":
      return `variant “${source.key}”`;
    case "manufacturer":
      return "the manufacturer reference";
  }
}

export function displayValue(e: Extraction): string {
  return e.value.display;
}

export function evidenceFrom(e: Extraction): Evidence {
  return {
    source: e.source,
    sourceLabel: sourceLabel(e.source),
    text: e.snippet,
    value: displayValue(e),
  };
}

export function fingerprint(productId: string, issueType: IssueType, attributes: string[], extra = ""): string {
  return [productId, issueType, [...attributes].sort().join("+"), extra].join("|");
}

export function confidenceFor(exts: Extraction[]): Confidence {
  return exts.every((e) => e.certainty === "explicit") ? "high" : "medium";
}

export function baseFinding(
  product: ProductInput,
  partial: Omit<Finding, "productId" | "productTitle" | "fingerprint" | "detector" | "suggestedCorrections"> &
    Partial<Pick<Finding, "suggestedCorrections" | "fingerprint">>,
): Finding {
  return {
    productId: product.externalId,
    productTitle: product.title,
    detector: "rules",
    suggestedCorrections: [],
    fingerprint: partial.fingerprint ?? fingerprint(product.externalId, partial.issueType, partial.attributes),
    ...partial,
  };
}

export function labelOf(key: string): string {
  return attributeLabel(key);
}

export function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Merge findings that describe the same issue (same fingerprint). */
export function dedupeFindings(findings: Finding[]): Finding[] {
  const map = new Map<string, Finding>();
  for (const f of findings) {
    const existing = map.get(f.fingerprint);
    if (!existing) {
      map.set(f.fingerprint, { ...f, evidence: [...f.evidence] });
      continue;
    }
    const seen = new Set(existing.evidence.map((e) => `${e.sourceLabel}|${e.text}`));
    for (const e of f.evidence) {
      const k = `${e.sourceLabel}|${e.text}`;
      if (!seen.has(k)) {
        existing.evidence.push(e);
        seen.add(k);
      }
    }
    existing.severity = maxSeverity(existing.severity, f.severity);
    existing.suggestedCorrections.push(...f.suggestedCorrections);
    if (f.verificationStatus === "manufacturer_verified") existing.verificationStatus = "manufacturer_verified";
  }
  return [...map.values()].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}
