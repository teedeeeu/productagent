import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProductCsv } from "@/lib/import/csv";
import { scanProduct, scanProducts, type ProductInput } from "@/lib/scanner";
import { extractProduct } from "@/lib/scanner/extract";
import { findQuantities, sameValue } from "@/lib/scanner/units";

function product(p: Partial<ProductInput> & { title: string }): ProductInput {
  return {
    externalId: p.externalId ?? "p1",
    descriptionHtml: "",
    specifications: [],
    metafields: [],
    variants: [],
    manufacturerReferences: [],
    ...p,
  };
}

const kv = (s: string) =>
  s.split("|").map((part) => {
    const [key, ...rest] = part.split(":");
    return { key: key.trim(), value: rest.join(":").trim() };
  });

const values = (p: ProductInput, attribute: string) =>
  extractProduct(p)
    .filter((e) => e.attribute === attribute)
    .map((e) => (e.value.kind === "number" ? Math.round(e.value.base * 10) / 10 : e.value.kind === "boolean" ? e.value.value : e.value.display));

describe("unit normalization", () => {
  it("converts lb, mph, HP and PK", () => {
    expect(findQuantities("up to 300 lbs", "mass")[0].base).toBeCloseTo(136.08, 1);
    expect(findQuantities("10 mph", "speed")[0].base).toBeCloseTo(16.09, 1);
    expect(findQuantities("2 PK", "power")[0].base).toBeCloseTo(1471, 0);
    expect(findQuantities("2 HP", "power")[0].base).toBeCloseTo(1491.4, 0);
    expect(findQuantities("1,5 kW", "power")[0].base).toBe(1500);
    expect(findQuantities("60 inch", "length")[0].base).toBeCloseTo(152.4, 1);
  });

  it("treats values within tolerance as equal and others as different", () => {
    expect(sameValue(136.08, 136, "mass")).toBe(true);
    expect(sameValue(1471, 1491.4, "power")).toBe(true); // 2 PK ≈ 2 HP
    expect(sameValue(125, 180, "mass")).toBe(false);
    expect(sameValue(16, 18, "speed")).toBe(false);
  });

  it("reads the top of a speed range and ignores minimum speed", () => {
    const p = product({ title: "Treadmill", specifications: kv("Snelheid: 1 - 16 km/u|Min. snelheid: 1 km/u") });
    expect(values(p, "max_speed")).toEqual([16]);
  });
});

describe("extraction", () => {
  it("keeps continuous, peak and unqualified power as separate attributes", () => {
    const p = product({
      title: "Treadmill",
      descriptionHtml: "<p>Motor: 1 PK continu / 2 PK piek. Een krachtige 3 PK motor.</p>",
    });
    expect(values(p, "motor_power_continuous")).toEqual([735.5]);
    expect(values(p, "motor_power_peak")).toEqual([1471]);
    expect(values(p, "motor_power_unqualified")).toEqual([2206.5]);
  });

  it("does not read product weight as maximum user weight", () => {
    const p = product({ title: "Treadmill", specifications: kv("Productgewicht: 75 kg|Gewicht: 70 kg") });
    expect(values(p, "max_user_weight")).toEqual([]);
  });

  it("reads Dutch and English negated compatibility claims", () => {
    expect(values(product({ title: "x", descriptionHtml: "Niet compatibel met Zwift." }), "compat_zwift")).toEqual([false]);
    expect(values(product({ title: "x", descriptionHtml: "Not compatible with Zwift." }), "compat_zwift")).toEqual([false]);
    expect(values(product({ title: "x", descriptionHtml: "Niet alleen compatibel met Zwift, maar ook met Kinomap." }), "compat_zwift")).toEqual([true]);
    // A bare mention is not a compatibility claim
    expect(values(product({ title: "x", descriptionHtml: "Zwift is a popular app." }), "compat_zwift")).toEqual([]);
  });

  it("reads spec tables embedded in description HTML", () => {
    const p = product({
      title: "Treadmill",
      descriptionHtml: "<table><tr><td>Max. gebruikersgewicht</td><td>130 kg</td></tr></table>",
    });
    expect(values(p, "max_user_weight")).toEqual([130]);
  });
});

describe("false positives — must not flag", () => {
  it("never compares continuous with peak power", () => {
    const p = product({
      title: "Treadmill X1",
      productType: "Loopband",
      specifications: kv(
        "Continu vermogen: 1 PK|Piekvermogen: 2 PK|Max. gebruikersgewicht: 120 kg|Max. snelheid: 14 km/u|Loopvlak: 130 x 45 cm|Afmetingen: 160 x 70 x 120 cm",
      ),
    });
    expect(scanProduct(p).findings).toEqual([]);
  });

  it("accepts the same value written in different units", () => {
    const p = product({
      title: "Treadmill",
      productType: "Treadmill",
      descriptionHtml: "<p>Supports users weighing up to 300 lbs, speeds up to 10 mph, 2 HP continuous motor.</p>",
      specifications: kv("Max user weight: 136 kg|Max speed: 16 km/h|Continuous motor power: 2 PK|Running surface: 140 x 50 cm|Dimensions: 180 x 80 x 135 cm"),
    });
    expect(scanProduct(p).findings).toEqual([]);
  });

  it("does not require treadmill attributes for a rowing machine", () => {
    const p = product({
      title: "Rower",
      productType: "Roeitrainer",
      specifications: kv("Weerstandstype: Magnetisch|Max. gebruikersgewicht: 150 kg|Afmetingen: 200 x 50 x 90 cm"),
    });
    expect(scanProduct(p).findings).toEqual([]);
  });

  it("runs no missing-attribute checks for uncategorised products", () => {
    expect(scanProduct(product({ title: "Yoga mat", productType: "Accessories" })).findings).toEqual([]);
  });

  it("does not flag a model suffix difference (TM4500 vs TM4500s)", () => {
    const p = product({ title: "Brand TM4500s", descriptionHtml: "<p>The TM4500 is built to last.</p>" });
    expect(scanProduct(p).findings.filter((f) => f.attributes.includes("model"))).toEqual([]);
  });

  it("does not treat a speed of 0% incline as an incline feature", () => {
    const p = product({ title: "Walker", specifications: kv("Verstelbare helling: Nee|Hellingshoek: 0%") });
    expect(scanProduct(p).findings).toEqual([]);
  });

  it("the clean example products produce no findings", () => {
    const csv = readFileSync(new URL("../public/samples/example-products.csv", import.meta.url), "utf8");
    const { products } = parseProductCsv(csv);
    for (const id of ["demo-runner-500", "demo-row-air", "demo-yoga-mat"]) {
      const p = products.find((x) => x.externalId === id)!;
      expect(scanProduct(p).findings, id).toEqual([]);
    }
  });
});

