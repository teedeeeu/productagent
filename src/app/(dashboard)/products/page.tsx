import { Search } from "lucide-react";
import Link from "next/link";
import { CATEGORY_LABEL, SeverityBadge } from "@/components/labels";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDataStore } from "@/lib/data";
import type { ProductRecord } from "@/lib/data/types";
import { severityRank } from "@/lib/scanner/findings";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Products · Agent Commerce QA" };

const PAGE_SIZE = 100;

const SCAN_STATUS: Record<ProductRecord["scanStatus"], { label: string; variant: "success" | "secondary" | "critical" }> = {
  scanned: { label: "Scanned", variant: "success" },
  not_scanned: { label: "Not scanned", variant: "secondary" },
  error: { label: "Scan error", variant: "critical" },
};

type Search = { q?: string; severity?: string; status?: string; page?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const q = (params.q ?? "").trim().toLowerCase();
  const severity = params.severity ?? "";
  const status = params.status ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const ds = await getDataStore();
  const store = await ds.getOrCreateStore();
  const all = await ds.listProducts(store.id);

  const filtered = all
    .filter(
      (p) =>
        !q ||
        p.title.toLowerCase().includes(q) ||
        (p.vendor ?? "").toLowerCase().includes(q) ||
        p.externalId.toLowerCase().includes(q),
    )
    .filter((p) => !severity || p.highestSeverity === severity)
    .filter(
      (p) =>
        !status ||
        (status === "issues" && p.openFindingsCount > 0) ||
        (status === "clean" && p.scanStatus === "scanned" && p.openFindingsCount === 0) ||
        (status === "not_scanned" && p.scanStatus !== "scanned"),
    )
    .sort(
      (a, b) =>
        (a.highestSeverity ? severityRank(a.highestSeverity) : 9) - (b.highestSeverity ? severityRank(b.highestSeverity) : 9) ||
        b.openFindingsCount - a.openFindingsCount ||
        a.title.localeCompare(b.title),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageHref = (n: number) => `/products?${new URLSearchParams({ ...params, page: String(n) })}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        <p className="text-sm text-muted-foreground">
          {all.length} product{all.length === 1 ? "" : "s"} imported. Most serious issues first.
        </p>
      </div>

      <form className="flex flex-wrap gap-2" role="search">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input name="q" defaultValue={params.q ?? ""} placeholder="Search title, brand or product ID" className="pl-8" aria-label="Search products" />
        </div>
        <Select name="severity" defaultValue={severity} aria-label="Severity">
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </Select>
        <Select name="status" defaultValue={status} aria-label="Status">
          <option value="">All products</option>
          <option value="issues">With open issues</option>
          <option value="clean">No issues</option>
          <option value="not_scanned">Not scanned</option>
        </Select>
        <Button type="submit" variant="outline">Filter</Button>
        {(q || severity || status) && (
          <Link href="/products" className={buttonVariants({ variant: "ghost" })}>Clear</Link>
        )}
      </form>

      <Card>
        <CardContent className="p-2">
          {visible.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Open issues</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Scan status</TableHead>
                  <TableHead>Last scanned</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-md">
                      <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                        {p.title}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {[p.vendor, p.externalId].filter(Boolean).join(" · ")}
                      </p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.scanStatus === "scanned" ? CATEGORY_LABEL[p.category] ?? p.category : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.scanStatus === "scanned" ? p.openFindingsCount : "—"}</TableCell>
                    <TableCell>{p.scanStatus === "scanned" ? <SeverityBadge severity={p.highestSeverity} /> : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={SCAN_STATUS[p.scanStatus].variant}>{SCAN_STATUS[p.scanStatus].label}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(p.lastScannedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {all.length ? "No products match these filters." : <>No products yet. <Link className="underline" href="/settings#import">Import a CSV</Link> to get started.</>}
            </p>
          )}
        </CardContent>
      </Card>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {pages} · {filtered.length} products
          </span>
          <div className="flex gap-2">
            {page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={pageHref(page - 1)}>Previous</Link>}
            {page < pages && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={pageHref(page + 1)}>Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
