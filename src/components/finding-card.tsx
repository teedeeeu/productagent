import { ArrowRight, Quote } from "lucide-react";
import { setFindingStatusAction } from "@/app/actions";
import { ConfidenceLabel, IssueTypeBadge, SeverityBadge, VerificationBadge } from "@/components/labels";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent } from "@/components/ui/card";
import type { FindingRecord } from "@/lib/data/types";
import { formatDateTime } from "@/lib/utils";

const SEVERITY_BORDER = {
  critical: "border-l-red-700",
  high: "border-l-orange-500",
  medium: "border-l-amber-400",
  low: "border-l-sky-400",
} as const;

export function SafeLink({ href }: { href: string }) {
  // Only http(s) links are rendered as links.
  if (!/^https?:\/\//i.test(href)) return <span>{href}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline underline-offset-2">
      {href}
    </a>
  );
}

export function FindingCard({ finding }: { finding: FindingRecord }) {
  const inactive = finding.status !== "open";
  return (
    <Card className={`border-l-4 ${SEVERITY_BORDER[finding.severity]} ${inactive ? "opacity-70" : ""}`}>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={finding.severity} />
              <IssueTypeBadge type={finding.issueType} />
              <VerificationBadge status={finding.verificationStatus} />
              <ConfidenceLabel confidence={finding.confidence} />
            </div>
            <h3 className="font-semibold">{finding.title}</h3>
          </div>
          <form action={setFindingStatusAction}>
            <input type="hidden" name="findingId" value={finding.id} />
            <input type="hidden" name="productId" value={finding.productId} />
            {finding.status === "open" ? (
              <>
                <input type="hidden" name="status" value="dismissed" />
                <SubmitButton variant="outline" size="sm" pendingText="Saving…" title="Hide this finding; it stays hidden in future scans">
                  Dismiss
                </SubmitButton>
              </>
            ) : finding.status === "dismissed" ? (
              <>
                <input type="hidden" name="status" value="open" />
                <SubmitButton variant="outline" size="sm" pendingText="Saving…">
                  Reopen
                </SubmitButton>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Resolved — no longer found</span>
            )}
          </form>
        </div>

        <p className="text-sm leading-relaxed">{finding.explanation}</p>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Evidence</p>
          <ul className="space-y-2">
            {finding.evidence.map((e, i) => (
              <li key={i} className="rounded-md bg-muted/60 p-3 text-sm">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {e.sourceLabel}
                  {e.value ? ` · ${e.value}` : ""}
                </p>
                <p className="flex gap-2">
                  <Quote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="whitespace-pre-line">{e.text}</span>
                </p>
                {e.source.field === "manufacturer" && e.source.url && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Source: <SafeLink href={e.source.url} />
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-md border bg-card p-3 text-sm">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Recommended action</p>
          <p>{finding.recommendedAction}</p>
          {finding.suggestedCorrections.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t pt-3">
              {finding.suggestedCorrections.map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{c.sourceLabel}:</span>
                  <span className="rounded bg-red-50 px-1.5 text-red-900 line-through decoration-red-400">{c.currentValue}</span>
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                  <span className="rounded bg-emerald-50 px-1.5 font-medium text-emerald-900">{c.suggestedValue}</span>
                  <span className="text-xs text-muted-foreground">per manufacturer reference</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          First found {formatDateTime(finding.createdAt)}
          {finding.reviewedAt && finding.status === "dismissed" ? ` · dismissed ${formatDateTime(finding.reviewedAt)}` : ""}
        </p>
      </CardContent>
    </Card>
  );
}


