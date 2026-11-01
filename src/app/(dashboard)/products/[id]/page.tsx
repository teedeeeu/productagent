import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  addManufacturerReferenceAction,
  deleteManufacturerReferenceAction,
  rescanProductAction,
} from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { FindingCard, SafeLink } from "@/components/finding-card";
import { CATEGORY_LABEL, SeverityBadge } from "@/components/labels";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { getDataStore } from "@/lib/data";
import type { FindingStatus } from "@/lib/data/types";
import { severityRank } from "@/lib/scanner/findings";
import { htmlToText } from "@/lib/scanner/text";
import type { KeyValue } from "@/lib/scanner/types";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Product · Agent Commerce QA" };

const TABS: { value: FindingStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "dismissed", label: "Dismissed" },
  { value: "resolved", label: "Resolved" },
];

function KeyValueTable({ rows, empty }: { rows: KeyValue[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            <TableCell className="w-2/5 py-1.5 text-muted-foreground">{r.key}</TableCell>
            <TableCell className="py-1.5">{r.value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { id } = await params;
  const { show } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();

  const ds = await getDataStore();
  const product = await ds.getProduct(id);
  if (!product) notFound();
  const [findings, references] = await Promise.all([
    ds.listFindings({ productId: id }),
    ds.listManufacturerReferences([id]),
  ]);

  const tab: FindingStatus = TABS.some((t) => t.value === show) ? (show as FindingStatus) : "open";
  const visible = findings
    .filter((f) => f.status === tab)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const description = htmlToText(product.descriptionHtml);

  return (
    <div className="space-y-6">
      <Link href="/products" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Products
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{product.title}</h1>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {[product.vendor, product.productType, CATEGORY_LABEL[product.category], `ID ${product.externalId}`]
              .filter(Boolean)
              .join(" · ")}
            {product.productUrl && /^https?:\/\//i.test(product.productUrl) && (
              <a href={product.productUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 underline underline-offset-2">
                View in store <ExternalLink className="size-3" />
              </a>
            )}
          </p>
          <p className="text-xs text-muted-foreground">Last scanned {formatDateTime(product.lastScannedAt)}</p>
        </div>
        <div className="flex items-center gap-3">
          {product.scanStatus === "scanned" && <SeverityBadge severity={product.highestSeverity} />}
          <ActionForm action={rescanProductAction} resultClassName="flex flex-col items-end">
            <input type="hidden" name="productId" value={product.id} />
            <SubmitButton variant="outline" pendingText="Scanning…">
              Re-scan
            </SubmitButton>
          </ActionForm>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="space-y-4">
          <div className="flex items-center gap-1 border-b">
            {TABS.map((t) => {
              const n = findings.filter((f) => f.status === t.value).length;
              return (
                <Link
                  key={t.value}
                  href={`/products/${product.id}?show=${t.value}`}
                  className={cn(
                    "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
                    tab === t.value && "border-foreground font-medium text-foreground",
                  )}
                >
                  {t.label} ({n})
                </Link>
              );
            })}
          </div>
          {visible.length ? (
            visible.map((f) => <FindingCard key={f.id} finding={f} />)
          ) : (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                {product.scanStatus !== "scanned"
                  ? "This product has not been scanned yet."
                  : tab === "open"
                    ? "No open issues found for this product."
                    : `No ${tab} findings.`}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Original product data</CardTitle>
              <CardDescription>As imported. The scanner only reads this data. It never changes your store.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <h4 className="mb-2 text-sm font-medium">Description</h4>
                <p className="whitespace-pre-line rounded-md bg-muted/60 p-3 text-sm">{description || "No description."}</p>
              </div>
              <div>
                <h4 className="mb-1 text-sm font-medium">Specifications</h4>
                <KeyValueTable rows={product.specifications} empty="No specifications." />
              </div>
              <div>
                <h4 className="mb-1 text-sm font-medium">Metafields</h4>
                <KeyValueTable rows={product.metafields} empty="No metafields." />
              </div>
              <div>
                <h4 className="mb-1 text-sm font-medium">Variants</h4>
                {product.variants.length ? (
                  <ul className="list-inside list-disc text-sm">
                    {product.variants.map((v, i) => (
                      <li key={i}>
                        {v.title}
                        {v.sku ? <span className="text-muted-foreground"> · SKU {v.sku}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No variants.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Manufacturer verification</CardTitle>
              <CardDescription>
                Add values from the manufacturer&apos;s documentation. Findings are marked manufacturer-verified only when
                you include a source link or an exact quote.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {product.manufacturerUrl && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Manufacturer page: </span>
                  <SafeLink href={product.manufacturerUrl} />
                </p>
              )}
              {references.length > 0 && (
                <ul className="space-y-2">
                  {references.map((r) => (
                    <li key={r.id} className="flex items-start justify-between gap-2 rounded-md border p-2.5 text-sm">
                      <div className="min-w-0 space-y-0.5">
                        <p>
                          <span className="text-muted-foreground">{r.attributeLabel}:</span>{" "}
                          <span className="font-medium">{r.valueText}</span>
                        </p>
                        {r.sourceUrl ? (
                          <p className="truncate text-xs text-muted-foreground">
                            <SafeLink href={r.sourceUrl} />
                          </p>
                        ) : !r.evidenceText ? (
                          <p className="text-xs text-amber-700">No source — not counted as verified</p>
                        ) : null}
                        {r.evidenceText && <p className="text-xs italic text-muted-foreground">“{r.evidenceText}”</p>}
                      </div>
                      <form action={deleteManufacturerReferenceAction}>
                        <input type="hidden" name="referenceId" value={r.id} />
                        <input type="hidden" name="productId" value={product.id} />
                        <Button variant="ghost" size="sm" aria-label={`Delete ${r.attributeLabel}`}>
                          <Trash2 />
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <ActionForm action={addManufacturerReferenceAction} className="space-y-3">
                <input type="hidden" name="productId" value={product.id} />
                <div className="space-y-1.5">
                  <Label htmlFor="attributeLabel">Specification</Label>
                  <Input id="attributeLabel" name="attributeLabel" placeholder="e.g. Max. user weight" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="valueText">Value</Label>
                  <Input id="valueText" name="valueText" placeholder="e.g. 125 kg" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sourceUrl">Source link</Label>
                  <Input id="sourceUrl" name="sourceUrl" type="url" placeholder="https://manufacturer.com/manual.pdf" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="evidenceText">Exact quote (optional)</Label>
                  <Textarea id="evidenceText" name="evidenceText" placeholder="Copy the sentence from the manual" />
                </div>
                <SubmitButton className="w-full" pendingText="Saving…">
                  Add reference
                </SubmitButton>
              </ActionForm>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
