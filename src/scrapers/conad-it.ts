/**
 * Conad Italy scraper, via direct HTTP fetch of category pages.
 *
 * Conad's online store (spesaonline.conad.it) ships every category
 * page at /c/<slug>-<code> as a server-rendered HTML document with
 * embedded `data-product="{...}"` cards on each tile. Each card
 * carries the full SKU JSON (code, nome, netQuantity, netQuantityUm,
 * basePrice). For most categories an anonymous fetch returns the
 * nationally-uniform shelf price, which is what we want.
 *
 * Earlier the scraper drove a remote chromium against /search?q=<X>
 * via Browser Use Cloud, but that path turned out to be broken: the
 * /search SSR returns the default 40-product catalog regardless of
 * query (the real search runs client-side via the SAP OCC API). The
 * old wait-for-priced-card condition was satisfied immediately by
 * the SSR default, so the scraper extracted the default catalog for
 * every slug and `acqua minerale` was the only entry that happened
 * to match a picker regex (water_bottled_1500ml).
 *
 * Category URLs are stable. Anonymous prices are present for ~10 of
 * the 16 slugs. Fresh produce (tomatoes, potatoes, bananas, apples),
 * beef and beer remain unpriced without a store cookie; they report
 * cleanly as misses and a follow-up pass can re-introduce the store
 * selection flow without rolling back this simpler path.
 *
 * Picker config lives next to the scraper, NOT in ProductTarget, so
 * ProductTarget stays retailer-agnostic.
 */
import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const BASE = "https://spesaonline.conad.it";

// Curl-equivalent headers a typical desktop Chrome ships. Conad's edge
// does not gate the category SSR behind a bot fingerprint check, but a
// plain `node:fetch` UA still trips a "low-confidence" filter that
// strips ~half the cards. The desktop UA + it-IT Accept-Language is
// stable.
const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};

// Per-fetch timeout. Category pages are 700kB to 1.4MB so 20 s is a
// generous safety margin.
const FETCH_TIMEOUT_MS = 20_000;

interface ConadPicker {
  /**
   * Category page path under BASE. Conad ships these as
   * `/c/<human-slug>-<numeric-code>`. The numeric code is the only
   * stable part across redesigns; the human slug is the SEO label.
   */
  category: string;
  /** Product name (nome) must match. */
  include: RegExp;
  /** Product name MUST NOT match. */
  exclude: readonly RegExp[];
  /** Pack size in target.unit (g or mL or pcs). */
  sizeRange: { min: number; max: number };
  /**
   * Override the netQuantity-derived pack size by extracting a piece
   * count from the product title. Used for slugs measured in pieces
   * (eggs, yogurt cups) where Conad reports weight in KG. The first
   * non-empty capture group is parsed as an integer. If the regex
   * does not match a candidate, that candidate is dropped (no
   * fallback to the weight-derived size, otherwise we would let in
   * obviously wrong matches).
   */
  pcsFromTitle?: RegExp;
}

