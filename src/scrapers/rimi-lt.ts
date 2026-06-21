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

const PICKERS: Partial<Record<ProductTarget["slug"], LtPicker>> = {
  // White wheat sandwich bread "balta duona" (Sumuštinių duona,
  // Skrudinimo duona TOSTE). Excludes black rye ("juoda duona"),
  // garlic-baked ("česnakine"), grain biscuits, pastries.
  bread_500g: {
    query: "balta duona 500g",
    include: /\bduona\b/i,
    exclude: [
      /\bjuoda\b/i,
      /\b(?:rugin|rugiu|m[oō]čiut[ėe]s)\b/iu,
      /\b(?:česnak|kepta\s+duona)\b/iu,
      /\b(?:duoniukai|grūdų|paplot|krekery|krekeris)\b/iu,
      /\b(?:saldumai|šokolad|kakao|braškės)\b/iu,
      /\b(?:hot\s*dog|burger|hamburger|salotomis|salotin)\b/i,
      /\b(?:džiūvėsiai|sausainiai|biskvit|napol)\b/iu,
    ],
    sizeRange: { min: 300, max: 700 },
    unitFromTitle: "g",
  },
  // Standard milk in a 1 L carton (DVARO, ROKIŠKIO NAMINIS).
  // Excludes plant milks (kokoso / migdolų / sojos), AUGA
  // lactose-free, kefir, yoghurt, sour cream, curd cheese,
  // baby formula.
  milk_1l: {
    query: "pienas 1l",
    include: /\bpienas\b/i,
    exclude: [
      /\bbe\s+lakt(?:ozes)?\b/iu,
      /\b(?:soja|kokos|avižų|ryžių|migdolų|grikių)\b/iu,
      /\b(?:jogurt|kefyr|grietin|varšk|pasūk)\b/iu,
      /\b(?:kūdik|formul|šeimynine)\b/iu,
      /\b(?:liesas|lengvas)\b/iu,
      /\b(?:šokoladin|braškin|aromatiz)\b/iu,
      /\b(?:gėrimas|gertis)\b/iu,
    ],
    sizeRange: { min: 800, max: 1300 },
    unitFromTitle: "ml",
  },
  // Fresh chicken eggs in 10-piece cartons. Excludes chocolate
  // eggs, quail / goose / duck eggs, liquid / powdered, dyed
  // Easter eggs.
  eggs_12: {
    query: "kiausiniai 10vnt",
    include: /\bkiaušiniai\b/iu,
    exclude: [
      /\b(?:šokolad|saldumai|kakao)\b/iu,
      /\b(?:putpel|žąsų|antie|antis)\b/iu,
      /\b(?:skystieji|miltel|sausi)\b/iu,
      /\b(?:velyk|dažytos)\b/iu,
      /\b(?:šliuk|šiukšl|nat\s*ūr|gėl)\b/iu,
    ],
    sizeRange: { min: 6, max: 30 },
    unitFromTitle: "pcs",
  },
  // 200 g butter bar (ROKIŠKIO, DVARO, ŽEMAITIJOS, all 82%).
  // Excludes nut / peanut butters, margarine, ghee, lard.
  butter_200g: {
    query: "sviestas 200g",
    include: /\bsviestas\b/i,
    exclude: [
      /\b(?:žemės\s+riešut|riešut|migdol|kokos)\b/iu,
      /\b(?:margarin|tartin|spread|aug[ai]l|s[ėe]klų)\b/iu,
      /\b(?:ghee|lydytas|kausintas)\b/iu,
      /\b(?:lardas?|tauk)\b/iu,
      /\b(?:saldumai|biskvit|kremas)\b/iu,
    ],
    sizeRange: { min: 100, max: 300 },
    unitFromTitle: "g",
  },
  // White granulated 1 kg sugar (RIMI SMART 0.67 EUR, RIMI 1.09,
  // PANEVĖŽIO PLIUS 0.79). Excludes brown, organic premium,
  // powder / icing / cube / syrup, vanilla.
  sugar_1kg: {
    query: "cukrus baltas",
    include: /\bcukrus\b/i,
    exclude: [
      /\brudasis?\s+cukrus\b/iu,
      /\b(?:milteliai?|pulveris|kubel|sirop)\b/iu,
      /\b(?:vanili|cinam|fruktoz|stevija|aspart)\b/iu,
      /\b(?:ekologišk)\b/iu,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // White rice 1 kg / 800 g bag (Apvalieji ryžiai GRALLA 800g
  // is the canonical Lithuanian retail pick). Excludes basmati,
  // jasmine, brown, wild, rice flour / cakes / drinks, baby.
  // Leading "r" is ASCII so `\b` anchors, the non-ASCII "ž" sits
  // in the middle of the word and does not break the boundary.
  rice_1kg: {
    query: "ryziai balti",
    include: /\bryžiai\b/iu,
    exclude: [
      /\b(?:basmati|jazmin|laukinis|rudieji|t[uū]turai)\b/iu,
      /\b(?:risotto|paella|sushi)\b/i,
      /\b(?:kūdik|piebar|formul)\b/iu,
      /\b(?:miltai|duona|pyrag|sausainiai)\b/iu,
      /\b(?:košė|kruopos|tirštas)\b/iu,
    ],
    sizeRange: { min: 500, max: 1200 },
    unitFromTitle: "g",
  },
  // Loose fresh red tomatoes per kg ("Lietuviški pomidorai
  // 2 kl., kg" 2.59 EUR, "Raudonieji pomidorai 1 kl., 1 kg"
  // 1.76 EUR). Excludes cherry / mini varieties, sauce / paste
  // / ketchup, sun-dried, marinated, salads.
  tomatoes_1kg: {
    query: "pomidorai kg",
    include: /\bpomidorai\b/i,
    exclude: [
      /\b(?:cherry|slyvini|mažieji|mažas|smulkieji)\b/iu,
      /\b(?:saltyk|kečup|pasta|padaž|sals)\b/iu,
      /\b(?:konservuoti|virti|kepti|marinuoti?)\b/iu,
      /\b(?:saulėje\s+džiov|džiov|liofiliz)\b/iu,
      /\b(?:salot|past|sriub)\b/iu,
      /\b(?:geltonieji|oranzin)\b/iu,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Loose fresh potatoes per kg ("Lietuviškos bulvės Gala/Jelly,
  // d.45+, 1 kg" 0.22 EUR is the canonical floor pick).
  // Excludes sweet potatoes (batatai), salads, mashed, croquettes,
  // chips, frozen processed. Leading "b" is ASCII so `\b` works.
  potatoes_1kg: {
    query: "bulves kg",
    include: /\bbulvės\b/iu,
    exclude: [
      /\b(?:bata[at]|saldoji)\b/iu,
      /\b(?:salot|kep|čips|traškučiai)\b/iu,
      /\b(?:košė|tyrelė|tarkuotos)\b/iu,
      /\b(?:šald|šaldyt)\b/iu,
      /\b(?:šlauneliu|paplotė)\b/iu,
    ],
    sizeRange: { min: 800, max: 5500 },
    unitFromTitle: "g",
  },
  // Olive oil bottle. Rimi LT stocks 750 ml extra virgin packs
  // as the closest-to-1L sensible canonical (RIMI EXTRA VIRGIN
  // 750 ml 10.49 EUR scales to 13.99 EUR per litre). Excludes
  // shampoos / soaps named with olive, sunflower / corn / rape.
  olive_oil_1l: {
    query: "alyvuogiu aliejus",
    include: /\balyvuogi[ųu]\s+aliejus\b/iu,
    exclude: [
      /\b(?:šampūnas?|kremas?|losjon|kosmetika|muilas?)\b/iu,
      /\b(?:saulėgr|rapsų|kukurūzų|sojos|linų)\b/iu,
      /\b(?:aerozolis|purškiklis)\b/iu,
    ],
    sizeRange: { min: 700, max: 1200 },
    unitFromTitle: "ml",
  },
  // Still water 1.5 L PET (AKVILĖ 0.79 EUR, NEPTŪNAS 0.86).
  // The include requires both "vanduo" and "negaz" so all
  // sparkling rows drop out. Leading "v" / "n" are ASCII so
  // `\b` works.
  // Word order in Lithuanian titles is reversed compared to EE
  // and LV ("Negaz. mineralinis vanduo NEPTŪNAS, 1,5l"); the
  // include uses two lookaheads so the still-water marker and
  // the "vanduo" word can appear in either order.
  water_bottled_1500ml: {
    query: "vanduo negazuotas 1,5l",
    include: /(?=.*\bvanduo\b)(?=.*\bnegaz)/iu,
    exclude: [
      /\bgazuotas\b/iu,
      /\b(?:aromatizuotas|skonio|citrinos|braškiu|uogų)\b/iu,
      /\b(?:kūdik|kūdikių|šeimynine)\b/iu,
      /\b(?:tonik|izotonin|sport|elektrolit)\b/iu,
      /\b(?:dest|kondicionav|kosmetika)\b/iu,
    ],
    sizeRange: { min: 1400, max: 1600 },
    unitFromTitle: "ml",
  },
  // Loose fresh bananas per kg ("Bananai Cavendish 1kg" 0.89
  // EUR). Excludes juices, smoothies, dried banana chips,
  // baby cereals, baked goods named with banana.
  bananas_1kg: {
    query: "bananai kg",
    include: /\bbananai\b/i,
    exclude: [
      /\b(?:sultys|nektaras|gėrimas|kokteil|tirštas)\b/iu,
      /\b(?:traškučiai|čips|džiov|liofiliz)\b/iu,
      /\b(?:kūdik|šeimynine|kruopos)\b/iu,
      /\b(?:ledai|tortas|sausai|jogurt|pyrag)\b/iu,
      /\b(?:šokoladin|kremas)\b/iu,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Loose fresh apples per kg ("Obuoliai Champion 1 kl., 1 kg"
  // 0.49 EUR canonical). Excludes apple juice, cider, vinegar,
  // shampoos / soaps, jams, baby food, pastries.
  apples_1kg: {
    query: "obuoliai kg",
    include: /\bobuoliai\b/i,
    exclude: [
      /\b(?:sultys|nektaras|sidras|actas|kremas)\b/iu,
      /\b(?:kūdik|šeimynine|brokastys|tirštas)\b/iu,
      /\b(?:saldumai|cinam|cinamon|šokol)\b/iu,
      /\b(?:past|tyrel|uoge|dziem)\b/iu,
      /\b(?:tortas|sausai|pyrag|ledai)\b/iu,
      /\b(?:šampūnas?|losjon)\b/iu,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Fresh chicken breast filet (broiler filė, 400 / 500 g
  // consumer tray). Excludes chicken liver (kepenėlės),
  // legs / thighs (šlaunelės / šlaunis), wings, pork
  // (kiauliena), turkey (kalakutiena), ground meat, eggs.
  // The trailing `\b` on "filė" fails in ASCII-mode \b because
  // "ė" is non-word, so we drop the trailing anchor entirely.
  // Excludes drop the trailing `\b` for the same reason on the
  // various non-ASCII-suffix Lithuanian noun stems.
  chicken_breast_1kg: {
    query: "broileris filete",
    include: /\bbroileri[ouų]?\b.*\bfil[ėe]/iu,
    exclude: [
      /\bkepenėl/iu,
      /\bšlaun/iu,
      /\b(?:sparnel|sparnai|kojel|kojos|nugarin)/iu,
      /\b(?:kiauliena|kalakutien|jautien)/iu,
      /\b(?:kiaušiniai|maltinis|smulk|šaldyt)/iu,
      /\b(?:rūkyt|kept|šaldyt|panieruot)/iu,
      /\b(?:vidin\b|kepsny|antrekot|šniceli)/iu,
      /\b(?:mėsa|kotletai)\b/iu,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Ground beef ("smulkinta jautiena", typically RIMI 1 kg tray
  // at 4.25 EUR / kg). Excludes pork mixes ("kiauliena ir
  // jautiena"), turkey / chicken, americano burgers, steaks,
  // sausages, canned beef.
  beef_ground_1kg: {
    query: "smulkinta jautiena",
    include: /\b(?:smulk(?:inta)?\.?|smulkint)\b.*\bjautien/iu,
    exclude: [
      /\bkiauliena\b/iu,
      /\b(?:kalakut|vista|broileri|antie|av[ie]ena)\b/iu,
      /\b(?:americano|burger|kepsnys?|antrekot|kumpio)\b/iu,
      /\b(?:dešra|sausa|konser|past)\b/iu,
      /\b(?:salot|šaldyt[ai])\b/iu,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Local hard cheese 200-300 g tray (RIMI SMART Tilsit 250 g
  // 1.49 EUR canonical floor, DVARO / ROKIŠKIO 240 g around
  // 2.85-3.19). Rimi LT does not stock the 500 g packs that EE
  // and LV both carry, so the sizeRange targets the smaller
  // tray and normalize.ts scales the on-chain price up by
  // canonical/packSize so the cross-country comparison stays
  // valid. Excludes halloumi / mozzarella / cream cheese /
  // feta, kid cheese sticks, sausage-style snack cheese.
  cheese_local_500g: {
    query: "fermentinis suris",
    include: /\bsūris\b/iu,
    exclude: [
      /\b(?:halloumi|mocarell|mozzarell|brie|camembert|feta)\b/iu,
      /\b(?:lydytas|tirpus|sūrelis|kremin|frischk)\b/iu,
      /\b(?:dešrel|pikenikas|pik-nik|sniukšt)\b/iu,
      /\b(?:salotų|sūr.?\s+sausainiai|šveižias)\b/iu,
      /\b(?:šokol|kūdik|saldumai)\b/iu,
      /\b(?:tarkuot|smulkint|švieži[as]?\s+sūris)\b/iu,
    ],
    sizeRange: { min: 150, max: 350 },
    unitFromTitle: "g",
  },
  // 500 ml beer can (KAUNO alus 0,5l 1.79 EUR canonical local;
  // ESTRELLA Damm, VOLFAS ENGELMAN, KALNAPILIS at 1.39-1.95
  // also qualify). Excludes non-alcoholic, Radler, flavoured,
  // cider, sausage / cheese cross-contamination, gift kits.
  // Excludes drop the trailing `\b` so the Lithuanian noun
  // ending "nis" / "iniai" on "nealkoholinis" / "bealkoholinis"
  // is still caught.
  beer_imported_500ml: {
    query: "alus skardine 500ml",
    include: /\balus\b/i,
    exclude: [
      /\b(?:bealkohol|be\s+alkohol|nealkohol|0[,.]0%)/iu,
      /\b(?:radler|kokteilis|aromat|skoni[us]|braški|cidr)\b/iu,
      /\b(?:sviestas|sūris|past|dešra|salot)\b/iu,
      /\b(?:dovan|rinkin|kompl|paket|kalėd|šventin)\b/iu,
      /\b(?:vyšni[ųu]\s+kriek)\b/iu,
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
// @scraper: rimi-lt
// @rate-limit: respect retailer crawl policy
// @retry: exponential backoff on fetch failure
// @config: prefer env var over hardcode
// @guard: validate before processing
// @i18n: add locale-specific number format
// @perf: monitor allocation pattern here
// @a11y: check contrast ratio here
// @perf: monitor allocation pattern here
