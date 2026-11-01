import { detectCategory } from "./categories";
import { extractProduct } from "./extract";
import { dedupeFindings, severityRank } from "./findings";
import { detectAmbiguities } from "./rules/ambiguous";
import { detectContradictions, detectImpliedContradictions } from "./rules/contradictions";
import { detectMisleading } from "./rules/misleading";
import { detectMissing } from "./rules/missing";
import type { Finding, ProductInput, ProductScanResult, Severity } from "./types";

export * from "./types";
export { CATEGORY_LABELS } from "./categories";
export { attributeLabel } from "./attributes";

/** Deterministic scan of one product. Pure function: no I/O, no AI. */
export function scanProduct(product: ProductInput): ProductScanResult {
  const category = detectCategory(product);
  const extractions = extractProduct(product);
  const findings = dedupeFindings([
    ...detectContradictions(product, extractions),
    ...detectImpliedContradictions(product, extractions),
    ...detectMisleading(product, extractions),
    ...detectAmbiguities(product, extractions),
    ...detectMissing(product, category, extractions),
  ]);
  return { productId: product.externalId, category, extractions, findings };
}

export interface ScanSummary {
  productsScanned: number;
  productsWithIssues: number;
  totalFindings: number;
  bySeverity: Record<Severity, number>;
  skipped: number;
}

export const DEFAULT_MAX_PRODUCTS_PER_SCAN = 500;

export function scanProducts(
  products: ProductInput[],
  opts: { maxProducts?: number } = {},
): { results: ProductScanResult[]; summary: ScanSummary } {
  const max = opts.maxProducts ?? DEFAULT_MAX_PRODUCTS_PER_SCAN;
  const batch = products.slice(0, max);
  const results = batch.map(scanProduct);
  const all: Finding[] = results.flatMap((r) => r.findings);
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of all) bySeverity[f.severity]++;
  return {
    results,
    summary: {
      productsScanned: batch.length,
      productsWithIssues: results.filter((r) => r.findings.length).length,
      totalFindings: all.length,
      bySeverity,
      skipped: products.length - batch.length,
    },
  };
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}
