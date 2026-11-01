import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
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
 * Production data store. Uses the signed-in user's Supabase session, so all
 * access is checked by Postgres row-level security. Transient network or
 * server errors are retried with backoff; large writes are chunked.
 */

type Row = Record<string, unknown>;

export const toSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function rowToRecord<T>(row: Row): T {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v])) as T;
}
export function recordToRow(rec: object): Row {
  return Object.fromEntries(
    Object.entries(rec)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [toSnake(k), v]),
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface PgResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
  status: number;
}

export class DataAccessError extends Error {}

/** Run a query, retrying transient failures (network errors, 5xx, 429). */
async function q<T>(label: string, fn: () => PromiseLike<PgResult<T>>, attempts = 3): Promise<T> {
  let last: PgResult<T> | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      last = await fn();
    } catch (err) {
      last = { data: null, error: { message: err instanceof Error ? err.message : String(err) }, status: 0 };
    }
    if (!last.error) return last.data as T;
    const transient = last.status === 0 || last.status === 429 || last.status >= 500;
    if (!transient) break;
    await new Promise((r) => setTimeout(r, 300 * 2 ** i));
  }
  console.error(`[data] ${label} failed`, last?.error);
  throw new DataAccessError(`Could not ${label}. Please try again.`);
}

export class SupabaseStore implements DataStore {
  readonly mode = "supabase" as const;

  constructor(
    private readonly db: SupabaseClient,
    readonly viewer: Viewer,
  ) {}

  async getOrCreateStore(): Promise<StoreRecord> {
    const rows = await q<Row[]>("load store", () =>
      this.db.from("stores").select("*").order("created_at").limit(1),
    );
    if (rows.length) return rowToRecord<StoreRecord>(rows[0]);
    const created = await q<Row>("create store", () =>
      this.db
        .from("stores")
        .insert({ organization_id: this.viewer.organizationId, name: "My store" })
        .select()
        .single(),
    );
    return rowToRecord<StoreRecord>(created);
  }

  async updateStore(id: string, patch: Partial<Pick<StoreRecord, "name" | "lastImportAt">>) {
    await q("update store", () => this.db.from("stores").update(recordToRow(patch)).eq("id", id));
  }

  async listProducts(storeId: string) {
    const all: ProductRecord[] = [];
    // Page through results (PostgREST returns at most 1000 rows per request).
    for (let from = 0; ; from += 1000) {
      const rows = await q<Row[]>("load products", () =>
        this.db.from("products").select("*").eq("store_id", storeId).order("title").range(from, from + 999),
      );
      all.push(...rows.map((r) => rowToRecord<ProductRecord>(r)));
      if (rows.length < 1000) break;
    }
    return all;
  }

  async getProduct(id: string) {
    const row = await q<Row | null>("load product", () =>
      this.db.from("products").select("*").eq("id", id).maybeSingle(),
    );
    return row ? rowToRecord<ProductRecord>(row) : null;
  }

  async upsertProducts(storeId: string, rows: ProductImport[]) {
    for (const part of chunk(rows, 200)) {
      const payload = part.map((r) =>
        recordToRow({ ...r, storeId, organizationId: this.viewer.organizationId }),
      );
      await q("save products", () =>
        this.db.from("products").upsert(payload, { onConflict: "store_id,external_id" }),
      );
    }
  }

  async saveProducts(rows: ProductRecord[]) {
    for (const part of chunk(rows, 200)) {
      const payload = part.map(({ createdAt: _c, updatedAt: _u, ...r }) => recordToRow(r));
      await q("save products", () => this.db.from("products").upsert(payload, { onConflict: "id" }));
    }
  }

  async replaceProductAttributes(productIds: string[], rows: ProductAttributeRecord[]) {
    for (const ids of chunk(productIds, 200)) {
      await q("clear attributes", () => this.db.from("product_attributes").delete().in("product_id", ids));
    }
    for (const part of chunk(rows, 500)) {
      const payload = part.map((r) => recordToRow({ ...r, organizationId: this.viewer.organizationId }));
      await q("save attributes", () => this.db.from("product_attributes").insert(payload));
    }
  }

  async listManufacturerReferences(productIds: string[]) {
    const out: ManufacturerReferenceRecord[] = [];
    for (const ids of chunk(productIds, 200)) {
      const rows = await q<Row[]>("load manufacturer references", () =>
        this.db.from("manufacturer_references").select("*").in("product_id", ids).order("created_at"),
      );
      out.push(...rows.map((r) => rowToRecord<ManufacturerReferenceRecord>(r)));
    }
    return out;
  }

  async addManufacturerReference(ref: NewManufacturerReference) {
    await q("save manufacturer reference", () =>
      this.db.from("manufacturer_references").insert(
        recordToRow({ ...ref, organizationId: this.viewer.organizationId, enteredBy: this.viewer.userId }),
      ),
    );
  }

  async deleteManufacturerReference(id: string) {
    await q("delete manufacturer reference", () => this.db.from("manufacturer_references").delete().eq("id", id));
  }

  async createScan(storeId: string, productsTotal: number, llmEnabled: boolean) {
    const row = await q<Row>("start scan", () =>
      this.db
        .from("scans")
        .insert({
          organization_id: this.viewer.organizationId,
          store_id: storeId,
          products_total: productsTotal,
          llm_enabled: llmEnabled,
          created_by: this.viewer.userId,
        })
        .select()
        .single(),
    );
    return rowToRecord<ScanRecord>(row);
  }

  async updateScan(id: string, patch: Partial<ScanRecord>) {
    await q("update scan", () => this.db.from("scans").update(recordToRow(patch)).eq("id", id));
  }

  async listScans(storeId: string, limit: number) {
    const rows = await q<Row[]>("load scans", () =>
      this.db.from("scans").select("*").eq("store_id", storeId).order("started_at", { ascending: false }).limit(limit),
    );
    return rows.map((r) => rowToRecord<ScanRecord>(r));
  }

  async listFindings(filter: { storeId?: string; productId?: string; productIds?: string[] }) {
    const run = async (ids?: string[]) => {
      const out: FindingRecord[] = [];
      for (let from = 0; ; from += 1000) {
        const rows = await q<Row[]>("load findings", () => {
          let query = this.db.from("findings").select("*");
          if (filter.storeId) query = query.eq("store_id", filter.storeId);
          if (filter.productId) query = query.eq("product_id", filter.productId);
          if (ids) query = query.in("product_id", ids);
          return query.order("created_at").range(from, from + 999);
        });
        out.push(...rows.map((r) => rowToRecord<FindingRecord>(r)));
        if (rows.length < 1000) break;
      }
      return out;
    };
    if (!filter.productIds) return run();
    const out: FindingRecord[] = [];
    for (const ids of chunk(filter.productIds, 200)) out.push(...(await run(ids)));
    return out;
  }

  async saveFindings(rows: FindingRecord[]) {
    for (const part of chunk(rows, 200)) {
      const payload = part.map(({ updatedAt: _u, ...r }) => recordToRow(r));
      await q("save findings", () => this.db.from("findings").upsert(payload, { onConflict: "id" }));
    }
  }

  async updateFindingStatus(id: string, status: FindingStatus) {
    await q("update finding", () =>
      this.db
        .from("findings")
        .update({ status, reviewed_at: new Date().toISOString(), reviewed_by: this.viewer.userId })
        .eq("id", id),
    );
  }
}
