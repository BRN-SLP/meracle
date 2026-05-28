/**
 * Rimi Estonia scraper, via the public search page on rimi.ee.
 *
 * Why this shape:
 *   - rimi.ee renders search results server-side; every product
 *     card carries a `data-gtm-eec-product` HTML attribute holding
 *     a JSON envelope: `{"id": "...", "name": "...", "category":
 *     "...", "brand": null, "price": 1.29, "currency": "EUR"}`.
 *     The same node also has `data-product-code` (SKU) and an
 *     `<a href="...">` pointing at the canonical product URL.
 *   - The page returns 40-item search batches from a plain
 *     `node:fetch` over EU egress, no proxy, no login, no
 *     Browser Use credit. Same recipe as Auchan PL, different
 *     attribute name.
 *   - The same template is served on rimi.lv (Latvia) and
 *     rimi.lt (Lithuania), so a future LV / LT adapter can reuse
 *     `extractRimiCards` and `parseRimiCard` verbatim and only
 *     swap the base URL and picker tables.
 *
 * Estonian-specific quirks:
 *
 * 1. "Piim" means milk; "või" means butter; "leib" means dark
 *    rye bread, "sai" means white wheat bread. The canonical
 *    bread_500g target picks white "sai" (the closest analogue to
 *    the other countries' white sandwich loaves) and excludes
 *    dark rye loaves.
 *
 * 2. Eggs sell as 10-piece cartons ("kanamunad 10tk"), not 12.
 *    normalize.ts scales the on-chain price by 12/10 so the
 *    canonical observation is comparable across countries.
 *
 * 3. Loose produce uses the suffix "1kl, kg" (per-kg) inside the
 *    title, e.g. "Tomat 1kl, kg" or "Banaan Cavendish 1kl, kg".
 *    The size parser recognises the bare "kg" trailer and treats
 *    such items as 1 kg packs.
 *
 * 4. Estonian uses "tk" (tükki) for pieces, "prk" / "purk" for
 *    can, "klp" / "klaaspudel" for glass bottle. Pack sizes are
 *    always inside the title, no separate field is needed.
 */
import { z } from "zod";

import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const BASE = "https://www.rimi.ee";
const SEARCH_PATH = "/epood/ee/otsing";
const FETCH_TIMEOUT_MS = 20_000;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept-Language": "et-EE,et;q=0.9,en;q=0.5",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};

// Schema for the per-card JSON envelope. Rimi inlines this as a
// single-quoted JSON literal inside `data-gtm-eec-product='...'`.
const RimiCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().optional().default(""),
  brand: z.union([z.string(), z.null()]).optional().default(null),
  price: z.number().nonnegative(),
  currency: z.string().default("EUR"),
});
export type RimiCard = z.infer<typeof RimiCardSchema>;

interface RoPicker {
  query: string;
  include: RegExp;
  exclude: readonly RegExp[];
  sizeRange: { min: number; max: number };
  unitFromTitle?: ParsedUnit;
}

const PICKERS: Partial<Record<ProductTarget["slug"], RoPicker>> = {};

export type ParsedUnit = "ml" | "g" | "pcs";

export function parseSizeFromName(
  name: string,
): { value: number; unit: ParsedUnit } | null {
  const s = name.replace(/\xa0/g, " ");

  // Litres ("1l", "1,5l", "1.5 l", "0,5l")
  const litre = s.match(
    /(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*l(?:t|iter|iitrit)?\b/i,
  );
  if (litre) {
    const v = parseFloat(litre[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 50)
      return { value: Math.round(v * 1000), unit: "ml" };
  }
  // Kilograms ("1kg", "0,5kg", "1.5 kg")
  const kg = s.match(/(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*kg\b/i);
  if (kg) {
    const v = parseFloat(kg[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 100)
      return { value: Math.round(v * 1000), unit: "g" };
  }
  // Loose per-kg, the Estonian "1kl, kg" tail. The card lists a
  // standard kilo SKU even though the on-shelf price is per kilo.
  if (/\b1kl,?\s*kg\b/i.test(s) || /,\s*kg\s*$/i.test(s)) {
    return { value: 1000, unit: "g" };
  }
  // Millilitres ("500ml", "330 ml")
  const ml = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*ml\b/i);
  if (ml) {
    const v = parseInt(ml[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "ml" };
  }
  // Grams ("500g", "200 g", "750g")
  const g = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*g\b/i);
  if (g) {
    const v = parseInt(g[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "g" };
  }
  // Pieces, the Estonian "tk" (tükki) trailer.
  // Also handles "M10" / "L10" / "M/L 10" Õrrekanade marking.
  const pcs = s.match(/(?<![a-zA-Z%\d.,])(\d{1,3})\s*tk\b/i);
  if (pcs) {
    const v = parseInt(pcs[1]!, 10);
    if (Number.isFinite(v) && v > 0 && v < 200)
      return { value: v, unit: "pcs" };
  }
  const eggGrade = s.match(/\b[MLS]\s*(\d{1,2})\b/);
  if (eggGrade) {
    const v = parseInt(eggGrade[1]!, 10);
    if (Number.isFinite(v) && v >= 6 && v <= 30)
      return { value: v, unit: "pcs" };
  }
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
 * Sweep the search HTML and pull every `data-gtm-eec-product`
 * JSON envelope into a typed array. Cards whose JSON does not
 * parse, lack a price, or lack a usable pack-size in the title
 * are dropped here, so downstream pickers see only viable rows.
 */
export function extractRimiCards(html: string): ParsedProduct[] {
  const out: ParsedProduct[] = [];
  const re = /data-gtm-eec-product='([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let raw: unknown;
    try {
      raw = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    const parsed = RimiCardSchema.safeParse(raw);
    if (!parsed.success) continue;
    if (!Number.isFinite(parsed.data.price) || parsed.data.price <= 0) continue;
    const size = parseSizeFromName(parsed.data.name);
    if (size === null) continue;
    out.push({
      productId: parsed.data.id,
      title: parsed.data.name,
      priceMajor: parsed.data.price,
      packSize: size.value,
      packUnit: size.unit,
      sourceUrl: `${BASE}/epood/ee/p/${parsed.data.id}`,
    });
  }
  return out;
}

function pickBestMatch(
  products: ParsedProduct[],
  picker: RoPicker,
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
    const url = `${BASE}${SEARCH_PATH}?query=${encodeURIComponent(query)}`;
    const res = await fetchImpl(url, {
      headers: REQUEST_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    return extractRimiCards(html);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function scrapeRimiEe(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("rimi-ee");
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
        reason: `rimi-ee returned no candidates for "${picker.query}"`,
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

  return { retailer: "rimi-ee", scraped, misses };
}
