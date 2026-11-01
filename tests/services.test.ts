import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DemoStore } from "@/lib/data/demo-store";
import { importCsv } from "@/lib/services/import";
import { refreshProductCounters, runScan, ScanInProgressError } from "@/lib/services/scan";

const fitnessking = readFileSync(new URL("./fixtures/fitnessking.csv", import.meta.url), "utf8");

async function setup() {
  const ds = new DemoStore();
  const result = await importCsv(ds, fitnessking);
  const store = await ds.getOrCreateStore();
  return { ds, store, result };
}

describe("import → scan workflow", () => {
  it("imports products and manufacturer references from CSV", async () => {
    const { ds, store, result } = await setup();
    expect(result).toMatchObject({ imported: 4, created: 4, updated: 0, unchanged: 0, referencesAdded: 1 });
    expect(await ds.listProducts(store.id)).toHaveLength(4);
    expect((await ds.getOrCreateStore()).lastImportAt).not.toBeNull();
  });

  it("re-importing the same file changes nothing and adds no duplicate references", async () => {
    const { ds } = await setup();
    const again = await importCsv(ds, fitnessking);
    expect(again).toMatchObject({ imported: 4, created: 0, updated: 0, unchanged: 4, referencesAdded: 0 });
  });

  it("stores findings and product counters after a scan", async () => {
    const { ds, store } = await setup();
    const scan = await runScan(ds, { maxProducts: 500 });
    expect(scan.status).toBe("completed");
    expect(scan.productsScanned).toBe(4);
    expect(scan.findingsCount).toBe(5);
    expect(scan.findingsBySeverity).toEqual({ critical: 0, high: 4, medium: 1, low: 0 });

    const products = await ds.listProducts(store.id);
    const tm4500 = products.find((p) => p.externalId === "fk-christopeit-tm4500s")!;
    expect(tm4500).toMatchObject({ scanStatus: "scanned", openFindingsCount: 2, highestSeverity: "high", category: "treadmill" });
    const bh = products.find((p) => p.externalId === "fk-bh-i-hudson-r325")!;
    const [bhFinding] = await ds.listFindings({ productId: bh.id });
    expect(bhFinding.verificationStatus).toBe("manufacturer_verified");
  });

  it("re-scans update findings instead of duplicating them, and keep dismissals", async () => {
    const { ds, store } = await setup();
    await runScan(ds, { maxProducts: 500 });
    const before = await ds.listFindings({ storeId: store.id });
    const dismissed = before[0];
    await ds.updateFindingStatus(dismissed.id, "dismissed");
    await refreshProductCounters(ds, dismissed.productId);

    const second = await runScan(ds, { maxProducts: 500 });
    const after = await ds.listFindings({ storeId: store.id });
    expect(after).toHaveLength(before.length);
    expect(after.find((f) => f.id === dismissed.id)!.status).toBe("dismissed");
    expect(second.findingsCount).toBe(4); // dismissed findings are not counted as open
  });

  it("marks findings resolved when the product data is fixed", async () => {
    const { ds, store } = await setup();
    await runScan(ds, { maxProducts: 500 });
    // Merchant fixes the DC Athletics description in their next export
    const fixed = fitnessking.replace("De motor levert 2 PK continu vermogen", "De motor levert 1 PK continu vermogen");
    const imp = await importCsv(ds, fixed);
    expect(imp.updated).toBe(1);
    await runScan(ds, { maxProducts: 500 });
    const pacer = (await ds.listProducts(store.id)).find((p) => p.externalId === "fk-dc-athletics-pacer")!;
    const findings = await ds.listFindings({ productId: pacer.id });
    expect(findings.map((f) => f.status)).toEqual(["resolved"]);
    expect(pacer.openFindingsCount).toBe(0);
  });

  it("caps products per scan and reports a partial scan", async () => {
    const { ds, store } = await setup();
    const first = await runScan(ds, { maxProducts: 3 });
    expect(first.status).toBe("partial");
    expect(first.productsScanned).toBe(3);
    expect(first.error).toMatch(/3 of 4/);
    // The next scan picks up the product that was not scanned yet
    await runScan(ds, { maxProducts: 1 });
    const products = await ds.listProducts(store.id);
    expect(products.every((p) => p.scanStatus === "scanned")).toBe(true);
  });

  it("refuses to start a second scan while one is running", async () => {
    const { ds, store } = await setup();
    await ds.createScan(store.id, 4, false);
    await expect(runScan(ds, { maxProducts: 500 })).rejects.toBeInstanceOf(ScanInProgressError);
  });

  it("scanning a single product leaves other products untouched", async () => {
    const { ds, store } = await setup();
    const products = await ds.listProducts(store.id);
    await runScan(ds, { maxProducts: 500, productIds: [products[0].id] });
    const after = await ds.listProducts(store.id);
    expect(after.filter((p) => p.scanStatus === "scanned")).toHaveLength(1);
  });
});
