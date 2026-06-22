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

const PICKERS: Partial<Record<ProductTarget["slug"], RoPicker>> = {
  // Sliced white bread 500 g pack (Auchan own-brand "cu maia",
  // Vel Pitar feliata, KB toast). Excludes gluten-free niches,
  // whole-grain (integrala / cu seminte), and bread-derived
  // products (croutons / breadcrumbs / sticks).
  bread_500g: {
    query: "paine alba feliata",
    include: /\bpaine\b/i,
    exclude: [
      /\bfara\s+gluten\b/i,
      /\b(?:integrala?|graham|secara|ovaz|seminte|multicereale)\b/i,
      /\b(?:crutoane|pesmet|stick|sticksuri|biscui?ti?)\b/i,
      /\b(?:dulce|cu ciocolata|cu fructe|cu stafide)\b/i,
      /\b(?:congelat[ăa]?)\b/i,
    ],
    sizeRange: { min: 400, max: 800 },
    unitFromTitle: "g",
  },
  // UHT whole milk in 1 L cartons (Auchan own-brand, Pouce, Mizo,
  // Albalact). Requires both "lapte" and "integral" (whole) so
  // semidegresat (semi-skimmed) and lactose-free variants are
  // rejected as different product classes.
  milk_1l: {
    query: "lapte uht integral 1l",
    include: /\blapte\b.*\bintegral\b/i,
    exclude: [
      /\bfara\s+lactoza\b/i,
      /\b(?:soia|migdale|cocos|ovaz|orez|hemp|amande)\b/i,
      /\b(?:cu\s+ciocolata|capsuni|vanilie|aromat[ăa]?)\b/i,
      /\b(?:iaurt|kefir|smantana|frisca|sana|chefir)\b/i,
      /\b(?:bebe|formula|maternizat|copii)\b/i,
    ],
    sizeRange: { min: 700, max: 1300 },
    unitFromTitle: "ml",
  },
  // Fresh chicken eggs in cartons of 10. The Romanian retail
  // standard is 10 bucati, not 12; normalize.ts scales the price
  // by 12/10 when emitting the canonical observation. Excludes
  // liquid / powdered / dyed-Easter eggs, fish roe, and salads.
  eggs_12: {
    query: "oua gaina 10 bucati",
    include: /\bouas?\b\s+de\s+gaina/i,
    exclude: [
      /\b(?:ciocolata|prajitur|napolitane|tort|biscui?ti?)\b/i,
      /\b(?:icre|caviar|pescaresti?)\b/i,
      /\b(?:salata|gustare|maioneza)\b/i,
      /\b(?:lichide?|pasteurizat[ăa]?|praf)\b/i,
      /\b(?:pasti|paste)\b/i,
    ],
    sizeRange: { min: 6, max: 30 },
    unitFromTitle: "pcs",
  },
  // 200 g butter bar (Lurpak, President, Kerrygold, Auchan
  // own-brand). Excludes nut butters, biscuits-with-butter,
  // clarified ghee, and lard-style "untura".
  butter_200g: {
    query: "unt 200g",
    include: /\bunt\b/i,
    exclude: [
      /\b(?:biscui?ti?|prajitur|napolitane|patiserie|fursecuri)\b/i,
      /\b(?:arahide|migdale|cocos|peanut|cacao|cashew|nuc)\b/i,
      /\b(?:clarificat|ghee)\b/i,
      /\buntura\b/i,
      /\b(?:crema?|spread|tartinabil)\b/i,
    ],
    sizeRange: { min: 100, max: 300 },
    unitFromTitle: "g",
  },
  // White granulated sugar in 1 kg bag (Margaritar, Bod, Coronita,
  // Pouce). Excludes sugar-free cereals, brown / cane / icing
  // sugars (different product classes), and confectionery uses.
  sugar_1kg: {
    query: "zahar alb 1kg",
    include: /\bzahar\b/i,
    exclude: [
      /\bfara\s+zahar\b/i,
      /\b(?:brun|trestie|brut|cocos|cana|caramelizat)\b/i,
      /\b(?:vanilat|pudra|cuburi|sirop|invertat)\b/i,
      /\b(?:fulgi|cereale|musli|granola)\b/i,
      /\b(?:cofetari?|biscui?ti?|prajitur)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // White rice 1 kg bag (Pouce, Atifco, Deroni camolino is the
  // Romanian retail default). Excludes brown / wild / parboiled
  // rice (different classes), dog-food biscuits (the literal
  // string "orez" appears in pet products), rice flour, rice
  // bread, rice cakes, and rice-milk drinks.
  rice_1kg: {
    query: "orez camolino 1kg",
    include: /\borez\b/i,
    exclude: [
      /\b(?:pentru caini|caini|pisici|hrana)\b/i,
      /\b(?:brun|salbatic|paraboiled|integral|basmati|jasmin)\b/i,
      /\b(?:fulgi|prajituri|rondele)\b/i,
      /\b(?:faina|paine|biscui?ti?)\b/i,
      /\b(?:lapte\s+de\s+orez|bautura)\b/i,
      /\b(?:mix|quinoa|bulgur)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Loose fresh red tomatoes per kg (mu=kg branch maps to 1000g).
  // Excludes canned tomato cubes / sauces, cherry / cocktail
  // varieties (different product class), other red produce that
  // collides on the word "rosii" (red): mere rosii (red apples),
  // coacaze rosii (redcurrants), cartofi rosii (red potatoes),
  // ardei rosii (red peppers), and frozen / oven-roasted variants.
  tomatoes_1kg: {
    query: "rosii kg",
    include: /\brosii\b/i,
    exclude: [
      /\b(?:cuburi|in sos|sos de|past[ăa]|piure|concentrat)\b/i,
      /\b(?:cherry|cocktail|prune|prunisor)\b/i,
      /\b(?:mere|coacaze|capsuni|fructe|stafide|cartofi|ardei|ceapa)\b/i,
      /\b(?:cuptor|gratar|congelat[ăa]?|deshidratat)\b/i,
      /\b(?:conserva|conserve|fierte|murate|uscate)\b/i,
      /\b(?:gem|jeleu|jam)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // White potatoes loose or in 5 kg sacks ("Cartofi albi, 5 kg").
  // The sort-by-unit-price step prefers the 5 kg bag (~3 RON/kg)
  // over the 1 kg loose bin when the loose bin is out of stock.
  // Excludes processed potato products (Aviko crochete, frozen
  // fries, mash powder) and sweet potatoes (different class).
  potatoes_1kg: {
    query: "cartofi albi",
    include: /\bcartofi\b/i,
    exclude: [
      /\b(?:aviko|bulete|crochete|piure|stick|chips|cipsuri)\b/i,
      /\b(?:dulci|batat)\b/i,
      /\b(?:congelati?|prajit|copti|gratar|cuptor)\b/i,
      /\b(?:salat|salata|preparat)\b/i,
    ],
    sizeRange: { min: 800, max: 5500 },
    unitFromTitle: "g",
  },
  // Extra-virgin olive oil 1 L bottle (Auchan own-brand, Giana,
  // Monini, Abril). Excludes argan-oil shampoos that pollute the
  // "ulei" search, infant-skin creams, and sunflower / rapeseed
  // oils (different product classes).
  olive_oil_1l: {
    query: "ulei masline extravirgin 1l",
    include: /\bulei\b.*\bm[ăa]sline\b/i,
    exclude: [
      /\b(?:sampon|argan|cosmetic|crema?|lotiune|gel|spray)\b/i,
      /\b(?:floarea\s+soarelui|rapita|porumb|in|susan|nuca)\b/i,
      /\b(?:bebe|copii|infant)\b/i,
      /\b(?:aerosol)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "ml",
  },
  // Still bottled water in a 1.5 L PET bottle (Borsec, Bucovina,
  // Vittel, Aqua Carpatica, Dorna). Excludes sparkling /
  // mineralised / flavoured water, holy water, small 0.33 L
  // bottles, 2 L bidons, and isotonic / vitamin variants.
  water_bottled_1500ml: {
    query: "apa plata 1.5 l",
    include: /\bap[ăa]\b/i,
    exclude: [
      /\b(?:minerala|carbogazoasa|cu\s+bule|spumant[ăa]?)\b/i,
      /\b(?:aromat[ăa]?|cu\s+(?:lamaie|fructe|capsuni|portocale))\b/i,
      /\b(?:bidon|garrafa|canistra|dispenser)\b/i,
      /\b(?:vietii|sfintita|botezata)\b/i,
      /\b(?:oxigenata|alcalina|electrolit|vitaminizat|hidratanta)\b/i,
      /\b(?:tonica|sport|isotonica|izotonica)\b/i,
      /\b(?:colonia|colonie|de\s+toaleta|parfum)\b/i,
      /\b(?:de\s+fier|de\s+calcar|de\s+gradina)\b/i,
    ],
    sizeRange: { min: 1400, max: 1600 },
    unitFromTitle: "ml",
  },
  // Loose fresh bananas per kg (mu=kg branch maps to 1000g).
  // Excludes baby cereal, yogurts, milkshakes, juices, ice
  // cream, energy bars, baked goods that contain "banane" in the
  // title.
  bananas_1kg: {
    query: "banane kg",
    include: /\bbanane\b/i,
    exclude: [
      /\b(?:cereale|gustare|prajitur|tort|biscui?ti?|napolitane)\b/i,
      /\b(?:nectar|suc|piure|smoothie|bautura|baton)\b/i,
      /\b(?:bebelu[șs]i?|copii|maternizat|formula)\b/i,
      /\b(?:chip|cipsuri|deshidratat|uscate|liofilizat)\b/i,
      /\b(?:iaurt|lapte|inghetata|ice\s+cream)\b/i,
      /\b(?:aroma|saborizat|esenta|extract)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Loose fresh apples per kg (Golden / Jonagold / Idared
  // varieties). The probe shows a Filiera Auchan +/- 1 kg loose
  // SKU at ~4.5 RON/kg. Excludes apple juice, cider, vinegar,
  // baby food, shampoo (otet de mere = apple vinegar shows up in
  // hair care).
  apples_1kg: {
    query: "mere golden kg",
    include: /\bmere\b/i,
    exclude: [
      /\b(?:suc|nectar|piure|cidru|otet|sampon|crema?|gel)\b/i,
      /\b(?:cereale|gustare|prajitur|biscui?ti?|tort|napolitane)\b/i,
      /\b(?:bebelu[șs]i?|copii|maternizat|formula)\b/i,
      /\b(?:chips|cipsuri|deshidratat|liofilizat|uscate)\b/i,
      /\b(?:strudel|compot|gem|mermelada)\b/i,
      /\b(?:aroma|esenta|extract|saborizat)\b/i,
    ],
    sizeRange: { min: 600, max: 1200 },
    unitFromTitle: "g",
  },
  // Fresh raw chicken breast, boneless, per-kg tray (La Provincia,
  // Fragedo, Agricola, Safir). Excludes cured / processed cuts
  // (crenvursti = sausages, jambon, salam), breaded / fried,
  // smoked, and other cuts (wings, thighs, gizzards, skin).
  chicken_breast_1kg: {
    query: "piept pui dezosat",
    include: /\bpiept\b.*\bpui\b/i,
    exclude: [
      /\b(?:crenvursti|salam|carnati|caltabos|sunca|jambon|pat[ée]u)\b/i,
      /\b(?:congelat?[ăa]?|panat|pane|breaded|gratinat|afumat[ăa]?)\b/i,
      /\b(?:aripi|pulpe|piele|os|gat|inima|ficat|menudencie)\b/i,
      /\b(?:hamburger|burger|chiftele|nuggets|crispy)\b/i,
      /\b(?:hrana|mancare|conserva|pentru\s+(?:caini|pisici))\b/i,
    ],
    sizeRange: { min: 800, max: 1500 },
    unitFromTitle: "g",
  },
  // Fresh raw ground beef ("carne tocata de vita"). Auchan RO
  // mainly stocks mixed pork-and-beef ground meat; pure-beef is
  // typically a 500 g tray or the organic +/- 1 kg Filiera SKU.
  // Excludes pork, mixed amestec, canned beef stews, dog/cat food,
  // burgers, salads.
  beef_ground_1kg: {
    query: "carne tocata vita",
    include: /\b(?:carne\s+tocata|tocata)\b.*\bvita\b/i,
    exclude: [
      /\b(?:porc|pui|miel|curcan|pasare)\b/i,
      /\b(?:amestec|combinatie|mix)\b/i,
      /\b(?:conserva|conserve|suc\s+propriu|gulas|mazare)\b/i,
      /\b(?:hamburger|burger|chiftele|salam|carnati)\b/i,
      /\b(?:hrana|pentru\s+(?:caini|pisici)|snack)\b/i,
      /\b(?:congelat[ăa]?|afumat[ăa]?|panat|pane)\b/i,
      /\b(?:salata|boeuf|spaghete)\b/i,
    ],
    sizeRange: { min: 400, max: 1100 },
    unitFromTitle: "g",
  },
  // Romanian cow-milk "telemea" (the local fresh white cheese),
  // canonical 500 g portion. Excludes sheep / goat milk variants
  // (different classes), smoked cheese, melted / grated /
  // processed slices.
  cheese_local_500g: {
    query: "telemea vaca",
    include: /\btelemea\b/i,
    exclude: [
      /\b(?:capr[ăa]|capre|oai|oaie|bivolita)\b/i,
      /\b(?:afumat[ăa]?|fumat)\b/i,
      /\b(?:topit|cascaval|feliat|ras|rasa|pudra)\b/i,
      /\b(?:cu\s+(?:verdeturi|ardei|chimen|condimente))\b/i,
    ],
    sizeRange: { min: 300, max: 600 },
    unitFromTitle: "g",
  },
  // Imported beer in 500 ml can ("doza"). The picker prefers
  // recognized international labels over generic Romanian
  // discounters; sort-by-unit-price still picks the cheapest
  // qualifying SKU. Excludes alcohol-free and flavoured
  // variants, multi-packs, and cocktail / cider crossovers.
  beer_imported_500ml: {
    query: "bere blonda doza 500ml",
    include: /\bbere\b/i,
    exclude: [
      /\b(?:fara\s+alcool|nealcoolica|0\.0|0,0)\b/i,
      /\b(?:aroma|fructe|capsuni|lamaie|cocktail|spritz|sidru)\b/i,
      /\b(?:pahar|halba|set|kit|cadou|deschizator)\b/i,
      /\b(?:pack|bax|navet[ăa]|caja|caseta)\b/i,
      /\b(?:malt|maltbeer|drojdie\s+de\s+bere)\b/i,
      /\b(?:rom|whisky|gin|vodka|vin|sampanie)\b/i,
    ],
    sizeRange: { min: 450, max: 550 },
    unitFromTitle: "ml",
  },
};

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
// @scraper: auchan-ro
// @rate-limit: respect retailer crawl policy
// @config: add feature flag toggle
// @perf: monitor allocation pattern here
// @note: coordinated with PR #87
// @guard: validate at component boundary
// @edge: zero-value special case
// @a11y: check contrast ratio here
// @type: export the inner parameter type
