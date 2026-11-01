import { describe, expect, it } from "vitest";
import { parseKeyValues, parseProductCsv, parseVariants } from "@/lib/import/csv";

describe("simple CSV format", () => {
  it("parses rows, specs, metafields and variants", () => {
    const csv = [
      "Product ID,Title,Description,Vendor,Product Type,Product URL,Variants,Metafields,Specifications",
      'p1,Runner,"<p>Fast, quiet</p>",Demo,Treadmill,https://example.com/p1,"Black | White","{""custom.max_weight"": ""120 kg""}","Max speed: 16 km/h | Max user weight: 120 kg"',
    ].join("\n");
    const { products, errors, format } = parseProductCsv(csv);
    expect(format).toBe("simple");
    expect(errors).toEqual([]);
    expect(products[0]).toMatchObject({
      externalId: "p1",
      title: "Runner",
      descriptionHtml: "<p>Fast, quiet</p>",
      vendor: "Demo",
      productType: "Treadmill",
      url: "https://example.com/p1",
      variants: [{ title: "Black" }, { title: "White" }],
      metafields: [{ key: "custom.max_weight", value: "120 kg" }],
      specifications: [
        { key: "Max speed", value: "16 km/h" },
        { key: "Max user weight", value: "120 kg" },
      ],
    });
  });

  it("reports row-level errors and keeps valid rows", () => {
    const csv = [
      "product_id,title,product_url",
      "p1,Good,https://example.com",
      "p2,,https://example.com",
      "p1,Duplicate,",
      "p3,Bad URL,ftp://nope",
    ].join("\n");
    const { products, errors } = parseProductCsv(csv);
    expect(products.map((p) => p.externalId)).toEqual(["p1"]);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5]);
    expect(errors[0].message).toMatch(/Title is required/);
    expect(errors[1].message).toMatch(/Duplicate/);
    expect(errors[2].message).toMatch(/URL/);
  });

  it("rejects files without a title column", () => {
    const { products, errors } = parseProductCsv("foo,bar\n1,2");
    expect(products).toEqual([]);
    expect(errors[0].message).toMatch(/title/i);
  });

  it("attaches manufacturer specifications with the manufacturer URL as evidence", () => {
    const csv = 'product_id,title,manufacturer_url,manufacturer_specifications\np1,X,https://maker.example/x,"Max user weight: 125 kg"';
    const [p] = parseProductCsv(csv).products;
    expect(p.manufacturerReferences).toEqual([
      { key: "Max user weight", value: "125 kg", sourceUrl: "https://maker.example/x" },
    ]);
  });
});

describe("Shopify product export format", () => {
  it("groups variant rows by handle and reads metafield columns", () => {
    const csv = [
      "Handle,Title,Body (HTML),Vendor,Type,Option1 Name,Option1 Value,Variant SKU,Max gebruikersgewicht (product.metafields.custom.max_user_weight)",
      "runner,Runner 500,<p>Hi</p>,Demo,Loopband,Kleur,Zwart,R-B,120 kg",
      "runner,,,,,,Wit,R-W,",
      "walker,Walker,<p>Walk</p>,Demo,Walking pad,Title,Default Title,W-1,",
    ].join("\n");
    const { products, errors, format } = parseProductCsv(csv);
    expect(format).toBe("shopify_export");
    expect(errors).toEqual([]);
    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({
      externalId: "runner",
      title: "Runner 500",
      productType: "Loopband",
      metafields: [{ key: "Max gebruikersgewicht", value: "120 kg" }],
      variants: [
        { title: "Zwart", sku: "R-B", options: { Kleur: "Zwart" } },
        { title: "Wit", sku: "R-W", options: { Kleur: "Wit" } },
      ],
    });
    expect(products[1].variants).toEqual([]); // "Default Title" is not a real variant
  });
});

describe("field parsers", () => {
  it("parses key/value text and JSON", () => {
    expect(parseKeyValues("A: 1\nB: 2")).toEqual([
      { key: "A", value: "1" },
      { key: "B", value: "2" },
    ]);
    expect(parseKeyValues('[{"namespace":"specs","key":"weight","value":"10 kg"}]')).toEqual([
      { key: "specs.weight", value: "10 kg" },
    ]);
    expect(parseKeyValues("Time: 10:30")).toEqual([{ key: "Time", value: "10:30" }]);
  });

  it("parses JSON variants with options", () => {
    expect(parseVariants('[{"title":"Black","sku":"B1","options":{"Color":"Black"}}]')).toEqual([
      { title: "Black", sku: "B1", options: { Color: "Black" } },
    ]);
  });
});
