import { randomUUID } from "node:crypto";
import type {
  DataStore,
  FindingRecord,
  ManufacturerReferenceRecord,
  ProductAttributeRecord,
  ProductRecord,
  ScanRecord,
} from "@/lib/data/types";
import { scanProduct } from "@/lib/scanner";
import { severityRank } from "@/lib/scanner/findings";
import type { Finding, ProductInput, Severity } from "@/lib/scanner/types";

/**
 * Scan workflow:
 *  1. load products (+ manufacturer references)   4. (phase 5) LLM checks
 *  2. normalise to ProductInput                   5. deduplicate (inside the scanner)
 *  3. deterministic checks                        6. store findings, update products
 *
 * Findings are matched to earlier findings by fingerprint, so a re-scan
 * updates them instead of duplicating them and keeps the merchant's
 * "dismissed" decision. Open findings that no longer occur become "resolved".
 */

export class ScanInProgressError extends Error {
  constructor() {
    super("A scan is already running. Wait for it to finish, then try again.");
  }
}

const STALE_SCAN_MS = 10 * 60 * 1000;

export function toProductInput(p: ProductRecord, refs: ManufacturerReferenceRecord[]): ProductInput {
  return {
    externalId: p.id,
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    vendor: p.vendor ?? undefined,
    productType: p.productType ?? undefined,
    url: p.productUrl ?? undefined,
    specifications: p.specifications,
    metafields: p.metafields,
    variants: p.variants,
    manufacturerUrl: p.manufacturerUrl ?? undefined,
    manufacturerReferences: refs
      .filter((r) => r.productId === p.id)
      .map((r) => ({
        key: r.attributeLabel,
        value: r.valueText,
        sourceUrl: r.sourceUrl ?? undefined,
        evidenceText: r.evidenceText ?? undefined,
      })),
  };
}

/** Merge new scanner findings with stored ones for one product. */
export function reconcileFindings(params: {
  product: ProductRecord;
  scanId: string;
  existing: FindingRecord[];
  found: Finding[];
  now: string;
}): FindingRecord[] {
  const { product, scanId, existing, found, now } = params;
  const byFingerprint = new Map(existing.map((f) => [f.fingerprint, f]));
  const out: FindingRecord[] = [];
  const seen = new Set<string>();

  for (const f of found) {
    seen.add(f.fingerprint);
    const prev = byFingerprint.get(f.fingerprint);
    out.push({
      id: prev?.id ?? randomUUID(),
      organizationId: product.organizationId,
      storeId: product.storeId,
      productId: product.id,
      firstSeenScanId: prev?.firstSeenScanId ?? scanId,
      lastSeenScanId: scanId,
      fingerprint: f.fingerprint,
      issueType: f.issueType,
      severity: f.severity,
      confidence: f.confidence,
      verificationStatus: f.verificationStatus,
      attributes: f.attributes,
      title: f.title,
      evidence: f.evidence,
      explanation: f.explanation,
      recommendedAction: f.recommendedAction,
      suggestedCorrections: f.suggestedCorrections,
      detector: f.detector,
      // A dismissed finding stays dismissed; a resolved one that comes back reopens.
      status: prev?.status === "dismissed" ? "dismissed" : "open",
      reviewedAt: prev?.reviewedAt ?? null,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    });
  }
  for (const prev of existing) {
    if (!seen.has(prev.fingerprint) && prev.status === "open") {
      out.push({ ...prev, status: "resolved", updatedAt: now });
    }
  }
  return out;
}

export function summarizeOpen(findings: FindingRecord[]): { count: number; highest: Severity | null } {
  const open = findings.filter((f) => f.status === "open");
  const highest = open.reduce<Severity | null>(
    (acc, f) => (acc === null || severityRank(f.severity) < severityRank(acc) ? f.severity : acc),
    null,
  );
  return { count: open.length, highest };
}

export interface RunScanOptions {
  /** Only scan these products (default: the whole store). */
  productIds?: string[];
  maxProducts: number;
}

