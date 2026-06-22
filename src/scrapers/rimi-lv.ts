/**
 * Rimi Latvia scraper, via the public search page on rimi.lv.
 *
 * Same `data-gtm-eec-product` per-card JSON envelope as rimi.ee
 * (see src/scrapers/rimi-ee.ts for the design notes); only the
 * base URL, search path, accepted Latvian piece suffix ("gab" =
 * gabali), and per-country picker tables differ. parseSizeFromName
 * + extractRimiCards are reimplemented here verbatim rather than
 * imported because each adapter owns its own size-suffix table;
 * a shared common module can come later if the EE / LV / LT trio
 * starts to drift.
 *
 * Latvia-specific quirks:
 *
 * 1. White wheat sandwich bread is "baltmaize", dark rye is
 *    "rudzu maize"; both can carry the word "maize". The bread
 *    picker requires "baltmaize" or the white-bread-shaped
 *    variants like "sumustinju".
 *
 * 2. Loose produce uses ", kg" / ", 1 kg" / "1 kl., 1 kg"
 *    trailers in the title; the parser treats any of these as
 *    a 1 kg pack.
 *
 * 3. Latvian uses macrons (a / e / i / u with overbar) and
 *    several caron / cedilla letters that JavaScript's ASCII
 *    `\b` treats as non-word characters, so picker patterns
 *    starting with such letters (ūdens = water, āboli = apples,
 *    olīveļļa = olive oil) anchor with a Unicode lookbehind.
 *
 * 4. Eggs ship as 10-piece cartons ("olas 10 gab."), same
 *    canonical 12/10 scaling via normalize.ts.
 */
import { z } from "zod";

import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const BASE = "https://www.rimi.lv";
const SEARCH_PATH = "/e-veikals/lv/meklesana";
const FETCH_TIMEOUT_MS = 20_000;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept-Language": "lv-LV,lv;q=0.9,en;q=0.5",
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

interface LvPicker {
  query: string;
  include: RegExp;
  exclude: readonly RegExp[];
  sizeRange: { min: number; max: number };
  unitFromTitle?: ParsedUnit;
}

