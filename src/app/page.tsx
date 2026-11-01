// Temporary landing page. The dashboard (Overview, Products, Settings) is built in phase 6.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Agent Commerce QA</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        Find product information that could confuse AI shopping assistants and cost you sales.
      </p>
      <p className="text-sm text-zinc-500">
        The scanning engine and CSV import are ready. The dashboard is under construction.
      </p>
      <a
        href="/samples/example-products.csv"
        download
        className="w-fit rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Download example CSV
      </a>
    </main>
  );
}
