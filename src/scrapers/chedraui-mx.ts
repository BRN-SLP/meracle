/**
 * Chedraui Mexico scraper, via the VTEX catalog API.
 *
 * Chedraui runs on the same VTEX platform as Disco AR / Wong PE /
 * Olimpica CO. See src/scrapers/disco-ar.ts for the shared design
 * notes (VTEX schema, kg-vs-un measurement split, sanity-aware
 * picker filter, Unicode-aware Spanish accent boundaries).
 *
 * Mexico-specific quirks:
 *
 * 1. \"manteca\" in MX means lard (pork fat), not butter. The butter
 *    picker has to anchor on \"mantequilla\" specifically and exclude
 *    \"manteca\" altogether.
 *
 * 2. \"plátano macho\" is plantain, a cooking banana that is a
 *    different product class from regular eating bananas. The banana
 *    picker excludes \"macho\", \"dominico\" (cooking variety), and
 *    \"plátano frito\" snack chips.
 *
 * 3. Pricing wire format: MXN with decimals (e.g. 26.50 for 1 L milk).
 *    USD 1 is roughly 17 MXN, so the sanity ranges are an order of
 *    magnitude smaller than the COP catalog.
 */
import { z } from "zod";

import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const API_BASE = "https://www.chedraui.com.mx";
const FETCH_TIMEOUT_MS = 15_000;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
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

const ChedrauiProductSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  brand: z.string().optional(),
  linkText: z.string().optional(),
  items: z.array(ItemSchema).min(1),
});
export type ChedrauiProduct = z.infer<typeof ChedrauiProductSchema>;

const ChedrauiSearchResponseSchema = z.array(ChedrauiProductSchema);

interface MxPicker {
  query: string;
  include: RegExp;
  exclude: readonly RegExp[];
  sizeRange: { min: number; max: number };
  unitFromTitle?: ParsedUnit;
}

