import type { Dimension } from "./types";

/**
 * Unit normalization. Every measurable value is converted to one base unit
 * per dimension so values written in different units can be compared:
 *   mass → kg, length → cm, speed → km/h, power → W, percent → %
 *
 * Power: "PK" (Dutch paardenkracht) and "PS" are metric horsepower (735.5 W);
 * "HP" is mechanical horsepower (745.7 W). The ~1.4% difference falls inside
 * the comparison tolerance, so "2 PK" and "2 HP" are treated as equal.
 *
 * Continuous vs. peak power is NOT handled here — those are separate
 * attributes and are never compared with each other.
 */

interface UnitDef {
  pattern: string;
  factor: number;
  label: string;
}

const UNITS: Record<Dimension, UnitDef[]> = {
  mass: [
    { pattern: "kilograms?|kilo'?s?|kg", factor: 1, label: "kg" },
    { pattern: "lbs?|pounds?", factor: 0.45359237, label: "lb" },
  ],
  length: [
    { pattern: "mm", factor: 0.1, label: "mm" },
    { pattern: "cm", factor: 1, label: "cm" },
    { pattern: "inch(?:es)?|in\\.?|\"|″", factor: 2.54, label: "in" },
    { pattern: "m(?:eters?|eter)?", factor: 100, label: "m" },
  ],
  speed: [
    { pattern: "km\\s?/\\s?(?:h|u|uur|hr)|kmh|kph|km per uur", factor: 1, label: "km/h" },
    { pattern: "mph|miles per hour", factor: 1.609344, label: "mph" },
  ],
  power: [
    { pattern: "kw|kilowatt", factor: 1000, label: "kW" },
    { pattern: "w|watts?", factor: 1, label: "W" },
    { pattern: "pk|ps", factor: 735.49875, label: "PK" },
    { pattern: "hp|bhp|chp", factor: 745.69987, label: "HP" },
  ],
  percent: [{ pattern: "%|procent|percent", factor: 1, label: "%" }],
};

/** Relative tolerance when comparing two values of the same dimension. */
export const TOLERANCE: Record<Dimension, number> = {
  mass: 0.02,
  length: 0.02,
  speed: 0.03,
  power: 0.03,
  percent: 0.01,
};

const NUMBER = "(\\d{1,3}(?:\\.\\d{3})+|\\d+(?:[.,]\\d+)?)";

export function parseNumber(raw: string): number {
  // "1.200" (thousands separator) vs "1.5" / "3,5" (decimal separators)
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) return Number(raw.replace(/\./g, ""));
  return Number(raw.replace(",", "."));
}

export interface Quantity {
  value: number;
  base: number;
  unit: string;
  raw: string;
  index: number;
  /** Set when the quantity was written as a range, e.g. "1 - 16 km/h". */
  rangeMin?: number;
}

const regexCache = new Map<Dimension, RegExp>();

function quantityRegex(dimension: Dimension): RegExp {
  let re = regexCache.get(dimension);
  if (!re) {
    const units = UNITS[dimension].map((u) => `(?:${u.pattern})`).join("|");
    // Optional range prefix: "1 - 16 km/h", "1 tot 16 km/u", "0–15%"
    re = new RegExp(
      `(?:${NUMBER}\\s*(?:-|–|tot|to|t/m)\\s*)?${NUMBER}\\s*(${units})(?![a-z0-9])`,
      "gi",
    );
    regexCache.set(dimension, re);
  }
  re.lastIndex = 0;
  return re;
}

function unitFor(dimension: Dimension, unitText: string): UnitDef | undefined {
  const t = unitText.trim().toLowerCase();
  return UNITS[dimension].find((u) => new RegExp(`^(?:${u.pattern})$`, "i").test(t));
}

/** Find all quantities of a given dimension in a piece of text. */
export function findQuantities(text: string, dimension: Dimension): Quantity[] {
  const re = quantityRegex(dimension);
  const out: Quantity[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const unit = unitFor(dimension, m[3]);
    if (!unit) continue;
    const value = parseNumber(m[2]);
    if (!Number.isFinite(value)) continue;
    const q: Quantity = {
      value,
      base: value * unit.factor,
      unit: unit.label,
      raw: m[0].trim(),
      index: m.index,
    };
    if (m[1]) q.rangeMin = parseNumber(m[1]) * unit.factor;
    out.push(q);
  }
  return out;
}

export function sameValue(a: number, b: number, dimension: Dimension): boolean {
  const tol = TOLERANCE[dimension];
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return true;
  return Math.abs(a - b) / max <= tol;
}

export function formatBase(base: number, dimension: Dimension): string {
  const round = (n: number) => (Math.round(n * 10) / 10).toString();
  switch (dimension) {
    case "mass":
      return `${round(base)} kg`;
    case "length":
      return `${round(base)} cm`;
    case "speed":
      return `${round(base)} km/h`;
    case "power":
      return base >= 1000 ? `${round(base / 1000)} kW` : `${Math.round(base)} W`;
    case "percent":
      return `${round(base)}%`;
  }
}

/** "2 PK" stays "2 PK", but we add the normalized value when units differ. */
export function describeQuantity(q: Quantity, dimension: Dimension): string {
  const base = formatBase(q.base, dimension);
  const original = q.raw;
  const sameUnit =
    (dimension === "mass" && q.unit === "kg") ||
    (dimension === "length" && q.unit === "cm") ||
    (dimension === "speed" && q.unit === "km/h") ||
    (dimension === "percent") ||
    (dimension === "power" && q.unit === "W");
  return sameUnit ? original : `${original} (≈ ${base})`;
}
