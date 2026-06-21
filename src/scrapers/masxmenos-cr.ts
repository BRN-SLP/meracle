/**
 * Más x Menos Costa Rica scraper, via the VTEX catalog API.
 *
 * Más x Menos is the Walmart-owned VTEX storefront in Costa Rica, sharing the same VTEX engine as Olimpica CO.
 * Its `/api/catalog_system/pub/products/search` endpoint is public,
 * unauthenticated, cookieless. See src/scrapers/disco-ar.ts for the
 * shared design notes (Price units, sanity-aware picker filter,
 * Unicode-aware Spanish accent boundaries).
 *
 * The MxM-specific quirk mirrors Olimpica: VTEX department store, every product
 * in the catalog uses `measurementUnit: "un", unitMultiplier: 1`,
 * even fresh produce and butcher meat. Loose-Kg products are tagged
 * with "X Kg" or "Kg" in the product name (e.g. "Tomate Chonto X Kg",
 * "Carne Molida De Res X Kg"). The parser detects the bare-Kg
 * suffix and treats those titles as 1000 g packs, mirroring the
 * Migros TR bare-Kg branch.
 *
 * Más x Menos search returns surprising cross-category hits because
 * the indexer matches any token in any field. Searching for
 * "manzana" surfaces detergent powders that name-drop apple as
 * a fragrance; "agua sin gas" returns women's tank tops because
 * "sin mangas" overlaps. The picker include / exclude regexes
 * tighten the keyword scope to fight that.
 */
import { z } from "zod";

import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const API_BASE = "https://www.masxmenos.cr";
const FETCH_TIMEOUT_MS = 15_000;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "es-CR,es;q=0.9,en;q=0.8",
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

const MasXMenosProductSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  brand: z.string().optional(),
  linkText: z.string().optional(),
  items: z.array(ItemSchema).min(1),
});
export type MasXMenosProduct = z.infer<typeof MasXMenosProductSchema>;

const MasXMenosSearchResponseSchema = z.array(MasXMenosProductSchema);

interface CoPicker {
  query: string;
  include: RegExp;
  exclude: readonly RegExp[];
  sizeRange: { min: number; max: number };
  unitFromTitle?: ParsedUnit;
}

