import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  DataStore,
  FindingRecord,
  FindingStatus,
  ManufacturerReferenceRecord,
  NewManufacturerReference,
  ProductAttributeRecord,
  ProductImport,
  ProductRecord,
  ScanRecord,
  StoreRecord,
  Viewer,
} from "./types";

/**
 * Local demo data store: one merchant, data kept in memory and (optionally)
 * saved to a JSON file so it survives restarts of `npm run dev`.
 * Used when Supabase is not configured, and in automated tests.
 * Never used in production (see src/lib/env.ts).
 */

interface State {
  stores: StoreRecord[];
  products: ProductRecord[];
  attributes: ProductAttributeRecord[];
  references: ManufacturerReferenceRecord[];
  scans: ScanRecord[];
  findings: FindingRecord[];
}

const empty = (): State => ({ stores: [], products: [], attributes: [], references: [], scans: [], findings: [] });

export const DEMO_VIEWER: Viewer = {
  userId: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  email: "demo@localhost",
};

const now = () => new Date().toISOString();
const clone = <T>(v: T): T => structuredClone(v);

export class DemoStore implements DataStore {
  readonly mode = "demo" as const;
  readonly viewer = DEMO_VIEWER;
  private state: State;

  constructor(private readonly filePath?: string) {
    this.state = empty();
    if (filePath && existsSync(filePath)) {
      try {
        this.state = { ...empty(), ...(JSON.parse(readFileSync(filePath, "utf8")) as State) };
      } catch {
        this.state = empty();
      }
    }
  }

  private persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state));
    renameSync(tmp, this.filePath);
  }

  async getOrCreateStore(): Promise<StoreRecord> {
    let store = this.state.stores[0];
    if (!store) {
      store = {
        id: randomUUID(),
        organizationId: this.viewer.organizationId,
        name: "Demo store",
        platform: "csv",
        shopDomain: null,
        connectionStatus: "not_connected",
        connectedAt: null,
        lastImportAt: null,
        createdAt: now(),
      };
      this.state.stores.push(store);
      this.persist();
    }
    return clone(store);
  }

  async updateStore(id: string, patch: Partial<Pick<StoreRecord, "name" | "lastImportAt">>) {
    const s = this.state.stores.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
    this.persist();
  }

  async listProducts(storeId: string) {
    return clone(this.state.products.filter((p) => p.storeId === storeId));
  }

  async getProduct(id: string) {
    const p = this.state.products.find((x) => x.id === id);
    return p ? clone(p) : null;
  }

  async upsertProducts(storeId: string, rows: ProductImport[]) {
    for (const row of rows) {
      const existing = this.state.products.find((p) => p.storeId === storeId && p.externalId === row.externalId);
      if (existing) {
        Object.assign(existing, clone(row), { updatedAt: now() });
      } else {
        this.state.products.push({
          ...clone(row),
          id: randomUUID(),
          organizationId: this.viewer.organizationId,
          storeId,
          category: "unknown",
          scanStatus: "not_scanned",
          lastScannedAt: null,
          openFindingsCount: 0,
          highestSeverity: null,
          createdAt: now(),
          updatedAt: now(),
        });
      }
    }
    this.persist();
  }

  async saveProducts(rows: ProductRecord[]) {
    for (const row of rows) {
      const i = this.state.products.findIndex((p) => p.id === row.id);
      if (i >= 0) this.state.products[i] = { ...clone(row), updatedAt: now() };
    }
    this.persist();
  }

  async replaceProductAttributes(productIds: string[], rows: ProductAttributeRecord[]) {
    const ids = new Set(productIds);
    this.state.attributes = this.state.attributes.filter((a) => !ids.has(a.productId)).concat(clone(rows));
    this.persist();
  }

  async listManufacturerReferences(productIds: string[]) {
    const ids = new Set(productIds);
    return clone(this.state.references.filter((r) => ids.has(r.productId)));
  }

  async addManufacturerReference(ref: NewManufacturerReference) {
    if (!this.state.products.some((p) => p.id === ref.productId)) throw new Error("Product not found");
    this.state.references.push({
      ...clone(ref),
      id: randomUUID(),
      organizationId: this.viewer.organizationId,
      createdAt: now(),
    });
    this.persist();
  }

  async deleteManufacturerReference(id: string) {
    this.state.references = this.state.references.filter((r) => r.id !== id);
    this.persist();
  }

  async createScan(storeId: string, productsTotal: number, llmEnabled: boolean): Promise<ScanRecord> {
    const scan: ScanRecord = {
      id: randomUUID(),
      organizationId: this.viewer.organizationId,
      storeId,
      status: "running",
      productsTotal,
      productsScanned: 0,
      productsWithIssues: 0,
      findingsCount: 0,
      findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      llmCalls: 0,
      llmEnabled,
      error: null,
      startedAt: now(),
      finishedAt: null,
    };
    this.state.scans.push(scan);
    this.persist();
    return clone(scan);
  }

  async updateScan(id: string, patch: Partial<ScanRecord>) {
    const s = this.state.scans.find((x) => x.id === id);
    if (s) Object.assign(s, clone(patch));
    this.persist();
  }

  async listScans(storeId: string, limit: number) {
    return clone(
      this.state.scans
        .filter((s) => s.storeId === storeId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit),
    );
  }

  async listFindings(filter: { storeId?: string; productId?: string; productIds?: string[] }) {
    const ids = filter.productIds ? new Set(filter.productIds) : null;
    return clone(
      this.state.findings.filter(
        (f) =>
          (!filter.storeId || f.storeId === filter.storeId) &&
          (!filter.productId || f.productId === filter.productId) &&
          (!ids || ids.has(f.productId)),
      ),
    );
  }

  async saveFindings(rows: FindingRecord[]) {
    for (const row of rows) {
      const i = this.state.findings.findIndex((f) => f.id === row.id);
      if (i >= 0) this.state.findings[i] = clone(row);
      else this.state.findings.push(clone(row));
    }
    this.persist();
  }

  async updateFindingStatus(id: string, status: FindingStatus) {
    const f = this.state.findings.find((x) => x.id === id);
    if (f) Object.assign(f, { status, reviewedAt: now(), updatedAt: now() });
    this.persist();
  }
}
