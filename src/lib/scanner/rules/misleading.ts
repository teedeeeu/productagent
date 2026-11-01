import { baseFinding, evidenceFrom, fingerprint, sourceLabel } from "../findings";
import { isDifferentModel, parseModelTokens, type ModelToken } from "../models";
import { htmlToText, splitSentences, truncate } from "../text";
import type { Evidence, Extraction, Finding, ProductInput, Source } from "../types";

/**
 * Misleading-information rule: the product data refers to a different model
 * than the title. (Variant values that contradict the main product are
 * reported by the contradiction rule with issue type "misleading".)
 */

const COMPARISON = /(opvolger|voorganger|vergeleken|vergelijk|in\s+plaats\s+van|ten\s+opzichte\s+van|successor|predecessor|compared|replaces|vervangt|upgrade\s+van|than\s+the)/i;

export function detectMisleading(product: ProductInput, extractions: Extraction[]): Finding[] {
  const titleTokens = parseModelTokens(product.title);
  if (!titleTokens.length) return [];
  const findings: Finding[] = [];
  const titleNorm = new Set(titleTokens.map((t) => t.normalized));
  const conflictsWithTitle = (t: ModelToken) =>
    !titleNorm.has(t.normalized) && titleTokens.some((tt) => isDifferentModel(tt, t));
  const titleEvidence: Evidence = {
    source: { field: "title", url: product.url },
    sourceLabel: "Title",
    text: product.title,
  };

  // 1. An explicit "Model" field that names a different model than the title.
  const modelFields = extractions.filter(
    (e) => e.attribute === "model" && e.source.field !== "manufacturer" && e.value.kind === "enum",
  );
  const badModelFields = modelFields.filter((e) =>
    parseModelTokens(e.value.display).some(conflictsWithTitle),
  );
  if (badModelFields.length) {
    findings.push(
      baseFinding(product, {
        issueType: "misleading",
        severity: "high",
        attributes: ["model"],
        title: "Title and specifications name different models",
        evidence: [titleEvidence, ...badModelFields.map(evidenceFrom)],
        explanation: `The title names ${titleTokens.map((t) => t.raw).join(", ")}, but ${badModelFields
          .map((e) => `${sourceLabel(e.source)} says ${e.value.display}`)
          .join("; ")}. A shopping assistant may mix up specifications of two different models.`,
        recommendedAction:
          "Confirm which model is actually sold, then correct the title or the model field. Check that the other specifications belong to the same model.",
        confidence: "high",
        verificationStatus: "unverified",
        fingerprint: fingerprint(product.externalId, "misleading", ["model"], "model-field"),
      }),
    );
  }

  // 2. Description or specs mentioning another model with the same prefix.
  const texts: { text: string; source: Source }[] = [
    ...splitSentences(htmlToText(product.descriptionHtml)).map((s) => ({
      text: s,
      source: { field: "description" as const, url: product.url },
    })),
    ...product.specifications
      .filter((kv) => !/^(model|type)/i.test(kv.key))
      .map((kv) => ({ text: `${kv.key}: ${kv.value}`, source: { field: "specifications" as const, key: kv.key, url: product.url } })),
  ];
  const mentions: { text: string; source: Source; tokens: ModelToken[]; comparison: boolean }[] = [];
  for (const t of texts) {
    const tokens = parseModelTokens(t.text).filter(conflictsWithTitle);
    if (tokens.length) mentions.push({ ...t, tokens, comparison: COMPARISON.test(t.text) });
  }
  if (mentions.length) {
    const allComparisons = mentions.every((m) => m.comparison);
    const others = [...new Set(mentions.flatMap((m) => m.tokens.map((t) => t.raw)))];
    findings.push(
      baseFinding(product, {
        issueType: "misleading",
        severity: allComparisons ? "low" : "medium",
        attributes: ["model"],
        title: "Product text references a different model number",
        evidence: [
          titleEvidence,
          ...mentions.map((m) => ({ source: m.source, sourceLabel: sourceLabel(m.source), text: truncate(m.text) })),
        ],
        explanation: `The title is ${titleTokens.map((t) => t.raw).join(", ")}, but the text also mentions ${others.join(", ")}. ${
          allComparisons
            ? "It appears to be a comparison, but assistants can still attribute the other model's specifications to this product."
            : "This often happens when a description is copied from an older or related model, and the specifications may belong to that model."
        }`,
        recommendedAction: `Check whether the text about ${others.join(", ")} applies to this product. Remove or rewrite references to other models, and confirm the specifications match ${titleTokens[0].raw}.`,
        confidence: "medium",
        verificationStatus: "needs_verification",
        fingerprint: fingerprint(product.externalId, "misleading", ["model"], "mention"),
      }),
    );
  }

  return findings;
}
