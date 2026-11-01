/**
 * Core types for the product-data scanner.
 *
 * The scanner is a pure library: it takes product data in, and returns
 * findings out. It never talks to the database, Shopify, or the network,
 * which keeps it fast, cheap, and easy to test.
 */

export interface KeyValue {
  key: string;
  value: string;
}

export interface VariantInput {
  title: string;
  sku?: string;
  options?: Record<string, string>;
}

/** A specification the merchant entered from manufacturer documentation. */
export interface ManufacturerReference {
  key: string;
  value: string;
  /** Link to the manufacturer page/PDF that supports the value. */
  sourceUrl?: string;
  /** Exact quote from the manufacturer's documentation. */
  evidenceText?: string;
}

/** Normalized product, independent of where it was imported from. */
export interface ProductInput {
  externalId: string;
  title: string;
  descriptionHtml: string;
  vendor?: string;
  productType?: string;
  url?: string;
  specifications: KeyValue[];
  metafields: KeyValue[];
  variants: VariantInput[];
  manufacturerUrl?: string;
  manufacturerReferences: ManufacturerReference[];
}

export type SourceField =
  | "title"
  | "description"
  | "specifications"
  | "metafield"
  | "variant"
  | "manufacturer";

export interface Source {
  field: SourceField;
  /** Spec label, metafield key, or variant title. */
  key?: string;
  url?: string;
}

export type Dimension = "mass" | "length" | "speed" | "power" | "percent";

export type AttrValue =
  | { kind: "number"; dimension: Dimension; base: number; display: string }
  | { kind: "boolean"; value: boolean; display: string }
  | { kind: "enum"; values: string[]; display: string }
  | { kind: "present"; display: string };

export interface Extraction {
  attribute: string;
  value: AttrValue;
  /** The exact text the value was read from (sentence or "Label: value"). */
  snippet: string;
  source: Source;
  /** How directly the text states the value. */
  certainty: "explicit" | "inferred";
  /** Manufacturer reference only: whether supporting evidence was supplied. */
  hasEvidence?: boolean;
}

export type IssueType =
  | "contradiction"
  | "missing_attribute"
  | "ambiguous"
  | "misleading";

export type Severity = "critical" | "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low";
export type VerificationStatus =
  | "unverified"
  | "needs_verification"
  | "manufacturer_verified";

export interface Evidence {
  source: Source;
  /** Human-readable source label, e.g. "Specifications › Continu vermogen". */
  sourceLabel: string;
  text: string;
  value?: string;
}

export interface SuggestedCorrection {
  source: Source;
  sourceLabel: string;
  currentValue: string;
  suggestedValue: string;
  /** Corrections are only ever suggested on the basis of supplied evidence. */
  basis: "manufacturer_reference";
}

export interface Finding {
  productId: string;
  productTitle: string;
  issueType: IssueType;
  severity: Severity;
  attributes: string[];
  title: string;
  evidence: Evidence[];
  explanation: string;
  recommendedAction: string;
  suggestedCorrections: SuggestedCorrection[];
  confidence: Confidence;
  verificationStatus: VerificationStatus;
  detector: "rules" | "llm";
  /** Stable id used to deduplicate findings across rules and across scans. */
  fingerprint: string;
}

export type Category =
  | "treadmill"
  | "walking_pad"
  | "rowing_machine"
  | "exercise_bike"
  | "cross_trainer"
  | "unknown";

export interface ProductScanResult {
  productId: string;
  category: Category;
  extractions: Extraction[];
  findings: Finding[];
}