export async function runScan(ds: DataStore, opts: RunScanOptions): Promise<ScanRecord> {
  const store = await ds.getOrCreateStore();
  const [latest] = await ds.listScans(store.id, 1);
  if (latest?.status === "running" && Date.now() - Date.parse(latest.startedAt) < STALE_SCAN_MS) {
    throw new ScanInProgressError();
  }

  let products = await ds.listProducts(store.id);
  if (opts.productIds) {
    const ids = new Set(opts.productIds);
    products = products.filter((p) => ids.has(p.id));
  }
  // Oldest-scanned first, so repeated capped scans eventually cover everything.
  products.sort((a, b) => (a.lastScannedAt ?? "").localeCompare(b.lastScannedAt ?? ""));
  const batch = products.slice(0, opts.maxProducts);

  const scan = await ds.createScan(store.id, products.length, false);
  try {
    const productIds = batch.map((p) => p.id);
    const [refs, existingFindings] = await Promise.all([
      ds.listManufacturerReferences(productIds),
      ds.listFindings({ productIds }),
    ]);

    const now = new Date().toISOString();
    const findingsToSave: FindingRecord[] = [];
    const productsToSave: ProductRecord[] = [];
    const attributes: ProductAttributeRecord[] = [];
    const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    let productsWithIssues = 0;
    let errors = 0;

    for (const product of batch) {
      try {
        const result = scanProduct(toProductInput(product, refs));
        const merged = reconcileFindings({
          product,
          scanId: scan.id,
          existing: existingFindings.filter((f) => f.productId === product.id),
          found: result.findings,
          now,
        });
        findingsToSave.push(...merged);
        const { count, highest } = summarizeOpen(merged);
        if (count) productsWithIssues++;
        for (const f of merged) if (f.status === "open") bySeverity[f.severity]++;
        productsToSave.push({
          ...product,
          category: result.category,
          scanStatus: "scanned",
          lastScannedAt: now,
          openFindingsCount: count,
          highestSeverity: highest,
        });
        for (const e of result.extractions) {
          attributes.push({
            productId: product.id,
            scanId: scan.id,
            attributeKey: e.attribute,
            valueNumber: e.value.kind === "number" ? e.value.base : null,
            valueBoolean: e.value.kind === "boolean" ? e.value.value : null,
            valueText: e.value.display,
            sourceField: e.source.field,
            sourceKey: e.source.key ?? null,
            snippet: e.snippet,
            certainty: e.certainty,
          });
        }
      } catch (err) {
        errors++;
        console.error(`scan failed for product ${product.id}`, err);
        productsToSave.push({ ...product, scanStatus: "error", lastScannedAt: now });
      }
    }

    await ds.saveFindings(findingsToSave);
    await ds.saveProducts(productsToSave);
    await ds.replaceProductAttributes(productIds, attributes);

    const totalFindings = Object.values(bySeverity).reduce((a, b) => a + b, 0);
    const status = errors || batch.length < products.length ? "partial" : "completed";
    const patch = {
      status,
      productsScanned: batch.length - errors,
      productsWithIssues,
      findingsCount: totalFindings,
      findingsBySeverity: bySeverity,
      finishedAt: new Date().toISOString(),
      error:
        batch.length < products.length
          ? `Scan limit reached: scanned ${batch.length} of ${products.length} products. Run another scan to continue.`
          : errors
            ? `${errors} product(s) could not be scanned.`
            : null,
    } satisfies Partial<ScanRecord>;
    await ds.updateScan(scan.id, patch);
    return { ...scan, ...patch };
  } catch (err) {
    await ds
      .updateScan(scan.id, {
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown error",
        finishedAt: new Date().toISOString(),
      })
      .catch(() => {});
    throw err;
  }
}

/** Recompute a product's open-finding counters after a review action. */
export async function refreshProductCounters(ds: DataStore, productId: string): Promise<void> {
  const product = await ds.getProduct(productId);
  if (!product) return;
  const { count, highest } = summarizeOpen(await ds.listFindings({ productId }));
  await ds.saveProducts([{ ...product, openFindingsCount: count, highestSeverity: highest }]);
}
