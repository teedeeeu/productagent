import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { recordToRow } = await import("@/lib/data/supabase-store");
const { DemoStore } = await import("@/lib/data/demo-store");
const { importCsv } = await import("@/lib/services/import");
const { runScan } = await import("@/lib/services/scan");

/**
 * The Supabase store converts camelCase records to snake_case columns. This
 * checks every column the app writes actually exists in the migration, so a
 * typo can't slip through to production unnoticed.
 */
const sql = readFileSync(new URL("../supabase/migrations/20261101000000_initial_schema.sql", import.meta.url), "utf8");

function columns(table: string): Set<string> {
  const m = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
  if (!m) throw new Error(`table ${table} not found`);
  return new Set(
    m[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[a-z_]+ /.test(l) && !/^(unique|primary|constraint|check)\b/.test(l))
      .map((l) => l.split(" ")[0]),
  );
}

function expectColumns(table: string, rec: object) {
  const cols = columns(table);
  const missing = Object.keys(recordToRow(rec)).filter((k) => !cols.has(k));
  expect(missing, `${table} is missing columns`).toEqual([]);
}

describe("record ↔ schema mapping", async () => {
  const ds = new DemoStore();
  await importCsv(ds, readFileSync(new URL("./fixtures/fitnessking.csv", import.meta.url), "utf8"));
  await runScan(ds, { maxProducts: 10 });
  const store = await ds.getOrCreateStore();
  const products = await ds.listProducts(store.id);
  const ids = products.map((p) => p.id);

  it("stores", () => expectColumns("stores", store));
  it("detects unknown columns", () => expect(() => expectColumns("stores", { notAColumn: 1 })).toThrow());
  it("products", () => products.forEach((p) => expectColumns("products", p)));
  it("findings", async () => (await ds.listFindings({ storeId: store.id })).forEach((f) => expectColumns("findings", f)));
  it("scans", async () => (await ds.listScans(store.id, 5)).forEach((s) => expectColumns("scans", s)));
  it("manufacturer_references", async () =>
    (await ds.listManufacturerReferences(ids)).forEach((r) => expectColumns("manufacturer_references", { ...r, enteredBy: "x" })));
  it("product_attributes", () =>
    expectColumns("product_attributes", {
      organizationId: "x", productId: "x", scanId: "x", attributeKey: "x", valueNumber: 1, valueBoolean: true,
      valueText: "x", sourceField: "x", sourceKey: "x", snippet: "x", certainty: "explicit",
    }));
});
