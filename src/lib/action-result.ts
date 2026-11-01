import type { CsvRowError } from "@/lib/import/csv";

export interface ActionResult {
  ok: boolean;
  message: string;
  rowErrors?: CsvRowError[];
}

export const initialActionResult: ActionResult = { ok: true, message: "" };
