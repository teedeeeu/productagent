/** Text helpers: HTML → plain text, sentence and clause splitting. */

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&euml;": "ë",
  "&eacute;": "é",
  "&egrave;": "è",
  "&ouml;": "ö",
  "&uuml;": "ü",
  "&deg;": "°",
  "&ndash;": "–",
  "&mdash;": "—",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;|&#39;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
}

/**
 * Convert description HTML into plain text lines. Table rows become
 * "Label: value" lines so spec tables embedded in descriptions are read the
 * same way as a specification list.
 */
export function htmlToText(html: string): string {
  if (!html) return "";
  let s = html;
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Table rows: <tr><td>Label</td><td>Value</td></tr> → "Label: Value"
  s = s.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, row: string) => {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    );
    if (cells.length >= 2 && cells[0]) return `\n${cells[0].replace(/:$/, "")}: ${cells.slice(1).join(" ")}\n`;
    return `\n${cells.join(" ")}\n`;
  });
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|h[1-6]|ul|ol|table|section)>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "\n• ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Split into sentences (and lines). Keeps decimal points intact. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9À-Ý•])/)
    .map((s) => s.replace(/^•\s*/, "").trim())
    .filter((s) => s.length > 1);
}

/**
 * Split a sentence into clauses: commas (not decimal commas), semicolons,
 * parentheses and the words "and/en/und". Used so that each measured value is
 * associated with the words closest to it.
 */
export function splitClauses(sentence: string, splitParens = false): string[] {
  const re = splitParens
    ? /(?<!\d),|,(?!\d)|;|\(|\)|\s+(?:en|and|und|maar|but|terwijl|whereas)\s+/i
    : /(?<!\d),|,(?!\d)|;|\s+(?:en|and|und|maar|but|terwijl|whereas)\s+/i;
  return sentence
    .split(re)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Clause split that also splits on "/" and "|" — for power values like "1 PK continu / 2 PK piek". */
export function splitPowerSegments(text: string): string[] {
  return splitClauses(text, true)
    .flatMap((c) => c.split(/\s\/\s|\||\s-\s|\s–\s/))
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Match "Label: value" lines (used for spec tables inside descriptions). */
export function parseKeyValueLine(line: string): { key: string; value: string } | null {
  const m = /^([^:]{2,60}):\s*(.+)$/.exec(line.trim());
  if (!m) return null;
  // Avoid treating ordinary sentences with a colon as a spec line.
  if (m[1].split(/\s+/).length > 7) return null;
  return { key: m[1].trim(), value: m[2].trim() };
}

export function truncate(s: string, max = 240): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
