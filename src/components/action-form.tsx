"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { createContext, startTransition, useActionState, useEffect, useRef } from "react";
import { Alert } from "@/components/ui/alert";
import { initialActionResult, type ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/** Lets SubmitButton show a spinner while this form's action runs. */
export const ActionPendingContext = createContext<boolean | null>(null);

/**
 * A form bound to a server action that shows the action's result message
 * (and, for imports, row-level CSV errors) underneath.
 *
 * Inputs keep what the user typed when the action fails (React would
 * otherwise reset the form), and are cleared only after a success.
 */
export function ActionForm({
  action,
  children,
  className,
  resultClassName,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resultClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionResult);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && state.message) formRef.current?.reset();
  }, [state]);

  return (
    <div className={resultClassName}>
      <form
        ref={formRef}
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(() => formAction(data));
        }}
      >
        <ActionPendingContext.Provider value={pending}>{children}</ActionPendingContext.Provider>
      </form>
      {state.message && (
        <Alert variant={state.ok ? "success" : "destructive"} className="mt-3" aria-live="polite">
          <div className="flex gap-2">
            {state.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
            <p>{state.message}</p>
          </div>
        </Alert>
      )}
      {state.rowErrors && state.rowErrors.length > 0 && (
        <div className={cn("mt-3 rounded-md border bg-card p-3 text-sm")}>
          <p className="mb-2 font-medium">
            {state.rowErrors.length} row{state.rowErrors.length === 1 ? "" : "s"} skipped or with problems:
          </p>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-muted-foreground">
            {state.rowErrors.map((e, i) => (
              <li key={i}>
                {e.row > 0 ? `Row ${e.row}: ` : ""}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
