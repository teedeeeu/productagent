"use client";

import { Loader2 } from "lucide-react";
import { useContext } from "react";
import { useFormStatus } from "react-dom";
import { ActionPendingContext } from "@/components/action-form";
import { Button, type ButtonProps } from "@/components/ui/button";

/** Submit button that shows a spinner while its form's server action runs. */
export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const formStatus = useFormStatus();
  const pending = useContext(ActionPendingContext) ?? formStatus.pending;
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending && <Loader2 className="animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}
