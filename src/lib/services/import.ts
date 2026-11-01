import { createHash } from "node:crypto";
import type { DataStore, ProductImport } from "@/lib/data/types";
import { MAX_CSV_BYTES, parseProductCsv, type CsvRowError } from "@/lib/import/csv";
import type { ProductInput } from "@/lib/scanner/types";

export interface ImportResult {
  format: "simple" | "shopify_export";
  imported: number;
  created: number;
  updated: number;
  unchanged: number;
  referencesAdded: number;
  errors: CsvRowError[];
  productIds: string[];
}

export function contentHash(p: Omit<ProductImport, "contentHash" | "importSource">): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        p.externalId,
        p.title,
        p.descriptionHtml,
        p.vendor,
        p.productType,
        p.productUrl,
        p.specifications,
        p.metafields,
        p.variants,
        p.manufacturerUrl,
      ]),
    )
    .digest("hex");
}

export function toProductImport(p: ProductInput, source: "csv" | "shopify"): ProductImport {
  const base = {
    externalId: p.externalId,
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    vendor: p.vendor ?? null,
    productType: p.productType ?? null,
    productUrl: p.url ?? null,
    specifications: p.specifications,
    metafields: p.metafields,
    variants: p.variants,
    manufacturerUrl: p.manufacturerUrl ?? null,
  };
  return { ...base, contentHash: contentHash(base), importSource: source };
}

/**
 * Import products into the merchant's store. Existing products (same product
 * ID) are updated; unchanged ones are left alone; products missing from the
 * file are kept (imports never delete data).
 */
export async function importProducts(
  ds: DataStore,
  products: ProductInput[],
  source: "csv" | "shopify",
): Promise<Omit<ImportResult, "format" | "errors">> {
  const store = await ds.getOrCreateStore();
  const existing = new Map((await ds.listProducts(store.id)).map((p) => [p.externalId, p]));

  const rows = products.map((p) => toProductImport(p, source));
  const changed = rows.filter((r) => existing.get(r.externalId)?.contentHash !== r.contentHash);
  const created = changed.filter((r) => !existing.has(r.externalId)).length;
  if (changed.length) await ds.upsertProducts(store.id, changed);

  // Manufacturer specifications supplied in the CSV become manufacturer references.
  const after = new Map((await ds.listProducts(store.id)).map((p) => [p.externalId, p]));
  const withRefs = products.filter((p) => p.manufacturerReferences.length);
  let referencesAdded = 0;
  if (withRefs.length) {
    const ids = withRefs.map((p) => after.get(p.externalId)?.id).filter((x): x is string => Boolean(x));
    const current = await ds.listManufacturerReferences(ids);
    for (const p of withRefs) {
      const productId = after.get(p.externalId)?.id;
      if (!productId) continue;
      for (const ref of p.manufacturerReferences) {
        const dup = current.some(
          (c) =>
            c.productId === productId &&
            c.attributeLabel.toLowerCase() === ref.key.toLowerCase() &&
            c.valueText === ref.value,
        );
        if (dup) continue;
        await ds.addManufacturerReference({
          productId,
          attributeLabel: ref.key,
          valueText: ref.value,
          sourceUrl: ref.sourceUrl ?? null,
          evidenceText: ref.evidenceText ?? null,
        });
        referencesAdded++;
      }
    }
  }

  await ds.updateStore(store.id, { lastImportAt: new Date().toISOString() });
  return {
    imported: rows.length,
    created,
    updated: changed.length - created,
    unchanged: rows.length - changed.length,
    referencesAdded,
    productIds: products.map((p) => after.get(p.externalId)?.id).filter((x): x is string => Boolean(x)),
  };
}

export async function importCsv(ds: DataStore, text: string): Promise<ImportResult> {
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) {
    return {
      format: "simple",
      imported: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      referencesAdded: 0,
      productIds: [],
      errors: [{ row: 0, message: "The file is larger than 10 MB. Split it into smaller files." }],
    };
  }
  const parsed = parseProductCsv(text);
  if (!parsed.products.length) {
    return { format: parsed.format, imported: 0, created: 0, updated: 0, unchanged: 0, referencesAdded: 0, productIds: [], errors: parsed.errors };
  }
  const result = await importProducts(ds, parsed.products, "csv");
  return { ...result, format: parsed.format, errors: parsed.errors };
}
