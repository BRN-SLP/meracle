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

const PICKERS: Partial<Record<ProductTarget["slug"], RoPicker>> = {
  // Estonian "sai" = white wheat sandwich loaf. Excludes "leib"
  // (dark rye bread, different product class), sweet pastries,
  // burger buns. Pack sizes 300 g and 500 g are both common;
  // sort-by-unit-price picks the cheapest per gram.
  bread_500g: {
    query: "sai 500g",
    include: /\bsai\b/i,
    exclude: [
      /\bleib\b/i,
      /\b(?:röstsai|toast)\b/i,
      /\b(?:hamburger|burger|hotdog|kuklid)\b/i,
      /\b(?:saiakene|magus|p[äa]rl|kaneeli|sokol|kakaov|kookos)\b/i,
      /\b(?:croissant|brios)\b/i,
    ],
    sizeRange: { min: 250, max: 800 },
    unitFromTitle: "g",
  },
  // Standard milk, any fat percent in the 2,5%-3,5% range. Excludes
  // lactose-free (laktoosivaba), plant milks (soja / kaerajook /
  // kookos / mandel), yoghurt, kefir, sour cream, baby formula,
  // and curd cheese (kohupiim is a fresh dairy spread, not milk).
  milk_1l: {
    query: "täispiim 1l",
    include: /\bpiim\b/i,
    exclude: [
      /\blaktoosivaba\b/i,
      /\b(?:kohu?piim|piimajook|kakaojook|jogurtijook)\b/i,
      /\b(?:hapukoor|kreem|frische|vahukreem)\b/i,
      /\b(?:jogurt|joogurt|kefir|skyr)\b/i,
      /\b(?:soja|kaera|kookos|mandel|riisipiim)\b/i,
      /\b(?:beebi|imikute|maternal|formula)\b/i,
      /\b(?:lahja|kerge)\s+piim\b/i,
      /\b(?:vahukommi|maasika|sokolaad|vanilli|aroom)\b/i,
    ],
    sizeRange: { min: 800, max: 1300 },
    unitFromTitle: "ml",
  },
  // Chicken eggs in cartons of 10 (Baltic retail standard). The
  // picker accepts the "M10" / "L10" / "Õrrekanade M10" grade
  // tags inside the title via the parser's egg-grade fallback.
  // Excludes liquid eggs, fish roe, salads, chocolate Easter eggs.
  eggs_12: {
    query: "kanamunad 10tk",
    include: /\bmunad\b/i,
    exclude: [
      /\b(?:sokolaad|kakao|kommid|sool|nool)\b/i,
      /\b(?:past|salat|salaks|kreem|past[eö]r)\b/i,
      /\b(?:vutimunad|hanemu|partsi|jaanip)\b/i,
      /\b(?:lihatoit|kalamari|kala)\b/i,
      /\b(?:liter|liite)\b/i,
      /\bvedel\b/i,
    ],
    sizeRange: { min: 6, max: 30 },
    unitFromTitle: "pcs",
  },
  // 200 g butter bar (Rimi own-brand, Tere, Alma, MO Saaremaa).
  // Excludes nut butters, margarine, ghee, and the place-name
  // brand "Võiste" / "Vaarikatomat Võiste" that trips on the
  // word "või". Pack 100-300 g covers the local consumer formats.
  butter_200g: {
    query: "või 200g",
    include: /\bvõi\b/i,
    exclude: [
      /\bvõiste\b/i,
      /\bvaarik(?:a|atomat)\b/i,
      /\b(?:tomat|kurk|salat|liha|kala|p[eo]rgu)\b/i,
      /\b(?:maapahkleid?|maapähkel|pähkli|kookos|mandel)\b/i,
      /\b(?:ghee|klaariv|sulatatud)\b/i,
      /\b(?:taimeõli|margarin|spread|tartin|või-)\b/i,
      /\b(?:küpsis|saiakene|magus)\b/i,
    ],
    sizeRange: { min: 100, max: 300 },
    unitFromTitle: "g",
  },
  // White granulated 1 kg sugar (Rimi own-brand cheapest at 0.65,
  // Dan Sukker at 0.85). Excludes brown sugar, icing sugar,
  // cubes, syrup, low-cal sweeteners, and confectionery uses.
  sugar_1kg: {
    query: "suhkur 1kg",
    include: /\bsuhkur\b/i,
    exclude: [
      /\bpruun\b/i,
      /\b(?:fariin|tume|toor|kookospal)\b/i,
      /\b(?:vanilli|tuhk|kuubikud?|siirup|melass)\b/i,
      /\b(?:fruktoos|sukral|stevia|asparta|aspart|erit[aä]ti)\b/i,
      /\b(?:küpsis|leib|sai|magus|kompvek)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // White long-grain rice 1 kg bag (Veski Mati "sõmer", Tartu
  // Mill "aurutatud", Bosto). Excludes brown / wild / basmati /
  // jasmine rice (different product classes), rice flour / cakes
  // / drinks, baby food.
  rice_1kg: {
    query: "riis 1kg",
    include: /\briis\b/i,
    exclude: [
      /\b(?:basmati|jasm[äa]ti|metsik|t[äa]istera|t[üu]ras|pruun)\b/i,
      /\b(?:küpsis|j[ää]tis|saiakene|noodels?|nuudl|krõbu)\b/i,
      /\b(?:risot|paella|sushi|sushi-)\b/i,
      /\b(?:beebi|imik|imikute)\b/i,
      /\b(?:jook|piim|kreem|piimar)\b/i,
      /\b(?:faina|jahu|leib|sai)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Loose fresh red tomatoes ("Tomat 1kl, kg"). Excludes canned
  // (tükeldatud / purustatud), sun-dried, sauce / ketchup, baby
  // food, and the place-name "Võiste" cross-contamination from
  // strawberry-tomato. "Lihatomat" (beef tomato) is the local
  // term for a large round variety, kept in scope.
  tomatoes_1kg: {
    query: "tomat punane kg",
    include: /\btomat\b/i,
    exclude: [
      /\b(?:t[üu]keldatud|purustatud|p[üa]ikesekuivatatud|p[üa]ikesek)\b/i,
      /\b(?:ket[sš]up|paste|past[äa]|kons|s[oõ]s|hautis|sup|supp)\b/i,
      /\b(?:vaarikatomat|võiste)\b/i,
      /\b(?:salat|liha-?salat|hommiku|paste)\b/i,
      /\b(?:beebi|imik)\b/i,
      /\b(?:kuiv|kuivat)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Loose fresh potatoes per-kg (Kartul pesemata / kollane /
  // punane / Spunta). Excludes potato salad, mash, croquettes,
  // pelmeni dumplings with potato filling, dried potato flakes,
  // and "bataat" (sweet potato, different class).
  potatoes_1kg: {
    query: "kartul kg",
    include: /\bkartul(?:id)?\b/i,
    exclude: [
      /\b(?:salat|puder|krokett|laast|kips)\b/i,
      /\b(?:pelmeen|vorst|kotlett|burger)\b/i,
      /\b(?:röst|kuivat|p[üa]ikesek)\b/i,
      /\b(?:saiakene|leib|pehmik|paks)\b/i,
      /\bbataat\b/i,
    ],
    sizeRange: { min: 800, max: 5500 },
    unitFromTitle: "g",
  },
  // Olive oil 1 L bottle. Rimi stocks both the extra-virgin
  // ("Extra Light", weirdly named) at 13.29 EUR and pomace
  // ("oliivijää") at 9.89 EUR. Excludes shampoos / soaps with
  // olive oil in the name, and other vegetable oils.
  olive_oil_1l: {
    query: "oliiviõli 1l",
    include: /\b(?:oliivi[õo]li|oliivij[ää]k[õo]li)\b/i,
    exclude: [
      /\b(?:šampoo|seep|kreem|losjoon|kosmeetika|p[äa]rfüümi)\b/i,
      /\b(?:p[äa]ikeselill|rüps|raps|maisi|s[i]idum|linaõli)\b/i,
      /\b(?:spray|aerosool)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "ml",
  },
  // Still water 1.5 L PET (Aura Gaasita is the canonical at
  // 0.89 EUR; Värska Aluseline alkaline is a niche keep). The
  // include requires "gaasita" (still) so all sparkling /
  // carbonated rows are filtered before the cheap-water sort.
  water_bottled_1500ml: {
    query: "vesi 1,5l gaasita",
    include: /\bvesi\b.*\bgaasita\b/i,
    exclude: [
      /\bgaasiga\b/i,
      /\b(?:karb[oõ]niseer|k[äa]rbon|sodavesi)\b/i,
      /\b(?:must|maasik|sidr|fruit|lim|kr[oa]ndev|aprikoos|aroom)\b/i,
      /\b(?:beebi|imikute|tervis)\b/i,
      /\b(?:cola|sprite|pepsi|tonik|isotoonil)\b/i,
      /\b(?:p[üa]ha|p[üa]hahõimuv)\b/i,
    ],
    sizeRange: { min: 1400, max: 1600 },
    unitFromTitle: "ml",
  },
  // Loose fresh bananas per-kg ("Banaan Cavendish 1kl, kg"
  // 0.90 EUR; eco variants 1.69). Excludes baby food, banana
  // chips, snack bars, drinks, ice cream, baked goods.
  bananas_1kg: {
    query: "banaan kg",
    include: /\bbanaan(?:id)?\b/i,
    exclude: [
      /\b(?:p[üa]ree|jook|smoothie|kokteil|jogurt|magus|chips|laast)\b/i,
      /\b(?:beebi|imik|teravilja)\b/i,
      /\b(?:j[ää]tis|tort|kook|cake|baton)\b/i,
      /\b(?:p[äa]hkleid|kookos|maasika|sokol)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Loose fresh apples per-kg (Gloster / Gala / Golden Delicious
  // varieties). Excludes apple juice, cider, vinegar, baby food,
  // shampoos / soaps named with apple, jams, and sweets.
  // The leading anchor uses a Unicode-aware lookbehind because
  // JavaScript's `\b` is ASCII-only and treats the leading "Õ"
  // (U+00D5) as a non-word character; `\bõun\b` would never
  // match the typical "Õun Gloster" title.
  apples_1kg: {
    query: "oun kg",
    include: /(?<!\p{L})õun(?:ad)?\b/iu,
    exclude: [
      /\b(?:mahl|jook|nektar|sidr|smoothie|kompvek)\b/i,
      /\b(?:šampoo|seep|kreem|deod|kosmeetika)\b/i,
      /\b(?:beebi|imik|imikute|teravilja)\b/i,
      /\b(?:past|p[üa]ree|jogurt|hommiku|m[üü]sli)\b/i,
      /\b(?:chips|laast|kuivat|liofiil)\b/i,
      /\bõunavili\b/i,
      /\b(?:kook|tort|saiakene|pehmik|magus)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Fresh chicken breast filet ("broileri rinnafilee", abbrev.
  // "br.rinnafil"). The mu=kg branch covers the per-kg loose
  // 4.43 EUR Tallegg SKU; the standard 500 g consumer tray runs
  // 3.15-4.69 EUR. Excludes turkey, ham, sausage, nuggets,
  // pre-marinated, frozen-breaded, and cooked products.
  chicken_breast_1kg: {
    query: "kanafilee kg",
    include:
      /\b(?:kanafilee|kana\s*filee|broileri?\s+rinnafil|br\.?\s*rinnafil|br\.?\s*r\.?\s*fil)/i,
    exclude: [
      /\b(?:kalkun|sealiha|sea\s|vorst|sink|jambon)\b/i,
      /\b(?:past|tooraine|kotlett|nugget|fileeriba|tükid)\b/i,
      /\b(?:k[üu]lm|valmis|hommik|marin|maitse|jog\.?\s*tilli)\b/i,
      /\b(?:k[üü]ps|röst|gril|panat)\b/i,
      /\b(?:lihasalat|salat|past)\b/i,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Ground beef ("veisehakkliha"). Rimi sells in 300-400 g
  // trays. Excludes pork mixes ("sea- ja veisehakkliha"),
  // chicken / turkey, organic premium ("Mahe rohumaa-veise"),
  // pre-formed burgers / meatballs, and canned beef.
  beef_ground_1kg: {
    query: "veisehakkliha",
    include: /\bveisehakkliha\b/i,
    exclude: [
      /\bsea-?\s*ja\b/i,
      /\b(?:sealiha|sea\s|kana|kalkun|seape)\b/i,
      /\b(?:konserv|past|kotlett|burger|p[ää]l)\b/i,
      /\b(?:k[üü]ps|gril|röst|valmistoit|valmis)\b/i,
      /\b(?:beebi|imik)\b/i,
      /\bmahe\b/i,
    ],
    sizeRange: { min: 250, max: 1100 },
    unitFromTitle: "g",
  },
  // Estonian "juust Eesti" yellow cheese, canonical 500 g (Valio
  // Atleet, E-Piim Eesti, Estover, Royal Gouda — all hard yellow
  // varieties, retail-equivalent). Excludes specialty imports
  // (brie / camembert / parmesan / halloumi / blue / feta),
  // cream cheese, processed slices, grated, sweet cheese.
  cheese_local_500g: {
    query: "juust eesti 500g",
    include: /\bjuust\b/i,
    exclude: [
      /\b(?:purustatud|riivit|sulatatud|t[üu]keldatud|viil)\b/i,
      /\b(?:kreem|m[oõ]rsk|frische|frisch|cottage|kohuke|feta)\b/i,
      /\b(?:brie|camembert|cheddar|parm|moots|halloumi|sinihallit|sini)\b/i,
      /\b(?:purk|kotis|salat|sushi|pizz)\b/i,
      /\b(?:beebi|imik|magus|kook|j[ää]tis)\b/i,
      /\b(?:must|mozzarella|maasika|tomat)\b/i,
    ],
    sizeRange: { min: 250, max: 600 },
    unitFromTitle: "g",
  },
  // Imported beer in 500 ml can (Heineken, Carlsberg,
  // Kronenbourg, Saku, Walter, A.LeCoq Alexander). Pack size
  // includes the slightly-larger 0.568 L UK pint can (Alexander).
  // Excludes alcohol-free, flavoured / fruit, ciders / cocktails,
  // and gift kits.
  beer_imported_500ml: {
    query: "õlu purk 0,5l",
    // Same Unicode-aware leading anchor as apples_1kg.
    include: /(?<!\p{L})õlu\b/iu,
    exclude: [
      /\b(?:gluteen|alkoholivaba|alkoh[oõ]livaba|0[,.]0%|nul|null)\b/i,
      /\b(?:maitselised|maitseline|nimet|p[üa]hahõim|magus|maasika|sidr)\b/i,
      /\b(?:cider|cidre|cocktail|kokteil|spritz|radler)\b/i,
      /\b(?:tass|set|kit|paket|kink|kingitus|kollekts)\b/i,
      /\b(?:malta|leib|drojd)\b/i,
    ],
    sizeRange: { min: 450, max: 600 },
    unitFromTitle: "ml",
  },
};

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
  // Loose per-kg, two Estonian patterns:
  //   "1kl, kg" / "1kl kg" inside the title (apples / bananas)
  //   ", kg" trailer with optional suffix (kartul: ", kg Eesti")
  // Both mean the row is priced per kilogram.
  if (/\b1kl,?\s*kg\b/i.test(s)) return { value: 1000, unit: "g" };
  if (/,\s*kg(?:\b|\s)/i.test(s)) return { value: 1000, unit: "g" };
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
// @scraper: rimi-ee
// @rate-limit: respect retailer crawl policy
// @type: narrow from string to union
// @note: discussed in review thread
// @cleanup: remove legacy fallback path
// @type: add discriminant union for states
// @type: narrow from string to union
// @perf: add caching layer here
// @type: prefer readonly for immutable data
// @i18n: ensure this string is extracted
// @perf: lazy load this component
// @type: export the inner parameter type
// @guard: validate before processing
// @i18n: extract pluralization logic
// @config: expose timeout as parameter
// @guard: validate before processing
