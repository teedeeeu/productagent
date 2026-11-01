"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { getDataStore } from "@/lib/data";
import { DataAccessError } from "@/lib/data/supabase-store";
import { config } from "@/lib/env";
import { MAX_CSV_BYTES } from "@/lib/import/csv";
import { importCsv } from "@/lib/services/import";
import { refreshProductCounters, runScan, ScanInProgressError } from "@/lib/services/scan";

/**
 * Server actions. Each one authenticates through getDataStore() (which
 * redirects signed-out users) and validates its input; the database then
 * enforces that the user can only touch their own organization's rows.
 */

function failure(err: unknown): ActionResult {
  unstable_rethrow(err); // let Next.js redirects (e.g. to /login) propagate
  if (err instanceof ScanInProgressError || err instanceof DataAccessError) return { ok: false, message: err.message };
  console.error(err);
  return { ok: false, message: "Something went wrong. Please try again." };
}

function revalidateDashboard() {
  revalidatePath("/overview");
  revalidatePath("/products", "layout");
  revalidatePath("/settings");
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function importCsvAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ds = await getDataStore();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a CSV file to upload." };
    if (file.size > MAX_CSV_BYTES) return { ok: false, message: "The file is larger than 10 MB. Split it into smaller files." };
    if (!/\.(csv|txt)$/i.test(file.name) && !/csv|text\/plain/.test(file.type))
      return { ok: false, message: "That doesn't look like a CSV file." };

    const result = await importCsv(ds, await file.text());
    if (!result.imported) {
      return { ok: false, message: "No products could be imported.", rowErrors: result.errors.slice(0, 50) };
    }
    let message = `Imported ${plural(result.imported, "product")} (${result.created} new, ${result.updated} updated, ${result.unchanged} unchanged).`;
    if (result.format === "shopify_export") message = `Shopify export detected. ${message}`;
    if (result.referencesAdded) message += ` Added ${plural(result.referencesAdded, "manufacturer reference")}.`;

    if (formData.get("scanAfterImport") === "on") {
      const scan = await runScan(ds, { maxProducts: config.maxProductsPerScan, productIds: result.productIds });
      message += ` Scan finished: ${plural(scan.findingsCount, "open issue")} found in ${plural(scan.productsScanned, "product")}.`;
      if (scan.error) message += ` ${scan.error}`;
    }
    revalidateDashboard();
    return { ok: true, message, rowErrors: result.errors.slice(0, 50) };
  } catch (err) {
    return failure(err);
  }
}

export async function runScanAction(_prev: ActionResult, _formData: FormData): Promise<ActionResult> {
  try {
    const ds = await getDataStore();
    const scan = await runScan(ds, { maxProducts: config.maxProductsPerScan });
    revalidateDashboard();
    if (!scan.productsTotal) return { ok: false, message: "There are no products to scan yet. Import a CSV first." };
    return {
      ok: true,
      message: `Scanned ${plural(scan.productsScanned, "product")}: ${plural(scan.findingsCount, "open issue")}.${scan.error ? ` ${scan.error}` : ""}`,
    };
  } catch (err) {
    return failure(err);
  }
}

const Id = z.uuid();

export async function rescanProductAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ds = await getDataStore();
    const productId = Id.parse(formData.get("productId"));
    const scan = await runScan(ds, { maxProducts: 1, productIds: [productId] });
    revalidateDashboard();
    return { ok: true, message: `Re-scanned: ${plural(scan.findingsCount, "open issue")}.` };
  } catch (err) {
    return failure(err);
  }
}

const FindingStatusInput = z.object({
  findingId: Id,
  productId: Id,
  status: z.enum(["open", "dismissed"]),
});

export async function setFindingStatusAction(formData: FormData): Promise<void> {
  const ds = await getDataStore();
  const input = FindingStatusInput.parse(Object.fromEntries(formData));
  await ds.updateFindingStatus(input.findingId, input.status);
  await refreshProductCounters(ds, input.productId);
  revalidateDashboard();
}

const ReferenceInput = z.object({
  productId: Id,
  attributeLabel: z.string().trim().min(1, "Enter the specification name").max(200),
  valueText: z.string().trim().min(1, "Enter the value").max(500),
  sourceUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => !v || /^https?:\/\//i.test(v), "The source link must start with http:// or https://"),
  evidenceText: z.string().trim().max(2000),
});

export async function addManufacturerReferenceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ds = await getDataStore();
    const parsed = ReferenceInput.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join(" ") };
    const input = parsed.data;
    if (!(await ds.getProduct(input.productId))) return { ok: false, message: "Product not found." };
    await ds.addManufacturerReference({
      productId: input.productId,
      attributeLabel: input.attributeLabel,
      valueText: input.valueText,
      sourceUrl: input.sourceUrl || null,
      evidenceText: input.evidenceText || null,
    });
    // Re-scan right away so the findings reflect the new evidence.
    await runScan(ds, { maxProducts: 1, productIds: [input.productId] });
    revalidateDashboard();
    const verified = Boolean(input.sourceUrl || input.evidenceText);
    return {
      ok: true,
      message: verified
        ? "Manufacturer reference saved and product re-scanned."
        : "Saved, but without a source link or quote it will not count as manufacturer-verified.",
    };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteManufacturerReferenceAction(formData: FormData): Promise<void> {
  const ds = await getDataStore();
  const referenceId = Id.parse(formData.get("referenceId"));
  const productId = Id.parse(formData.get("productId"));
  await ds.deleteManufacturerReference(referenceId);
  await runScan(ds, { maxProducts: 1, productIds: [productId] }).catch((err) => {
    if (!(err instanceof ScanInProgressError)) throw err;
  });
  revalidateDashboard();
}

export async function updateStoreNameAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const ds = await getDataStore();
    const name = z.string().trim().min(1).max(200).safeParse(formData.get("name"));
    if (!name.success) return { ok: false, message: "Enter a store name (up to 200 characters)." };
    const store = await ds.getOrCreateStore();
    await ds.updateStore(store.id, { name: name.data });
    revalidateDashboard();
    return { ok: true, message: "Saved." };
  } catch (err) {
    return failure(err);
  }
}
