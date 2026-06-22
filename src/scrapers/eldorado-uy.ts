/**
 * El Dorado Uruguay scraper, via the VTEX catalog API.
 *
 * Cencosud's El Dorado supermarket runs on the VTEX commerce platform.
 * Its `/api/catalog_system/pub/products/search?ft=<term>` endpoint is
 * public, unauthenticated, cookieless, and returns a JSON array of
 * product objects via plain `node:fetch` from anywhere. No Browser
 * Use Cloud, no proxy, no auth (same pattern as Migros TR).
 *
 * Pricing semantics (the part that took the most probing):
 *
 *   - El Dorado overrides VTEX's default centavos representation, the
 *     `commertialOffer.Price` field is in WHOLE ARS pesos. The cart
 *     POST link encodes the same value × 100 (so `price=199900`
 *     corresponds to Price=1999 ARS).
 *   - Pack products carry `measurementUnit: "un"`, `unitMultiplier: 1`
 *     and Price is the per-pack rate. Size is parsed from the title
 *     suffix ("1 Kg", "500 Grs", "1 Lts", "12 Un").
 *   - Loose produce and butcher meat carry
 *     `measurementUnit: "kg"`, `unitMultiplier: 0.1` or `0.5`. Price
 *     is the per-kilogram rate, so the scraper treats the pack as
 *     1000 g (mirrors the bare-Kg branch of the Migros TR parser).
 *
 *   The fractional `unitMultiplier` is the minimum purchase increment
 *   on the website, NOT a price scaler. It is intentionally ignored
 *   for the per-kg interpretation.
 *
 * Some products carry obviously corrupted Price values (e.g. a single
 * "Pechuga De Pollo" entry shows Price=332 against a real market rate
 * of ~5000 ARS). The catalog `sanityRange` rejects those rows before
 * they touch the chain, so the picker leaves them in the candidate
 * set without special-casing.
 */
import { z } from "zod";

import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const API_BASE = "https://www.eldorado.com.uy";
const FETCH_TIMEOUT_MS = 15_000;

// Plain desktop Chrome UA. The VTEX catalog endpoint blocks bare
// "curl/..." style UAs (returns a "Bad Request! Scripts are not
// allowed!" placeholder), but accepts any reasonable browser UA.
const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
};

// The VTEX wire format ships dozens of fields per product (images,
// SEO metadata, navigation breadcrumbs, custom El Dorado attributes).
// We pin only what drives the picker decision.
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

const EldoradoProductSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  brand: z.string().optional(),
  linkText: z.string().optional(),
  items: z.array(ItemSchema).min(1),
});
export type EldoradoProduct = z.infer<typeof EldoradoProductSchema>;

const EldoradoSearchResponseSchema = z.array(EldoradoProductSchema);

interface ArPicker {
  /** VTEX search keyword passed to ?ft=. */
  query: string;
  /** Product name must match this regex. */
  include: RegExp;
  /** Product name MUST NOT match any of these regexes. */
  exclude: readonly RegExp[];
  /** Pack size in target.unit (g, mL, or pcs). */
  sizeRange: { min: number; max: number };
  /**
   * Optional unit class parsed from the title. El Dorado mixes solid
   * produce ("kg" measurement) and liquid pack products ("un"
   * measurement with " 1 L" or "500 Ml" in the name) under the same
   * search keyword. Setting `unitFromTitle: "g"` on a kg slug
   * rejects candidates whose parsed size unit is mL, and vice versa.
   * Omit to accept any unit.
   */
  unitFromTitle?: ParsedUnit;
}