const PICKERS: Partial<Record<ProductTarget["slug"], CoPicker>> = {
  // White sliced "pan tajado" bread. Bimbo, Milenio, Olimpica
  // private label, Fitcook. Excludes croissant-style and snack
  // breads, and excludes whole-grain ("integral") which is a
  // different SKU class and breaks per-canonical-500g
  // cross-country comparability with the white-bread picks in
  // other countries.
  bread_500g: {
    query: "pan blanco tajado",
    include: /\bpan\b/i,
    exclude: [
      /\b(?:hamburguesa|hot dog|hotdog|pita|naan|chapa)\b/i,
      /\b(?:croissant|brioche|bizcocho|panecillo|donut|rosca)\b/i,
      /\b(?:relleno|crema|chocolate|dulce|mermelada)\b/i,
      /\b(?:perro caliente|sandwichero|tortilla)\b/i,
      /\b(?:integral|integrales|multicereal|multi[- ]cereal|cereales|avena|salvado|centeno|linaza|chia|chía|semilla|grano entero|fibra|light|fitness|fitcook)\b/i,
    ],
    sizeRange: { min: 300, max: 800 },
    unitFromTitle: "g",
  },
  // Whole milk in 1 L or "1100 Ml" UHT bottles. Colanta, Alqueria,
  // Olimpica, Freskaleche. Excludes skim, lactose-free, flavoured,
  // and dairy adjacent.
  milk_1l: {
    query: "leche entera",
    include: /\bleche\b.*\bentera\b/i,
    exclude: [
      /\b(?:deslactosada|sin lactosa|descremada|semi)\b/i,
      /\b(?:saborizada|chocolatada|frutilla|fresa|vainilla)\b/i,
      /\b(?:condensada|evaporada|crema|dulce|manjar|kumis|yogurt|yogur|kefir)\b/i,
      /\b(?:soja|almendra|coco|avena|arroz|maternizada)\b/i,
      /\bx\s*\d+\s*unds?\b/i,
    ],
    sizeRange: { min: 700, max: 1300 },
    unitFromTitle: "ml",
  },
  // Fresh eggs in 12 / 30 panel cartons. Cheapest is "HUEVO X 30
  // UND" (anonymous-brand value pack). Olimpica also tags brown
  // ("tipo b" or "kikes color") which is fine.
  eggs_12: {
    // CR catalog drops the "30" cardinality suffix, and the bare
    // "huevos" query is dominated by quail eggs ("codorniz") and
    // chocolate eggs. "huevo gallina" surfaces the chicken-egg
    // cartons (Marketside / Don Cristobal), the picker filters
    // out the 60-pack on the sizeRange.
    query: "huevo gallina",
    include: /\bhuevos?\b/i,
    exclude: [
      /\b(?:liquido|líquido|pasteurizado|polvo|chocolate|pascua)\b/i,
      /\b(?:codorniz|pato)\b/i,
      // CR-specific noise: mayo / pre-pizza both contain the
      // word "huevos" in their ingredient blurb.
      /\b(?:mayonesa|pan\s+konig|pre\s*pizza)\b/i,
    ],
    sizeRange: { min: 6, max: 30 },
    unitFromTitle: "pcs",
  },
  // Butter in 200 / 250 / 500 g blocks. Colanta is the dominant
  // brand; query is narrowed because the bare "mantequilla" keyword
  // returns mostly ghee (clarified butter) which is a different
  // product class for our purposes.
  butter_200g: {
    // CR's dairy butter staple is Dos Pinos. "Colanta" (Colombian
    // brand) returns 0 results. Switching to "mantequilla dos
    // pinos" returns 7 cards including the 115g, 200g and 460g
    // canonical packs.
    query: "mantequilla dos pinos",
    include: /\bmantequilla\b/i,
    exclude: [
      /\b(?:ghee|clarificada|mani|maní|cacahuate|almendra|coco)\b/i,
      /\b(?:spread|untable|margarina|vegetal|reducida)\b/i,
      /\b(?:galleta|panecillo|hojaldre|alfajor|relleno)\b/i,
      /\b(?:sabor|chocolate|cocoa|vainilla|herbs)\b/i,
    ],
    sizeRange: { min: 80, max: 600 },
    unitFromTitle: "g",
  },
  // White sugar in 1 / 2 / 5 kg bags. Manuelita, Incauca, Olimpica.
  // The narrower query keeps the sweetener / candy / coffee-cube
  // SKUs from dominating the search.
  sugar_1kg: {
    query: "azucar manuelita 1kg",
    include: /\baz[uú]car\b/i,
    exclude: [
      /\b(?:gaseosa|bebida|jugo|cola|sprite|pepsi|coca)\b/i,
      /\b(?:sin azucar|sin azúcar|zero|light|diet|cero)\b/i,
      /\b(?:morena|panela|mascabo|chancaca|impalpable|polvo|stick)\b/i,
      /\b(?:stevia|sucralosa|edulcorante|aspartam|fructosa)\b/i,
      /\b(?:caramelo|chocolate|galleta|chupetin|sobre|sobres)\b/i,
      /\bmango\b/i,
    ],
    // 1 kg consumer pack only. The 2.5 / 5 kg restaurant bags discount
    // the per-canonical-kg price and misrepresent the shelf staple.
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Long-grain rice in 454 g / 1 kg / 3 kg bags. "Arroz Mi Arroz"
  // is the cheapest staple. Excludes rice cakes, rice flour, and
  // bulk 10 kg / 25-unit cases that warp the per-kg sort by
  // economy-of-scale pricing.
  rice_1kg: {
    query: "arroz",
    include: /\barroz\b/i,
    exclude: [
      /\b(?:galleta|biscocho|snack|chip|harina)\b/i,
      /\b(?:bebida|leche|chicha|aroma|saborizado|crema)\b/i,
      /\b(?:granel|preparado|cocido)\b/i,
      /\bx\s*\d+\s*unds?\b/i,
      /\b(?:bulto|paca|mini bulto|caja|cajita)\b/i,
    ],
    sizeRange: { min: 400, max: 5500 },
    unitFromTitle: "g",
  },
  // Tomatoes per kg ("Tomate Chonto X Kg", "Tomate Tamarillo X Kg").
  // Excludes sauces, pastes, soups, and canned tomato products
  // that show up under the same keyword.
  tomatoes_1kg: {
    // MxM tags loose tomatoes as "Tomate Kg" with measurementUnit
    // "kg" and unitMultiplier 0.15-0.25. The bare-Kg branch in
    // parseProduct picks them up as 1000g. "tomate hortifruti"
    // (the in-house produce brand) surfaces the cleanest cards.
    query: "tomate hortifruti",
    include: /\btomate/i,
    exclude: [
      /\b(?:salsa|pasta|pulpa|extracto|sopa|jugo|conserva|enlatado)\b/i,
      /\bpur[eé](?!\p{L})/iu,
      /\b(?:bary|kari|listas|maggi|fruco|hellmann|knorr)\b/i,
      /\b(?:pizza|empanada|tarta|relleno|preparado|mix)\b/i,
      /\b(?:deshidratado|secado|seco|polvo|aroma|saborizado)\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Potatoes per kg ("Papa Criolla Kg", "Papa Pastusa X Kg"). Excludes
  // sweet potato (camote / batata), frozen fries (McCain Rapi Papa),
  // and the "yuca" / "ñame" tubers that also surface under "papa".
  potatoes_1kg: {
    query: "papa kg",
    include: /\bpapa\b/i,
    exclude: [
      /\b(?:camote|batata|olluco|oca|yuca|ñame|name|arracacha)\b/i,
      /\b(?:rapi|mccain|congelad|prefrita|frita|fritas|baston)\b/i,
      /\b(?:tradicional|delgada|casquito|noisette|smile)\b/i,
      /\b(?:chip|chips|snack|nugget|tortilla)\b/i,
      /\b(?:fecula|almidón|harina)\b/i,
      /\b(?:relleno|tarta|empanada|salsa|aderezo|preparado)\b/i,
    ],
    sizeRange: { min: 500, max: 5500 },
    unitFromTitle: "g",
  },
  // Olive oil in 250 / 500 / 1000 / 2000 ml bottles. Selecto,
  // Olitalia, Carbonell. Excludes shower gels and skincare that
  // name-drop olive oil, plus condiments / mayonnaise.
  olive_oil_1l: {
    query: "aceite oliva 1 litro",
    include: /\baceite\b.*\boliva\b/i,
    exclude: [
      /\b(?:girasol|maiz|maíz|mezcla|soja|canola|sansa)\b/i,
      /\b(?:gel|loción|cosmetic|jabón|shampoo|champú|crema)\b/i,
      /\b(?:vinagre|aceto|aliño|aderezo|condimento|salsa)\b/i,
      /\b(?:mayonesa|ketchup|mostaza|hummus)\b/i,
      /\b(?:atun|atún|sardina|anchoa|conserva|en lata)\b/i,
    ],
    // 1 L bottle staple. The 2 L jug discounts per-canonical-L too
    // aggressively for the shelf-staple oracle target.
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "ml",
  },
  // Still water in 500ml / 1 L / 1.5 L / 2 L / 6 L bottles. Brisa
  // bidón 6 L is the cheapest per litre. Excludes carbonated, tonic,
  // and apparel-aliased SKUs (Olimpica's search incorrectly returns
  // "Top sin mangas" under "sin gas").
  water_bottled_1500ml: {
    // CR brands: Agua Alpina and Agua Cristal are the staples.
    // Alpina ships 600 / 1000 / 2000 / 6000 ml. Cristal ships
    // 355 / 600 / 1000 / 1750 ml. Widen the size band to 1000-
    // 2200 ml so the 1.75 L Cristal and 2 L Alpina both clear,
    // normalize.ts scales each to the canonical 1.5 L.
    query: "agua cristal",
    include: /\bagua\b.*\b(?:alpina|cristal|naturela|epm)\b/iu,
    exclude: [
      /\b(?:con gas|gasificada|gaseada|soda|tonica|tonic)\b/i,
      /\b(?:saborizada|aromatizada|frutal|limon|naranja|fresa)\b/i,
      /\b(?:gaseosa|cola|sprite|pepsi|coca|inca kola|gatorade|powerade)\b/i,
      /\b(?:destilada|colonia|limpiavidrios|hidratante|energizante)\b/i,
      /\b(?:top|short|camiseta|sin mangas|leggings|safetti)\b/i,
      /\b(?:bid[oó]n)\b/i,
    ],
    // 1 L / 1.75 L Cristal and 2 L Alpina PET bottles. 5 L and 6 L
    // family carafes are bulk-priced and break per-canonical-1.5L
    // comparability against single-bottle picks elsewhere.
    sizeRange: { min: 1000, max: 2200 },
    unitFromTitle: "ml",
  },
  // Bananas per kg ("Banano Económico a Granel X Kg" is cheapest
  // at Olimpica). Excludes plantain prep, banana flavoured drinks,
  // chips, baby food.
  bananas_1kg: {
    // CR cheapest fresh banana is the "Banano Datil Empacado Kg".
    // Querying with the variety name surfaces it as the only card,
    // bare "banano kg" returns the bulk Pro chip 400g pack instead.
    query: "banano datil",
    include: /\bbanano\b/i,
    exclude: [
      /\b(?:yogur|yogurt|bebida|smoothie|jugo|aroma|saborizado|nectar)\b/i,
      /\b(?:chip|chips|snack|chifle|deshidratado|seco|frito|liofilizado)\b/i,
      /\b(?:budin|kek|panqueque|hojaldre|biscuit|brownie)\b/i,
      /\bpur[eé](?!\p{L})/iu,
      /\b(?:bebe|infant|maternal|formula|leche)\b/i,
      /\b(?:helado|crema|mousse|pudin|relleno|protein)\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Apples per kg ("Manzana Roja 1 Kg"). Bare "manzana" surfaces
  // detergents that use apple as a fragrance, so the include
  // requires "manzana" to actually be the product type.
  apples_1kg: {
    query: "manzana kg",
    include: /\bmanzana\b/i,
    exclude: [
      /\b(?:deterg|detergente|jab[oó]n|lavavajilla|fragancia|aroma)\b/i,
      /\b(?:jugo|bebida|gaseosa|nectar|isotonica|gatorade|powerade)\b/i,
      /\b(?:vinagre|sidra|fermentada|alcohol)\b/i,
      /\b(?:deshidratada|seca|chip|chips|snack)\b/i,
      /\b(?:compota|mermelada|jalea|relleno|tarta|salsa)\b/i,
      /\bpur[eé](?!\p{L})/iu,
      /\b(?:bebe|infant|maternal|leche|yogur|cereal)\b/i,
      /\b(?:saborizad|esencia|extracto)\b/i,
      /\bguayaba\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Chicken breast in butcher trays. "Pechuga de Pollo Fresca
  // Bandeja Familiar X Kg" is per-kg. Excludes nuggets, fingers,
  // burgers, smoked, sausages, and animal-product look-alikes.
  chicken_breast_1kg: {
    // CR butcher tags "Pechuga de Pollo Entera Don Cristobal" with
    // measurementUnit "kg" and unitMultiplier 1, the bare-Kg branch
    // in parseProduct emits 1000 g. "pollo pechuga" surfaces it as
    // the first card; "pechuga pollo bandeja" returned 5 mixed
    // candidates with cold-cut variants.
    query: "pollo pechuga entera",
    include: /\bpechuga\b.*\bpollo\b/i,
    exclude: [
      /\bpavo\b/i,
      /\b(?:nugget|deditos|tiras|patty|burger|hamburguesa|chicharron)\b/i,
      /\b(?:milanesa|empanizada|rebozada|frita|crocante|crispy)\b/i,
      /\b(?:salame|salami|jamon|jamón|fiambre|pate|mortadela)\b/i,
      /\b(?:ahumado|ahumada|cocida|feteada|rostizado|hueso)\b/i,
      /\b(?:dreambone|kibble|alimento|mascota|perro|gato)\b/i,
      /\b(?:relleno|rellena|marinada|adobada|barbacoa)\b/i,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Ground beef. "Carne Molida De Res X Kg" or "Carne Molida de Res
  // 500 G" are the staples. Excludes pork, chicken, lamb, and
  // pre-prepared dishes (rellenas / preparadas / empanadas).
  beef_ground_1kg: {
    // CR butcher tags ground beef with measurementUnit "kg" and
    // fractional unitMultiplier (0.25, 0.6). The bare-Kg branch in
    // parseProduct normalizes them to 1000 g. "carne molida magra"
    // narrows to Don Cristobal 95% magra (canonical lean ground).
    query: "carne molida magra",
    include: /\bcarne\b.*\bmolida\b/i,
    exclude: [
      /\b(?:cerdo|chancho|pollo|pavo|cordero|chivo|cabra|conejo)\b/i,
      /\b(?:hamburguesa|burger|patty|albondiga|empanada|chorizo)\b/i,
      /\b(?:rellena|relleno|preparada|preparado|congelada|ahumada)\b/i,
      /\b(?:mascotas|perro|gato|cachorro|alimento)\b/i,
      /\b(?:salame|salami|fiambre|salchicha|morcilla|embutido)\b/i,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Local cheese ("queso campesino" / "queso costeño" / "queso
  // doblecrema"). Colanta and Betania are the staple brands.
  // Excludes processed slices, blue cheese, ricotta, mozzarella
  // string-fingers, and grated.
  cheese_local_500g: {
    // CR's signature local cheese is "Queso Turrialba" (denominación
    // de origen). Dos Pinos and Del Prado ship 300-500 g varieties
    // around 1700-3500 CRC. "queso turrialba" returns 7 cards.
    query: "queso turrialba",
    include: /\bqueso\b/i,
    exclude: [
      /\b(?:rallado|rayado|polvo|deshidratado|en polvo)\b/i,
      /\b(?:untable|crema|mascarpone|ricota|ricotta|cottage)\b/i,
      /\b(?:azul|cabra|brie|camembert|gouda|cheddar|parmesano|gruyere|roquefort)\b/i,
      /\b(?:halloumi|mozzarella en sticks|sticks|bocadito|chizito|fingers)\b/i,
      /\b(?:snack|relleno|preparado|salsa|fondue|dip)\b/i,
      /\b(?:saborizado|ahumado|aromatizado|hierbas)\b/i,
      /\b(?:arepa|empanada|pandebono|pandeyuca|bunuelo|bu[nñ]uelo|pizza|sandwich)\b/i,
      /\bx\s*\d+\s*unds?\b/i,
    ],
    sizeRange: { min: 150, max: 1100 },
    unitFromTitle: "g",
  },
  // Imported beer in 250 / 269 / 300 / 330 ml bottles. Heineken,
  // Stella Artois, Corona. Olimpica indexes mostly multipacks
  // ("X6", "X12") under Heineken, so the cleanest single-unit
  // hits come from Stella Artois. Excludes non-alcoholic ("cero",
  // "0.0"), multi-packs, malt-only, and accessories.
  beer_imported_500ml: {
    query: "stella artois",
    include: /\bstella\b.*\bartois\b/i,
    exclude: [
      /\b(?:cero|0\.0|sin alcohol|alcohol[- ]free)\b/i,
      /\b(?:malta|maltada|cocktail|coctel|saborizada|aromatizada|sidra)\b/i,
      /\b(?:vaso|jarro|jarra|chop|chopp|abridor|posavaso|kit|set)\b/i,
      /\bx\s*\d+\s*unds?\b/i,
      /\b(?:pack|sixpack|fourpack|six pack|four pack|caja)\b/i,
    ],
    sizeRange: { min: 250, max: 750 },
    unitFromTitle: "ml",
  },
};

export type ParsedUnit = "ml" | "g" | "pcs";

/**
 * Parse a Spanish-grammar size token out of an Olimpica product
 * name. Includes a bare-Kg branch ("X Kg" / "Kg" suffix) for loose
 * produce and butcher meat that Olimpica indexes under
 * `measurementUnit: "un"`, see the module header for the reason.
 */
export function parseSizeFromName(
  name: string,
): { value: number; unit: ParsedUnit } | null {
  const s = name.replace(/\xa0/g, " ");

  // Litres: " 1 L", " 1 Lt", " 1.3L", " 6 Lt"
  const litre = s.match(
    /(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*l(?:t|ts|itro|itros)?\b/i,
  );
  if (litre) {
    const v = parseFloat(litre[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 50)
      return { value: Math.round(v * 1000), unit: "ml" };
  }
  // Kilograms: " 1 Kg", " 1kg", " 3 Kg"
  const kg = s.match(/(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*k(?:g|ilo|ilogramo)s?\b/i);
  if (kg) {
    const v = parseFloat(kg[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 100)
      return { value: Math.round(v * 1000), unit: "g" };
  }
  // Bare-Kg suffix: "Tomate Chonto X Kg", "Papa Criolla Kg",
  // "Carne Molida De Res X Kg". Anchored at the end of the
  // string to avoid mid-title brand fragments.
  const bareKg = s.match(/\b(?:x\s*kg|kg)\s*$/i);
  if (bareKg) return { value: 1000, unit: "g" };
  // Eggs first: "Huevo Gallina ... Cartón de 15 Uds" contains
  // both "por Kilo" (per-kilo pricing) and a real piece count.
  // Detect the pieces token before falling into the kilo phrase
  // branches below, otherwise eggs collapse to 1000 g.
  const piecesEarly = s.match(
    /\bcart[oó]n\s+de\s+(\d{1,3})\s*(?:unid(?:ades?)?|unds?|uds?|u)\b/i,
  );
  if (piecesEarly) {
    const v = parseInt(piecesEarly[1]!, 10);
    if (Number.isFinite(v) && v > 0 && v < 200) return { value: v, unit: "pcs" };
  }
  // MxM-style phrase-Kg: "Por Kilo", "Por Kg", "Empacado Kg",
  // "Indicado por Kilo", "Por Kg. Aproximadamente" (anywhere in
  // title because MxM butcher titles append free-text qualifiers
  // after the unit phrase).
  const phraseKg = s.match(
    /\b(?:por|empacado|empacada|indicado)\s+(?:x\s+)?k(?:g|ilo|ilogramo)s?\b/i,
  );
  if (phraseKg) return { value: 1000, unit: "g" };
  // Trailing "Kilo" or "Kilogramo" without a preceding digit,
  // used by Don Cristobal cuts like "Precio indicado por Kilo".
  const trailingKilo = s.match(/\bk(?:ilo|ilogramo)s?\s*\.?\s*$/i);
  if (trailingKilo) return { value: 1000, unit: "g" };
  // Centilitres / cc: "330cc"
  const cc = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*cc\b/i);
  if (cc) {
    const v = parseInt(cc[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "ml" };
  }
  // Millilitres: " 500 Ml", " 500ml"
  const ml = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*ml\b/i);
  if (ml) {
    const v = parseInt(ml[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "ml" };
  }
  // Grams: " 500 G", " 500 Grs", " 500g"
  const g = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*(?:gr|grs|g)\b/i);
  if (g) {
    const v = parseInt(g[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "g" };
  }
  // Pieces: " 12 Unds", " 30 Unds", " 12 Unidades"
  const pcs = s.match(/(?<![a-zA-Z%\d.,])(\d{1,3})\s*(?:unid(?:ades?)?|unds?|uds?|un|u)\b/i);
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

export function parseProduct(p: MasXMenosProduct): ParsedProduct | null {
  const item = p.items[0];
  if (!item) return null;
  const seller = item.sellers.find((s) => s.sellerDefault) ?? item.sellers[0]!;
  const price = seller.commertialOffer.Price;
  if (!Number.isFinite(price) || price <= 0) return null;

  const linkText = p.linkText ?? "";
  const sourceUrl = linkText
    ? `${API_BASE}/${linkText}/p`
    : `${API_BASE}/${item.itemId}`;

  let size = parseSizeFromName(p.productName);
  let priceMajor = price;
  // MxM lists chicken eggs with per-kilo pricing: measurementUnit
  // "kg", Price quoting one kilo, unitMultiplier the carton weight
  // in kg, and the piece count only in the title ("Carton de 15
  // Uds"). Charge the carton: Price x unitMultiplier.
  if (size?.unit === "pcs" && item.measurementUnit.toLowerCase() === "kg") {
    const cartonPrice = price * item.unitMultiplier;
    if (Number.isFinite(cartonPrice) && cartonPrice > 0) {
      priceMajor = cartonPrice;
    }
  }
  // MxM butcher titles sometimes truncate the unit phrase ("...
  // Empacado" with no Kilo). When the VTEX measurementUnit says
  // "kg", use unitMultiplier × 1000 g as the pack weight, the
  // listed Price quotes the pack so normalize.ts can scale it to
  // the canonical 1 kg.
  if (size === null && item.measurementUnit.toLowerCase() === "kg") {
    const grams = Math.round(item.unitMultiplier * 1000);
    if (Number.isFinite(grams) && grams >= 100 && grams <= 5000) {
      size = { value: grams, unit: "g" };
    }
  }
  if (size === null) return null;
  return {
    itemId: item.itemId,
    title: p.productName,
    priceMajor,
    packSize: size.value,
    packUnit: size.unit,
    sourceUrl,
  };
}

function pickBestMatch(
  products: ParsedProduct[],
  picker: CoPicker,
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
    const parsed = MasXMenosSearchResponseSchema.safeParse(raw);
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

export async function scrapeMasXMenosCr(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("masxmenos-cr");
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
        reason: `masxmenos returned no candidates for "${picker.query}"`,
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

  return { retailer: "masxmenos-cr", scraped, misses };
}
// @scraper: masxmenos-cr
// @rate-limit: respect retailer crawl policy
// @retry: exponential backoff on fetch failure
// @a11y: ensure keyboard navigation works
// @i18n: ensure this string is extracted
