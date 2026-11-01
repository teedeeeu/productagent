import { CheckCircle2, Download, MinusCircle, XCircle } from "lucide-react";
import { importCsvAction, updateStoreNameAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { getDataStore } from "@/lib/data";
import { configurationStatus } from "@/lib/env";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Settings · Agent Commerce QA" };

function StatusRow({
  label,
  state,
  detail,
}: {
  label: string;
  state: "ok" | "missing" | "optional";
  detail: string;
}) {
  const Icon = state === "ok" ? CheckCircle2 : state === "missing" ? XCircle : MinusCircle;
  const color = state === "ok" ? "text-emerald-600" : state === "missing" ? "text-red-600" : "text-muted-foreground";
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </li>
  );
}

export default async function SettingsPage() {
  const ds = await getDataStore();
  const store = await ds.getOrCreateStore();
  const products = await ds.listProducts(store.id);
  const status = configurationStatus();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Store details, product import and connections.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Store information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ActionForm action={updateStoreNameAction} className="flex max-w-md items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="name">Store name</Label>
              <Input id="name" name="name" defaultValue={store.name} required maxLength={200} />
            </div>
            <SubmitButton variant="outline" pendingText="Saving…">
              Save
            </SubmitButton>
          </ActionForm>
          <dl className="grid max-w-md grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Products imported</dt>
            <dd>{products.length}</dd>
            <dt className="text-muted-foreground">Last import</dt>
            <dd>{formatDateTime(store.lastImportAt)}</dd>
            <dt className="text-muted-foreground">Signed in as</dt>
            <dd className="truncate">{ds.viewer.email}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card id="import">
        <CardHeader>
          <CardTitle>Import products from CSV</CardTitle>
          <CardDescription>
            Upload the example format, or the file from your Shopify admin (Products → Export → CSV). Products with the
            same product ID are updated. Nothing is deleted. Up to 10 MB.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ActionForm action={importCsvAction} className="space-y-4">
            <Input name="file" type="file" accept=".csv,text/csv" required aria-label="CSV file" className="max-w-md" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="scanAfterImport" defaultChecked className="size-4 accent-current" />
              Scan the imported products right away
            </label>
            <div className="flex flex-wrap gap-2">
              <SubmitButton pendingText="Importing…">Import</SubmitButton>
              <a href="/samples/example-products.csv" download className={buttonVariants({ variant: "outline" })}>
                <Download /> Example CSV
              </a>
            </div>
          </ActionForm>
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">CSV columns</summary>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li><code>product_id</code> and <code>title</code> (required)</li>
              <li><code>description</code> (text or HTML), <code>vendor</code>, <code>product_type</code>, <code>product_url</code></li>
              <li><code>specifications</code> and <code>metafields</code>: <code>Label: value | Label: value</code></li>
              <li><code>variants</code>: <code>Black | White</code></li>
              <li><code>manufacturer_url</code> and <code>manufacturer_specifications</code>: values from the manufacturer&apos;s documentation</li>
            </ul>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Shopify connection</CardTitle>
            <Badge variant="secondary">Coming soon</Badge>
          </div>
          <CardDescription>
            A read-only connection that imports products, variants and metafields automatically. It cannot change
            anything in your store. Until then, use the Shopify CSV export above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" disabled>
            Connect Shopify
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API configuration status</CardTitle>
          <CardDescription>Keys are stored on the server only. This page shows whether each one is set, never its value.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            <StatusRow
              label="Database (Supabase)"
              state={status.supabase ? "ok" : "missing"}
              detail={status.supabase ? "Connected. Accounts and data are stored securely." : "Not configured. Running in local demo mode."}
            />
            <StatusRow
              label="AI analysis (OpenAI)"
              state={status.openai ? "ok" : "optional"}
              detail={
                status.openai
                  ? `Key set${status.openaiModel ? `, model ${status.openaiModel}` : ""}. AI checks are added in the next update.`
                  : "Optional. Without it, only the rule-based checks run (no AI costs)."
              }
            />
            <StatusRow
              label="Shopify app credentials"
              state={status.shopifyApp ? "ok" : "optional"}
              detail={status.shopifyApp ? "Set." : "Optional. Needed for the direct Shopify connection."}
            />
            <StatusRow
              label="Token encryption key"
              state={status.tokenEncryptionKey ? "ok" : "optional"}
              detail={status.tokenEncryptionKey ? "Set." : "Needed together with the Shopify connection."}
            />
            <StatusRow
              label="Scan limits"
              state="ok"
              detail={`Up to ${status.maxProductsPerScan} products per scan · up to ${status.maxLlmCallsPerScan} AI calls per scan.`}
            />
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
