/**
 * Metro Peru scraper, via the VTEX catalog API.
 *
 * Cencosud cash-and-carry banner in Peru runs on the same VTEX platform
 * as Disco Argentina. Its `/api/catalog_system/pub/products/search`
 * endpoint serves public, unauthenticated, cookieless JSON over plain
 * HTTP from anywhere. See src/scrapers/disco-ar.ts for the shared
 * design notes (Price units, kg vs un measurement classes, sanity-
 * floor filtering, Spanish accent boundaries). The two scrapers stay
 * separate modules because their pickers differ on Peruvian-specific
 * brand names ("plátano" instead of "banana", "mantequilla" instead
 * of "manteca", "papa amarilla" / "papa huayro" varieties, etc.).
 *
 * Metro PE Price field is in whole PEN units with one or two decimals
 * (e.g. 4.50 PEN for 1 kg sugar), not centimos. The cart POST body
 * encodes the same value × 100 as centimos.
 */
import { z } from "zod";

import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const API_BASE = "https://www.metro.pe";
const FETCH_TIMEOUT_MS = 15_000;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "es-PE,es;q=0.9,en;q=0.8",
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

const MetroProductSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  brand: z.string().optional(),
  linkText: z.string().optional(),
  items: z.array(ItemSchema).min(1),
});
export type MetroProduct = z.infer<typeof MetroProductSchema>;

const MetroSearchResponseSchema = z.array(MetroProductSchema);

interface PePicker {
  query: string;
  include: RegExp;
  exclude: readonly RegExp[];
  sizeRange: { min: number; max: number };
  unitFromTitle?: ParsedUnit;
}

