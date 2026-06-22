/**
 * Migros Turkey scraper, via migros.com.tr public JSON API.
 *
 * The mobile-shop front-end calls
 * `https://www.migros.com.tr/rest/products/search?q=<term>&limit=N` to
 * populate product list pages. The endpoint is public, unauthenticated,
 * cookieless, and returns 200 OK with ~60 to 200 kB JSON via plain
 * `node:fetch` from anywhere. No Browser Use Cloud, no proxy, no auth.
 *
 * Response shape (trimmed to fields the scraper uses):
 *
 *   {
 *     "successful": true,
 *     "data": {
 *       "hitCount": <N>,
 *       "storeProductInfos": [
 *         {
 *           "id": 20000011011530,
 *           "sku": "11011530",
 *           "name": "Migros Yarım Yağlı UHT Süt 1 L",
 *           "regularPrice": 4075,       // kuruş (1 lira = 100 kuruş)
 *           "shownPrice":  4075,
 *           "discountRate": 0,
 *           "unit": "PIECE",            // PIECE | KG | LT (display unit)
 *           "unitAmount": 1,
 *           "prettyName": "migros-yarim-yagli-uht-sut-1-l-p-a805ca",
 *           ...
 *         }
 *       ]
 *     }
 *   }
 *
 * Migros ships the pack size in the product *name* as a Turkish-grammar
 * suffix ("1 L", "200 G", "1,5 Kg", "12'li"), not in a structured
 * `unitAmount` field, so the scraper parses the title with
 * `parseSizeFromName` (similar pattern to the REWE German parser).
 *
 * Prices are stored as integer kuruş, so the major-units `priceMajor`
 * is `shownPrice / 100`. `shownPrice` reflects any active discount,
 * `regularPrice` is the pre-discount sticker, we use the cheaper of
 * the two to match the oracle's cheapest-staple semantics.
 *
 * The `beer_imported_500ml` slug is expected to miss every cron run:
 * Migros TR does not sell alcohol online (Turkish licensing rules),
 * its catalog under "bira" returns drinking glassware and zero
 * actual beer SKUs. The picker still ships so the catalog stays
 * uniform, the miss just surfaces in the daily preview.
 */
import { z } from "zod";

import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const API_BASE = "https://www.migros.com.tr";
const FETCH_TIMEOUT_MS = 15_000;

// Plain desktop Chrome UA. The /rest/products/search endpoint accepts
// any UA, but the canonical product page URL needs a full browser-
// shape UA to bypass a thin Cloudflare check (the product detail page
// is not what the scraper reads, the API is, but we link to it as
// `sourceUrl` so a downstream submitter can fall back to a manual
// fetch if needed).
const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
};

// Subset of the Migros product JSON we depend on. The wire format
// carries dozens more fields (images, store metadata, CRM tags) which
// we ignore.
const MigrosProductSchema = z.object({
  id: z.number().int(),
  sku: z.string(),
  name: z.string(),
  status: z.string(),
  unit: z.string(),
  unitAmount: z.number().nonnegative(),
  regularPrice: z.number().nonnegative(),
  shownPrice: z.number().nonnegative(),
  prettyName: z.string(),
});
export type MigrosProduct = z.infer<typeof MigrosProductSchema>;

const MigrosSearchResponseSchema = z.object({
  successful: z.boolean(),
  data: z.object({
    hitCount: z.number().int().nonnegative().optional(),
    storeProductInfos: z.array(MigrosProductSchema).optional(),
  }),
});

interface TrPicker {
  /** Turkish search keyword passed to /rest/products/search?q=. */
  query: string;
  /** Product name must match. */
  include: RegExp;
  /** Product name MUST NOT match. */
  exclude: readonly RegExp[];
  /** Pack size in target.unit (g or mL or pcs). */
  sizeRange: { min: number; max: number };
  /**
   * Required unit class parsed from the product name. Migros ships
   * solid produce in `g`/`kg` and liquids in `mL`/`L`. A 1 L apple
   * juice would otherwise pass the apples (gram) slug because the
   * litre token resolves to 1000 (mL) which falls inside the gram
   * sizeRange. Setting `unitFromTitle: "g"` on the apples picker
   * rejects any candidate whose name carries a litre or mL size.
   * Omit to accept any unit (e.g. milk picker explicitly wants mL).
   */
  unitFromTitle?: ParsedUnit;
}