const PICKERS: Partial<Record<ProductTarget["slug"], MxPicker>> = {
  // Sliced "pan blanco de caja" (white sandwich bread). Bimbo,
  // Selecto, Bonybon. Excludes flatbread (tortilla), buns, sweet
  // breads (pan dulce / concha), and frozen.
  bread_500g: {
    query: "pan blanco de caja",
    include: /\bpan\b/i,
    exclude: [
      /\b(?:tortilla|tostada|nachos|chip)\b/i,
      /\b(?:bolillo|telera|concha|pan dulce|empanada|rosca|churros)\b/i,
      /\b(?:hamburguesa|bollo|pancho|hotdog|sandwich)\b/i,
      /\b(?:relleno|crema|chocolate|dulce|mermelada)\b/i,
      /\b(?:congelado|frozen|keto)\b/i,
    ],
    sizeRange: { min: 300, max: 800 },
    unitFromTitle: "g",
  },
  // Whole milk in 1 L cartons. Lala, Alpura, Alkala, Santa Clara,
  // San Marcos. Excludes skim, lactose-free, flavoured, evaporated
  // (Carnation), and condensed.
  milk_1l: {
    query: "leche entera 1 litro",
    include: /\bleche\b.*\bentera\b/i,
    exclude: [
      /\b(?:deslactosada|sin lactosa|descremada|semi|light|reducida)\b/i,
      /\b(?:saborizada|chocolatada|chocolate|fresa|vainilla|coco)\b/i,
      /\b(?:condensada|evaporada|crema|dulce|nata)\b/i,
      /\b(?:soja|almendra|coco|avena|arroz|maternizada|formula)\b/i,
      /\b(?:yogur|yogurt|kefir|jocoque)\b/i,
      /\b(?:gal[oó]n|6 piezas|piezas)\b/i,
    ],
    sizeRange: { min: 700, max: 1300 },
    unitFromTitle: "ml",
  },
  // Fresh eggs in 12 / 18 / 30 piece cartons. Bachoco, Kaki, Crio,
  // Sabrohuevo. Excludes liquid egg, powdered, dyed Easter eggs.
  eggs_12: {
    query: "huevo blanco",
    include: /\bhuevos?\b/i,
    exclude: [
      /\b(?:liquido|líquido|pasteurizado|polvo|chocolate|pascua)\b/i,
      /\b(?:codorniz|pato|tortuga)\b/i,
      /\b(?:cocido|hervido|frito|sabor)\b/i,
    ],
    sizeRange: { min: 6, max: 30 },
    unitFromTitle: "pcs",
  },
  // Mexican butter is "mantequilla". "Manteca" alone is lard, NOT
  // butter, so the butter picker excludes manteca explicitly. The
  // butter slug also has to dodge "Galletas Gamesa Crackets
  // Mantequilla" style crackers, which Chedraui ships at half the
  // per-pack price and otherwise outrank actual butter on per-unit
  // sort. Aurrera, Lala, Gloria, San Antonio are the butter brands.
  butter_200g: {
    query: "mantequilla con sal",
    include: /\bmantequilla\b/i,
    exclude: [
      /\b(?:manteca|lard|cerdo|res|pollo)\b/i,
      /\b(?:mani|maní|cacahuate|almendra|coco|ghee)\b/i,
      /\b(?:spread|untable|margarina|vegetal|reducida)\b/i,
      /\b(?:galleta|cracker|crackets|cuernito|hojaldre|alfajor|biscuit|cookie)\b/i,
      /\b(?:pan|panecillo|panqu[eé]|relleno)\b/i,
      /\bsabor\b/i,
      /\b(?:chocolate|cocoa|vainilla|herbs|ajo|fresa|limon)\b/i,
    ],
    sizeRange: { min: 80, max: 600 },
    unitFromTitle: "g",
  },
  // White sugar in 1 kg / 2 kg bags. Cheapest at Chedraui is
  // typically Selecto private label. Excludes sweeteners, candy
  // bars (which match "azucar" as ingredient mention), brown sugar,
  // and yogurts that ship "sin azucar" in the title.
  sugar_1kg: {
    query: "azucar morena 1kg",
    include: /\baz[uú]car\b/i,
    exclude: [
      /\b(?:gaseosa|bebida|jugo|cola|sprite|pepsi|coca|yogurt|yogur)\b/i,
      /\b(?:sin azucar|sin azúcar|zero|light|diet|cero|edulcorante)\b/i,
      /\b(?:splenda|stevia|sucralosa|aspartam|fructosa)\b/i,
      /\b(?:caramelo|chocolate|galleta|chupetin|polvo gelatina)\b/i,
      /\b(?:mascabado|impalpable|en polvo|polvo)\b/i,
    ],
    sizeRange: { min: 800, max: 5500 },
    unitFromTitle: "g",
  },
  // Long-grain or "super extra" rice in 900 g / 1 kg bags. Aurrera,
  // Selecto, Chedraui private label, SOS, Verde Valle. Excludes
  // rice cakes, rice flour, rice-vinegar, and ready-mix kits.
  rice_1kg: {
    query: "arroz blanco 1kg",
    include: /\barroz\b/i,
    exclude: [
      /\b(?:galleta|biscocho|snack|chip|harina|fideo|pasta)\b/i,
      /\b(?:bebida|leche|aroma|saborizado|crema|vinagre|sushi)\b/i,
      /\b(?:yakimeshi|preparado|hervido|cocido|knorr)\b/i,
      /\b(?:integral con|wok|salteado|mix|kit)\b/i,
    ],
    sizeRange: { min: 800, max: 5500 },
    unitFromTitle: "g",
  },
  // Fresh tomatoes ("Tomate Bola por kg", "Tomate Saladette por
  // kg"). Excludes salsas, purees, ketchup, pizza pre-mixes, and
  // canned crushed varieties ("Tomate Molido Del Fuerte"); those
  // are processed pantry goods, not the fresh produce the canonical
  // tomatoes_1kg slug represents.
  tomatoes_1kg: {
    query: "tomate kg",
    include: /\btomate/i,
    exclude: [
      /\b(?:salsa|catsup|ketchup|pulpa|extracto|sopa|jugo|conserva|enlatado)\b/i,
      /\bpur[eé](?!\p{L})/iu,
      /\b(?:la costeña|herdez|hellmann|del monte|del fuerte|maggi|knorr|valle)\b/i,
      /\b(?:pizza|empanada|tarta|relleno|preparado|mix|frijol)\b/i,
      /\b(?:deshidratado|secado|seco|polvo|aroma|saborizado)\b/i,
      /\b(?:molid[oa]s?|tritura(?:d[oa]s?|do)|aplastad[oa]s?|condimentad[oa]s?|sazonad[oa]s?)\b/i,
      // Tomatillo ("Tomate Verde") is Physalis ixocarpa, a different
      // species. The canonical tomatoes_1kg slug means red tomato
      // (Solanum lycopersicum) for cross-country comparability.
      /\b(?:verde|verdes|tomatill[oa]s?)\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Fresh potatoes ("Papa Blanca", "Papa Morena", "Papa Alpha"
  // varieties per kg). Excludes sweet potato (camote), plantain,
  // frozen fries (McCain), potato chips, mashed potato prep.
  potatoes_1kg: {
    query: "papa blanca kg",
    include: /\bpapa\b/i,
    exclude: [
      /\b(?:camote|batata|dulce|yuca|achicoria)\b/i,
      /\b(?:frita|fritas|baston|nugget|smile|congelada|prefrita)\b/i,
      /\b(?:chip|chips|snack|sabritas|tortilla|nacho)\b/i,
      /\b(?:mccain|simon|simply)\b/i,
      /\b(?:fecula|almidón|harina|pure|puré)\b/i,
      /\b(?:relleno|tarta|empanada|salsa|aderezo|preparado|torta)\b/i,
      /\b(?:cambray)\b/i,
    ],
    sizeRange: { min: 500, max: 5500 },
    unitFromTitle: "g",
  },
  // Olive oil in 250 / 500 / 1000 ml bottles. Borges, Carbonell,
  // Selecto. Excludes mayo, dressings, body / cosmetic olive oil
  // products, and oil sprays.
  olive_oil_1l: {
    query: "aceite oliva",
    include: /\baceite\b.*\boliva\b/i,
    exclude: [
      /\b(?:girasol|maiz|maíz|mezcla|soja|canola|cocina|vegetal)\b/i,
      /\b(?:aerosol|spray|crema|loción|cosmetic|jabón|champu|champú|gel)\b/i,
      /\b(?:vinagre|aceto|aliño|aderezo|condimento|salsa)\b/i,
      /\b(?:mayonesa|ketchup|mostaza|hummus|tahini|alioli)\b/i,
      /\b(?:atun|atún|sardina|anchoa|conserva|en lata)\b/i,
    ],
    sizeRange: { min: 200, max: 1200 },
    unitFromTitle: "ml",
  },
  // Bottled still water in 1 / 1.5 / 2 / 5 L bottles or jugs. Ciel,
  // E-Pura, Bonafont, Sta. Maria. Excludes carbonated, tonic,
  // and the "infusionada" / "levité" / "toque sabor" Bonafont sub-
  // line which is flavoured water labelled as "agua" but with red
  // berry / lemon / cucumber notes.
  water_bottled_1500ml: {
    query: "agua natural ciel 1.5",
    include: /\bagua\b/i,
    exclude: [
      /\b(?:con gas|gasificada|mineralizada|soda|tonica|tónica|tonic)\b/i,
      /\b(?:saborizada|aromatizada|infusionada|infusi[oó]n|frutal|limon|naranja|fresa|coco|berries|pepino)\b/i,
      /\b(?:lev[ií]t[eé]|toque sabor|hint of|esencia|extracto)\b/i,
      /\bsabor\b/i,
      /\b(?:gaseosa|cola|sprite|pepsi|coca|inca|isotonica|gatorade|powerade)\b/i,
      /\b(?:destilada|colonia|limpiavidrios|hidratante|energizante)\b/i,
      /\b(?:purificadora|garrafa|garrafón|cajeta|bebida|sixpack|six pack|paquete)\b/i,
    ],
    // 1.5 L PET single-bottle staple. The 5 L Ciel family bottle
    // was being preferred at 8.70 MXN per-canonical-1.5L, well
    // below the actual shelf price of a single 1.5 L bottle (~12-15
    // MXN). Tighten to the consumer pack only.
    sizeRange: { min: 1300, max: 1700 },
    unitFromTitle: "ml",
  },
  // Fresh bananas ("Plátano Chiapas por Kg", "Plátano Tabasco por
  // Kg"). Excludes plantain ("plátano macho", "dominico"), banana
  // chips ("plátano frito", "chifle"), and banana-flavoured products.
  bananas_1kg: {
    query: "platano chiapas kg",
    include: /\bpl[áa]tano/i,
    exclude: [
      /\b(?:macho|dominico|cocinar|burro|cooking)\b/i,
      /\b(?:yogur|yogurt|bebida|smoothie|jugo|aroma|saborizado|nectar)\b/i,
      /\b(?:chip|chips|snack|chifle|deshidratado|seco|frito|liofilizado)\b/i,
      /\b(?:enchilad|empanizad|empacad|tostado|asado|cocido)\b/i,
      /\b(?:budin|kek|panqueque|hojaldre|biscuit|brownie)\b/i,
      /\bpur[eé](?!\p{L})/iu,
      /\b(?:bebe|infant|maternal|formula|leche)\b/i,
      /\b(?:helado|crema|mousse|pudin|relleno|protein)\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Fresh apples per kg (Fuji, Ambrosia, Gala). Excludes apple
  // juice, vinegar, sauce, baby food, snack bars.
  apples_1kg: {
    query: "manzana fuji kg",
    include: /\bmanzana\b/i,
    exclude: [
      /\b(?:jugo|bebida|gaseosa|nectar|isotonica|gatorade|powerade)\b/i,
      /\b(?:vinagre|sidra|fermentada|alcohol)\b/i,
      /\b(?:deshidratada|seca|chip|chips|snack|tarta)\b/i,
      /\b(?:compota|mermelada|jalea|relleno|salsa|strudel)\b/i,
      /\bpur[eé](?!\p{L})/iu,
      /\b(?:bebe|infant|maternal|leche|yogur|cereal)\b/i,
      /\b(?:martinell|saborizad|esencia|extracto)\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Chicken breast. "Pechuga de Pollo por kg" with kg measurement.
  // Excludes nuggets, milanesa, smoked, sausages, turkey (pavo).
  chicken_breast_1kg: {
    query: "pechuga pollo kg",
    include: /\bpechuga\b.*\bpollo\b/i,
    exclude: [
      /\bpavo\b/i,
      /\b(?:nugget|deditos|tiras|patty|burger|hamburguesa|chicharron)\b/i,
      /\b(?:milanesa|empanizada|rebozada|frita|crocante|crispy)\b/i,
      /\b(?:salame|salami|jamón|jamon|fiambre|pat[eé]|mortadela)\b/i,
      /\b(?:ahumado|cocido|cocida|feteada|rostizado|hueso)\b/i,
      /\b(?:relleno|rellena|marinada|adobada|barbacoa)\b/i,
      /\b(?:congelada|congelado|frozen)\b/i,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Ground beef. "Carne Molida de Res por kg". Excludes pork
  // ("cerdo"), chicken, turkey, lamb, pre-mixed burgers.
  beef_ground_1kg: {
    query: "carne molida res",
    include: /\bcarne\b.*\bmolida\b/i,
    exclude: [
      /\b(?:cerdo|chancho|puerco|pollo|pavo|cordero|chivo|conejo)\b/i,
      /\b(?:hamburguesa|burger|patty|albondiga|empanada|chorizo)\b/i,
      /\b(?:rellena|relleno|preparada|preparado|congelada|ahumada)\b/i,
      /\b(?:mascotas|perro|gato|cachorro|alimento)\b/i,
      /\b(?:salame|salami|fiambre|salchicha|morcilla|embutido)\b/i,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Local cheese ("queso oaxaca", "queso panela", "queso fresco",
  // "queso ranchero", "queso cotija"). Excludes processed slices,
  // imported (cheddar, gouda), grated, snack-format.
  cheese_local_500g: {
    query: "queso panela",
    include: /\bqueso\b/i,
    exclude: [
      /\b(?:rallado|rayado|polvo|deshidratado|en polvo)\b/i,
      /\b(?:untable|crema|mascarpone|ricota|ricotta|cottage)\b/i,
      /\b(?:azul|brie|camembert|gouda|cheddar|parmesano|gruyere|roquefort)\b/i,
      /\b(?:halloumi|mozzarella en sticks|sticks|bocadito|chizito|fingers)\b/i,
      /\b(?:snack|relleno|preparado|salsa|fondue|dip)\b/i,
      /\b(?:saborizado|ahumado|aromatizado|hierbas)\b/i,
    ],
    sizeRange: { min: 150, max: 1100 },
    unitFromTitle: "g",
  },
  // Imported beer in 330 / 355 ml bottles or cans. Heineken,
  // Stella, Corona Extra. Excludes non-alcoholic, malt-only,
  // multi-packs.
  beer_imported_500ml: {
    query: "cerveza heineken lata",
    include:
      /\b(?:heineken|carlsberg|stella|corona|budweiser|peroni|guinness|leffe|hoegaarden|asahi|kronenbourg|amstel|miller|becks)\b/i,
    exclude: [
      /\b(?:cero|0\.0|sin alcohol|alcohol[- ]free)\b/i,
      /\b(?:malta|maltada|cocktail|coctel|saborizada|aromatizada|sidra)\b/i,
      /\b(?:vaso|jarro|jarra|chop|chopp|abridor|posavaso|kit|set)\b/i,
      /\bx\s*\d+\s*(?:un|unds?|p)\b/i,
      /\b(?:pack|sixpack|fourpack|six pack|four pack|caja|barril)\b/i,
    ],
    sizeRange: { min: 250, max: 750 },
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
    /(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*l(?:t|ts|itro|itros)?\b/i,
  );
  if (litre) {
    const v = parseFloat(litre[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 50)
      return { value: Math.round(v * 1000), unit: "ml" };
  }
  // Kilograms
  const kg = s.match(/(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*k(?:g|ilo|ilogramo)s?\b/i);
  if (kg) {
    const v = parseFloat(kg[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 100)
      return { value: Math.round(v * 1000), unit: "g" };
  }
  // Centilitres / cc
  const cc = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*cc\b/i);
  if (cc) {
    const v = parseInt(cc[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "ml" };
  }
  // Millilitres
  const ml = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*ml\b/i);
  if (ml) {
    const v = parseInt(ml[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "ml" };
  }
  // Grams
  const g = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*(?:gr|grs|g)\b/i);
  if (g) {
    const v = parseInt(g[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "g" };
  }
  // Pieces: "18 Piezas", "12 Pz", "30 Unidades", "10 pza"
  const pcs = s.match(/(?<![a-zA-Z%\d.,])(\d{1,3})\s*(?:piezas?|pza|pz|unid(?:ades?)?|unds?|un|u)\b/i);
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

export function parseProduct(p: ChedrauiProduct): ParsedProduct | null {
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
  picker: MxPicker,
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
    const parsed = ChedrauiSearchResponseSchema.safeParse(raw);
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

export async function scrapeChedrauiMx(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("chedraui-mx");
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
        reason: `chedraui returned no candidates for "${picker.query}"`,
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

  return { retailer: "chedraui-mx", scraped, misses };
}
// @scraper: chedraui-mx
// @rate-limit: respect retailer crawl policy
// @retry: exponential backoff on fetch failure
// @note: discussed in review thread
// @edge: concurrent access safety
// @guard: bounds check before array access
// @cleanup: consolidate with sibling file
// @guard: rate limit this operation
// @a11y: ensure keyboard navigation works
// @edge: zero-value special case
// @cleanup: remove legacy fallback path
// @note: see issue tracker for context
// @edge: zero-value special case
// @i18n: support right-to-left layout
// @guard: validate at component boundary
// @i18n: add locale-specific number format
// @cleanup: inline single-use helper
// @i18n: add locale-specific number format
