import { ArrowRight, Upload } from "lucide-react";
import Link from "next/link";
import { runScanAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { ISSUE_TYPE_LABEL, SEVERITY_LABEL, SeverityBadge } from "@/components/labels";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDataStore } from "@/lib/data";
import type { ScanRecord } from "@/lib/data/types";
import { severityRank } from "@/lib/scanner/findings";
import type { IssueType, Severity } from "@/lib/scanner/types";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Overview · Agent Commerce QA" };

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const BAR_COLOR: Record<Severity, string> = {
  critical: "bg-red-700",
  high: "bg-orange-500",
  medium: "bg-amber-400",
  low: "bg-sky-400",
};

const SCAN_STATUS: Record<ScanRecord["status"], { label: string; variant: "success" | "medium" | "critical" | "secondary" }> = {
  completed: { label: "Completed", variant: "success" },
  partial: { label: "Partial", variant: "medium" },
  failed: { label: "Failed", variant: "critical" },
  running: { label: "Running", variant: "secondary" },
};

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default async function OverviewPage() {
  const ds = await getDataStore();
  const store = await ds.getOrCreateStore();
  const [products, findings, scans] = await Promise.all([
    ds.listProducts(store.id),
    ds.listFindings({ storeId: store.id }),
    ds.listScans(store.id, 10),
  ]);

  const open = findings.filter((f) => f.status === "open");
  const scanned = products.filter((p) => p.scanStatus === "scanned");
  const withIssues = products.filter((p) => p.openFindingsCount > 0);
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, open.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  const byType = Object.entries(
    open.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.issueType]: (acc[f.issueType] ?? 0) + 1 }), {}),
  ).sort((a, b) => b[1] - a[1]);
  const maxSeverityCount = Math.max(1, ...Object.values(bySeverity));
  const topProducts = [...withIssues]
    .sort(
      (a, b) =>
        severityRank(a.highestSeverity ?? "low") - severityRank(b.highestSeverity ?? "low") ||
        b.openFindingsCount - a.openFindingsCount,
    )
    .slice(0, 5);

  const scanForm = (
    <ActionForm action={runScanAction} resultClassName="flex flex-col items-end">
      <SubmitButton pendingText="Scanning…" disabled={!products.length}>
        Run scan
      </SubmitButton>
    </ActionForm>
  );

  if (!products.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <Card>
          <CardHeader>
            <CardTitle>Import your products to get started</CardTitle>
            <CardDescription>
              Upload a CSV, or the product export from your Shopify admin (Products → Export). The scan takes seconds and
              never changes your store.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Link href="/settings#import" className={buttonVariants()}>
              <Upload /> Import products
            </Link>
            <a href="/samples/example-products.csv" download className={buttonVariants({ variant: "outline" })}>
              Download example CSV
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Product information that could make an AI shopping assistant give a customer the wrong answer.
          </p>
        </div>
        {scanForm}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Products scanned" value={scanned.length} hint={`of ${products.length} imported`} />
        <Stat label="Products with issues" value={withIssues.length} hint={scanned.length ? `${Math.round((withIssues.length / scanned.length) * 100)}% of scanned` : undefined} />
        <Stat label="Open findings" value={open.length} hint={`${findings.filter((f) => f.status === "dismissed").length} dismissed · ${findings.filter((f) => f.status === "resolved").length} resolved`} />
        <Stat label="Critical + high" value={bySeverity.critical + bySeverity.high} hint="Fix these first" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Findings by severity</CardTitle>
            <CardDescription>Severity is the potential impact on the customer.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {SEVERITIES.map((s) => (
              <Link key={s} href={`/products?severity=${s}`} className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-3 text-sm hover:opacity-80">
                <span>{SEVERITY_LABEL[s]}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <span className={`block h-full rounded-full ${BAR_COLOR[s]}`} style={{ width: `${(bySeverity[s] / maxSeverityCount) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums">{bySeverity[s]}</span>
              </Link>
            ))}
            {byType.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                {byType.map(([type, n]) => (
                  <Badge key={type} variant="outline">
                    {ISSUE_TYPE_LABEL[type as IssueType]}: {n}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fix first</CardTitle>
            <CardDescription>Products with the most serious open issues.</CardDescription>
          </CardHeader>
          <CardContent>
            {topProducts.length ? (
              <ul className="divide-y">
                {topProducts.map((p) => (
                  <li key={p.id}>
                    <Link href={`/products/${p.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:underline">
                      <span className="truncate">{p.title}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-muted-foreground">{p.openFindingsCount} issue{p.openFindingsCount === 1 ? "" : "s"}</span>
                        <SeverityBadge severity={p.highestSeverity} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{scanned.length ? "No open issues." : "Run a scan to see results."}</p>
            )}
            <Link href="/products" className={buttonVariants({ variant: "link", className: "mt-2 px-0" })}>
              All products <ArrowRight />
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scan history</CardTitle>
        </CardHeader>
        <CardContent className="px-2">
          {scans.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Products</TableHead>
                  <TableHead className="text-right">Open findings</TableHead>
                  <TableHead>By severity</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scans.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(s.startedAt)}</TableCell>
                    <TableCell>
                      <Badge variant={SCAN_STATUS[s.status].variant}>{SCAN_STATUS[s.status].label}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.productsScanned}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.findingsCount}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {SEVERITIES.map((sev) => `${SEVERITY_LABEL[sev][0]} ${s.findingsBySeverity?.[sev] ?? 0}`).join(" · ")}
                    </TableCell>
                    <TableCell className="max-w-xs text-xs text-muted-foreground">{s.error ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-3 text-sm text-muted-foreground">No scans yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
