import Papa from "papaparse";
import { z } from "zod";
import type { KeyValue, ManufacturerReference, ProductInput, VariantInput } from "@/lib/scanner/types";

/**
 * CSV import. Two formats are accepted and detected automatically:
 *
 * 1. "Simple" format (see public/samples/example-products.csv):
 *    product_id, title, description, vendor, product_type, product_url,
 *    variants, metafields, specifications, manufacturer_url,
 *    manufacturer_specifications
 *
 * 2. Shopify's own product export (Products → Export in Shopify admin):
 *    Handle, Title, Body (HTML), Vendor, Type, Option1 Value, …, and
 *    metafield columns such as "Max weight (product.metafields.custom.max_weight)".
 *    This lets merchants try the scanner without connecting their store.
 */

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_PRODUCTS = 5000;

export interface CsvRowError {
  row: number;
  message: string;
}

export interface CsvParseResult {
  format: "simple" | "shopify_export";
  products: ProductInput[];
  errors: CsvRowError[];
}

const ALIASES: Record<string, string[]> = {
  externalId: ["product_id", "id", "productid", "handle", "sku"],
  title: ["title", "product_title", "name", "product_name"],
  description: ["description", "body_html", "body", "description_html", "body_html_"],
  vendor: ["vendor", "manufacturer", "brand"],
  productType: ["product_type", "type", "category", "producttype"],
  url: ["product_url", "url", "link"],
  variants: ["variants", "variant"],
  metafields: ["metafields", "metafield"],
  specifications: ["specifications", "specs", "specificaties", "specification"],
  manufacturerUrl: ["manufacturer_url", "manufacturer_link"],
  manufacturerSpecs: ["manufacturer_specifications", "manufacturer_specs", "verified_manufacturer_specifications"],
};

function normHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const RowSchema = z.object({
  externalId: z.string().trim().min(1, "Product ID is required").max(255),
  title: z.string().trim().min(1, "Title is required").max(500),
  description: z.string().max(200_000, "Description is too long").default(""),
  vendor: z.string().max(255).optional(),
  productType: z.string().max(255).optional(),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => !v || /^https?:\/\//i.test(v), "Product URL must start with http:// or https://")
    .optional(),
  manufacturerUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => !v || /^https?:\/\//i.test(v), "Manufacturer URL must start with http:// or https://")
    .optional(),
});

/**
 * Parse "Label: value | Label: value" (or one per line), or JSON:
 * {"Label": "value"} or [{"key": "Label", "value": "value"}].
 */
export function parseKeyValues(raw: string | undefined): KeyValue[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      const data: unknown = JSON.parse(s);
      if (Array.isArray(data)) {
        return data
          .map((d) => {
            const o = d as Record<string, unknown>;
            const key = String(o.key ?? o.name ?? o.label ?? "");
            const ns = o.namespace ? `${String(o.namespace)}.` : "";
            return { key: key ? `${ns}${key}` : "", value: String(o.value ?? "") };
          })
          .filter((kv) => kv.key && kv.value);
      }
      if (data && typeof data === "object") {
        return Object.entries(data as Record<string, unknown>)
          .filter(([, v]) => v !== null && v !== undefined && String(v).trim())
          .map(([k, v]) => ({ key: k, value: typeof v === "object" ? JSON.stringify(v) : String(v) }));
      }
    } catch {
      // fall through to text parsing
    }
  }
  return s
    .split(/\r?\n|\s*\|\s*/)
    .map((part) => {
      const i = part.indexOf(":");
      if (i <= 0) return null;
      return { key: part.slice(0, i).trim(), value: part.slice(i + 1).trim() };
    })
    .filter((kv): kv is KeyValue => Boolean(kv && kv.key && kv.value));
}

