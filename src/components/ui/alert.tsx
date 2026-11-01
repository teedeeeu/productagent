import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const alertVariants = cva("relative w-full rounded-lg border px-4 py-3 text-sm", {
  variants: {
    variant: {
      default: "bg-card text-card-foreground",
      info: "border-sky-200 bg-sky-50 text-sky-950",
      warning: "border-amber-200 bg-amber-50 text-amber-950",
      destructive: "border-red-200 bg-red-50 text-red-950",
      success: "border-emerald-200 bg-emerald-50 text-emerald-950",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Alert({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}
