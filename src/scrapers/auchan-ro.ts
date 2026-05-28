/**
 * Auchan Romania scraper, via the VTEX catalog API.
 *
 * Auchan RO runs on the same VTEX platform as Disco AR / Wong PE /
 * Olimpica CO / Chedraui MX. See src/scrapers/disco-ar.ts for the
 * shared design notes (VTEX schema, kg-vs-un measurement split,
 * sanity-aware picker filter).
 *
 * Romania-specific quirks:
 *
 * 1. Eggs ship in cartons of 10 ("oua, 10 bucati"), not 12. The
 *    canonical eggs_12 slug forces a 12/10 scale via normalize.ts;
 *    the picker still parses 10 as the pack size from the title.
 *
 * 2. The Romanian word for "red" is "rosu / rosii", and that string
 *    also names tomatoes. The tomatoes picker has to exclude "mere
 *    rosii" (red apples), "coacaze rosii" (redcurrants), and
 *    "rosii cherry" (cherry tomatoes, a different product class).
 *
 * 3. "Carne de porc si vita" is mixed pork + beef ground meat,
 *    sold as a 500 g tray. The beef picker has to require "vita"
 *    AND exclude "porc" so pure-beef SKUs only.
 *
 * 4. Auchan RO ships two bonus VTEX fields, `Nume unitate` (unit
 *    label, kg / l / buc) and `Cantitate unitate` (numeric quantity
 *    as a string). The parser sticks with title-regex extraction
 *    for consistency with the other VTEX adapters; size is
 *    recoverable from every product title worth picking.
 *
 * 5. The API serves Price 0 for out-of-stock SKUs. The shared
 *    parseProduct already filters them out (price > 0 guard).
 */
import { z } from "zod";

import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const API_BASE = "https://www.auchan.ro";
const FETCH_TIMEOUT_MS = 15_000;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ro-RO,ro;q=0.9,en;q=0.8",
};

const CommertialOfferSchema = z.object({
  Price: z.number().nonnegative(),
  ListPrice: z.number().nonnegative().optional(),
  AvailableQuantity: z.number().nonnegative().optional(),
});

const SellerSchema = z.object({
  sellerId: z.string().optional(),
  sellerDefault: z.boolean().optional(),
  commertialOffer: CommertialOfferSchema,
});

const ItemSchema = z.object({
  itemId: z.string(),
  name: z.string(),
  ean: z.string().optional(),
  measurementUnit: z.string(),
  unitMultiplier: z.number().nonnegative(),
  sellers: z.array(SellerSchema).min(1),
});

const AuchanRoProductSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  brand: z.string().optional(),
  linkText: z.string().optional(),
  items: z.array(ItemSchema).min(1),
});
export type AuchanRoProduct = z.infer<typeof AuchanRoProductSchema>;

const AuchanRoSearchResponseSchema = z.array(AuchanRoProductSchema);

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

  // Litres ("1 l", "1.5 l", "1,5 l", "0.5 l")
  const litre = s.match(
    /(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*l(?:t|ts|itri|itru)?\b/i,
  );
  if (litre) {
    const v = parseFloat(litre[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 50)
      return { value: Math.round(v * 1000), unit: "ml" };
  }
  // Kilograms ("1 kg", "0,5 kg", "1.5kg")
  const kg = s.match(
    /(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*k(?:g|ilogram[ăa]?)\b/i,
  );
  if (kg) {
    const v = parseFloat(kg[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 100)
      return { value: Math.round(v * 1000), unit: "g" };
  }
  // Millilitres ("500 ml", "330ml")
  const ml = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*ml\b/i);
  if (ml) {
    const v = parseInt(ml[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "ml" };
  }
  // Grams ("500 g", "200 gr", "750g")
  const g = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*(?:gr|grame|g)\b/i);
  if (g) {
    const v = parseInt(g[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "g" };
  }
  // Pieces: "10 bucati", "12 buc", "4 bucati"
  const pcs = s.match(
    /(?<![a-zA-Z%\d.,])(\d{1,3})\s*(?:bucati|bucat[ăa]|buc)\b/i,
  );
  if (pcs) {
    const v = parseInt(pcs[1]!, 10);
    if (Number.isFinite(v) && v > 0 && v < 200)
      return { value: v, unit: "pcs" };
  }
  return null;
}

interface ParsedProduct {
  itemId: string;
  title: string;
  priceMajor: number;
  packSize: number;
  packUnit: ParsedUnit;
  sourceUrl: string;
}

export function parseProduct(p: AuchanRoProduct): ParsedProduct | null {
  const item = p.items[0];
  if (!item) return null;
  const seller = item.sellers.find((s) => s.sellerDefault) ?? item.sellers[0]!;
  const price = seller.commertialOffer.Price;
  if (!Number.isFinite(price) || price <= 0) return null;

  const linkText = p.linkText ?? "";
  const sourceUrl = linkText
    ? `${API_BASE}/${linkText}/p`
    : `${API_BASE}/${item.itemId}`;

  if (item.measurementUnit === "kg") {
    return {
      itemId: item.itemId,
      title: p.productName,
      priceMajor: price,
      packSize: 1000,
      packUnit: "g",
      sourceUrl,
    };
  }
  const size = parseSizeFromName(p.productName);
  if (size === null) return null;
  return {
    itemId: item.itemId,
    title: p.productName,
    priceMajor: price,
    packSize: size.value,
    packUnit: size.unit,
    sourceUrl,
  };
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
    const url = `${API_BASE}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}&_from=0&_to=29`;
    const res = await fetchImpl(url, {
      headers: REQUEST_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const raw: unknown = await res.json();
    const parsed = AuchanRoSearchResponseSchema.safeParse(raw);
    if (!parsed.success) return [];
    const out: ParsedProduct[] = [];
    for (const p of parsed.data) {
      const pp = parseProduct(p);
      if (pp) out.push(pp);
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function scrapeAuchanRo(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("auchan-ro");
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
        reason: `auchan-ro returned no candidates for "${picker.query}"`,
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
      retailerSku: match.itemId,
      retailerTitle: match.title,
      priceMajor: match.priceMajor,
      packSize: match.packSize,
      scrapedAt,
      sourceUrl: match.sourceUrl,
    });
  }

  return { retailer: "auchan-ro", scraped, misses };
}