export function parseVariants(raw: string | undefined): VariantInput[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const data = JSON.parse(s) as unknown[];
      return data
        .map((d) => {
          const o = d as Record<string, unknown>;
          const options =
            o.options && typeof o.options === "object" && !Array.isArray(o.options)
              ? Object.fromEntries(Object.entries(o.options as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
              : undefined;
          return { title: String(o.title ?? o.name ?? ""), sku: o.sku ? String(o.sku) : undefined, options };
        })
        .filter((v) => v.title);
    } catch {
      // fall through
    }
  }
  return s
    .split(/\r?\n|\s*\|\s*/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((title) => ({ title }));
}

function pick(row: Record<string, string>, field: keyof typeof ALIASES): string | undefined {
  for (const alias of ALIASES[field]) {
    const v = row[alias];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return undefined;
}

function zodMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

function parseSimple(rows: Record<string, string>[], errors: CsvRowError[]): ProductInput[] {
  const products: ProductInput[] = [];
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const rowNumber = i + 2; // header is row 1
    const parsed = RowSchema.safeParse({
      externalId: pick(row, "externalId") ?? "",
      title: pick(row, "title") ?? "",
      description: pick(row, "description") ?? "",
      vendor: pick(row, "vendor"),
      productType: pick(row, "productType"),
      url: pick(row, "url"),
      manufacturerUrl: pick(row, "manufacturerUrl"),
    });
    if (!parsed.success) {
      errors.push({ row: rowNumber, message: zodMessage(parsed.error) });
      return;
    }
    const d = parsed.data;
    if (seen.has(d.externalId)) {
      errors.push({ row: rowNumber, message: `Duplicate product ID “${d.externalId}” — row skipped` });
      return;
    }
    seen.add(d.externalId);
    const manufacturerReferences: ManufacturerReference[] = parseKeyValues(pick(row, "manufacturerSpecs")).map(
      (kv) => ({ key: kv.key, value: kv.value, sourceUrl: d.manufacturerUrl || undefined }),
    );
    products.push({
      externalId: d.externalId,
      title: d.title,
      descriptionHtml: d.description,
      vendor: d.vendor,
      productType: d.productType,
      url: d.url || undefined,
      specifications: parseKeyValues(pick(row, "specifications")),
      metafields: parseKeyValues(pick(row, "metafields")),
      variants: parseVariants(pick(row, "variants")),
      manufacturerUrl: d.manufacturerUrl || undefined,
      manufacturerReferences,
    });
  });
  return products;
}

function parseShopifyExport(
  headers: string[],
  rows: Record<string, string>[],
  errors: CsvRowError[],
): ProductInput[] {
  const metafieldCols = headers
    .map((h) => {
      const m = /^(.*?)\s*\(product\.metafields\.([^)]+)\)\s*$/i.exec(h);
      return m ? { header: h, label: m[1].trim() || m[2], key: m[2] } : null;
    })
    .filter((x): x is { header: string; label: string; key: string } => Boolean(x));

  const byHandle = new Map<string, { first: number; rows: Record<string, string>[] }>();
  rows.forEach((row, i) => {
    const handle = (row["Handle"] ?? "").trim();
    if (!handle) {
      errors.push({ row: i + 2, message: "Missing Handle — row skipped" });
      return;
    }
    const entry = byHandle.get(handle) ?? { first: i + 2, rows: [] };
    entry.rows.push(row);
    byHandle.set(handle, entry);
  });

  const products: ProductInput[] = [];
  for (const [handle, { first, rows: group }] of byHandle) {
    const main = group.find((r) => (r["Title"] ?? "").trim()) ?? group[0];
    const title = (main["Title"] ?? "").trim();
    if (!title) {
      errors.push({ row: first, message: `Product “${handle}” has no Title — skipped` });
      continue;
    }
    const variants: VariantInput[] = [];
    for (const r of group) {
      const options: Record<string, string> = {};
      const values: string[] = [];
      for (const n of [1, 2, 3]) {
        const name = (r[`Option${n} Name`] || main[`Option${n} Name`] || "").trim();
        const value = (r[`Option${n} Value`] ?? "").trim();
        if (value) {
          values.push(value);
          if (name) options[name] = value;
        }
      }
      if (values.length && values.join(" / ") !== "Default Title")
        variants.push({ title: values.join(" / "), sku: r["Variant SKU"] || undefined, options });
    }
    const metafields: KeyValue[] = metafieldCols
      .map((c) => ({ key: c.label, value: (main[c.header] ?? "").trim() }))
      .filter((kv) => kv.value);
    products.push({
      externalId: handle,
      title,
      descriptionHtml: main["Body (HTML)"] ?? "",
      vendor: main["Vendor"] || undefined,
      productType: main["Type"] || main["Product Category"] || undefined,
      url: undefined,
      specifications: [],
      metafields,
      variants,
      manufacturerReferences: [],
    });
  }
  return products;
}

export function parseProductCsv(text: string): CsvParseResult {
  const errors: CsvRowError[] = [];
  const result = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
  });
  for (const e of result.errors.slice(0, 20)) {
    errors.push({ row: (e.row ?? 0) + 2, message: `CSV format problem: ${e.message}` });
  }
  const headers = result.meta.fields ?? [];
  const isShopify = headers.includes("Handle") && headers.includes("Body (HTML)");

  let products: ProductInput[];
  if (isShopify) {
    products = parseShopifyExport(headers, result.data, errors);
  } else {
    const rows = result.data.map((r) => {
      const o: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) o[normHeader(k)] = v ?? "";
      return o;
    });
    if (!headers.map(normHeader).some((h) => ALIASES.title.includes(h))) {
      return {
        format: "simple",
        products: [],
        errors: [{ row: 1, message: "No “title” column found. Download the example CSV to see the expected columns." }],
      };
    }
    products = parseSimple(rows, errors);
  }

  if (products.length > MAX_CSV_PRODUCTS) {
    errors.push({ row: 0, message: `Only the first ${MAX_CSV_PRODUCTS} products were imported.` });
    products = products.slice(0, MAX_CSV_PRODUCTS);
  }
  return { format: isShopify ? "shopify_export" : "simple", products, errors };
}