const PICKERS: Partial<Record<ProductTarget["slug"], ConadPicker>> = {
  // Whole milk (latte intero). Italian milk is sold UHT (long-life,
  // 1 L bricks) and fresco (refrigerated, 1 L bottles). Conad's
  // own-brand "Latte Intero UHT 1 L" is the mass-market staple.
  // sizeRange 800 to 1100 ml allows for the rare 900 / 1000 / 1050 ml
  // variant, normalize.ts rescales to canonical 1000.
  milk_1l: {
    category: "/c/latte--0404",
    // Inside the /c/latte category, the cheapest priced whole milk
    // ships as "Più Tempo ... Pastorizzato Intero" with no "latte"
    // token in the name (it's implied by the category). Match on
    // `intero` alone and let the exclude list strip skimmed and
    // plant-based variants.
    include: /\bintero\b/i,
    exclude: [
      /\b(scremato|parzialmente|delattosato|senza lattosio|cappuccino|cacao|cioccolat|caffè|caffe|fragola|vaniglia|miele|condensato|polvere|infante|crescita|bevanda|soia|riso|mandorla|cocco|avena|kefir|yogurt|panna|crema|alta digeribilità)\b/i,
    ],
    sizeRange: { min: 800, max: 1100 },
  },
  // Fresh eggs, 6-pack standard. Conad ships "6 Uova Fresche da
  // Galline Allevate a Terra" at EUR 1.99 (probed live). 12-packs
  // (the catalog canonical) and 10-packs both exist; sizeRange 6 to 12
  // catches all, normalize.ts rescales 6 / 10 / 12 to per-12 price.
  //
  // Conad reports the SKU netQuantity as the carton WEIGHT in KG
  // (0.381 KG for 6 eggs) but our slug measures pieces. Use
  // `pcsFromTitle` to recover the count from the product name. Two
  // alternative shapes:
  //   - "6 Uova Fresche..."        -> capture 1
  //   - "Uova medie x 10..."       -> capture 2
  eggs_12: {
    category: "/c/uova-di-gallina--0406",
    include: /\buova\b/i,
    exclude: [
      /\b(quaglia|anatra|oca|cioccolat|pasqua|paste|tortelloni|ravioli|tagliatell|gelato|maionese|liquid|albume|tuorlo)\b/i,
    ],
    sizeRange: { min: 6, max: 12 },
    pcsFromTitle: /\b(\d{1,2})\s+uova\b|\buova\b[^0-9]{0,30}\bx\s*(\d{1,2})\b/i,
  },
  // Butter (burro). Italian standard sizes: 125g / 200g / 250g /
  // 500g bricks. The canonical 200g slug matches the 200 to 250g
  // typical pack. sizeRange 180 to 300g catches 200g and 250g,
  // normalize.ts rescales to per-200g.
  butter_200g: {
    category: "/c/burro-e-margarina--0402",
    include: /\bburro\b/i,
    exclude: [
      /\b(margarina|spalmabile|chiarificato|ghi|anidro|cacao|cioccolat|noci|nocciol|arachidi|sesamo|mandorl|spread|biscott|brioche|crema|salat|aromatizzat)\b/i,
    ],
    sizeRange: { min: 180, max: 300 },
  },
  // Hard cheese wedges. Italy's mass-market staple is Parmigiano
  // Reggiano / Grana Padano in 200 to 500g wedges. Conad ships these
  // alongside Asiago, Pecorino, Provolone, Caciocavallo. The picker
  // accepts any hard or aged cheese variant; cheapest per pack wins.
  // After normalize.ts rescaling to canonical 500g, the on-chain
  // price is priceMajor * (500 / packSize).
  cheese_local_500g: {
    category: "/c/formaggi--0401",
    include:
      /\b(parmigiano|grana padano|grana|asiago|pecorino|provolone|caciocavallo|fontina|montasio|gruviera|emmental|sbrinz)\b/i,
    // Excludes match prefix-stems (no trailing \b) so `fett` strikes
    // both `Fette` (slices) and `Fettine`, matching Italian morphology.
    exclude: [
      /\b(grattugia|grattugiat|fiocchi|scaglie|fuso|spalmabile|fett|cubett|tagliat|filant|stick|snack|portatile|baby|porzion)/i,
      /\b(mozzarell|ricott|mascarpon|crescenz|stracchin|robiola|caprino|tomino|burrata|burrini|fresco|fresch)/i,
      /\b(philadelphia|brie|camembert|feta|halloumi|paneer|gorgonzola|stilton|cheddar|gouda|edam|brunost)/i,
      /\b(tartuf|peperoncin|piccant|affumicat|alle erbe|al pepe|al cumino|al peperone|alla noce|al miele)/i,
      /\b(vegan|vegetal|senza lattosio|delattosato)/i,
      /\b(prodotto|imitazione|sostituto)/i,
    ],
    // Hard cheese ships in 100 to 500g wedges at Conad; the canonical
    // 500g slug rescales via normalize.ts. Widening from 350 to 600
    // catches the 200 to 300g Asiago / Emmental wedges priced
    // anonymously in the category.
    sizeRange: { min: 100, max: 600 },
  },
  // White sliced bread (pane in cassetta / pane bianco a fette).
  // Italian mass-market staple is the 400 to 500 g sliced loaf. Conad
  // sells own-brand "Pane Bianco a Fette" at ~EUR 1.20 to 1.50.
  bread_500g: {
    category: "/c/pane-morbido-croccante--0905",
    include: /\bpan(e|ino)\b/i,
    exclude: [
      /\b(integrale|cereali|semi|noci|olive|tostat|grissini|cracker|focaccia|pizza|piadina|carasau|carrè|carre|raffermo|crouton|panko|dolce|farcito|brioche|pagnotta|baguett|ciabatta|nero|carbone|farro|kamut|orzo|segale|avena)\b/i,
    ],
    sizeRange: { min: 300, max: 700 },
  },
  // White granulated sugar (zucchero bianco / semolato). Conad ships
  // own-brand "Zucchero Semolato 1 kg" as the staple. Excludes brown,
  // cane, icing, vanilla-flavored, and sweetener substitutes.
  sugar_1kg: {
    category: "/c/zucchero-e-dolcificanti--0504",
    include: /\bzucchero\b/i,
    exclude: [
      /\b(canna|integrale|grezzo|moscovado|bruno|panela|vanigliato|vaniglia|velo|impalpabile|stevia|dolcificante|fruttosio|maltitolo|saccarina|eritritolo|aspartam)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Rice (riso). Italian rice varieties for risotto (Arborio,
  // Carnaroli, Vialone Nano) plus long-grain (basmati, parboiled,
  // jasmine, lungo). The picker accepts any pure rice 800 to 1200 g.
  rice_1kg: {
    category: "/c/riso--1005",
    // Inside /c/riso, Conad ships pure-rice SKUs as the variety name
    // (Parboiled, Arborio, Carnaroli, Originario, Ribe, Roma, Vialone
    // Nano) with no "riso" token in the name. Include the variety
    // whitelist, leave exclude defending against rice flour, drinks,
    // and ready-to-eat reheats.
    include:
      /\b(riso|arborio|carnaroli|vialone|basmati|parboiled|originario|ribe|roma|jasmin|fragrante|lungo|thai)\b/i,
    exclude: [
      /\b(latte|bevanda|sciroppo|farina|aceto|gallett|cracker|biscott|tortin|barrett|insalata|nero|venere|integrale)\b/i,
      /\b(precotto|microond|pronto|surgelat|congelat|cotto)\b/i,
      /\b(pilaf|sushi|orientale|cinese|esotic)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Olive oil (olio di oliva). Italy is the canonical source: extra
  // virgin (extravergine), virgin (vergine), refined (raffinato).
  // Conad ships own-brand "Olio Extra Vergine di Oliva" 1 L bottles
  // at EUR 5 to 7. Excludes blends, flavored, and seed oils.
  olive_oil_1l: {
    category: "/c/olio-aceto-condimenti--0801",
    include: /\bolio\b.*\boliv/i,
    exclude: [
      /\b(girasol|semi|mais|colza|arachidi|sesamo|palm|coco|burro)\b/i,
      /\b(aromatizz|aromatic|tartuf|aglio|limon|peperonc|rosmarino|basilico|origano|menta|chili|ervas|infuso|spray)\b/i,
      /\bcondimento\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Chicken breast (petto di pollo). Italian supermarkets ship this
  // as 'fettine' (slices), 'filetti' (fillets), or whole 'petto'
  // ranging 300 to 1200 g. The 1 kg family pack ('petto di pollo
  // famiglia') is the closest to the canonical. sizeRange 800 to
  // 1200 g catches it; smaller portion packs and processed forms
  // excluded.
  chicken_breast_1kg: {
    category: "/c/carne-di-pollo-e-tacchino--0204",
    // Include `filetti` (fillets) alongside `petto`; both denote
    // breast meat at Conad and the typical priced SKU is "Filetti di
    // Petto di Pollo".
    include:
      /\bpetto\b.*\bpollo\b|\bpollo\b.*\bpetto\b|\bfilett\w*\b.*\bpollo\b/i,
    exclude: [
      /\b(coscia|alette|alett|fusi|cosciotti|sovracosc|sottocosc|fegatini|cuori)\b/i,
      /\b(panat|crocchett|cordon|cordon bleu|nuggets|burger|kebab|hambur|salsicc|wurstel|spiedin|polpett|involtin)\b/i,
      /\b(marinat|aromatizz|speziat|tandoori|tikka|teriyaki|barbecue|bbq|affumicat|prosciutto|cott|fritt|grigliat|arrost|stufat)\b/i,
      /\b(surgelat|congelat|piatto pronto|ready|riscaldament)\b/i,
      /\b(tacchino|anatra|oca|fagiano|coniglio|manzo|vitello|maiale|suino|agnello)\b/i,
    ],
    // Conad sells chicken breast in 300 to 1200g portion packs. Widen
    // sizeRange to accept the 400g vaschetta common at the cheap end;
    // normalize.ts rescales to per-1kg.
    sizeRange: { min: 300, max: 1200 },
  },
  // Still bottled water (acqua naturale). Italy is the EU's largest
  // bottled-water market by per-capita consumption. Standard size is
  // the 1.5 L PET bottle.
  water_bottled_1500ml: {
    category: "/c/acqua--1801",
    include: /\bacqua\b/i,
    // Excludes use stem prefixes without a trailing word boundary so
    // that `frizzant` matches both `Frizzante` and `Frizzantine`. The
    // earlier `\bfrizzant\b` form let "Acqua Minerale ... Frizzante"
    // through and the cheapest sparkling water won.
    exclude: [
      /\bfrizzant/i,
      /\b(gassat|gasat|gasata|effervescent|brillante|con gas|leggermente frizzante)/i,
      /\b(aromatizz|aromatic|sabor|gusto|cocktail|tonic|saporit|fragol|menta|the|tè)/i,
      /\b(cologn|profumo|cosmetic|micellar|bagno|doccia|shampoo|detergente)/i,
      /\b(cottura|salata|sale|distillata|deionizz|demineralizz)/i,
      /\b(neonati|infante|bambini|baby|infant|formula|svezzament)/i,
    ],
    sizeRange: { min: 1400, max: 1600 },
  },
  // The following six slugs map to category pages where Conad reports
  // `basePrice: 0` on every card without a selected store. Including
  // them as pickers would produce false-zero candidates; leaving them
  // out makes the scraper report a clean miss, and a follow-up pass
  // can layer in store selection to unlock them.
  //
  //   tomatoes_1kg        => /c/verdura-fresca--0103
  //   potatoes_1kg        => /c/verdura-fresca--0103
  //   bananas_1kg         => /c/frutta-fresca--0101
  //   apples_1kg          => /c/frutta-fresca--0101
  //   beef_ground_1kg     => /c/carne-di-bovino--0202
  //   beer_imported_500ml => /c/birre--1708
};

/**
 * Conad ships netQuantity in kg / L / pieces via netQuantityUm:
 *   KG to grams (multiply by 1000)
 *   LT to milliliters (multiply by 1000)
 *   PZ pieces (passes through)
 *
 * The catalog stores pack size in the same units, so for eggs (PZ)
 * a 6-pack returns 6, not 6000.
 */
function netQuantityToTargetUnit(
  netQuantity: number,
  netQuantityUm: string,
): number {
  const um = netQuantityUm.toUpperCase();
  if (um === "KG" || um === "LT") return netQuantity * 1000;
  return netQuantity;
}

export interface ConadProductRaw {
  /** Conad SKU (5 to 6 digit numeric string). */
  code: string;
  /** Display name with brand + size suffix. */
  nome: string;
  /** Net quantity in the unit below. */
  netQuantity: number;
  /** Unit: "KG", "LT", "PZ". */
  netQuantityUm: string;
  /** EUR price major units. 0.0 means "ask in store" or unpriced. */
  basePrice: number;
}

export interface ParsedProduct {
  code: string;
  title: string;
  priceMajor: number;
  packSize: number;
  sourceUrl: string;
}

/**
 * Parse the `data-product` JSON attribute from each rendered card.
 * Cards with basePrice === 0 are dropped (variable or ask-in-store).
 *
 * Exported so unit tests can feed in fixtures.
 */
export function parseProductsFromCards(
  cards: ConadProductRaw[],
  baseUrl = BASE,
): ParsedProduct[] {
  const out: ParsedProduct[] = [];
  for (const c of cards) {
    if (!c.code || !c.nome) continue;
    if (!Number.isFinite(c.basePrice) || c.basePrice <= 0) continue;
    if (!Number.isFinite(c.netQuantity) || c.netQuantity <= 0) continue;
    const size = netQuantityToTargetUnit(c.netQuantity, c.netQuantityUm);
    // Conad product detail URL pattern, mirrors `assets/products/...`
    // images: `/prodotto/<slug>-<code>`. Used as sourceUrl so the
    // submitter can link back from on-chain observations.
    const slugified = c.nome
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    out.push({
      code: c.code,
      title: c.nome,
      priceMajor: c.basePrice,
      packSize: size,
      sourceUrl: `${baseUrl}/prodotto/${slugified}--${c.code}`,
    });
  }
  return out;
}

/**
 * Decode the HTML-entity-encoded JSON inside a single `data-product`
 * attribute value. Conad ships these as `data-product="{&#34;code...`
 * so we unescape `&amp;` / `&#34;` / `&#39;` before JSON.parse.
 *
 * Exported for unit tests.
 */
export function decodeDataProductValue(raw: string): ConadProductRaw | null {
  const decoded = raw
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
  let obj: unknown;
  try {
    obj = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const r = obj as Record<string, unknown>;
  if (
    typeof r.code !== "string" ||
    typeof r.nome !== "string" ||
    typeof r.netQuantity !== "number" ||
    typeof r.netQuantityUm !== "string" ||
    typeof r.basePrice !== "number"
  ) {
    return null;
  }
  return {
    code: r.code,
    nome: r.nome,
    netQuantity: r.netQuantity,
    netQuantityUm: r.netQuantityUm,
    basePrice: r.basePrice,
  };
}

/**
 * Pull every `data-product="..."` attribute payload out of a Conad
 * category HTML document and decode it into a `ConadProductRaw`.
 *
 * The attribute is HTML-entity-encoded double-quoted JSON, e.g.
 *
 *   <div ... data-product="{&#34;code&#34;:&#34;365221&#34;,...}">
 *
 * Cards that fail to decode are silently dropped; the caller treats
 * the empty list as a clean "category found, no usable products".
 *
 * Exported for unit tests.
 */
export function extractCardsFromHtml(html: string): ConadProductRaw[] {
  const out: ConadProductRaw[] = [];
  const rx = /data-product="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(html)) !== null) {
    const decoded = decodeDataProductValue(match[1]!);
    if (decoded) out.push(decoded);
  }
  return out;
}

/**
 * Re-derive packSize from the title when a picker carries
 * `pcsFromTitle`. Conad ships some piece-priced SKUs (eggs, yogurt
 * cups) with the count in the product name and the weight in
 * netQuantity, so the weight-derived size is wrong for piece slugs.
 * Returns the input unchanged when the picker has no override or
 * when the regex does not match (the caller then drops that
 * candidate via the sizeRange filter).
 *
 * Exported for unit tests.
 */
export function overridePackSizeFromTitle(
  product: ParsedProduct,
  picker: { pcsFromTitle?: RegExp },
): ParsedProduct {
  if (!picker.pcsFromTitle) return product;
  const m = product.title.match(picker.pcsFromTitle);
  if (!m) return { ...product, packSize: NaN };
  const captured = m.slice(1).find((g) => typeof g === "string" && g.length > 0);
  if (!captured) return { ...product, packSize: NaN };
  const pcs = parseInt(captured, 10);
  if (!Number.isFinite(pcs) || pcs <= 0) return { ...product, packSize: NaN };
  return { ...product, packSize: pcs };
}

function pickBestMatch(
  products: ParsedProduct[],
  picker: ConadPicker,
): ParsedProduct | null {
  const candidates = products
    .map((p) => overridePackSizeFromTitle(p, picker))
    .filter((p) => {
      if (!picker.include.test(p.title)) return false;
      if (picker.exclude.some((rx) => rx.test(p.title))) return false;
      if (!Number.isFinite(p.packSize)) return false;
      if (p.packSize < picker.sizeRange.min || p.packSize > picker.sizeRange.max)
        return false;
      return true;
    });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.priceMajor - b.priceMajor);
  return candidates[0]!;
}

/**
 * Fetch a Conad category page and return every priced product card
 * carried by it. Returns an empty array on non-2xx, network error,
 * or empty HTML; the caller treats that as a "no candidates" miss.
 */
async function fetchCategoryProducts(
  categoryPath: string,
): Promise<ParsedProduct[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${categoryPath}`, {
      headers: REQUEST_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    const cards = extractCardsFromHtml(html);
    return parseProductsFromCards(cards);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Live scrape, exported entry point. Pure HTTP, no Browser Use Cloud.
 */
export async function scrapeConadIt(): Promise<ScraperResult> {
  const targets = targetsForRetailer("conad-it");
  const scrapedAt = new Date().toISOString();
  const scraped: ScrapedProduct[] = [];
  const misses: ScraperResult["misses"] = [];

  // Many slugs share the same category page (fruit, vegetables);
  // cache the fetch so we hit the network once per distinct category.
  const cache = new Map<string, ParsedProduct[]>();

  for (const target of targets) {
    const picker = PICKERS[target.slug];
    if (!picker) {
      misses.push({ target, reason: "no picker configured for this slug" });
      continue;
    }
    let parsed = cache.get(picker.category);
    if (!parsed) {
      parsed = await fetchCategoryProducts(picker.category);
      cache.set(picker.category, parsed);
    }
    const match = pickBestMatch(parsed, picker);
    if (!match) {
      misses.push({
        target,
        reason: `no match in ${picker.category} (${parsed.length} priced candidates)`,
      });
      continue;
    }
    scraped.push({
      target,
      retailerSku: match.code,
      retailerTitle: match.title,
      priceMajor: match.priceMajor,
      packSize: match.packSize,
      scrapedAt,
      sourceUrl: match.sourceUrl,
    });
  }

  return { retailer: "conad-it", scraped, misses };
}
// @scraper: conad-it
// @rate-limit: respect retailer crawl policy
// @edge: what if the list is empty?
// @cleanup: consolidate with sibling file
// @edge: what if the list is empty?
