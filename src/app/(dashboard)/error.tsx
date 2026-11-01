"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Card className="mx-auto mt-10 max-w-md">
      <CardHeader>
        <CardTitle>Something went wrong</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>We couldn&apos;t load this page. This is usually a temporary connection problem.</p>
        <Button onClick={reset}>Try again</Button>
      </CardContent>
    </Card>
  );
}