const PICKERS: Partial<Record<ProductTarget["slug"], LvPicker>> = {
  // White wheat sandwich bread "baltmaize". Excludes rye
  // ("rudzu maize"), kefir-fermented (debatable, kept out for
  // a cleaner canonical pick), sweet pastries, and rusks.
  bread_500g: {
    query: "baltmaize 500g",
    include: /\bbaltmaize\b/i,
    exclude: [
      /\brudzu\s+maize\b/i,
      /\bkefīra\b/iu,
      /\b(?:rieksti|kakao|šokolāde|saldumi|saldskābmaize)\b/iu,
      /\bsuk[āa]du\b/iu,
      /\b(?:hot\s*dog|burger|hamburger)\b/i,
    ],
    sizeRange: { min: 300, max: 800 },
    unitFromTitle: "g",
  },
  // Standard milk in a 1 L bottle / carton. Excludes lactose-
  // free, plant milks (soy / oat / rice / almond / coconut),
  // yoghurt, kefir, sour cream, cottage cheese, and baby
  // formula.
  milk_1l: {
    query: "piens 1l",
    include: /\bpiens\b/i,
    exclude: [
      /\bbez\s+laktozes\b/i,
      /\b(?:soja|kokosriek|auzu|rīsu|mandeļu|griķu)\b/iu,
      /\b(?:jogurt|kefīr|biezpiens|krējums|skābpiens|paniņas)\b/iu,
      /\b(?:bērn|maml|formula|imikam)\b/i,
      /\b(?:vājpiens|paskābints)\b/i,
      /\b(?:šokolādes|ogu|garšojo|aromatizēt)\b/iu,
      /\b(?:sieru|past[ēe]li[ēe]ts)\b/iu,
    ],
    sizeRange: { min: 800, max: 1300 },
    unitFromTitle: "ml",
  },
  // Fresh chicken eggs in a 10-piece carton. Excludes chocolate
  // eggs, quail / goose / duck eggs, liquid / powdered.
  eggs_12: {
    query: "olas 10gab",
    include: /\bolas\b/i,
    exclude: [
      /\b(?:šokolādes|šokol|saldumi|kakao)\b/iu,
      /\b(?:paipal|zosu|pīļ|paipalu)\b/iu,
      /\b(?:šķidrās?|pulver)\b/iu,
      /\b(?:lieldienu|krāsainas)\b/iu,
      /\b(?:salāt|past|maltiņ)\b/iu,
      /\b(?:maisi|saimniec|šuksli|ziedu)\b/iu,
    ],
    sizeRange: { min: 6, max: 30 },
    unitFromTitle: "pcs",
  },
  // 200 g butter bar (Rimi own-brand, Exporta, Straupe, Valio).
  // Lactose-free 82% butter (Valio Eila) is kept; the canonical
  // class is "fat butter", lactose neutrality is allowed.
  // Excludes nut / peanut butters, margarine, ghee, lard.
  butter_200g: {
    query: "sviests 200g",
    include: /\bsviests\b/i,
    exclude: [
      /\b(?:zemesriekstu|riekstu|mandeļu|kokosriek|graud|saulgriež)\b/iu,
      /\b(?:margarīns|tartin|spread|krējumvielas|augu)\b/iu,
      /\b(?:ghee|kausēts|attīrīts|kausē)\b/iu,
      /\b(?:lardas?|tauks)\b/iu,
      /\b(?:cep|biskvit|smēr|sviestmaize)\b/iu,
    ],
    sizeRange: { min: 100, max: 300 },
    unitFromTitle: "g",
  },
  // White granulated sugar 1 kg bag (Rimi Smart 0.69, Dansukker
  // Jelgavas 1.19). Excludes brown sugar, icing / cubes / syrup,
  // sweeteners, jam-grade sugar.
  sugar_1kg: {
    query: "cukurs 1kg",
    include: /\bcukurs\b/i,
    exclude: [
      /\bbrūnais\s+cukurs\b/iu,
      /\b(?:milteļi|pulveris|kubik|sīrupa?)\b/iu,
      /\b(?:fruktoze|stevija|aspart|sukral|saldināt)\b/iu,
      /\bievārījuma\b/iu,
      /\b(?:vaniļ|ziedu)\b/iu,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // White long-grain rice 1 kg bag (Valdo klasiskie / Parboiled
  // are canonical Latvian retail picks). Excludes basmati,
  // jasmine, wild, brown, rice flour, rice cakes, baby food.
  // Leading non-ASCII "ī" needs a Unicode-aware lookbehind.
  rice_1kg: {
    query: "risi 1kg",
    include: /(?<!\p{L})rīsi\b/iu,
    exclude: [
      /\b(?:basmati|jasmīn|savvaļ|brūnie|melnie)\b/iu,
      /\b(?:risotto|paella|sushi)\b/i,
      /\b(?:bērn|imikiem|piebar|formula)\b/iu,
      /\b(?:milti|maize|kūk|čip|kraukš)\b/iu,
      /\b(?:biezputras?|putra)\b/iu,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Loose fresh tomatoes per kg ("Tomāti ķekaros 2.šķira kg").
  // The "Tomāti" non-ASCII a-macron sits in the middle of an
  // ASCII-bracketed root, so `\b` still matches at the leading
  // "T". Excludes canned / paste / sauce / sun-dried, cherry
  // and small specialty varieties, and salads.
  tomatoes_1kg: {
    query: "tomati kg",
    include: /\btomāti\b/iu,
    exclude: [
      /\b(?:ketčup|pasta|piests|mērce|sals)\b/iu,
      /\b(?:cherry|slyvini|mazie|maziejiem|sākara)\b/iu,
      /\b(?:cepi|konserv|kvēli|sutināt|marinēti?|marinad)\b/iu,
      /\b(?:saulēs?\s+kalt|kaltēt|liofiliz)\b/iu,
      /\b(?:salāt|salāts|zupu|past)\b/iu,
      /\b(?:dzeltenie|aveņu)\b/iu,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Loose fresh potatoes per kg ("Kartupeļi sveramie 40-60mm").
  // Excludes sweet potatoes ("batāti"), salads, mash, croquettes,
  // chips, frozen processed.
  potatoes_1kg: {
    query: "kartupelis kg",
    include: /\bkartupeļi\b/iu,
    exclude: [
      /\b(?:saldie|batāti|salty)\b/iu,
      /\b(?:salāt|ceptie|čip|kraukš|stikr|stick)\b/iu,
      /\b(?:p[ūu]rēs?|hrana|p[āa]nkr[ūu]ku|biezā)\b/iu,
      /\bsasalde\b/iu,
      /\b(?:rīvēti|sušuš|sasmal)\b/iu,
    ],
    sizeRange: { min: 800, max: 5500 },
    unitFromTitle: "g",
  },
  // Olive oil 1 L bottle (Rimi own-brand 11.99 EUR, pomace /
  // izspaidu 4.49 EUR for the cheaper grade). Excludes shampoos
  // with olive-oil naming, and other vegetable oils.
  olive_oil_1l: {
    query: "olivellas 1l",
    include: /\b(?:olīveļļa|olīvu\s+(?:eļļa|izspaidu))/iu,
    exclude: [
      /\b(?:šampūns?|krēms?|ziepes?|losjons?|kosmetik)\b/iu,
      /\b(?:saules?ziedu|rapšu|kukurūzas|sojas|linsēkl)\b/iu,
      /\b(?:aerosols?|spray)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "ml",
  },
  // Still water 1.5 L PET ("Avota ūdens Rimi negāzēts 1,5l"
  // 0.44 EUR is canonical). The include requires "negāzēts"
  // so all sparkling rows fall out before the cheap-water
  // sort. Leading non-ASCII "ū" needs Unicode lookbehind.
  water_bottled_1500ml: {
    query: "udens 1,5l",
    include: /(?<!\p{L})ūdens\b.*\bnegāzēts\b/iu,
    exclude: [
      /\bgāzēts\b/iu,
      /\b(?:garšojo|augļu|fruit|lim|citr|ogu|aroma)\b/iu,
      /\b(?:bērn|imikam|maml)\b/iu,
      /\b(?:tonik|isotonisk|sporta|elektrolit)\b/i,
      /\b(?:dest|kondicion|kosmetik)\b/iu,
    ],
    sizeRange: { min: 1400, max: 1600 },
    unitFromTitle: "ml",
  },
  // Loose fresh bananas per kg ("Banāni Cavendish 1.šķira kg").
  // Excludes baby food, banana chips, snack bars, drinks, ice
  // cream, baked goods.
  bananas_1kg: {
    query: "banani kg",
    include: /\bbanāni\b/iu,
    exclude: [
      /\b(?:p[ūu]rēs?|sula|jogurt|dzēriens?|kokteilis?)\b/iu,
      /\b(?:čip|kalt|liofiliz|kraukš)\b/iu,
      /\b(?:bērn|imikam|maml|formula)\b/iu,
      /\b(?:saldēj|cep|brokast|kūk|tort|cake)\b/iu,
      /\b(?:šokolādes|saldumi|kompvek|batonin)\b/iu,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Loose fresh apples per kg. Several local varieties qualify:
  // Champion (0.93 EUR is the canonical cheap pick), Royal Gala,
  // Golden Delicious, Granny Smith. Leading non-ASCII "ā" needs
  // Unicode lookbehind. Excludes pears (Bumbieri), apple juice,
  // cider, vinegar, baby food, jams.
  apples_1kg: {
    query: "aboli kg",
    include: /(?<!\p{L})āboli\b/iu,
    exclude: [
      /\bbumbieri?\b/iu,
      /\b(?:sula|nektārs?|sidrs?|etķi|kr[ēe]ms?|ziepes?|šampūns?)\b/iu,
      /\b(?:bērn|imikam|brokastīm)\b/iu,
      /\b(?:saldumi|krūmu|cept|čip|saulgriež)\b/iu,
      /\b(?:past|p[ūu]rēs|jam|ievārīj)\b/iu,
      /\b(?:tortes|kūk|cake|saldēj)\b/iu,
    ],
    sizeRange: { min: 600, max: 1200 },
    unitFromTitle: "g",
  },
  // Fresh chicken breast filet ("Cāļu krūtiņas filejas Rimi",
  // sold both as a 500 g consumer tray at 3.99 and the per-kg
  // 6.99-7.99 loose option). Excludes turkey, pork, ground
  // meat (m.gaļa), legs / wings / drumsticks, cooked / breaded.
  chicken_breast_1kg: {
    query: "vistas krutina",
    include:
      /\b(?:cāļu\s+krūtiņ|vistas\s+krūtiņ|krūtiņ[ua]?s?\s+filej)/iu,
    exclude: [
      /\b(?:tītar|cūkg|govi|jautien|liellopa)\b/iu,
      /\b(?:konserv|maltā|cepi|panēt|past)\b/iu,
      /\b(?:saldēt|sausās|cooked|pārveidot)\b/iu,
      /\b(?:kāj|spārn|cepetis|stilbiņ|gabaliņ)\b/iu,
      /\b(?:salāt|smūrk|past)\b/iu,
      /\b(?:m\.\s*gaļa)\b/iu,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Loose fresh ground beef per kg ("Liellopa maltā gaļa kg"
  // 10.99 EUR is the canonical retail SKU). Excludes pork
  // mixes, chicken / turkey ground meat, burgers, beef steak,
  // and canned products.
  beef_ground_1kg: {
    query: "liellopu malta gala",
    include: /\bliellopa\s+maltā\s+gaļa\b/iu,
    exclude: [
      /\b(?:cūkg|jaukt|smulk|tītar|vistas|cāļu|pīļ)\b/iu,
      /\b(?:burger|americano|antrekot|steiks?|kepsnys?)\b/iu,
      /\b(?:past|kons[ēe]rv|hrana)\b/iu,
      /\b(?:salāt|salam)\b/iu,
    ],
    sizeRange: { min: 800, max: 1500 },
    unitFromTitle: "g",
  },
  // Local hard cheese 500 g (Rimi own-brand Holandes / Tilsit
  // shavings, plus Tilzites Baltais). Excludes specialty imports
  // (halloumi / mozzarella / brie / camembert), processed
  // slices, grated, cream cheese, and sausage-style cheese.
  cheese_local_500g: {
    query: "siers 500g",
    include: /\bsiers\b/iu,
    exclude: [
      /\b(?:rīvēts?|sasml|kr[ēe]ms?|krēmsiers|biezpiens)\b/iu,
      /\b(?:halloumi|mocarell|mozzarell|brie|camembert|kazas|aitu)\b/iu,
      /\b(?:saldumi|smēr|smēriņš|spread)\b/iu,
      /\b(?:bērn|imikam|magus)\b/iu,
      /\b(?:burger|sviestmaize|pic|picas)\b/iu,
      /\b(?:dēreļ|d[ēe]reļas|st[ūu]kciņ)\b/iu,
      /\b(?:fetās?|salātu)\b/iu,
    ],
    sizeRange: { min: 300, max: 600 },
    unitFromTitle: "g",
  },
  // 500 ml beer can (Bauskas Senču 0.5l 0.99 EUR, Cēsu Premium
  // 0.568l 0.92 EUR, plus the imported Heineken / Carlsberg /
  // Corona variants). Excludes non-alcoholic, flavoured,
  // cocktail / cider crossovers, gift kits.
  beer_imported_500ml: {
    query: "alus banka 500ml",
    include: /\balus\b/iu,
    exclude: [
      /\b(?:bezalkohol|alkohola\s+brīvais|0%\s*alkoh|0,0%)\b/iu,
      /\b(?:radler|augļu|cocktail|kokteilis|garšojo|aromatizēt)\b/iu,
      /\b(?:siders?|cidre|sviestru)\b/iu,
      /\b(?:past|kr[ēe]ms?|sviests|sieru)\b/iu,
      /\b(?:dāvana|kompl|kārba|set|kit)\b/iu,
      /\b(?:malts|drojdes)\b/iu,
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

  // Litres
  const litre = s.match(
    /(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*l(?:t|itri|itrs)?\b/i,
  );
  if (litre) {
    const v = parseFloat(litre[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 50)
      return { value: Math.round(v * 1000), unit: "ml" };
  }
  // Kilograms
  const kg = s.match(/(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*kg\b/i);
  if (kg) {
    const v = parseFloat(kg[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 100)
      return { value: Math.round(v * 1000), unit: "g" };
  }
  // Loose per-kg, three Latvian patterns:
  //   "1 kl., 1 kg" / "1kl, kg"   (produce shelf marker)
  //   ", kg"                      (bare trailer)
  //   "<word> kg" at end          (Liellopa maltā gaļa kg)
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
  // Grams ("500g", "500 gr", "200 g")
  const g = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*(?:gr|g)\b/i);
  if (g) {
    const v = parseInt(g[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "g" };
  }
  // Pieces, the Latvian "gab" / "gab." (gabali) trailer.
  // Also handles the egg-grade marking "A/M Nr.2 10gab" /
  // "A/LM Nr.1 10gab.".
  const pcs = s.match(/(?<![a-zA-Z%\d.,])(\d{1,3})\s*gab\.?\b/i);
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
      sourceUrl: `${BASE}/e-veikals/lv/p/${parsed.data.id}`,
    });
  }
  return out;
}

function pickBestMatch(
  products: ParsedProduct[],
  picker: LvPicker,
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

export async function scrapeRimiLv(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("rimi-lv");
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
        reason: `rimi-lv returned no candidates for "${picker.query}"`,
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

  return { retailer: "rimi-lv", scraped, misses };
}
// @scraper: rimi-lv
// @rate-limit: respect retailer crawl policy
// @retry: exponential backoff on fetch failure
// @i18n: add locale-specific number format
// @guard: validate at component boundary
// @a11y: ensure keyboard navigation works
// @cleanup: inline single-use helper
// @type: narrow from string to union
// @config: prefer env var over hardcode
// @edge: zero-value special case
// @guard: validate before processing