const PICKERS: Partial<Record<ProductTarget["slug"], ArPicker>> = {
  // White sliced tin loaf ("pan lactal"). Argentine retailers
  // typically carry Lactal-branded 300 / 460 / 560 g loaves plus
  // Cuisine & Co private label. Excludes flatbread (pan árabe),
  // breadcrumbs (pan rallado), and sweet breads (pan dulce).
  bread_500g: {
    query: "pan lactal",
    include: /\blactal\b/i,
    exclude: [
      /\b(?:rallado|rayado|arabe|árabe|brioche|dulce|tostado|crouton)\b/i,
      /\b(?:bizcocho|hamburguesa|pancho|panini|integral 100|salvado)\b/i,
    ],
    sizeRange: { min: 250, max: 700 },
    unitFromTitle: "g",
  },
  // Whole milk in 1 L cartons. La Serenisima is the dominant brand
  // plus Las Tres Niñas, Ilolay, Tregar, and Cuisine & Co. Excludes
  // skim ("descremada", "desc"), lactose-free, flavoured, sachet
  // (which is also OK but cheaper-per-litre packaging), and dairy
  // adjacent products (yogur, kefir, dulce de leche).
  milk_1l: {
    query: "leche entera",
    include: /\bleche\b/i,
    exclude: [
      /\b(?:descremada|desc|parcial|deslactosada|zerolact|sin lactosa)\b/i,
      /\b(?:chocolatada|achocolatada|frutilla|vainilla|polvo|saborizada)\b/i,
      /\b(?:soja|almendra|coco|avena|arroz|bebida)\b/i,
      /\b(?:condensada|evaporada|crema|dulce de leche|nata)\b/i,
      /\b(?:yogur|kefir|infant|bebé|bebe|maternizada)\b/i,
    ],
    sizeRange: { min: 800, max: 1100 },
    unitFromTitle: "ml",
  },
  // Fresh eggs in 6 / 12 / 30 cartons. White and "color" (brown)
  // both accepted. Excludes liquid egg, powdered, decorated chocolate
  // eggs, and quail eggs.
  eggs_12: {
    query: "huevos",
    include: /\bhuevos?\b/i,
    exclude: [
      /\b(?:liquido|líquido|pasteurizado|polvo|chocolate|pascua)\b/i,
      /\b(?:codorniz|pato|avestruz|cocodrilo)\b/i,
    ],
    sizeRange: { min: 6, max: 30 },
    unitFromTitle: "pcs",
  },
  // Butter ("manteca") in 100 / 200 g bricks. La Serenisima,
  // Sancor, Tonadita, Ilolay, Milkaut. Excludes margarine ("ricota
  // hojaldrada", "untable"), peanut butter ("manteca de mani"),
  // confectionery (palmeritas de manteca = puff pastry), and
  // brioche-style breads that ship the word "manteca" in the flavour
  // descriptor (e.g. "Pan Brioche Sabor Manteca").
  butter_200g: {
    query: "manteca",
    include: /\bmanteca\b/i,
    exclude: [
      /\b(?:margarina|untable|vegetal|light|reducida|cacao)\b/i,
      /\b(?:mani|maní|cacahuate|almendra|coco|ghee)\b/i,
      /\b(?:palmerita|hojaldre|galleta|tarta|masa|alfajor)\b/i,
      /\b(?:pan|brioche|budin|budín|biscocho|bizcocho|magdalena|muffin)\b/i,
      /\bsabor\b/i,
      // Argentine pastries: "Figacita de Manteca" = small bread
      // rolls flavoured with butter; "Aceite Aerosol Manteca" =
      // butter-flavoured cooking spray. Neither belongs in the
      // 200 g butter SKU.
      // Trailing \b dropped so "figacitas" (plural) also fires;
      // \b between letter and `s` doesn't anchor.
      /\b(?:figacita|figazza|figazzeta|aerosol)/i,
    ],
    sizeRange: { min: 80, max: 500 },
    unitFromTitle: "g",
  },
  // White granulated sugar ("azúcar común") in 1 / 2 kg bags. The
  // bare "azucar" keyword surfaces zero-sugar sodas first; the
  // longer query and the exclude list anchor on actual sugar SKUs.
  sugar_1kg: {
    // El Dorado UY: "Azucarlito" is the canonical Uruguayan refined
    // white-sugar brand. The Disco "azucar comun 1kg" query returns
    // no matches; the bare "azucar" query lands on Azucarlito 1Kg.
    query: "azucar",
    include: /\baz[uú]car\b/i,
    exclude: [
      /\b(?:gaseosa|bebida|jugo|soda|cola|sprite|pepsi|coca)\b/i,
      /\b(?:sin azucar|sin azúcar|zero|light|diet|cero)\b/i,
      /\b(?:impalpable|rubia|negra|morena|mascabo|integral|melaza)\b/i,
      /\b(?:stevia|sucralosa|edulcorante|fructosa|aspartam)\b/i,
      /\b(?:caramelo|caramelos|chocolate|chupetin|galleta|polvo gelatina)\b/i,
    ],
    sizeRange: { min: 800, max: 2500 },
    unitFromTitle: "g",
  },
  // Long-grain or doble-carolina rice in 1 / 2 / 5 kg bags. Dos
  // Hermanos, Molinos Ala, Gallo, Lucchetti. Excludes rice cakes
  // ("galletitas de arroz"), rice flour, rice drinks, and risotto-
  // ready boxed kits.
  rice_1kg: {
    query: "arroz 1kg",
    include: /\barroz\b/i,
    exclude: [
      /\b(?:galleta|galletita|tostadita|snack|chip|harina)\b/i,
      /\b(?:bebida|leche|aroma|saborizado|crema|risotto preparado)\b/i,
      /\b(?:pasta|fideo|fusilli|sopa|condimento|preparado)\b/i,
      /\b(?:integral con quinoa|wok|salteado)\b/i,
    ],
    sizeRange: { min: 800, max: 5500 },
    unitFromTitle: "g",
  },
  // Tomatoes sold per kg loose ("Tomate Redondo Grande Por Kg",
  // "Tomate Perita x Kg") and as 250 / 500 g punnets ("cherry").
  // Excludes sauces (salsa, pure, extracto, pulpa), juices, pizzas,
  // and dried (deshidratado). The "pulpa de tomate" pack class
  // ships under VTEX category "tomate" and otherwise outranks
  // loose produce on per-kg price because pulp is denser.
  //
  // The "puré" trailing-é exclude has to use a Unicode-property
  // lookahead: JavaScript's `\b` is ASCII-only, so `\bpuré\b` never
  // matches because the position between `é` and the following space
  // is not a `\w`/`\W` boundary. See parseSizeFromName / Migros TR
  // for the same Unicode-aware pattern.
  tomatoes_1kg: {
    query: "tomate",
    include: /\btomate/i,
    exclude: [
      /\b(?:salsa|pulpa|extracto|sopa|jugo|conserva|enlatado)\b/i,
      /\bpur[eé](?!\p{L})/iu,
      /\b(?:pizza|empanada|tarta|relleno|pasta|pasta de tomate)\b/i,
      /\b(?:deshidratado|secado|seco|polvo|aroma|saborizado)\b/i,
      /\b(?:trozado|cortado|cubeteado|peritas en lata|peritas enlatadas)\b/i,
      /\b(?:cazuela|fondo|tapa|preparado|cocido|frito)\b/i,
      // El Dorado UY: "Tomate Entero Viter Lata 400Grs" is canned
      // whole tomato; "Tomate Triturado" is crushed canned. Neither
      // belongs in the fresh-tomato 1 kg SKU.
      /\b(?:entero|triturado|pelado|lata|envasado)\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Potatoes sold per kg loose. "Papa Lavada Por Kg", "Papa
  // Cepillada x Kg" are the staples; bagged 1 kg variants also
  // accepted. Excludes sweet potato ("batata"), frozen fries
  // (papas fritas, bastones), snack chips, and starches.
  potatoes_1kg: {
    // El Dorado UY doesn't surface "papa lavada" results; the bare "papa"
    // query lands on "Papa Negra x Kg" / "Papa Blanca en malla x Kg",
    // both valid bulk loose-potato SKUs.
    query: "papa",
    include: /\bpapa\b/i,
    exclude: [
      /\b(?:batata|camote|dulce|boniato)\b/i,
      /\b(?:frita|fritas|baston|bastones|noisette|smile|smiles)\b/i,
      /\b(?:chip|chips|snack|nachos|tortilla)\b/i,
      /\b(?:congelada|congeladas|prefrita|horno|microondas)\b/i,
      /\b(?:fecula|almidón|harina|nuez)\b/i,
      /\b(?:ñoquis|nyoquis|gnocchi|pure|puré|relleno|tarta|empanada)\b/i,
      /\b(?:rellenada|salsa|aderezo)\b/i,
    ],
    sizeRange: { min: 500, max: 5500 },
    unitFromTitle: "g",
  },
  // Olive oil in 250 / 500 ml / 1 L bottles. Cocinero, Oliovita,
  // Zuccardi, Cuisine & Co. Excludes seed oils (girasol, maíz,
  // mezcla), aerosols, cosmetic / skincare olive products, infused
  // dressings, and condiments that name-drop olive oil in the
  // ingredient list (mayonesa con aceite de oliva, salsas, pestos).
  olive_oil_1l: {
    query: "aceite de oliva",
    include: /\baceite\b.*\boliva\b/i,
    exclude: [
      /\b(?:girasol|maiz|maíz|mezcla|soja|canola|sésamo|sesamo|salvado)\b/i,
      /\b(?:aerosol|spray|crema|loción|cosmetic|jabón|champu|champú)\b/i,
      /\b(?:vinagre|aceto|aliño|aderezo|condimento|salsa)\b/i,
      /\b(?:tapenade|relleno|pesto|preparado|infusionado)\b/i,
      /\b(?:mayonesa|mayonaise|ketchup|mostaza|hummus|tahini|alioli)\b/i,
      /\b(?:atun|atún|sardina|anchoa|conserva|en lata)\b/i,
    ],
    sizeRange: { min: 200, max: 1200 },
    unitFromTitle: "ml",
  },
  // Still mineral water in 1.5 / 2 / 5 L bottles. Eco de los Andes,
  // Villavicencio, Glaciar, Villa del Sur. Excludes carbonated
  // ("con gas", "gasificada", "soda"), flavoured, tonic water, and
  // non-drinking liquid products.
  water_bottled_1500ml: {
    query: "agua mineral sin gas 1.5 l",
    include: /\bagua\b/i,
    exclude: [
      /\b(?:con gas|gasificada|gaseada|soda|tonica|tónica|tonic)\b/i,
      /\b(?:saborizada|aromatizada|frutal|limon|limón|naranja|pomelo)\b/i,
      /\b(?:gaseosa|cola|sprite|pepsi|coca|isotonica|isotónica|gatorade|powerade)\b/i,
      /\b(?:destilada|desionizada|colonia|limpiavidrios|lavandina)\b/i,
      /\b(?:oxigenada|peroxido|peróxido)\b/i,
      /\b(?:bid[óo]n|dispenser|garrafa|caja|sixpack|six pack|pack)\b/i,
    ],
    // 1.5 L PET single-bottle consumer staple. The 5 L family
    // carafe was being preferred at 870 ARS-normalized, breaking
    // per-canonical-1.5L comparability.
    sizeRange: { min: 1300, max: 1700 },
    unitFromTitle: "ml",
  },
  // Bananas sold per kg loose ("Banana por Kg"). Excludes banana-
  // flavoured products: yogurts, smoothies, chips, breakfast cereals,
  // pancake mixes, baby food.
  bananas_1kg: {
    query: "banana por kg",
    include: /\bbanan/i,
    exclude: [
      /\b(?:yogur|bebida|smoothie|jugo|aroma|saborizad)\b/i,
      /\b(?:chip|chips|snack|deshidratada|seca|liofilizada|granola|cereal)\b/i,
      /\b(?:budin|budín|kek|panqueque|hojaldre|alfajor|biscuit)\b/i,
      /\b(?:pure|puré|bebe|infant|maternal|leche)\b/i,
      /\b(?:helado|crema|mousse|pudin|relleno|protein)\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Apples sold per kg loose ("Manzana Roja Por Kg", "Manzana
  // Granny Smith X Kg"). Excludes apple juice, vinegar, sauce
  // (puré), dried, and apple-flavoured drinks.
  apples_1kg: {
    query: "manzana roja",
    include: /\bmanzana/i,
    exclude: [
      /\b(?:jugo|bebida|gaseosa|isotonica|isotónica|gatorade|powerade)\b/i,
      /\b(?:vinagre|sidra|fermentada|alcohol)\b/i,
      /\b(?:deshidratada|seca|chip|chips|snack)\b/i,
      /\b(?:compota|pure|puré|mermelada|jalea|relleno|tarta|salsa)\b/i,
      /\b(?:bebe|infant|maternal|leche|yogur|cereal)\b/i,
      /\b(?:aroma|saborizad|esencia|extracto)\b/i,
    ],
    sizeRange: { min: 100, max: 3000 },
    unitFromTitle: "g",
  },
  // Chicken breast in butcher trays. "Pechuga de pollo" with kg
  // measurement is the staple. Excludes turkey breast ("pechuga de
  // pavo"), processed (milanesa, nuggets, hamburguesa, supremas
  // rebozadas), smoked, sausages, frozen ready-meal brands (Iglo,
  // Granja del Sol, La Anonima), and stuffed breast.
  chicken_breast_1kg: {
    // El Dorado UY sells the boneless chicken breast as "Suprema de Pollo"
    // (Argentine convention) rather than "Pechuga de Pollo". The
    // include now accepts either word followed by "pollo".
    query: "suprema pollo",
    include: /\b(?:pechuga|suprema)\b.*\bpollo\b/i,
    exclude: [
      /\bpavo\b/i,
      /\b(?:milanesa|rebozada|empanizada|frita|nugget|hamburguesa|patty)\b/i,
      /\b(?:salame|salami|jamón|jamon|fiambre|paté|pate|mortadela)\b/i,
      /\b(?:ahumado|ahumada|cocida|cocido|feteada|feteado)\b/i,
      /\b(?:churrasco|brochette|brocheta|salchicha|chorizo|morcilla)\b/i,
      /\b(?:relleno|rellena|marinada|adobada|tandoori|barbacoa)\b/i,
      /\b(?:iglo|granja del sol|la anonima|la anónima|naturalia|congelad)\b/i,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Ground beef ("carne picada"). Sold per-kg at the butcher
  // counter, common variants: especial, magra, novillo, vacuna.
  // Excludes lamb / chicken / pork ground meat, premade burgers,
  // empanada fillings, prepared meatballs, pet food.
  beef_ground_1kg: {
    query: "carne picada",
    include: /\bcarne\b.*\bpicad/i,
    exclude: [
      /\b(?:cordero|pollo|cerdo|chancho|pavo|conejo)\b/i,
      /\b(?:hamburguesa|burger|patty|bondiola|milanesa|albondiga|empanada)\b/i,
      /\b(?:rellena|relleno|salsa|preparada|preparado|congelada|ahumada)\b/i,
      /\b(?:mascotas|perro|gato|cachorro|comida|alimento)\b/i,
      /\b(?:embutido|salame|salami|chorizo|morcilla|fiambre)\b/i,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Hard / semi-hard local cheese. AR's mass-market staples in this
  // class are Reggianito (Argentine parmigiano clone), Sardo,
  // Provolone, Sbrinz, Pategrás. Excludes Queso Cremoso (a soft
  // fresh cheese, distinct from hard cheese; the previous query
  // collapsed onto it and broke per-canonical-kg cross-country
  // comparability) and all other soft / fresh / spread / processed
  // variants.
  cheese_local_500g: {
    // El Dorado UY catalog stocks Sbrinz and Provolone but no Reggianito;
    // bare "queso" query surfaces them. Sardo / Sbrinz are the canonical
    // UY local hard-cheese references.
    query: "queso",
    include:
      /\b(?:reggianito|sardo|sbrinz|provolone|pategr[áa]s|tybo|holanda|edam|porteño)\b/i,
    exclude: [
      /\b(?:rallado|rayado|polvo|deshidratado|en polvo)\b/i,
      /\b(?:cremos[oa]|fresc[oa]|blando|untable|crema|mascarpone|ricota|ricotta|cottage)\b/i,
      /\b(?:roquefort|azul|cabra|brie|camembert|cheddar|feta|halloumi|paneer)\b/i,
      /\b(?:mozzarella|muzzarella|port salut|cuartirolo|criollo)\b/i,
      /\b(?:hellim|sticks|bocadito|bocaditos|snack|atado|relleno|preparado|salsa|fondue|dip)\b/i,
      /\b(?:saborizado|ahumado|aromatizado|condimentado|hierbas|tartufo|trufa)\b/i,
    ],
    sizeRange: { min: 150, max: 1100 },
    unitFromTitle: "g",
  },
  // Imported beer in 330 / 355 / 473 / 500 / 710 ml bottles or
  // cans. Heineken, Stella Artois, Corona, Budweiser, Carlsberg,
  // Peroni. Excludes non-alcoholic ("cero", "0.0"), malt-only,
  // cocktail-style beverages, and accessories (mugs, openers).
  beer_imported_500ml: {
    // El Dorado UY stocks both imported brands (Budweiser, Heineken
    // when in stock) and Uruguayan locals (Pilsen, Patricia,
    // Zillertal, Norteña). Loosened to accept either tier since
    // the catalog slug is "imported_500ml" but the practical UY
    // basket reference is the local 473-710 ml lager.
    query: "cerveza",
    include:
      /\b(?:heineken|carlsberg|stella|corona|budweiser|peroni|guinness|leffe|hoegaarden|asahi|kronenbourg|amstel|miller|becks|pilsen|patricia|norte[ñn]a|zillertal|zillerthal)\b/iu,
    exclude: [
      /\b(?:cero|0\.0|sin alcohol|alcohol[- ]free|kero)\b/i,
      /\b(?:malta|maltada|cocktail|coctel|saborizada|aromatizada|sidra)\b/i,
      /\b(?:vaso|jarro|jarra|chop|chopp|abridor|posavaso|kit|regalo|set)\b/i,
    ],
    sizeRange: { min: 250, max: 750 },
    unitFromTitle: "ml",
  },
};

/**
 * Parse a Spanish-grammar size token out of a El Dorado product name.
 *
 *   "Leche La Serenisima Entera Bot 1l"        -> 1000 mL
 *   "Aceite de Oliva 250 Ml Cocinero"          -> 250 mL
 *   "Manteca Clásica 200 Grs La Serenisima"    -> 200 g
 *   "Arroz Doble Dos Hermanos 1kg"             -> 1000 g
 *   "Huevos Blancos 12 Un Cuisine & Co"        -> 12 pcs
 *   "Cerveza Heineken 330 Ml"                  -> 330 mL
 *
 * Exported for unit tests.
 */
export type ParsedUnit = "ml" | "g" | "pcs";

export function parseSizeFromName(
  name: string,
): { value: number; unit: ParsedUnit } | null {
  const s = name.replace(/\xa0/g, " ");

  // Litres: " 1 L", " 1L", " 1.5 Lts", " 2 Lts", " 1l"
  const litre = s.match(
    /(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*l(?:t|ts)?\b/i,
  );
  if (litre) {
    const v = parseFloat(litre[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 50)
      return { value: Math.round(v * 1000), unit: "ml" };
  }
  // Centilitres / centilitre cousins: "591 Cc", "750 cc"
  const cc = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*cc\b/i);
  if (cc) {
    const v = parseInt(cc[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "ml" };
  }
  // Kilograms: " 1 Kg", " 1kg", " 2,5 Kg"
  const kg = s.match(/(?<![a-zA-Z%\d.,])(\d+(?:[,.]\d+)?)\s*kg\b/i);
  if (kg) {
    const v = parseFloat(kg[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 100)
      return { value: Math.round(v * 1000), unit: "g" };
  }
  // Millilitres: " 500 Ml", " 500ml"
  const ml = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*ml\b/i);
  if (ml) {
    const v = parseInt(ml[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "ml" };
  }
  // Grams: " 200 Grs", " 200 Gr", " 200g"
  const g = s.match(/(?<![a-zA-Z%\d.,])(\d{2,5})\s*(?:gr|grs|g)\b/i);
  if (g) {
    const v = parseInt(g[1]!, 10);
    if (Number.isFinite(v) && v > 0) return { value: v, unit: "g" };
  }
  // Pieces: " 12 Un", " 6 U", " 30 Un", " 12 Unidades", " 12 Ud."
  // El Dorado UY uses "Ud." (with trailing period) as its piece-count abbrev.
  const pcs = s.match(/(?<![a-zA-Z%\d.,])(\d{1,3})\s*(?:un|ud|u|unidades?)\b/i);
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

/**
 * Convert one VTEX product into the scraper's internal representation.
 * Returns null when the price is missing, the only seller is out of
 * stock, or the title carries no parseable size for "un" measurement
 * products.
 *
 * For `measurementUnit === "kg"` items, the pack is hardwired to
 * 1000 g and the unit class to "g": El Dorado prices loose produce and
 * butcher meat per kilogram regardless of `unitMultiplier`.
 *
 * Exported for unit tests.
 */
export function parseProduct(p: EldoradoProduct): ParsedProduct | null {
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
  picker: ArPicker,
  target: ProductTarget,
): ParsedProduct | null {
  // El Dorado's VTEX feed periodically serves corrupted products with
  // Prices like 1.27, 3.99, or 8.33 ARS for 1 kg staples that retail
  // at thousands of pesos. The pattern looks like draft / test SKUs
  // that escaped quality gates. Reject any candidate whose per-pack
  // canonical price falls below the slug's sanity floor or above
  // its sanity ceiling before the picker sorts. The picker mirrors
  // normalize()'s gate so the per-unit sort never settles on a row
  // that the downstream pipeline would have to reject anyway.
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
  // Sort ascending by per-canonical-unit price so multi-kg bags
  // compete fairly with single-pack items inside the same sizeRange.
  candidates.sort(
    (a, b) => a.priceMajor / a.packSize - b.priceMajor / b.packSize,
  );
  return candidates[0]!;
}

/**
 * Fetch one VTEX query and return the parsed candidate list. Returns
 * an empty array on any non-2xx, parse error, or timeout, so the
 * caller treats it as "no candidates".
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
    const url = `${API_BASE}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}&_from=0&_to=29`;
    const res = await fetchImpl(url, {
      headers: REQUEST_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const raw: unknown = await res.json();
    const parsed = EldoradoSearchResponseSchema.safeParse(raw);
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

/**
 * Live scrape, exported entry point. Pure HTTP, no Browser Use Cloud.
 */
export async function scrapeEldoradoUy(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("eldorado-uy");
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
        reason: `eldorado returned no candidates for "${picker.query}"`,
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

  return { retailer: "eldorado-uy", scraped, misses };
}
// @scraper: eldorado-uy
// @rate-limit: respect retailer crawl policy
// @retry: exponential backoff on fetch failure
// @note: discussed in review thread
// @edge: test with maximum input length
// @config: read from next.config env section
// @type: narrow the generic constraint
// @cleanup: remove dead code in next pass
// @edge: concurrent access safety
// @cleanup: remove dead code in next pass
// @guard: bounds check before array access
// @perf: lazy load this component
// @perf: add caching layer here
// @a11y: check contrast ratio here
// @config: expose timeout as parameter
// @config: expose timeout as parameter
// @i18n: ensure this string is extracted
// @a11y: add aria-describedby reference
// @note: coordinated with PR #87
// @cleanup: consolidate with sibling file
