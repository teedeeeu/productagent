# Agent Commerce QA

**Find product information that could confuse AI shopping assistants and cost you sales.**

Agent Commerce QA scans a store's product data for contradictions, missing
buying-critical attributes, vague claims and references to the wrong model.
Every finding quotes the exact text it is based on, says where that text is,
and recommends a fix. It never invents specifications. When two sources
disagree it flags the conflict. It only suggests a value when a manufacturer
reference you entered supports it.

## Status

| Phase | What | Status |
|---|---|---|
| 1 | Next.js app (TypeScript, Tailwind) | ✅ |
| 2 | Supabase schema, indexes, row-level security | ✅ tested on PostgreSQL 16 |
| 3 | CSV import (simple format + Shopify's own product export) | ✅ |
| 4 | Deterministic scanner | ✅ all 4 FitnessKing cases detected |
| 5 | LLM-assisted analysis (OpenAI, Zod-validated) | ⏳ next |
| 6 | Dashboard (Overview, Products, Product detail, Settings), sign-in | ✅ |
| 7 | Shopify OAuth (read-only) | ⏳ |
| 8 | More automated tests | ongoing (60 tests + database security tests) |
| 9 | Deployment (Vercel + Supabase) | ⏳ |

## Run the dashboard locally (no accounts or keys needed)

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. Without Supabase keys the app runs in **local demo
mode**: there's no sign-in, and data is saved in `.data/demo-db.json` on your
computer. Go to **Settings → Import products** and upload
`tests/fixtures/fitnessking.csv` or `public/samples/example-products.csv`.

Demo mode is switched off automatically in production. A deployed app always needs Supabase.

## Connect Supabase (accounts + secure storage)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the contents of
   `supabase/migrations/20261101000000_initial_schema.sql`. If you use the Supabase CLI, run `supabase db push` instead.
3. Under **Authentication → URL Configuration**:
   - set **Site URL** to `http://localhost:3000` (your real domain later)
   - add `http://localhost:3000/auth/callback` to **Redirect URLs**
4. Under **Project Settings → API**, copy the **Project URL** and the **anon / publishable key**.
5. Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
6. Restart `npm run dev`. You'll now see a sign-in page. Create an account and confirm it from the email.

Each new account gets its own organization and store. Row-level security in the
database stops any account from seeing another account's data.

## Try the scanner from the command line

```bash
npm run scan -- tests/fixtures/fitnessking.csv
npm run scan -- public/samples/example-products.csv
npm run scan -- path/to/your-shopify-products-export.csv
```

The last command works with the file from **Shopify admin → Products → Export**.
Add `--json` for machine-readable output.

## Tests

```bash
npm test            # scanner + CSV tests (FitnessKing regressions and false-positive cases)
npm run typecheck
npm run lint
```

Database security tests need an **empty, throwaway** PostgreSQL database.
They create a stub of Supabase's `auth` schema, so never run them against your real Supabase project:

```bash
DATABASE_URL=postgresql://postgres@localhost:5432/acqa_test npm run test:db
```

They check that one merchant cannot read, change, delete or insert another
merchant's data, and that Shopify tokens cannot be read from the browser.

## CSV format

Download [`public/samples/example-products.csv`](public/samples/example-products.csv).

| Column | Required | Format |
|---|---|---|
| `product_id` | yes | Any unique ID (handle, SKU, Shopify ID) |
| `title` | yes | |
| `description` | | Plain text or HTML. Spec tables inside the HTML are read too |
| `vendor` | | Brand or manufacturer |
| `product_type` | | Used to choose category checks, e.g. `Loopband`, `Treadmill`, `Rowing machine` |
| `product_url` | | `https://…` |
| `variants` | | `Black \| White`, or JSON `[{"title":"Black","sku":"B1","options":{"Color":"Black"}}]` |
| `metafields` | | `key: value \| key: value`, or JSON |
| `specifications` | | `Label: value \| Label: value` (or one per line), or JSON |
| `manufacturer_url` | | Link to the manufacturer page or PDF |
| `manufacturer_specifications` | | Values copied from the manufacturer's documentation, same format as `specifications` |

Column names are not case-sensitive, and common aliases are accepted (`id`, `body_html`, `brand`, `specs`, …).
Limits: 10 MB and 5,000 products per file.

## How the scanner works

```
product → normalise text & units → extract attributes (with source + quote)
        → rules: contradictions · implied contradictions · missing (per category) · ambiguous · misleading
        → deduplicate → findings
```

- **Units** are normalised before comparing: kg/lb, cm/inch, km/h/mph, W/kW/PK/HP.
  Small rounding differences count as equal, e.g. 300 lb = 136 kg or 2 PK ≈ 2 HP.
- **Continuous and peak motor power are separate attributes** and are never compared
  with each other. Power that does not say which one it is gets an "ambiguous" finding.
- **Category-specific checks.** Treadmills need max user weight, max speed, continuous
  power, running surface and dimensions. Rowing machines need max user weight,
  resistance type and dimensions, but not speed. Products with an unknown category
  get no missing-attribute checks.
- **Languages:** English and Dutch.
- **Severity** reflects customer impact. **Confidence** reflects how sure the
  scanner is. They are separate fields. A safety limit (max user weight) that
  contradicts itself is *high*. It becomes *critical* when every merchant value
  is higher than a sourced manufacturer value.
- **Verification status:**
  - `manufacturer_verified` only when a manufacturer reference with a source link or quote is involved.
  - `needs_verification` for potential contradictions, such as "incline: not available" next to "incline quick keys: yes".
  - `unverified` otherwise.

Code: [`src/lib/scanner/`](src/lib/scanner). This is a pure library with no network
calls or database access, which keeps it fast, cheap and easy to test.

## Database

The migration is in [`supabase/migrations/`](supabase/migrations). It creates:

`organizations`, `users`, `stores`, `store_credentials`, `products`, `product_attributes`,
`scans`, `findings`, `manufacturer_references`

- Every table has row-level security, so users only see their own organization's rows.
- A database trigger also stops anyone from attaching rows to another merchant's store or product.
- Signing up automatically creates the merchant's organization.
- Shopify tokens go in `store_credentials`. This table has no browser access at all and will also be encrypted by the app.
- Re-scans update existing findings instead of duplicating them, so a finding the
  merchant dismissed stays dismissed. Findings that disappear are marked `resolved`.

## Dashboard

| Page | What it shows |
|---|---|
| **Overview** | Products scanned, products with issues, open findings, findings by severity, the products to fix first, and scan history. Also has the **Run scan** button. |
| **Products** | Searchable table with filters for severity and status, sorted so the most serious issues come first |
| **Product detail** | Each finding with its quoted evidence, recommended action and suggested correction. You can dismiss and reopen findings. Also shows the original product data and lets you add manufacturer references. |
| **Settings** | Store name, CSV upload, Shopify connection (coming next), and which API keys are configured (never the key values) |

- **Dismissed findings stay dismissed** when you re-scan.
- **Fixed issues are marked "resolved" automatically** on the next scan.
- **Adding a manufacturer reference re-scans that product right away.**

Code layout:
- `src/app/`: the pages and server actions. Every action checks the user is signed in.
- `src/lib/services/`: the import and scan workflow.
- `src/lib/data/`: database access. `SupabaseStore` is used in production. `DemoStore` is used for local demo mode and tests.

## Configuration

Copy `.env.example` to `.env.local`. Supabase is needed for accounts. OpenAI
(the AI checks, coming next) and Shopify (the direct connection) are optional.