// JavaScript `\b` matches only ASCII word boundaries — `\bşeker\b`
// fails on "Migros Toz Şeker" because `ş` is not an ASCII word char,
// so the position before `ş` (space|ş) is NOT a word boundary in JS
// regex semantics. We use Unicode property lookarounds with the `u`
// flag throughout the Turkish pickers: `(?<!\p{L})stem(?!\p{L})` is
// the equivalent of `\bstem\b` that treats every Unicode letter as a
// word character. The trailing lookahead is dropped when we want to
// match Turkish agglutinative suffixes (Domates / Domatesi /
// Domateste all share the `domates` stem).
const PICKERS: Partial<Record<ProductTarget["slug"], TrPicker>> = {
  // Whole / half-fat milk in 1 L UHT cartons. Catches "Süt", "Sütü",
  // "Sütle" via prefix match. Excludes anything that contains `süt`
  // but is not pure milk (yogurt, kefir, milky desserts, flavoured
  // chocolate / kakao milk, plant-based "milks", and so on).
  milk_1l: {
    query: "süt",
    include: /(?<!\p{L})s[uü]t/iu,
    exclude: [
      /(?<!\p{L})(?:laktozsuz|laktozsiz|aroma|kakao|çikolat|çilek|stroberi|bal|bebek|formul|keçi|koyun|soya|badem|hindistan|yulaf|pirin[çc]|kefir|yo[gğ]urt|kaymak|krema)/iu,
      /(?<!\p{L})sütl[üu]/iu,
      /(?<!\p{L})(?:tatlı|puding|sufle|kahve|nesquik|maden|gazoz|kola|cay|tea|şerbet)/iu,
    ],
    sizeRange: { min: 800, max: 1100 },
    unitFromTitle: "ml",
  },
  // White sliced loaf bread. Migros private label "Sofra" line is the
  // staple. Flat- / sweet- / cracker- / pastry-style breads excluded.
  bread_500g: {
    query: "ekmek",
    include: /(?<!\p{L})(?:ekmek|tost)/iu,
    exclude: [
      /(?<!\p{L})(?:pide|lavaş|laksa|bazlama|tortilla|gözleme|simit|çörek|kek|pasta|kraker|galeta|baget|grissini)/iu,
      /(?<!\p{L})(?:biskuvi|biskü|atıştırmalık|kruton|panko|peynirli|zeytinli|haşhaş|sütlü|tahin|reçel)/iu,
    ],
    sizeRange: { min: 300, max: 700 },
    unitFromTitle: "g",
  },
  // Fresh eggs in 6 / 10 / 15 / 30 packs. Per-egg price after rescale.
  // Excludes egg-derived products (sıvı / liquid, toz / powder) and
  // non-chicken eggs (quail, duck, goose).
  eggs_12: {
    query: "yumurta",
    include: /(?<!\p{L})yumurta/iu,
    exclude: [
      /(?<!\p{L})(?:s[ıi]v[ıi]|likit|toz|kurutulmu[şs]|cirpilmis|aroma|haşlanmı[şs]|kaplan|paskal|tatl[ıi]|krem|pasta|sufle|gofret|pişmiş)/iu,
      /(?<!\p{L})(?:bıldırcın|kaz|ördek|hindi|deve)/iu,
    ],
    sizeRange: { min: 6, max: 30 },
    unitFromTitle: "pcs",
  },
  // Butter, 200 / 250 / 500 g bricks. Excludes margarine, ghee
  // (sadeyağ), and flavoured / herbed variants.
  butter_200g: {
    query: "tereyağı",
    include: /(?<!\p{L})terey[aağ]/iu,
    exclude: [
      /(?<!\p{L})(?:margarin|sadeyağ|samin|nebati|bitkisel|fıstık|f[ıi]nd[ıi]k|kakao|çikolat|baharat|aroma|sarımsak|otlu)/iu,
    ],
    sizeRange: { min: 180, max: 550 },
    unitFromTitle: "g",
  },
  // White granulated sugar. Migros TR carries 1 / 2 / 2.5 / 5 kg
  // bags; the picker accepts only the 1 kg consumer pack because
  // bulk discounts on the 5 kg bag pull the per-canonical-kg price
  // unrealistically low for an oracle representing the everyday
  // consumer SKU. Excludes brown, cube, vanilla, candied, and
  // sugar-substitute variants.
  sugar_1kg: {
    query: "şeker 1 kg",
    include: /(?<!\p{L})şeker/iu,
    exclude: [
      /(?<!\p{L})(?:esmer|kahverengi|kamış|hindistan|panela|pudra|kesme|küp|vanilya|tarçın|kayısı)/iu,
      /(?<!\p{L})(?:tatlandırıcı|stevia|aspartam|sakarin|fruktoz|maltitol|eritritol|şekersiz|şekerleme|jelibon|sakız|akide|lokum|çikolat|kakaolu|bonbon)/iu,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Rice in 1 / 2 / 2.5 kg bags. Baldo / Osmancık / Basmati / Jasmine
  // all accepted. Excludes rice flour, rice drinks, baby food, ready-
  // pilaf, and other grain look-alikes.
  rice_1kg: {
    query: "pirinç",
    include: /(?<!\p{L})pirin[çc]/iu,
    exclude: [
      /(?<!\p{L})(?:unu|sütü|içeceği|içecek|bebek|maması|aroma|gofret|biskuvi|kraker|patlak|haşlanmı[şs]|haz[ıi]r)/iu,
      /(?<!\p{L})(?:mantar|nohut|fasulye|mercimek|bulgur|kuskus|makarna)/iu,
    ],
    sizeRange: { min: 800, max: 5500 },
    unitFromTitle: "g",
  },
  // Tomatoes, sold per kg loose ("Domates Yerli Kg", "Domates Kokteyl
  // Kg") and as 250 / 500 g punnets. Query "domates kg" filters out
  // confectionery / sauce candidates and surfaces fresh per-kg variants
  // at the top, so the per-unit sort lands on the cheapest fresh
  // tomato. Excludes processed (salça = paste, sos, kons[erve], suyu,
  // kuru = dried, ezme, rendesi = grated) and confusables.
  tomatoes_1kg: {
    query: "domates kg",
    include: /(?<!\p{L})domates/iu,
    exclude: [
      /(?<!\p{L})(?:salça|sos|kons|konserve|köfte|dolma|peynir|pizza|makarna|çorba|kurusu|kurutulmuş)/iu,
      /(?<!\p{L})(?:suyu|ezme|aroma|p[üu]re|p[üu]resi|tatl[ıi])/iu,
      /(?<!\p{L})(?:rende|rendesi|rendelenmiş)/iu,
      /(?<!\p{L})kuru(?!\p{L})/iu,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Potatoes, sold per kg loose ("Patates Yeni Mahsul Kg", "M Life
  // Organik Patates Kg") and as 2.5 kg bags. Query "patates yerli"
  // surfaces fresh loose varieties at the top; the bare "patates"
  // query is dominated by frozen-fries brands and Hellmann's mayo
  // (tagged with "patates" because it's served on fries). Excludes
  // frozen fries (Torpat brand, "donmuş", "kızartmalık", "parmak",
  // "elma dilim" = "apple-slice cut" describing fries shape), sauces
  // wrongly tagged as "patates" (mayonnaise, ketchup), snack crisps,
  // and sweet potato.
  potatoes_1kg: {
    query: "patates kg",
    include: /(?<!\p{L})patates/iu,
    exclude: [
      /(?<!\p{L})(?:cips|chips|kızartmalık|don[dm][au][şs]|frozen|dondurul|haşlanmı[şs]|köfte|kroket|salata|püre|pure|nişasta|baharat|paçanga|kek)/iu,
      /(?<!\p{L})(?:parmak|elma dilim|jumbo|çubuk|kesim|şerit)/iu,
      /(?<!\p{L})(?:torpat|hellmann|heinz|knorr|feast|superfresh)/iu,
      /(?<!\p{L})(?:mayone[zs]|sos|ketçap|hardal|tortilla)/iu,
      /(?<!\p{L})(?:börek|hamur|pizza|mant[ıi]|haşlanm|sufle|tatl[ıi]|köfte)/iu,
    ],
    sizeRange: { min: 500, max: 5500 },
    unitFromTitle: "g",
  },
  // Olive oil in 1 / 2 / 5 L bottles. Excludes seed oils, cosmetic
  // olive-oil products (soap, skincare), and oil sprays.
  olive_oil_1l: {
    query: "zeytinyağı",
    include: /(?<!\p{L})zeytin\s*ya/iu,
    exclude: [
      /(?<!\p{L})(?:ayçiçek|m[ıi]s[ıi]r|soya|kanola|susam|f[ıi]nd[ıi]k|aspir|palm|mineral|bitkisel|karış[ıi]m|aroma)/iu,
      /(?<!\p{L})(?:sabun|krem|kozmetik|krema|şampuan|saç|cilt|losyon)/iu,
      /(?<!\p{L})(?:sprey|spray|aerosol)/iu,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "ml",
  },
  // Still water in 1.5 L PET bottles. Migros sells 0.5 / 1 / 1.5 / 5
  // L sizes of "doğal kaynak suyu" (natural spring water). The
  // sizeRange targets 1.5 L canonical; 5 L jugs also pass because
  // per-litre price is what matters for the oracle and rescaling is
  // automatic.
  water_bottled_1500ml: {
    // Restrict to the standard 1.5 L PET single bottle (consumer
    // staple). The 5 L family pack discounts the per-canonical-1.5L
    // price by ~3x and breaks comparability with single-bottle
    // picks elsewhere (Mercadona, Conad, Novus, Auchan PL).
    query: "doğal kaynak suyu 1,5",
    // The keyword "su" alone is too broad (matches yogurts, juices,
    // and unrelated "suyu" = "juice"). Anchor on the staple phrase.
    include: /(?<!\p{L})(?:doğal kaynak|içme suyu|kaynak suyu|içme su|doğal su)/iu,
    exclude: [
      /(?<!\p{L})(?:maden|soda|gazl[ıi]|aromal[ıi]|aroma|tonik|limon|portakal|nane|şeker|kola|cay|kahve|enerji)/iu,
      /(?<!\p{L})(?:saf|distile|deiyonize|temizleyici|cila|deterjan|sabun)/iu,
      /(?<!\p{L})(?:kolonya|losyon|krem|şampuan|cilt|saç|hava|nem|buhar|kapsül|tablet)/iu,
      /(?<!\p{L})(?:bebek|maması|sterilize|s[üu]t|yo[gğ]urt)/iu,
    ],
    sizeRange: { min: 1400, max: 1600 },
    unitFromTitle: "ml",
  },
  // Bananas sold per kg loose ("Muz Yerli Kg" = local from Anamur,
  // "Muz İthal Kg" = imported, typically from Ecuador). Query "muz kg"
  // returns just the fresh per-kg variants, no banana-flavoured
  // dessert products. Bare "muz" is dominated by smoothie, kek, gofret,
  // and aromalı süt SKUs (Migros indexes them under "muz" because the
  // flavour is in the name). The exclude list is kept as a defensive
  // safety net in case the query ever broadens.
  bananas_1kg: {
    query: "muz kg",
    include: /(?<!\p{L})muz/iu,
    exclude: [
      /(?<!\p{L})(?:ezme|suyu|smoothie|içecek|maması|aromal[ıi]|kek|kuru|deshidrat|cips|chips|nektar|şuru[bp]|kakaolu|çikolat|krem|kremalı|gofret|biskuvi|granola|bal)/iu,
      /(?<!\p{L})(?:haz[ıi]r|atıştırmal[ıi]k|barr|barlık|sufle|tatl[ıi]|içecek|pud[iı]ng|puding|protein|şampuan|losyon)/iu,
      /(?<!\p{L})(?:p[üu]re|p[üu]resi)/iu,
      /(?<!\p{L})s[üu]t/iu,
      /(?<!\p{L})müzik/iu,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Apples sold per kg loose (Starking, Gala, Golden, Fuji, Granny
  // Smith, Pink Lady, Amasya). Query "elma kg" returns just the
  // per-kg fresh varieties; bare "elma" is dominated by juice and
  // smoothie SKUs. The "Elma Dilim Patates" candidates ("apple-slice
  // cut fries") are blocked by the patates exclude. Excludes apple
  // juice, vinegar, dried, sauce, baby food, snack bars / candies /
  // chips.
  apples_1kg: {
    query: "elma kg",
    include: /(?<!\p{L})elma(?!\p{L})/iu,
    exclude: [
      /(?<!\p{L})(?:suyu|smoothie|sirkesi|sirke|sirka|kuru|çekirdek|ezme|maması|nektar|şuru[bp]|tarçınl[ıi]|kek|içece)/iu,
      /(?<!\p{L})(?:atıştırmal[ıi]k|cips|chips|krema|reçel|jelibon|sakız|çikolat|gofret|biskuvi)/iu,
      /(?<!\p{L})(?:patates|dilim patates|parmak patates|torpat|sufle|tatl[ıi]|granola|içecek|şurup)/iu,
      /(?<!\p{L})(?:dimes|cappy|tropicana|nektar|m life|p[üu]re|p[üu]resi)/iu,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Chicken breast. Sold per-kg loose at the butcher counter (e.g.
  // "Uzman Kasap Piliç Bonfile Kg", "Banvit Piliç Bonfile Kg") and as
  // 400 / 500 g trays. Query "tavuk eti" returns the full butcher
  // assortment so the per-kg fresh variants surface and beat the
  // 400 g sauced trays on per-unit price. The include matches any
  // title carrying "piliç|tavuk" together with "göğs|bonfile|fileto".
  // Excludes wings, drumsticks, whole birds, processed (nugget,
  // schnitzel, burger, sosis), and marinated / sauced ready-meal forms.
  chicken_breast_1kg: {
    query: "tavuk eti",
    include:
      /(?<!\p{L})(?:piliç|tavuk)[^.]*(?<!\p{L})(?:g[oö][gğ]s|bonfile|fileto)/iu,
    exclude: [
      /(?<!\p{L})(?:kanat|but|incik|baget|ayak|boyun|jambon|ci[gğ]er|kalp|çıtır)/iu,
      /(?<!\p{L})(?:bütün|p[oö]şet|döner|şinitzel|pirzola|kıyma|f[üu]me)/iu,
      /(?<!\p{L})(?:köfte|nuget|nugget|burger|sosis|salam|schnitzel|cordon|crispy|baharat|sote|sucuk|kavurma)/iu,
      /(?<!\p{L})(?:marin|terbiy|tand[ıi]ri|haşlanm[ıi][şs]|kızart|p[ıi]rze|don[dm]u[şs]|frozen|sos|soslu|barbekü|sweet chili|pesto)/iu,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Ground beef in 400 / 500 g trays + 1 kg packs. Include needs
  // "dana|sığır|biftek" AND "kıyma" (any order). Excludes other meats,
  // processed sausages, and pre-spiced / cooked / frozen variants.
  beef_ground_1kg: {
    query: "dana kıyma",
    include: /(?<!\p{L})(?:dana|sığır|biftek)[^.]*(?<!\p{L})k[ıi]yma/iu,
    exclude: [
      /(?<!\p{L})(?:kuzu|koyun|tavuk|piliç|hindi|tav[şs]an)/iu,
      /(?<!\p{L})(?:köfte|sucuk|salam|sosis|salami|pizza|mantı|çiğ köfte|burger|patty)/iu,
      /(?<!\p{L})(?:baharatlı|terbiyel[iı]|marinasyon|kavurma|haşlanm[ıi][şs])/iu,
      /(?<!\p{L})(?:donmuş|don[dm]u[şs]|frozen|kons|konserve|hazır|paket)/iu,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Hard yellow cheese (kaşar) in 200 / 350 / 500 / 700 g wedges.
  // Beyaz peynir (white feta-style) is an alternative staple but
  // ships in brine; excluded here to keep normalisation stable.
  cheese_local_500g: {
    query: "kaşar peyniri",
    include: /(?<!\p{L})(?:ka[şs]ar|tulum|ezine|mihalı[çc])/iu,
    exclude: [
      /(?<!\p{L})(?:rendelenm[ıi][şs]|toz|kakaolu|tatl[ıi]|haz[ıi]r|hellim|halloumi|mozzarella|cheddar|gouda|brie|parmesan|krem|labne|pizza)/iu,
      /(?<!\p{L})(?:at[ıi][şs]t[ıi]rmal[ıi]k|paket|cips|patl[ıi]y[ıi][çc]|nuget|köfte|burger)/iu,
      /(?<!\p{L})(?:laktozsuz|laktozsiz|so[şs]|salça|baharat|aroma|otlu|domatesli)/iu,
    ],
    sizeRange: { min: 150, max: 800 },
    unitFromTitle: "g",
  },
  // Imported beer 0.33 / 0.5 L. Expected to miss every cron because
  // Migros TR does not sell alcohol online; the picker still ships
  // for catalog uniformity.
  beer_imported_500ml: {
    query: "bira",
    include:
      /(?<!\p{L})(?:heineken|carlsberg|tuborg|stella|becks|budweiser|corona|leffe|hoegaarden|krombacher|paulaner|warsteiner|asahi|peroni|kronenbourg|guinness|grolsch|miller|amstel|desperados|efes|bomonti)/iu,
    exclude: [
      /(?<!\p{L})(?:alkols[uü]z|alcohol-free|bardağ[ıi]|cam|bardak|seramik|porselen|kalıp|açacak|opener|altl[ıi]k|sevimli)/iu,
      /(?<!\p{L})(?:malt|aromal[ıi]|şurup|sirop|cocktail|tonik|enerji)/iu,
      /0\.0/,
    ],
    sizeRange: { min: 250, max: 550 },
    unitFromTitle: "ml",
  },
};

/**
 * Parse a Turkish-grammar size token out of a Migros product name.
 *
 * Examples:
 *   "Migros Yarım Yağlı UHT Süt 1 L"        -> 1000 (mL)
 *   "Vio Mineralwasser Naturelle 1,5 L"     -> 1500 (mL)
 *   "Migros Tereyağı 250 G"                 -> 250 (g)
 *   "Migros Baldo Pirinç 2,5 Kg"            -> 2500 (g)
 *   "Keskinoglu 15'li L Büyük Boy Yumurta"  -> 15 (pcs)
 *   "12 Adet Yumurta"                       -> 12 (pcs)
 *
 * Litre token takes precedence over kg/g when both could match (a
 * '3% Yağlı' or '%3 yağlı' percentage mention should not be parsed
 * as 3 g). The regex anchors on whitespace and unit suffix.
 *
 * Exported for unit tests.
 */
export type ParsedUnit = "ml" | "g" | "pcs";

export function parseSizeFromName(
  name: string,
): { value: number; unit: ParsedUnit } | null {
  const s = name.replace(/ /g, " ");

  // Litres: " 1 L", " 1L", " 1,5L", " 1,5 L", " 1.5L"
  const litre = s.match(/(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*l\b/i);
  if (litre) {
    const v = parseFloat(litre[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 50) return { value: Math.round(v * 1000), unit: "ml" };
  }
  // Kilograms: " 1 Kg", " 2,5 Kg"
  const kg = s.match(/(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*kg\b/i);
  if (kg) {
    const v = parseFloat(kg[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 100) return { value: Math.round(v * 1000), unit: "g" };
  }
  // Bare-Kg: loose produce and butchery (e.g. "Muz Yerli Kg",
  // "Patates Yeni Mahsul Kg", "Uzman Kasap Piliç Bonfile Kg"). Migros
  // sells fresh fruit, veg, and per-kilo meat with the price displayed
  // as the kg rate and no number prefix. Treat the whole pack as 1000 g
  // so the per-unit sort and sizeRange checks work uniformly with the
  // packaged candidates that ship as "1 Kg", "500 G", etc. Only fire
  // when the title ends with " Kg" so we do not collide with mid-title
  // brand fragments.
  const bareKg = s.match(/\s+kg\s*$/i);
  if (bareKg) return { value: 1000, unit: "g" };
  // Millilitres: " 500 ml", " 500ml"
  const ml = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*ml\b/i);
  if (ml) {
    const v = parseInt(ml[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "ml" };
  }
  // Grams: " 200 G", " 200g", " 500G"
  const g = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*g\b/i);
  if (g) {
    const v = parseInt(g[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "g" };
  }
  // Pieces: "12'li", "15'li", "12 Adet", "10 lı"
  const pcs =
    s.match(/(\d{1,3})['’]?\s*l[ıi]\b/i) || s.match(/(\d{1,3})\s+adet\b/i);
  if (pcs) {
    const v = parseInt(pcs[1]!, 10);
    if (Number.isFinite(v) && v > 0 && v < 200) return { value: v, unit: "pcs" };
  }
  return null;
}

interface ParsedProduct {
  sku: string;
  title: string;
  priceMajor: number;
  packSize: number;
  /**
   * Unit class parsed from the title. Used by pickBestMatch to
   * reject candidates whose unit class does not match the slug's
   * expected unit (e.g. an apples slug expecting "g" must NOT
   * accept a 1 L liquid product like "Dimes Ekşi Elma 1 L" juice).
   */
  packUnit: ParsedUnit;
  sourceUrl: string;
}

/**
 * Convert one Migros JSON product into the scraper's internal
 * representation. Returns null when the title carries no parseable
 * size token (rare but happens for "Çay Bardağı" style novelty
 * items in the search hits).
 *
 * Exported for unit tests.
 */
export function parseProduct(p: MigrosProduct): ParsedProduct | null {
  const size = parseSizeFromName(p.name);
  if (size === null) return null;
  const cents = Math.min(p.shownPrice, p.regularPrice || p.shownPrice);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  return {
    sku: p.sku,
    title: p.name,
    priceMajor: cents / 100,
    packSize: size.value,
    packUnit: size.unit,
    sourceUrl: `${API_BASE}/${p.prettyName}`,
  };
}

function pickBestMatch(
  products: ParsedProduct[],
  picker: TrPicker,
): ParsedProduct | null {
  const candidates = products.filter((p) => {
    if (!picker.include.test(p.title)) return false;
    if (picker.exclude.some((rx) => rx.test(p.title))) return false;
    if (picker.unitFromTitle && p.packUnit !== picker.unitFromTitle) return false;
    if (p.packSize < picker.sizeRange.min || p.packSize > picker.sizeRange.max)
      return false;
    return true;
  });
  if (candidates.length === 0) return null;
  // Sort by per-canonical-unit price so multi-kg bags compete fairly
  // with single-unit items inside the same sizeRange. priceMajor /
  // packSize is the per-unit rate; sort ascending.
  candidates.sort((a, b) => a.priceMajor / a.packSize - b.priceMajor / b.packSize);
  return candidates[0]!;
}

/**
 * Fetch one query against the Migros search endpoint and return the
 * parsed candidate list. Returns an empty array on any non-2xx, parse
 * error, or timeout, so the caller treats it as "no candidates".
 *
 * Exported for unit tests via the fetchImpl seam.
 */
export async function fetchQueryProducts(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedProduct[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${API_BASE}/rest/products/search?q=${encodeURIComponent(query)}&limit=30`;
    const res = await fetchImpl(url, {
      headers: REQUEST_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const raw: unknown = await res.json();
    const parsed = MigrosSearchResponseSchema.safeParse(raw);
    if (!parsed.success) return [];
    const products = parsed.data.data.storeProductInfos ?? [];
    const out: ParsedProduct[] = [];
    for (const p of products) {
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

/**
 * Live scrape, exported entry point. Pure HTTP, no Browser Use Cloud.
 */
export async function scrapeMigrosTr(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("migros-tr");
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
        reason: `migros returned no candidates for "${picker.query}"`,
      });
      continue;
    }
    const match = pickBestMatch(candidates, picker);
    if (!match) {
      misses.push({
        target,
        reason: `no match for "${picker.query}" (${candidates.length} parsed candidates)`,
      });
      continue;
    }
    scraped.push({
      target,
      retailerSku: match.sku,
      retailerTitle: match.title,
      priceMajor: match.priceMajor,
      packSize: match.packSize,
      scrapedAt,
      sourceUrl: match.sourceUrl,
    });
  }

  return { retailer: "migros-tr", scraped, misses };
}
// @scraper: migros-tr
// @rate-limit: respect retailer crawl policy
// @retry: exponential backoff on fetch failure
// @edge: handle nullish input gracefully
// @cleanup: remove unused import on refactor
// @type: prefer readonly for immutable data
// @note: see RFC-42 for rationale
// @todo: profile under high load
// @i18n: extract pluralization logic
// @edge: handle nullish input gracefully
// @cleanup: remove legacy fallback path
// @guard: rate limit this operation
// @guard: sanitize user input here
// @type: narrow the generic constraint
// @i18n: extract pluralization logic
// @note: see design doc in Notion
// @todo: add unit test coverage
