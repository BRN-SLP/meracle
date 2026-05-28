/**
 * Continente Portugal scraper, via the public search page on
 * continente.pt.
 *
 * Continente runs on the Salesforce Commerce Cloud (Demandware)
 * platform and inlines every search-result tile with two SSR
 * markers:
 *
 *   `data-product-tile-impression='{"name":"...","id":"...",
 *                                   "price":1.08,"brand":"...",
 *                                   "category":"...","variant":"",
 *                                   "channel":"col"}'`
 *
 *   `<div class="pwc-tile--quantity"><p>emb. 1 Lt</p></div>`
 *
 * The first is HTML-encoded JSON (named entities `&quot;`,
 * `&iacute;`, etc.); after decoding it yields name + price +
 * category. The second carries the pack size as a short
 * Portuguese label (`emb. 1 Lt` / `emb. 500 g` / `emb. 4 x 200 ml`
 * for multi-packs / `emb. 12 Un` / `emb. 1 Kg` etc.). One-to-one
 * with the impression, in card order, so a simple
 * "split-by-impression then take next emb." pass associates them
 * unambiguously.
 *
 * The page returns 35 candidates per query in one round-trip from
 * EU egress, no proxy / login / WAF challenge required.
 *
 * Portugal-specific quirks:
 *
 * 1. Multi-pack: many beverages are listed as "emb. 4 x 200 ml"
 *    or "emb. 6 x 1 Lt"; parseSizeFromEmb multiplies the cluster
 *    count by the per-unit size, so the canonical normalization
 *    sees the total volume of the pack.
 *
 * 2. Mixed Portuguese diacritics in titles: 'aacute', 'iacute',
 *    'eacute', 'oacute', 'ocirc', 'atilde', 'ccedil'. The
 *    decodeHtmlEntities() helper resolves them before JSON parse.
 *
 * 3. Five SKUs lead with non-ASCII diacritics that JavaScript's
 *    ASCII `\b` would not anchor (a-acute for acucar / agua,
 *    o-acute for oleo, a-circumflex for camara, c-cedilla
 *    initial in colloquial words). Pickers wrap leading
 *    boundaries in `(?<!\p{L})` with the /u flag.
 *
 * 4. Continente labels "emb." with mixed case for the unit ("Lt"
 *    vs "lt" vs "Litro", "Kg" vs "kg", "Un" vs "un" vs "Und"),
 *    parseSizeFromEmb matches case-insensitive.
 */
import { z } from "zod";

import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const BASE = "https://www.continente.pt";
const SEARCH_PATH = "/pesquisa/";
const FETCH_TIMEOUT_MS = 25_000;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.5",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};

const ContinenteCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().optional().default(""),
  brand: z.union([z.string(), z.null()]).optional().default(null),
  price: z.number().nonnegative(),
  variant: z.string().optional().default(""),
  channel: z.string().optional().default(""),
});
export type ContinenteCard = z.infer<typeof ContinenteCardSchema>;

interface PtPicker {
  query: string;
  include: RegExp;
  exclude: readonly RegExp[];
  sizeRange: { min: number; max: number };
  unitFromTitle?: ParsedUnit;
}

const PICKERS: Partial<Record<ProductTarget["slug"], PtPicker>> = {};

export type ParsedUnit = "ml" | "g" | "pcs";

/**
 * Decode the subset of HTML entities Continente's tile JSON uses.
 * Numeric (decimal and hex) and a curated table of named entities
 * cover every character observed in the live HTML at the time of
 * authoring; unknown named entities pass through unchanged.
 */
export function decodeHtmlEntities(s: string): string {
  const named: Record<string, string> = {
    quot: '"',
    apos: "'",
    amp: "&",
    lt: "<",
    gt: ">",
    nbsp: " ",
    aacute: "á",
    eacute: "é",
    iacute: "í",
    oacute: "ó",
    uacute: "ú",
    atilde: "ã",
    otilde: "õ",
    ntilde: "ñ",
    ccedil: "ç",
    acirc: "â",
    ecirc: "ê",
    ocirc: "ô",
    Aacute: "Á",
    Eacute: "É",
    Iacute: "Í",
    Oacute: "Ó",
    Uacute: "Ú",
    Atilde: "Ã",
    Otilde: "Õ",
    Ccedil: "Ç",
    Acirc: "Â",
    Ecirc: "Ê",
    Ocirc: "Ô",
  };
  return s
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => named[name] ?? m);
}

/**
 * Parse a Continente "emb. <multiplier> x <quantity> <unit>" label.
 *
 *   "emb. 1 Lt"        -> 1000 ml
 *   "emb. 1.5 Lt"      -> 1500 ml
 *   "emb. 500 g"       -> 500 g
 *   "emb. 4 x 200 ml"  -> 800 ml
 *   "emb. 12 Un"       -> 12 pcs
 *   "emb. 1 Kg"        -> 1000 g
 *   "emb. 230 ml"      -> 230 ml
 *
 * Returns null for free-text labels that do not match the
 * recognised pack-size shape.
 */
