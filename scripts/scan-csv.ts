/**
 * Scan a CSV from the command line, without a database or any API keys.
 *   npm run scan -- path/to/products.csv [--json]
 */
import { readFileSync } from "node:fs";
import { parseProductCsv } from "../src/lib/import/csv";
import { CATEGORY_LABELS, scanProducts } from "../src/lib/scanner";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run scan -- <file.csv> [--json]");
  process.exit(1);
}
const { products, errors, format } = parseProductCsv(readFileSync(file, "utf8"));
const { results, summary } = scanProducts(products);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ format, errors, summary, results: results.map((r) => ({ ...r, extractions: undefined })) }, null, 2));
  process.exit(0);
}

console.log(`Format: ${format} · ${products.length} products imported · ${errors.length} row errors`);
for (const e of errors) console.log(`  ! row ${e.row}: ${e.message}`);
for (const r of results) {
  const p = products.find((x) => x.externalId === r.productId)!;
  console.log(`\n■ ${p.title}  [${CATEGORY_LABELS[r.category]}]  — ${r.findings.length} finding(s)`);
  for (const f of r.findings) {
    console.log(`  [${f.severity.toUpperCase()}] ${f.issueType}: ${f.title}  (confidence ${f.confidence}, ${f.verificationStatus})`);
    console.log(`     ${f.explanation}`);
    for (const ev of f.evidence) console.log(`     · ${ev.sourceLabel}: “${ev.text}”`);
    console.log(`     → ${f.recommendedAction}`);
    for (const c of f.suggestedCorrections) console.log(`     ✎ ${c.sourceLabel}: ${c.currentValue} → ${c.suggestedValue} (per manufacturer reference)`);
  }
}
console.log(`\nSummary: ${JSON.stringify(summary)}`);