describe("no invented specifications", () => {
  it("missing attribute without manufacturer reference suggests no value", () => {
    const p = product({ title: "Walking pad", productType: "Walking pad", specifications: kv("Max speed: 6 km/h|Dimensions: 140 x 55 x 15 cm") });
    const [f] = scanProduct(p).findings;
    expect(f.issueType).toBe("missing_attribute");
    expect(f.attributes).toEqual(["max_user_weight"]);
    expect(f.severity).toBe("high");
    expect(f.suggestedCorrections).toEqual([]);
    expect(f.verificationStatus).toBe("unverified");
  });

  it("missing attribute with a sourced manufacturer reference suggests that value", () => {
    const p = product({
      title: "Walking pad",
      productType: "Walking pad",
      specifications: kv("Max speed: 6 km/h|Dimensions: 140 x 55 x 15 cm"),
      manufacturerReferences: [{ key: "Max user weight", value: "110 kg", sourceUrl: "https://example.com/manual.pdf" }],
    });
    const [f] = scanProduct(p).findings;
    expect(f.verificationStatus).toBe("manufacturer_verified");
    expect(f.suggestedCorrections[0].suggestedValue).toBe("110 kg");
  });

  it("a manufacturer value without a source is never labelled verified", () => {
    const p = product({
      title: "Treadmill",
      specifications: kv("Max. gebruikersgewicht: 150 kg"),
      manufacturerReferences: [{ key: "Max. gebruikersgewicht", value: "120 kg" }],
    });
    const [f] = scanProduct(p).findings;
    expect(f.issueType).toBe("contradiction");
    expect(f.verificationStatus).toBe("unverified");
    expect(f.suggestedCorrections).toEqual([]);
  });

  it("merchant contradictions without manufacturer data never pick a value", () => {
    const p = product({ title: "Treadmill", descriptionHtml: "Max. gebruikersgewicht: 120 kg", specifications: kv("Max. gebruikersgewicht: 150 kg") });
    const [f] = scanProduct(p).findings;
    expect(f.suggestedCorrections).toEqual([]);
    expect(f.recommendedAction).toMatch(/manufacturer/i);
  });
});

describe("severity and other rules", () => {
  it("is critical when the merchant consistently overstates a safety limit vs. a sourced manufacturer value", () => {
    const p = product({
      title: "Treadmill",
      specifications: kv("Max. gebruikersgewicht: 150 kg"),
      manufacturerReferences: [{ key: "Max. gebruikersgewicht", value: "120 kg", sourceUrl: "https://example.com/spec" }],
    });
    const [f] = scanProduct(p).findings;
    expect(f.severity).toBe("critical");
    expect(f.verificationStatus).toBe("manufacturer_verified");
  });

  it("flags a model field that names a different model than the title", () => {
    const p = product({ title: "Brand RX200 treadmill", specifications: kv("Model: RX100") });
    const f = scanProduct(p).findings.find((x) => x.attributes.includes("model"))!;
    expect(f.issueType).toBe("misleading");
    expect(f.severity).toBe("high");
  });

  it("reports variant contradictions as misleading", () => {
    const p = product({
      title: "Walking pad",
      productType: "Walking pad",
      descriptionHtml: "Suitable for users up to 120 kg.",
      specifications: kv("Max speed: 6 km/h|Dimensions: 140 x 55 x 15 cm"),
      variants: [{ title: "Black / Max load 100 kg" }],
    });
    const [f] = scanProduct(p).findings;
    expect(f.issueType).toBe("misleading");
    expect(f.attributes).toEqual(["max_user_weight"]);
  });

  it("produces one finding per issue even when several rules see it", () => {
    const p = product({
      title: "Treadmill",
      descriptionHtml: "Max. gebruikersgewicht: 120 kg. Geschikt voor gebruikers tot 120 kg.",
      specifications: kv("Max. gebruikersgewicht: 150 kg|Belastbaarheid: 150 kg"),
    });
    const weight = scanProduct(p).findings.filter((f) => f.attributes.includes("max_user_weight"));
    expect(weight).toHaveLength(1);
    expect(weight[0].evidence.length).toBeGreaterThanOrEqual(3);
  });

  it("respects the per-scan product limit", () => {
    const many = Array.from({ length: 5 }, (_, i) => product({ externalId: `p${i}`, title: `P${i}` }));
    const { summary } = scanProducts(many, { maxProducts: 3 });
    expect(summary.productsScanned).toBe(3);
    expect(summary.skipped).toBe(2);
  });
});
