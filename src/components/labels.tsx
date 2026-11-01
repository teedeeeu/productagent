import { CheckCircle2, CircleHelp, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Confidence, IssueType, Severity, VerificationStatus } from "@/lib/scanner/types";

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function SeverityBadge({ severity }: { severity: Severity | null }) {
  if (!severity) return <Badge variant="success">No issues</Badge>;
  return <Badge variant={severity}>{SEVERITY_LABEL[severity]}</Badge>;
}

export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  contradiction: "Contradiction",
  missing_attribute: "Missing information",
  ambiguous: "Unclear information",
  misleading: "Potentially misleading",
};

export function IssueTypeBadge({ type }: { type: IssueType }) {
  return <Badge variant="outline">{ISSUE_TYPE_LABEL[type]}</Badge>;
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  if (status === "manufacturer_verified")
    return (
      <Badge variant="success" title="Backed by a manufacturer reference with a source link or quote">
        <ShieldCheck className="size-3" /> Manufacturer-verified
      </Badge>
    );
  if (status === "needs_verification")
    return (
      <Badge variant="medium" title="Possible issue — a person should check this">
        <CircleHelp className="size-3" /> Needs verification
      </Badge>
    );
  return (
    <Badge variant="secondary" title="Not yet checked against manufacturer documentation">
      Not verified
    </Badge>
  );
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export function ConfidenceLabel({ confidence }: { confidence: Confidence }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="How sure the scanner is that this is a real issue">
      <CheckCircle2 className="size-3" />
      {CONFIDENCE_LABEL[confidence]}
    </span>
  );
}

export const CATEGORY_LABEL: Record<string, string> = {
  treadmill: "Treadmill",
  walking_pad: "Walking pad",
  rowing_machine: "Rowing machine",
  exercise_bike: "Exercise bike",
  cross_trainer: "Cross trainer",
  unknown: "Uncategorised",
};
