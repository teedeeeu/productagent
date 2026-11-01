import type {
  Confidence,
  Evidence,
  IssueType,
  KeyValue,
  Severity,
  SuggestedCorrection,
  VariantInput,
  VerificationStatus,
} from "@/lib/scanner/types";

/**
 * Records as stored in the database (camelCase here, snake_case in Postgres).
 * Every record belongs to one organization; DataStore implementations scope
 * all reads and writes to the signed-in user's organization.
 */

export interface StoreRecord {
  id: string;
  organizationId: string;
  name: string;
  platform: "csv" | "shopify";
  shopDomain: string | null;
  connectionStatus: "not_connected" | "connected" | "error" | "disconnected";
  connectedAt: string | null;
  lastImportAt: string | null;
  createdAt: string;
}

export interface ProductRecord {
  id: string;
  organizationId: string;
  storeId: string;
  externalId: string;
  title: string;
  descriptionHtml: string;
  vendor: string | null;
  productType: string | null;
  productUrl: string | null;
  category: string;
  specifications: KeyValue[];
  metafields: KeyValue[];
  variants: VariantInput[];
  manufacturerUrl: string | null;
  contentHash: string | null;
  importSource: "csv" | "shopify";
  scanStatus: "not_scanned" | "scanned" | "error";
  lastScannedAt: string | null;
  openFindingsCount: number;
  highestSeverity: Severity | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManufacturerReferenceRecord {
  id: string;
  organizationId: string;
  productId: string;
  attributeLabel: string;
  valueText: string;
  sourceUrl: string | null;
  evidenceText: string | null;
  createdAt: string;
}

export type ScanStatus = "running" | "completed" | "partial" | "failed";

export interface ScanRecord {
  id: string;
  organizationId: string;
  storeId: string;
  status: ScanStatus;
  productsTotal: number;
  productsScanned: number;
  productsWithIssues: number;
  findingsCount: number;
  findingsBySeverity: Record<Severity, number>;
  llmCalls: number;
  llmEnabled: boolean;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export type FindingStatus = "open" | "dismissed" | "resolved";

export interface FindingRecord {
  id: string;
  organizationId: string;
  storeId: string;
  productId: string;
  firstSeenScanId: string | null;
  lastSeenScanId: string | null;
  fingerprint: string;
  issueType: IssueType;
  severity: Severity;
  confidence: Confidence;
  verificationStatus: VerificationStatus;
  attributes: string[];
  title: string;
  evidence: Evidence[];
  explanation: string;
  recommendedAction: string;
  suggestedCorrections: SuggestedCorrection[];
  detector: "rules" | "llm";
  status: FindingStatus;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductAttributeRecord {
  productId: string;
  scanId: string | null;
  attributeKey: string;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueText: string | null;
  sourceField: string;
  sourceKey: string | null;
  snippet: string;
  certainty: "explicit" | "inferred";
}

/** Fields the importer supplies; the store fills ids, org, timestamps and scan state. */
export type ProductImport = Pick<
  ProductRecord,
  | "externalId"
  | "title"
  | "descriptionHtml"
  | "vendor"
  | "productType"
  | "productUrl"
  | "specifications"
  | "metafields"
  | "variants"
  | "manufacturerUrl"
  | "contentHash"
  | "importSource"
>;

export type NewManufacturerReference = Pick<
  ManufacturerReferenceRecord,
  "productId" | "attributeLabel" | "valueText" | "sourceUrl" | "evidenceText"
>;

export interface Viewer {
  userId: string;
  organizationId: string;
  email: string | null;
}

/**
 * Data access for the signed-in merchant. Two implementations:
 *  - SupabaseStore: production. Uses the user's session, so Postgres
 *    row-level security enforces tenant isolation.
 *  - DemoStore: local development without Supabase (single demo merchant).
 */
export interface DataStore {
  readonly mode: "supabase" | "demo";
  readonly viewer: Viewer;

  getOrCreateStore(): Promise<StoreRecord>;
  updateStore(id: string, patch: Partial<Pick<StoreRecord, "name" | "lastImportAt">>): Promise<void>;

  listProducts(storeId: string): Promise<ProductRecord[]>;
  getProduct(id: string): Promise<ProductRecord | null>;
  /** Insert new products / update existing ones (matched on storeId + externalId). */
  upsertProducts(storeId: string, rows: ProductImport[]): Promise<void>;
  /** Persist scan state for products (full records, matched on id). */
  saveProducts(rows: ProductRecord[]): Promise<void>;

  replaceProductAttributes(productIds: string[], rows: ProductAttributeRecord[]): Promise<void>;

  listManufacturerReferences(productIds: string[]): Promise<ManufacturerReferenceRecord[]>;
  addManufacturerReference(ref: NewManufacturerReference): Promise<void>;
  deleteManufacturerReference(id: string): Promise<void>;

  createScan(storeId: string, productsTotal: number, llmEnabled: boolean): Promise<ScanRecord>;
  updateScan(id: string, patch: Partial<Omit<ScanRecord, "id" | "organizationId" | "storeId">>): Promise<void>;
  listScans(storeId: string, limit: number): Promise<ScanRecord[]>;

  listFindings(filter: { storeId?: string; productId?: string; productIds?: string[] }): Promise<FindingRecord[]>;
  /** Insert or update findings (matched on id). */
  saveFindings(rows: FindingRecord[]): Promise<void>;
  updateFindingStatus(id: string, status: FindingStatus): Promise<void>;
}
