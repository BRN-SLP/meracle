/**
 * Rimi Lithuania scraper, via the public search page on rimi.lt.
 *
 * Same `data-gtm-eec-product` per-card JSON envelope as Rimi EE
 * / Rimi LV; only BASE, SEARCH_PATH, the Lithuanian piece suffix
 * ("vnt." = vienetai), Lithuanian Accept-Language, and the
 * per-country picker tables differ. parseSizeFromName + the
 * extractor are duplicated rather than imported to keep each
 * country adapter independent.
 *
 * Lithuanian-specific quirks:
 *
 * 1. White wheat bread is "balta duona" or "sumuštinių duona";
 *    "juoda duona" is dark rye, kept out of scope. "Skrudinimo
 *    duona TOSTE" is the local toast loaf, also in scope.
 *
 * 2. Eggs ship as 10-piece cartons ("kiaušiniai 10 vnt"), same
 *    canonical 12 / 10 scaling via normalize.ts.
 *
 * 3. Rimi LT does not stock a 500 g hard-cheese pack. The
 *    canonical pick is the 200-300 g Tilsit / Dvaro / Rokiškio
 *    tray; normalize.ts scales the on-chain price by
 *    canonical / packSize so the resulting observation is the
 *    extrapolated 500 g price. The sanityRange in products.ts
 *    is sized for that extrapolated value.
 *
 * 4. Loose produce ends with ", 1 kg" / "1 kl., 1 kg" / "kg";
 *    parseSizeFromName treats all three as a 1000 g pack.
 *
 * 5. Five SKUs lead with a non-ASCII diacritic letter (ė for
 *    bread "duona BEATOS VIRTUVĖ", ū for sugar "Cukrus", ž for
 *    rice "Ryžiai", š for eggs "Šaldyti", and the leading "Ū"
 *    elsewhere). JavaScript's ASCII `\b` would never anchor on
 *    these; the include patterns wrap leading boundaries in a
 *    Unicode lookbehind (same trick as EE apples / beer and LV
 *    rice / udens / aboli).
 */
import { z } from "zod";

import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const BASE = "https://www.rimi.lt";
const SEARCH_PATH = "/e-parduotuve/lt/paieska";
const FETCH_TIMEOUT_MS = 20_000;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept-Language": "lt-LT,lt;q=0.9,en;q=0.5",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};

const RimiCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().optional().default(""),
  brand: z.union([z.string(), z.null()]).optional().default(null),
  price: z.number().nonnegative(),
  currency: z.string().default("EUR"),
});
export type RimiCard = z.infer<typeof RimiCardSchema>;

interface LtPicker {
  query: string;
  include: RegExp;
  exclude: readonly RegExp[];
  sizeRange: { min: number; max: number };
  unitFromTitle?: ParsedUnit;
}

const PICKERS: Partial<Record<ProductTarget["slug"], LtPicker>> = {};

export type ParsedUnit = "ml" | "g" | "pcs";

export function parseSizeFromName(
  name: string,
): { value: number; unit: ParsedUnit } | null {
  const s = name.replace(/\xa0/g, " ");

  // Litres
  const litre = s.match(
    /(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*l(?:t|itras|itrai)?\b/i,
  );
  if (litre) {
    const v = parseFloat(litre[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 50)
      return { value: Math.round(v * 1000), unit: "ml" };
  }
  // Kilograms ("1 kg", "0,5kg", "1.5 kg")
  const kg = s.match(/(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*kg\b/i);
  if (kg) {
    const v = parseFloat(kg[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 100)
      return { value: Math.round(v * 1000), unit: "g" };
  }
  // Loose per-kg trailers, three Lithuanian patterns:
  //   "1 kl., 1 kg" / "1kl,1kg" (produce shelf marker)
  //   ", kg" / ", 1 kg"
  //   "<word> kg" / "<word> KG" at end (used for ground meat
  //   trays like "Atšaldyta smulkinta jautiena RIMI 1 kg" plus
  //   the loose vegetable "Lietuviškos bulvės Gala, kg")
  if (/\b1\s*kl\.?,?\s*1?\s*kg\b/i.test(s)) {
    return { value: 1000, unit: "g" };
  }
  if (/,\s*kg(?:\b|\s)/i.test(s)) return { value: 1000, unit: "g" };
  if (/\s+kg\s*$/i.test(s)) return { value: 1000, unit: "g" };
  // Millilitres
  const ml = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*ml\b/i);
  if (ml) {
    const v = parseInt(ml[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "ml" };
  }
  // Grams ("500g", "200 g", "750gr")
  const g = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*(?:gr|g)\b/i);
  if (g) {
    const v = parseInt(g[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "g" };
  }
  // Pieces, the Lithuanian "vnt." (vienetai) trailer plus the
  // egg-grade "M/L 10vnt" marking.
  const pcs = s.match(/(?<![a-zA-Z%\d.,])(\d{1,3})\s*vnt\.?\b/i);
  if (pcs) {
    const v = parseInt(pcs[1]!, 10);
    if (Number.isFinite(v) && v > 0 && v < 200)
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
      sourceUrl: `${BASE}/e-parduotuve/lt/p/${parsed.data.id}`,
    });
  }
  return out;
}

function pickBestMatch(
  products: ParsedProduct[],
  picker: LtPicker,
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

export async function scrapeRimiLt(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("rimi-lt");
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
        reason: `rimi-lt returned no candidates for "${picker.query}"`,
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

  return { retailer: "rimi-lt", scraped, misses };
}