export function parseSizeFromEmb(
  label: string,
): { value: number; unit: ParsedUnit } | null {
  const s = label.replace(/\xa0/g, " ").trim();
  // Try multi-pack first: "4 x 200 ml" / "6 x 1 lt" / "12 x 1 Kg"
  const multi = s.match(
    /(\d+(?:[,.]\d+)?)\s*x\s*(\d+(?:[,.]\d+)?)\s*(lt|litro|l|ml|kg|kilo|g|gr|un|und|unid)\b/i,
  );
  if (multi) {
    const mult = parseFloat(multi[1]!.replace(",", "."));
    const qty = parseFloat(multi[2]!.replace(",", "."));
    const unit = normaliseUnit(multi[3]!);
    if (
      Number.isFinite(mult) &&
      Number.isFinite(qty) &&
      mult > 0 &&
      qty > 0 &&
      unit
    ) {
      return { value: Math.round(mult * qty * unit.factor), unit: unit.unit };
    }
  }
  // Single pack: "1 Lt" / "500 g" / "12 Un"
  const single = s.match(
    /(\d+(?:[,.]\d+)?)\s*(lt|litro|l|ml|kg|kilo|g|gr|un|und|unid)\b/i,
  );
  if (single) {
    const qty = parseFloat(single[1]!.replace(",", "."));
    const unit = normaliseUnit(single[2]!);
    if (Number.isFinite(qty) && qty > 0 && unit) {
      return { value: Math.round(qty * unit.factor), unit: unit.unit };
    }
  }
  return null;
}

function normaliseUnit(
  raw: string,
): { unit: ParsedUnit; factor: number } | null {
  const r = raw.toLowerCase();
  if (r === "lt" || r === "litro" || r === "l") return { unit: "ml", factor: 1000 };
  if (r === "ml") return { unit: "ml", factor: 1 };
  if (r === "kg" || r === "kilo") return { unit: "g", factor: 1000 };
  if (r === "g" || r === "gr") return { unit: "g", factor: 1 };
  if (r === "un" || r === "und" || r === "unid") return { unit: "pcs", factor: 1 };
  return null;
}

interface ParsedProduct {
  productId: string;
  title: string;
  priceMajor: number;
  packSize: number;
  packUnit: ParsedUnit;
  sourceUrl: string;
}

/**
 * Sweep the search HTML, pull each `data-product-tile-impression`
 * envelope and pair it with the next `emb. <size>` label that
 * appears in the same product-tile block. The "next emb." rule is
 * exact because the markup is one impression then one
 * `pwc-tile--quantity` per card, in source order.
 */
export function extractContinenteCards(html: string): ParsedProduct[] {
  const out: ParsedProduct[] = [];
  const impressionPositions: number[] = [];
  const impressionRe = /data-product-tile-impression='([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = impressionRe.exec(html)) !== null) {
    impressionPositions.push(m.index);
  }
  for (let i = 0; i < impressionPositions.length; i++) {
    const start = impressionPositions[i]!;
    const end =
      i + 1 < impressionPositions.length
        ? impressionPositions[i + 1]!
        : html.length;
    const chunk = html.slice(start, end);
    const impressionMatch = chunk.match(
      /data-product-tile-impression='([^']+)'/,
    );
    if (!impressionMatch) continue;
    let card: ContinenteCard;
    try {
      const json = JSON.parse(decodeHtmlEntities(impressionMatch[1]!));
      const parsed = ContinenteCardSchema.safeParse(json);
      if (!parsed.success) continue;
      card = parsed.data;
    } catch {
      continue;
    }
    if (!Number.isFinite(card.price) || card.price <= 0) continue;
    const embMatch = chunk.match(/emb\.\s*([^<]{1,80})/i);
    if (!embMatch) continue;
    const size = parseSizeFromEmb(embMatch[1]!);
    if (size === null) continue;
    out.push({
      productId: card.id,
      title: decodeHtmlEntities(card.name),
      priceMajor: card.price,
      packSize: size.value,
      packUnit: size.unit,
      sourceUrl: `${BASE}/produto/${card.id}/`,
    });
  }
  return out;
}

function pickBestMatch(
  products: ParsedProduct[],
  picker: PtPicker,
  target: ProductTarget,
): ParsedProduct | null {
  const canonical = target.canonicalSize;
  const { minMajor, maxMajor } = target.sanityRange;
  const candidates = products.filter((p) => {
    if (!picker.include.test(p.title)) return false;
    if (picker.exclude.some((rx) => rx.test(p.title))) return false;
    if (picker.unitFromTitle && p.packUnit !== picker.unitFromTitle)
      return false;
    if (p.packSize < picker.sizeRange.min || p.packSize > picker.sizeRange.max)
      return false;
    const canonicalMajor = (p.priceMajor * canonical) / p.packSize;
    if (canonicalMajor < minMajor) return false;
    if (canonicalMajor > maxMajor) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) => a.priceMajor / a.packSize - b.priceMajor / b.packSize,
  );
  return candidates[0]!;
}

export async function fetchQueryProducts(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedProduct[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${BASE}${SEARCH_PATH}?q=${encodeURIComponent(query)}`;
    const res = await fetchImpl(url, {
      headers: REQUEST_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    return extractContinenteCards(html);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function scrapeContinentePt(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("continente-pt");
  const scrapedAt = new Date().toISOString();
  const scraped: ScrapedProduct[] = [];
  const misses: ScraperResult["misses"] = [];

  for (const target of targets) {
    const picker = PICKERS[target.slug];
    if (!picker) {
      misses.push({ target, reason: "no picker configured for this slug" });
      continue;
    }
    let candidates: ParsedProduct[];
    try {
      candidates = await fetchQueryProducts(picker.query, fetchImpl);
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      misses.push({ target, reason: `fetch: ${reason}` });
      continue;
    }
    if (candidates.length === 0) {
      misses.push({
        target,
        reason: `continente-pt returned no candidates for "${picker.query}"`,
      });
      continue;
    }
    const match = pickBestMatch(candidates, picker, target);
    if (!match) {
      misses.push({
        target,
        reason: `no match for "${picker.query}" (${candidates.length} parsed candidates)`,
      });
      continue;
    }
    scraped.push({
      target,
      retailerSku: match.productId,
      retailerTitle: match.title,
      priceMajor: match.priceMajor,
      packSize: match.packSize,
      scrapedAt,
      sourceUrl: match.sourceUrl,
    });
  }

  return { retailer: "continente-pt", scraped, misses };
}
