import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProductCsv } from "@/lib/import/csv";
import { scanProduct, type Finding, type ProductInput } from "@/lib/scanner";

/**
 * FitnessKing regression cases from the product brief. The CSV is scanned
 * end-to-end. A second pass renames every product so we know detection comes
 * from the data, not from product names.
 */

const csv = readFileSync(new URL("./fixtures/fitnessking.csv", import.meta.url), "utf8");
const { products, errors } = parseProductCsv(csv);

function byId(id: string): ProductInput {
  const p = products.find((x) => x.externalId === id);
  if (!p) throw new Error(`fixture ${id} missing`);
  return p;
}

/** Strip brand and model names everywhere, keeping the data itself. */
function anonymise(p: ProductInput): ProductInput {
  const scrub = (s: string) =>
    s.replace(/DC Athletics|Christopeit|BH Fitness|i\.Hudson|Pacer|TM4500s|TM750s|R325/gi, "Product");
  return {
    ...p,
    externalId: `anon-${p.externalId}`,
    title: scrub(p.title),
    vendor: "Anonymous",
    descriptionHtml: scrub(p.descriptionHtml),
  };
}

const contradictionsFor = (findings: Finding[], attribute: string) =>
  findings.filter((f) => f.issueType === "contradiction" && f.attributes.includes(attribute));

describe.each([
  ["original", (p: ProductInput) => p],
  ["anonymised", anonymise],
])("FitnessKing regression (%s data)", (_label, transform) => {
  it("imports all fixture rows without errors", () => {
    expect(errors).toEqual([]);
    expect(products).toHaveLength(4);
  });

  it("DC Athletics Pacer: continuous power contradiction, high severity", () => {
    const { findings } = scanProduct(transform(byId("fk-dc-athletics-pacer")));
    const power = contradictionsFor(findings, "motor_power_continuous");
    expect(power).toHaveLength(1);
    expect(power[0].severity).toBe("high");
    // Evidence quotes both sources exactly
    const texts = power[0].evidence.map((e) => e.text).join("\n");
    expect(texts).toContain("2 PK continu vermogen");
    expect(texts).toContain("Continu vermogen: 1 PK");
    // Explains the likely peak/continuous mix-up without picking a value
    expect(power[0].explanation).toMatch(/peak power/i);
    expect(power[0].suggestedCorrections).toEqual([]);
    // Peak power (2 PK) must never be reported as conflicting with continuous (1 PK)
    expect(contradictionsFor(findings, "motor_power_peak")).toHaveLength(0);
    expect(findings).toHaveLength(1);
  });

  it("Christopeit TM4500s: two separate findings (Zwift + continuous power)", () => {
    const { findings } = scanProduct(transform(byId("fk-christopeit-tm4500s")));
    const zwift = contradictionsFor(findings, "compat_zwift");
    const power = contradictionsFor(findings, "motor_power_continuous");
    expect(zwift).toHaveLength(1);
    expect(power).toHaveLength(1);
    expect(zwift[0]).not.toBe(power[0]);
    expect(zwift[0].evidence.map((e) => e.sourceLabel)).toEqual(
      expect.arrayContaining(["Description", "Specifications › Zwift compatibel"]),
    );
    expect(power[0].evidence.map((e) => e.value)).toEqual(
      expect.arrayContaining([expect.stringContaining("2,5 PK"), expect.stringContaining("2 PK")]),
    );
    expect(findings).toHaveLength(2);
  });

  it("BH Fitness i.Hudson R325: high-severity weight contradiction with manufacturer evidence", () => {
    const { findings } = scanProduct(transform(byId("fk-bh-i-hudson-r325")));
    const weight = contradictionsFor(findings, "max_user_weight");
    expect(weight).toHaveLength(1);
    const f = weight[0];
    expect(f.severity).toBe("high");
    expect(f.verificationStatus).toBe("manufacturer_verified");
    expect(f.evidence.some((e) => e.source.field === "manufacturer" && e.source.url)).toBe(true);
    // Correction points the wrong field (180 kg specs) to the manufacturer value
    expect(f.suggestedCorrections).toHaveLength(1);
    expect(f.suggestedCorrections[0]).toMatchObject({
      currentValue: "180 kg",
      suggestedValue: "125 kg",
      basis: "manufacturer_reference",
    });
    expect(f.suggestedCorrections[0].source.field).toBe("specifications");
  });

  it("Christopeit TM750s: potential incline contradiction requiring verification", () => {
    const { findings } = scanProduct(transform(byId("fk-christopeit-tm750s")));
    const incline = findings.filter((f) => f.attributes.includes("incline_adjustable"));
    expect(incline).toHaveLength(1);
    expect(incline[0].issueType).toBe("contradiction");
    expect(incline[0].verificationStatus).toBe("needs_verification");
    expect(incline[0].confidence).not.toBe("high");
    expect(incline[0].evidence.map((e) => e.text)).toEqual(
      expect.arrayContaining(["Verstelbare helling: Niet beschikbaar", "Snelkeuzetoetsen helling: Ja"]),
    );
    expect(findings).toHaveLength(1);
  });

  it("every finding has evidence, explanation, action, confidence and verification status", () => {
    for (const p of products) {
      for (const f of scanProduct(transform(p)).findings) {
        expect(f.evidence.length).toBeGreaterThan(0);
        for (const e of f.evidence) {
          expect(e.text.length).toBeGreaterThan(0);
          expect(e.sourceLabel.length).toBeGreaterThan(0);
        }
        expect(f.explanation.length).toBeGreaterThan(20);
        expect(f.recommendedAction.length).toBeGreaterThan(20);
        expect(["high", "medium", "low"]).toContain(f.confidence);
        expect(["unverified", "needs_verification", "manufacturer_verified"]).toContain(f.verificationStatus);
        expect(f.productId).toBeTruthy();
        expect(f.productTitle).toBeTruthy();
      }
    }
  });
});