const PICKERS: Partial<Record<ProductTarget["slug"], PePicker>> = {
  // White sliced "pan de molde" loaves. Bimbo, Orno (private label varies on Metro) are the
  // main brands. Excludes flatbreads, snack breads, sweet rolls,
  // bagels, and the "Cuisine & Co Sandwich" microwaveable kit.
  bread_500g: {
    query: "pan molde",
    include: /\bpan\b.*\b(?:molde|integral|campesino|multigranos)\b/i,
    exclude: [
      /\b(?:pita|hamburguesa|hot dog|hotdog|burger|sandwichero|sandwich)\b/i,
      /\b(?:bizcocho|bizcochuelo|pasteleria|panaderia|tostada|baguette)\b/i,
      /\b(?:rosca|tortilla|chapa|chapati|naan|pretzel|donut)\b/i,
      /\b(?:dulce|chocolate|relleno|crema|mermelada|miel)\b/i,
    ],
    sizeRange: { min: 250, max: 700 },
    unitFromTitle: "g",
  },
  // Whole milk in 800ml / 900ml / 946ml / 1L UHT cartons and bolsas.
  // Gloria, Laive, Danlac. Excludes skim (descremada), lactose-free,
  // flavoured chocolate (chocolatada), evaporated (only sold as
  // pantry milk in cans), and dairy adjacent (yogurt, kefir).
  milk_1l: {
    query: "leche entera",
    include: /\bleche\b/i,
    exclude: [
      /\b(?:descremada|desc|deslactosada|deslactosada|sin lactosa|zerolact)\b/i,
      /\b(?:chocolatada|achocolatada|fresa|vainilla|polvo|saborizada)\b/i,
      /\b(?:soja|almendra|coco|avena|arroz|bebida)\b/i,
      /\b(?:condensada|evaporada|crema|dulce|manjar|nata)\b/i,
      /\b(?:yogur|kefir|infant|bebe|maternizada)\b/i,
    ],
    sizeRange: { min: 700, max: 1100 },
    unitFromTitle: "ml",
  },
  // Fresh eggs in 6 / 10 / 12 / 15 / 30 bandejas. La Calera,
  // San Fernando. Excludes liquid egg, powdered, dyed Easter eggs,
  // quail eggs.
  eggs_12: {
    query: "huevos",
    include: /\bhuevos?\b/i,
    exclude: [
      /\b(?:liquido|líquido|pasteurizado|polvo|chocolate|pascua)\b/i,
      /\b(?:codorniz|pato|avestruz)\b/i,
    ],
    sizeRange: { min: 6, max: 30 },
    unitFromTitle: "pcs",
  },
  // Butter ("mantequilla") in 100 / 125 / 200 / 250 g tubs and
  // bricks. Laive, Gloria, Bonle, Asturiana. Excludes peanut butter
  // ("mantequilla de mani"), almond / coconut butter, ghee, and
  // butter-cookie / pastry confectionery.
  butter_200g: {
    query: "mantequilla",
    include: /\bmantequilla\b/i,
    exclude: [
      /\b(?:mani|maní|cacahuate|almendra|coco|nuez|avellana|girasol|ghee)\b/i,
      /\b(?:spread|untable|margarina|vegetal|light|reducida)\b/i,
      /\b(?:galleta|cachito|pretzel|hojaldre|alfajor|panetela)\b/i,
      /\b(?:sabor|chocolate|kakao|cocoa|vainilla)\b/i,
    ],
    sizeRange: { min: 80, max: 500 },
    unitFromTitle: "g",
  },
  // White or "rubia" (off-white) sugar in 1 / 2 / 5 kg bags. Metro,
  // Paramonga, Dulfina, Cuisine & Co. The base query is "azucar
  // rubia 1kg" so the 1 kg variants surface ahead of the multi-kg
  // bags (per-kg sort still picks the cheapest, but the 1 kg pack
  // is the canonical reference).
  sugar_1kg: {
    query: "azucar rubia 1kg",
    include: /\baz[uú]car\b/i,
    exclude: [
      /\b(?:gaseosa|bebida|jugo|soda|cola|sprite|pepsi|coca|inca|kola)\b/i,
      /\b(?:sin azucar|sin azúcar|zero|light|diet|cero)\b/i,
      /\b(?:impalpable|en polvo|polvo|negra|panela|mascabo|chancaca)\b/i,
      /\b(?:stevia|sucralosa|edulcorante|fructosa|aspartam)\b/i,
      /\b(?:caramelo|chocolate|galleta|polvo gelatina|chupetin)\b/i,
    ],
    // 1 kg consumer pack only. The 5 kg restaurant bag pulls
    // per-canonical-kg below the shelf staple.
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Long-grain "extra" or "superior" rice in 750g / 1 kg / 5 kg
  // bags. Paisana, Costeño, Vallenorte. Excludes rice cakes,
  // rice flour, rice drinks, parboiled "chaufa" prepared mixes.
  rice_1kg: {
    query: "arroz 1kg",
    include: /\barroz\b/i,
    exclude: [
      /\b(?:galleta|biscocho|snack|chip|harina|fideo|pasta|tallarin)\b/i,
      /\b(?:bebida|leche|chicha|aroma|saborizado|crema)\b/i,
      /\b(?:chaufa|chifa|preparado|hervido|cocido)\b/i,
      /\b(?:menestra|frijol|quinua|kiwicha|wok|mix)\b/i,
    ],
    sizeRange: { min: 800, max: 5500 },
    unitFromTitle: "g",
  },
  // Fresh tomatoes per kg. "Tomate Italiano x kg" is the staple, plus
  // "Tomate Sachatomate" (Andean variety). Excludes sauces, pastes,
  // pulp, dried, and stuffed prep mixes.
  tomatoes_1kg: {
    query: "tomate kg",
    include: /\btomate/i,
    exclude: [
      /\b(?:salsa|pulpa|extracto|sopa|jugo|conserva|enlatado)\b/i,
      /\bpur[eé](?!\p{L})/iu,
      /\b(?:pizza|empanada|relleno|preparado|mix|tarta)\b/i,
      /\b(?:deshidratado|secado|seco|polvo|aroma|saborizado)\b/i,
      /\b(?:trozado|cortado|cubeteado|peritas en lata)\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Fresh potatoes per kg ("Papa Yungay", "Papa Capiro", "Papa
  // Camotillo", "Papa Huayro"). Peru has dozens of native varieties
  // and the picker accepts the cheapest. Excludes sweet potato
  // ("camote", "batata"), frozen fries, snack chips, and potato
  // flour.
  potatoes_1kg: {
    query: "papa kg",
    include: /\bpapa\b/i,
    exclude: [
      /\b(?:camote|batata|olluco|oca|mashua|yuca)\b/i,
      /\b(?:frita|fritas|baston|bastones|nugget|smile)\b/i,
      /\b(?:chip|chips|snack|tortilla|nacho)\b/i,
      /\b(?:congelada|prefrita|horno|microondas|cocida|hervida)\b/i,
      /\b(?:fecula|almidón|harina)\b/i,
      /\b(?:relleno|tarta|empanada|mix|salsa|aderezo|preparado)\b/i,
      /\bpapas a la huancaina\b/i,
    ],
    sizeRange: { min: 500, max: 5500 },
    unitFromTitle: "g",
  },
  // Olive oil in 250 / 500 / 750 ml / 1 L bottles. Borges, Santolivo,
  // Farchioni, Carbonell. Excludes seed oils, aerosols, infused
  // dressings, mayonnaise / tuna products that name-drop olive oil
  // in the descriptor, and "atún en aceite oliva" canned fish.
  olive_oil_1l: {
    query: "aceite oliva",
    include: /\baceite\b.*\boliva\b/i,
    exclude: [
      /\b(?:girasol|maiz|maíz|mezcla|soja|canola|sésamo|sesamo|palma)\b/i,
      /\b(?:aerosol|spray|crema|loción|cosmetic|jabón|champu|champú)\b/i,
      /\b(?:vinagre|aceto|aliño|aderezo|condimento|salsa)\b/i,
      /\b(?:tapenade|pesto|preparado|infusionado)\b/i,
      /\b(?:mayonesa|mayonaise|ketchup|mostaza|hummus|tahini|alioli)\b/i,
      /\b(?:atun|atún|sardina|anchoa|conserva|en lata|tripack)\b/i,
    ],
    sizeRange: { min: 200, max: 1200 },
    unitFromTitle: "ml",
  },
  // Still mineral water in 500 ml / 1 L / 1.5 L / 2.5 L bottles or
  // 5 / 7 L bidones. San Mateo, Cielo, San Luis, San Carlos.
  // Excludes carbonated ("con gas", "gasificada"), tonic, flavoured,
  // and non-drinking household products (limpiavidrios, cologne).
  water_bottled_1500ml: {
    // Metro PEs catalog does not stock a 1.5 L plain still water as
    // single bottle; the cheapest local SKU at that size is sparkling
    // (Socosani con gas), and the only 1.5 L still option is Evian
    // (imported French premium, ~5x the staple price). Cielo is the
    // Peruvian local staple (San Luis / San Mateo are tier-2), so the
    // picker targets local brands and accepts 1 L or 2.5 L as the
    // closest single-bottle stand-in.
    query: "agua sin gas cielo",
    include: /\bagua\b.*\b(?:cielo|san\s+(?:luis|mateo|carlos)|loa|cuisine)\b/i,
    exclude: [
      /\b(?:con gas|gasificada|soda|tonica|tónica|tonic|mineral con gas)\b/i,
      /\b(?:saborizada|aromatizada|frutal|limon|limón|naranja|fresa)\b/i,
      /\b(?:gaseosa|cola|sprite|pepsi|coca|inca kola|isotonica|gatorade|powerade)\b/i,
      /\b(?:destilada|desionizada|colonia|limpiavidrios|lavandina)\b/i,
      /\b(?:bebida|jugo|nectar|hidratante|energizante)\b/i,
      /\b(?:pollo|menu|combo|rostizado|sixpack|caja|bid[oó]n)\b/i,
      /\b(?:evian|acqua panna|fiji|perrier|vichy)\b/i,
    ],
    sizeRange: { min: 900, max: 3000 },
    unitFromTitle: "ml",
  },
  // Bananas ("plátano" in Peru — "banana" matches a few brand names
  // but the staple loose variety is "Plátano Palillo x kg", "Plátano
  // Morado x kg", "Plátano Bellaco x kg"). Excludes banana-flavoured
  // products and platano-meaning-dessert (chifle = fried plantain
  // chips).
  bananas_1kg: {
    query: "platano kg",
    include: /\bpl[áa]tano\b/i,
    exclude: [
      /\b(?:yogur|yogurt|bebida|smoothie|jugo|aroma|saborizado|nectar)\b/i,
      /\b(?:chip|chips|snack|chifle|chifles|deshidratado|seco|frito)\b/i,
      /\b(?:budin|kek|panqueque|hojaldre|biscuit|brownie|magdalena)\b/i,
      /\bpur[eé](?!\p{L})/iu,
      /\b(?:bebe|infant|maternal|leche)\b/i,
      /\b(?:helado|crema|mousse|pudin|relleno|protein)\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Apples per kg. "Manzana Israel x kg" is the cheapest local
  // variety; Roja, Verde Importada, Delicia, Granny Smith all also
  // sold per kg. Excludes apple juice, vinegar, dried, sauce, snack
  // bars / candies / chips.
  apples_1kg: {
    query: "manzana kg",
    include: /\bmanzana/i,
    exclude: [
      /\b(?:jugo|bebida|gaseosa|isotonica|gatorade|powerade|nectar)\b/i,
      /\b(?:vinagre|sidra|fermentada|alcohol)\b/i,
      /\b(?:deshidratada|seca|chip|chips|snack|crocante)\b/i,
      /\b(?:compota|mermelada|jalea|relleno|tarta|salsa)\b/i,
      /\bpur[eé](?!\p{L})/iu,
      /\b(?:bebe|infant|maternal|leche|yogur|cereal)\b/i,
      /\b(?:aroma|saborizad|esencia|extracto)\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Chicken breast ("filete de pechuga de pollo x kg"). The Metro /
  // San Fernando / Redondos butcher counter sells fresh pechuga
  // per kg with kg measurement. Excludes nuggets, fingers (deditos),
  // burgers, schnitzel, smoked, sausages, turkey (pavo), the
  // ready-meal combos that include rotisserie chicken, and the
  // "pechuga con ala" combo cut (breast attached to wing, sold
  // cheaper per kg because the wing is mostly bone, so the picker
  // would pick it as the cheapest, breaking comparability against
  // pure-breast picks elsewhere).
  chicken_breast_1kg: {
    query: "pechuga pollo",
    include: /\bpechuga\b.*\bpollo\b/i,
    exclude: [
      /\bpavo\b/i,
      /\b(?:nugget|deditos|tiras|patty|burger|hamburguesa|chicharron)\b/i,
      /\b(?:milanesa|empanizada|rebozada|frita|crocante|crispy)\b/i,
      /\b(?:salame|salami|jamon|jamón|fiambre|paté|pate|mortadela)\b/i,
      /\b(?:ahumado|ahumada|cocida|cocido|feteada|feteado|rostizado)\b/i,
      /\b(?:salchicha|chorizo|morcilla|hot dog)\b/i,
      /\b(?:relleno|rellena|marinada|adobada|tandoori|barbacoa)\b/i,
      /\b(?:congelada|congelado|frozen)\b/i,
      /\b(?:combo|menu|rostizado|gaseosa|papas fritas)\b/i,
      /\b(?:con\s+(?:ala|alas|hueso|pelleja|piel|menudencia)|con\s+ad[óo]bo)\b/i,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Ground beef ("carne molida"). Lima butchers stock "Especial
  // Nacional", "Premium", "Vacuna". Excludes pork ("cerdo"), chicken
  // ("pollo"), turkey, lamb, premade burgers, sausage stuffing.
  beef_ground_1kg: {
    query: "carne molida",
    include: /\bcarne\b.*\bmolida\b/i,
    exclude: [
      /\b(?:cordero|pollo|cerdo|chancho|pavo|conejo|cabra)\b/i,
      /\b(?:hamburguesa|burger|patty|milanesa|albondiga|empanada|chorizo)\b/i,
      /\b(?:rellena|relleno|preparada|preparado|congelada|ahumada)\b/i,
      /\b(?:mascotas|perro|gato|cachorro|comida|alimento)\b/i,
      /\b(?:embutido|salame|salami|morcilla|fiambre|salchicha)\b/i,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Fresh cheese ("queso fresco") in 400 / 500 g blocks. Bonle,
  // Gloria, Piamonte, Ecologic. Excludes grated, smoked, processed
  // slices, blue / soft cheeses, and snack-format cheese.
  cheese_local_500g: {
    query: "queso fresco",
    include: /\bqueso\b/i,
    exclude: [
      /\b(?:rallado|rayado|polvo|deshidratado|en polvo)\b/i,
      /\b(?:untable|crema|mascarpone|ricota|ricotta|cottage)\b/i,
      /\b(?:azul|cabra|brie|camembert|gouda|cheddar|parmesano|parmesan|gruyere|roquefort)\b/i,
      /\b(?:halloumi|mozzarella en sticks|sticks|bocadito|chizito|fingers)\b/i,
      /\b(?:snack|relleno|preparado|salsa|fondue|dip)\b/i,
      /\b(?:saborizado|ahumado|aromatizado|hierbas|aji|ají)\b/i,
    ],
    sizeRange: { min: 150, max: 1100 },
    unitFromTitle: "g",
  },
  // Imported beer in 330 / 355 / 473 / 500 / 710 ml bottles or
  // cans. Heineken, Stella, Corona, Budweiser. Excludes the Heineken
  // Barril 5 L mini-keg (too large for the 500 ml canonical), non-
  // alcoholic, malt-only, cocktail-style beverages, and packs of 4+
  // priced as a single SKU (fourpack / sixpack).
  beer_imported_500ml: {
    query: "cerveza heineken",
    include:
      /\b(?:heineken|carlsberg|stella|corona|budweiser|peroni|guinness|leffe|hoegaarden|asahi|kronenbourg|amstel|miller|becks)\b/i,
    exclude: [
      /\b(?:cero|0\.0|sin alcohol|alcohol[- ]free)\b/i,
      /\b(?:malta|maltada|cocktail|coctel|saborizada|aromatizada|sidra|chela)\b/i,
      /\b(?:vaso|jarro|jarra|chop|chopp|abridor|posavaso|kit|regalo|set)\b/i,
      /\b(?:barril|keg|tonel|growler)\b/i,
      /\b(?:fourpack|sixpack|pack|six pack|four pack|caja)\b/i,
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

  // Litres: " 1 L", " 1L", " 1.5 Lts", " 1Litro"
  const litre = s.match(
    /(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*l(?:t|ts|itro|itros)?\b/i,
  );
  if (litre) {
    const v = parseFloat(litre[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 50)
      return { value: Math.round(v * 1000), unit: "ml" };
  }
  // Centilitres / cc: "330cc", "591 Cc"
  const cc = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*cc\b/i);
  if (cc) {
    const v = parseInt(cc[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "ml" };
  }
  // Kilograms: " 1 Kg", " 1kg", " 2.5 Kg", " 1 Kilogramo"
  const kg = s.match(/(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*k(?:g|ilo|ilogramo)s?\b/i);
  if (kg) {
    const v = parseFloat(kg[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 100)
      return { value: Math.round(v * 1000), unit: "g" };
  }
  // Millilitres: " 500ml", " 500 Ml"
  const ml = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*ml\b/i);
  if (ml) {
    const v = parseInt(ml[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "ml" };
  }
  // Grams: " 200g", " 200 G", " 200 Gr"
  const g = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*(?:gr|grs|g)\b/i);
  if (g) {
    const v = parseInt(g[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "g" };
  }
  // Pieces: " 12 Unid", " 6 Un", " 12 Unidades", " 15un"
  const pcs = s.match(/(?<![a-zA-Z%\d.,])(\d{1,3})\s*(?:unid(?:ades?)?|un|u)\b/i);
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

export function parseProduct(p: MetroProduct): ParsedProduct | null {
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
  picker: PePicker,
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
    const parsed = MetroSearchResponseSchema.safeParse(raw);
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

export async function scrapeMetroPe(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("metro-pe");
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
        reason: `metro returned no candidates for "${picker.query}"`,
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

  return { retailer: "metro-pe", scraped, misses };
}
// @scraper: metro-pe
// @rate-limit: respect retailer crawl policy
// @retry: exponential backoff on fetch failure
// @i18n: use Intl for formatting
// @type: add discriminant union for states
// @type: add discriminant union for states
// @todo: handle retryable errors
// @note: coordinated with PR #87
// @perf: consider memoizing this computation
// @i18n: extract pluralization logic
// @guard: rate limit this operation
