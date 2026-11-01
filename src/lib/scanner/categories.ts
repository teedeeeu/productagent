import type { Category, ProductInput, Severity } from "./types";

/**
 * Category detection and category-specific required attributes.
 * Missing-attribute checks only run for attributes that matter for that
 * category — a rowing machine is never flagged for missing max speed.
 * Products in an unknown category get no missing-attribute checks at all.
 */

const RULES: { category: Category; match: RegExp }[] = [
  // Walking pads first: they are often also labelled "loopband"/"treadmill".
  { category: "walking_pad", match: /(walking\s?pad|wandelband|wandelloopband|under[-\s]?desk|onder\s+(?:het\s+)?bureau|bureauloopband)/i },
  { category: "treadmill", match: /(loopband|treadmill|running\s+machine|laufband)/i },
  { category: "rowing_machine", match: /(roeitrainer|roeimachine|roeiapparaat|rower|rowing|rudergerät)/i },
  { category: "cross_trainer", match: /(crosstrainer|cross\s+trainer|elliptical|elliptische|ellipstrainer)/i },
  { category: "exercise_bike", match: /(hometrainer|home\s+trainer|spinning|spin\s?bike|exercise\s+bike|indoor\s+(?:cycle|bike)|ligfiets|recumbent|fietstrainer|air\s?bike|upright\s+bike)/i },
];

export function detectCategory(product: Pick<ProductInput, "productType" | "title">): Category {
  // Product type is the merchant's own classification, so it wins over the title.
  for (const text of [product.productType ?? "", product.title]) {
    for (const r of RULES) if (r.match.test(text)) return r.category;
  }
  return "unknown";
}

export interface Requirement {
  attribute: string;
  severity: Severity;
  why: string;
}

const DIMENSIONS: Requirement = {
  attribute: "dimensions",
  severity: "medium",
  why: "Shoppers and AI assistants check whether the product fits in the available space.",
};
const USER_WEIGHT: Requirement = {
  attribute: "max_user_weight",
  severity: "high",
  why: "Without a stated maximum user weight, an assistant cannot tell whether the product is safe for a given shopper.",
};

export const REQUIREMENTS: Record<Category, Requirement[]> = {
  treadmill: [
    USER_WEIGHT,
    { attribute: "max_speed", severity: "medium", why: "Runners filter treadmills by top speed." },
    {
      attribute: "motor_power_continuous",
      severity: "medium",
      why: "Continuous motor power is the main durability indicator for treadmills; peak power alone is not comparable.",
    },
    { attribute: "running_surface", severity: "low", why: "Running surface size determines comfort for taller or faster users." },
    DIMENSIONS,
  ],
  walking_pad: [
    USER_WEIGHT,
    { attribute: "max_speed", severity: "medium", why: "Walking pads vary widely in top speed; shoppers ask whether they can jog on it." },
    DIMENSIONS,
  ],
  rowing_machine: [
    USER_WEIGHT,
    { attribute: "resistance_type", severity: "medium", why: "Resistance type (air, water, magnetic) is a primary buying criterion for rowers." },
    DIMENSIONS,
  ],
  exercise_bike: [
    USER_WEIGHT,
    { attribute: "resistance_type", severity: "medium", why: "Resistance type affects noise, feel and maintenance." },
    DIMENSIONS,
  ],
  cross_trainer: [
    USER_WEIGHT,
    { attribute: "resistance_type", severity: "medium", why: "Resistance type affects noise, feel and maintenance." },
    DIMENSIONS,
  ],
  unknown: [],
};

export const CATEGORY_LABELS: Record<Category, string> = {
  treadmill: "Treadmill",
  walking_pad: "Walking pad",
  rowing_machine: "Rowing machine",
  exercise_bike: "Exercise bike",
  cross_trainer: "Cross trainer",
  unknown: "Uncategorised",
};
