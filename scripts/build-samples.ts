/** Writes the sample/fixture CSV files from tests/fixtures/data.ts. Run: npm run samples */
import { writeFileSync } from "node:fs";
import Papa from "papaparse";
import { EXAMPLE, FITNESSKING } from "../tests/fixtures/data";

const toCsv = (rows: object[]) => Papa.unparse(rows, { quotes: true, newline: "\n" }) + "\n";
writeFileSync("public/samples/example-products.csv", toCsv(EXAMPLE));
writeFileSync("tests/fixtures/fitnessking.csv", toCsv(FITNESSKING));
console.log("Wrote public/samples/example-products.csv and tests/fixtures/fitnessking.csv");
