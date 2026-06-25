/**
 * Continente Portugal scraper, via the public search page on
 * continente.pt.
 *
 * Continente runs on the Salesforce Commerce Cloud (Demandware)
 * platform and inlines every search-result tile with two SSR
 * markers:
 *
 *   `data-product-tile-impression='{"name":"...","id":"...",
 *                                   "price":1.08,"brand":"...",
 *                                   "category":"...","variant":"",
 *                                   "channel":"col"}'`
 *
 *   `<div class="pwc-tile--quantity"><p>emb. 1 Lt</p></div>`
 *
 * The first is HTML-encoded JSON (named entities `&quot;`,
 * `&iacute;`, etc.); after decoding it yields name + price +
 * category. The second carries the pack size as a short
 * Portuguese label (`emb. 1 Lt` / `emb. 500 g` / `emb. 4 x 200 ml`
 * for multi-packs / `emb. 12 Un` / `emb. 1 Kg` etc.). One-to-one
 * with the impression, in card order, so a simple
 * "split-by-impression then take next emb." pass associates them
 * unambiguously.
 *
 * The page returns 35 candidates per query in one round-trip from
 * EU egress, no proxy / login / WAF challenge required.
 *
 * Portugal-specific quirks:
 *
 * 1. Multi-pack: many beverages are listed as "emb. 4 x 200 ml"
 *    or "emb. 6 x 1 Lt"; parseSizeFromEmb multiplies the cluster
 *    count by the per-unit size, so the canonical normalization
 *    sees the total volume of the pack.
 *
 * 2. Mixed Portuguese diacritics in titles: 'aacute', 'iacute',
 *    'eacute', 'oacute', 'ocirc', 'atilde', 'ccedil'. The
 *    decodeHtmlEntities() helper resolves them before JSON parse.
 *
 * 3. Five SKUs lead with non-ASCII diacritics that JavaScript's
 *    ASCII `\b` would not anchor (a-acute for acucar / agua,
 *    o-acute for oleo, a-circumflex for camara, c-cedilla
 *    initial in colloquial words). Pickers wrap leading
 *    boundaries in `(?<!\p{L})` with the /u flag.
 *
 * 4. Continente labels "emb." with mixed case for the unit ("Lt"
 *    vs "lt" vs "Litro", "Kg" vs "kg", "Un" vs "un" vs "Und"),
 *    parseSizeFromEmb matches case-insensitive.
 */
import { z } from "zod";

import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const BASE = "https://www.continente.pt";
const SEARCH_PATH = "/pesquisa/";
const FETCH_TIMEOUT_MS = 25_000;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.5",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};

const ContinenteCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().optional().default(""),
  brand: z.union([z.string(), z.null()]).optional().default(null),
  price: z.number().nonnegative(),
  variant: z.string().optional().default(""),
  channel: z.string().optional().default(""),
});
export type ContinenteCard = z.infer<typeof ContinenteCardSchema>;

interface PtPicker {
  query: string;
  include: RegExp;
  exclude: readonly RegExp[];
  sizeRange: { min: number; max: number };
  unitFromTitle?: ParsedUnit;
}

const PICKERS: Partial<Record<ProductTarget["slug"], PtPicker>> = {
  // "Pão de Forma" = sliced white sandwich bread. Continente
  // own-brand and Rio Maior / Panrico are the typical floor
  // picks. Excludes whole-grain ("integral"), seeds ("sementes"),
  // toast ("torrado" / "tosta"), sweet pastries.
  bread_500g: {
    query: "pao de forma branco 500g",
    include: /\bp[ãa]o\b/iu,
    exclude: [
      /\b(?:integral|integrais|m[áa]ltico|aveia|centeio)\b/iu,
      /\b(?:sementes|s[ée]samo|girassol|chia|linha[çc]a)\b/iu,
      /\b(?:tostas?|torrad|aperitivo|panini|hamb[úu]rguer|burger|hotdog)\b/iu,
      /\b(?:doce|mel|canela|chocolate|fruta)\b/iu,
      /\b(?:b[ôo]l[ai]|broa|alentejana|cebola)\b/iu,
    ],
    sizeRange: { min: 300, max: 800 },
    unitFromTitle: "g",
  },
  // Standard milk in a 1 L carton. "Meio Gordo" (semi-skim) and
  // "Gordo" / "Inteiro" (whole) are both valid canonical picks;
  // "Magro" (skim) and "Sem Lactose" are excluded to keep the
  // class consistent with the other countries.
  milk_1l: {
    query: "leite meio gordo 1l",
    include: /\bleite\b/i,
    exclude: [
      /\bsem\s+lactose\b/iu,
      /\b(?:magro|desnatado|0%\s+gordura)\b/iu,
      /\b(?:soja|amend|coco|aveia|arroz|am[êe]ndoa|cevad)\b/iu,
      /\b(?:achocolatad|aromatizad|sabor|chocolate|morango|baunilha)\b/iu,
      /\b(?:iogurte|kefir|natas|creme|requeij[ãa]o|manteig)\b/iu,
      /\b(?:beb[ée]|infantil|crescimento|crian)\b/iu,
      /\b(?:condensado|evaporado|em\s+p[óo])\b/iu,
    ],
    sizeRange: { min: 800, max: 1300 },
    unitFromTitle: "ml",
  },
  // Class M or M/L eggs in 12-piece cartons (Portuguese retail
  // also stocks 6 / 18 / 30 cartons). Excludes liquid eggs,
  // chocolate eggs, quail, sun-dried (not a thing for eggs but
  // protects against false positives).
  eggs_12: {
    query: "ovos classe m 12",
    include: /\bovos\b/iu,
    exclude: [
      /\b(?:chocolate|pascoa|p[áa]scoa|kinder)\b/iu,
      /\b(?:codorniz|peru|pato|ganso)\b/iu,
      /\b(?:l[ií]quidos?|p[óo]|desidratad)\b/iu,
      /\b(?:salada|maionese|sandes|comida)\b/iu,
    ],
    sizeRange: { min: 6, max: 30 },
    unitFromTitle: "pcs",
  },
  // 200-250 g butter (Continente, Mimosa, Primor are the floor
  // picks). Excludes nut butters, margarine, ghee, lard.
  butter_200g: {
    query: "manteiga 250g",
    include: /\bmanteiga\b/iu,
    exclude: [
      /\b(?:amendoim|amend[oô]a|caju|coco|girassol|sementes)\b/iu,
      /\b(?:margarina|creme\s+vegetal|spread|tartin)\b/iu,
      /\b(?:ghee|clarificada|fundida)\b/iu,
      /\b(?:banha|toucinho)\b/iu,
      /\b(?:bolacha|tosta|biscoito|pastel|wafer)/iu,
      /\b(?:cacau|chocolate|caramelo|fig[ao])\b/iu,
    ],
    sizeRange: { min: 100, max: 350 },
    unitFromTitle: "g",
  },
  // White granulated sugar 1 kg (Continente own-brand 0.89 EUR is
  // the canonical floor). "Açúcar" leads with non-ASCII so the
  // include uses a Unicode lookbehind. Excludes brown sugar,
  // cane (cana), icing (em pó), cubes (cubos), sachets, sticks,
  // syrups, sweeteners.
  sugar_1kg: {
    query: "acucar branco 1kg",
    include: /(?<!\p{L})a[çc][úu]car\b/iu,
    exclude: [
      /\bamarelo\b/iu,
      /\b(?:cana|mascavado|m[óo]rena|m[óo]reno)\b/iu,
      /\b(?:p[óo]|em\s+p[óo]|cubos|saquetas|sticks|terr[ãa]o)\b/iu,
      /\b(?:xarope|caramelo|invertido|coco)\b/iu,
      /\b(?:fructose|frutose|stevia|sucralose|aspartame|edulcorante)\b/iu,
      /\b(?:para\s+conservas|granulado\s+especial)\b/iu,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // White long-grain "arroz agulha" 1 kg. Excludes carolino
  // (round-grain, different product class), basmati, parboiled,
  // brown, wild, baby food, rice cakes, rice flour.
  rice_1kg: {
    query: "arroz agulha 1kg",
    include: /\barroz\b/iu,
    exclude: [
      /\b(?:carolino|basmati|jasmim|vaporizado|integral|selvagem)\b/iu,
      /\b(?:beb[ée]|infantil|crian[çc])\b/iu,
      /\b(?:bolacha|tosta|farinha|leite\s+de\s+arroz)\b/iu,
      /\b(?:risott|paella|sushi)\b/i,
      /\b(?:pronto|cozinhar|tempero)\b/iu,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "g",
  },
  // Loose / packed fresh tomatoes per kg (Continente sells in
  // 500 g / 1 kg / 2 kg pre-packs). Excludes cherry, sun-dried,
  // ketchup / paste / sauce, salads, canned.
  tomatoes_1kg: {
    query: "tomate kg",
    include: /\btomate\b/iu,
    exclude: [
      /\b(?:cherry|mini|cocktail|chucha|amarelo)\b/iu,
      /\b(?:seco|secos|desidrat|kalt|liof)\b/iu,
      /\b(?:ketchup|polpa|molho|past|conserv|enlat|pelad)\b/iu,
      /\b(?:salada|prepara|sopa|cozinha)\b/iu,
      /\b(?:beb[ée]|infantil)\b/iu,
    ],
    sizeRange: { min: 400, max: 2500 },
    unitFromTitle: "g",
  },
  // Loose fresh white potatoes per kg. Excludes sweet potato
  // ("batata doce"), frozen / fried / chips processed, salads,
  // mash, croquettes.
  potatoes_1kg: {
    query: "batata kg",
    include: /\bbatata\b/iu,
    exclude: [
      /\bdoce\b/iu,
      /\b(?:fritas|chips|stick|palha|crocant)\b/iu,
      /\b(?:congelad|pre[- ]?cozid|pronta)\b/iu,
      /\b(?:p[ée]\s+de|crocant|pur[ée]|esmagada)\b/iu,
      /\b(?:salada|tortilla|tortilh)\b/iu,
      /\b(?:beb[ée]|infantil)\b/iu,
    ],
    sizeRange: { min: 500, max: 5500 },
    unitFromTitle: "g",
  },
  // Olive oil 1 L bottle. Continente own-brand "Azeite
  // Poupança" is the canonical floor at 4.59 EUR; Oliveira da
  // Serra / Gallo are mid-market premium. Excludes shampoos,
  // soaps, cosmetics with olive-oil naming, and other vegetable
  // oils.
  olive_oil_1l: {
    query: "azeite 1l",
    include: /\bazeite\b/iu,
    exclude: [
      /\b(?:champ[ôo]|sabonete|creme|loc[ãa]o|cosm[ée]tic|sab[ãa]o)\b/iu,
      /\b(?:girassol|amendoim|colza|milho|s[ée]samo|linha[çc]a)\b/iu,
      /\b(?:spray|aerossol)\b/iu,
      /\b(?:tempero|prepara|biscoito|bolacha)\b/iu,
    ],
    sizeRange: { min: 800, max: 1200 },
    unitFromTitle: "ml",
  },
  // Still water 1.5 L PET. Continente own-brand at 1.86 EUR for
  // 6 x 1.5 L = 11.16, ~1.86 per 1.5 L pack. Single-bottle
  // floor pickers (Caldas de Penacova, Luso, Vitalis) range
  // 0.45-2 EUR per 1.5 L bottle. Leading "Á" non-ASCII so
  // include uses a Unicode lookbehind.
  water_bottled_1500ml: {
    query: "agua sem gas 1,5l",
    include: /(?<!\p{L})[áa]gua\b/iu,
    exclude: [
      /\bcom\s+g[áa]s\b/iu,
      /\b(?:gaseificad|carbonatad|gas[oeéifi])\b/iu,
      /\b(?:sabor|aromatizad|fruta|lim[ãa]o|laranja|frutos|cereja)\b/iu,
      /\b(?:beb[ée]|infantil)\b/iu,
      /\b(?:t[óo]nica|coca|pepsi|sprite|isot[óo]nica|gatorade|powerade)\b/iu,
      /\b(?:perfume|col[ôo]nia|destilad)\b/iu,
    ],
    sizeRange: { min: 1300, max: 1700 },
    unitFromTitle: "ml",
  },
  // Loose fresh bananas per kg (Continente own-brand "Banana da
  // Madeira" / Banana Bio). Excludes baby food, banana chips,
  // snack bars, juices, smoothies, baked goods, ice cream.
  bananas_1kg: {
    query: "banana kg",
    include: /\bbanana\b/iu,
    exclude: [
      /\b(?:bolo|bolinho|brownie|cake|paozinho|p[ãa]o)\b/iu,
      /\b(?:cereal|granola|barra|m[uú]sli|prote[íi]na|preparado)\b/iu,
      /\b(?:sumo|n[ée]ctar|smoothie|bebida|leite|iogurte)\b/iu,
      /\b(?:chips|chip|desidrat|liof|seca)\b/iu,
      /\b(?:beb[ée]|infantil|papa)\b/iu,
      /\b(?:gelado|sorvete|sobremesa)\b/iu,
    ],
    sizeRange: { min: 500, max: 2500 },
    unitFromTitle: "g",
  },
  // Loose fresh apples per kg ("Maçã"). JS `\b` is ASCII-only,
  // so the trailing `\b` after non-ASCII `ã` never anchors:
  // (ã = non-word, space = non-word, no boundary). Use Unicode
  // lookbehind/lookahead with `\p{L}` instead, which also lets
  // the plural form "maçãs" match. Excludes apple juice /
  // cider / vinegar, baby food, dried, sweets, baked goods.
  apples_1kg: {
    query: "maca golden kg",
    include: /(?<!\p{L})ma[çc][ãa](?!\p{L})|(?<!\p{L})ma[çc][ãa]s(?!\p{L})/iu,
    exclude: [
      /\b(?:sumo|n[ée]ctar|cidra|vinagre|cidre)\b/iu,
      /\b(?:beb[ée]|infantil|papa|crescimento)\b/iu,
      /\b(?:cereal|granola|barra|m[uú]sli)\b/iu,
      /\b(?:chips|chip|desidrat|liof|seca|crocant)\b/iu,
      /\b(?:strudel|compota|geleia|doce|tarte|pastel)\b/iu,
      /\b(?:champ[ôo]|sabonete|creme|cosm[ée]tic)\b/iu,
      /\b(?:vegan|hambur|burger)\b/iu,
    ],
    sizeRange: { min: 500, max: 2500 },
    unitFromTitle: "g",
  },
  // Fresh chicken breast filet ("peito de frango"). Excludes
  // turkey ("peru"), ham / cold cuts ("fiambre"), nuggets,
  // frozen, sausages, ground meat ("carne picada de frango").
  chicken_breast_1kg: {
    query: "peito frango kg",
    include: /\bpeito\b.*\bfrango\b/iu,
    exclude: [
      /\bperu\b/iu,
      /\b(?:fiambre|presunto|mortadela|salame|salsicha|paio|chouri)\b/iu,
      /\b(?:nuggets|filetes\s+panad|panad|empanad|crocant|crispy)\b/iu,
      /\b(?:congelad|congel|frozen|ultracongel)\b/iu,
      /\b(?:fumad|defumad|tabule|temperado|marinado|adobado)\b/iu,
      /\b(?:picada|moida|carne\s+picada)\b/iu,
      /\b(?:caldo|sopa|salada|tempero|prepara)\b/iu,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Fresh ground beef ("carne picada de bovino / vaca"). Excludes
  // pork ("porco / suino"), chicken / turkey, burgers, mixed
  // ("mista"), canned, dog/cat food.
  beef_ground_1kg: {
    query: "carne picada bovino kg",
    include: /\bcarne\s+picada\b/iu,
    exclude: [
      /\b(?:porco|su[íi]no|frango|peru|borrego|cordeiro|coelho)\b/iu,
      /\b(?:mista|mistura|combinada|misto)\b/iu,
      /\b(?:hamb[úu]rguer|burger|almondega|alm[ôo]ndega|kebab)\b/iu,
      /\b(?:conserv|enlat|conserv[ao])\b/iu,
      /\b(?:c[ãa]o|gato|cachorro|pet)\b/iu,
      /\b(?:congelad|congel|ultracongel)\b/iu,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Portuguese "queijo flamengo" (yellow semi-hard cheese,
  // analogous to gouda) is the canonical local pick at 500 g.
  // Excludes specialty / blue / processed slices / cream
  // cheese / fresh cheese ("fresco"), grated, snack-sized,
  // halloumi / mozzarella.
  cheese_local_500g: {
    query: "queijo flamengo 500g",
    include: /\bqueijo\b/iu,
    exclude: [
      /\b(?:ralado|ralad|p[óo]|polvilho)\b/iu,
      /\b(?:fresco|fresh|requeij[ãa]o|cottage|ricotta|mascarpone)\b/iu,
      /\b(?:azul|brie|camembert|cheddar|parmes[ãa]o|gouda|gruyere)\b/iu,
      /\b(?:halloumi|mozzarella|mozzar[ée]la|stracciatella|burrata)\b/iu,
      /\b(?:snack|relleno|preparado|fondue|dip|salsa)\b/iu,
      /\b(?:saborizad|aromatizad|fumad|defumad|ervas)\b/iu,
      /\b(?:vegan|vegetal|sem\s+lactose)\b/iu,
    ],
    sizeRange: { min: 250, max: 700 },
    unitFromTitle: "g",
  },
  // 500 ml / 33 cl beer can ("Cerveja em Lata"). Portuguese
  // retail Super Bock 0.33 L cans are the canonical floor;
  // Heineken / Carlsberg / Sagres also qualify. Excludes
  // non-alcoholic ("sem alcool"), flavoured (Radler / shandy),
  // cider ("sidra"), sausage / cheese cross-contamination,
  // gift kits, multi-pack-only.
  beer_imported_500ml: {
    query: "cerveja super bock",
    include: /\bcerveja\b/iu,
    exclude: [
      /\bsem\s+[áa]lcool\b/iu,
      /\b(?:radler|sabor|frutas|cocktail|aromatizad)\b/iu,
      /\b(?:sidra|cidre|cidra)\b/iu,
      /\b(?:queijo|salsicha|past|salgad)\b/iu,
      /\b(?:caixa|kit|presente|prenda|set)\b/iu,
      /\b(?:abridor|copo|caneca)\b/iu,
    ],
    sizeRange: { min: 250, max: 600 },
    unitFromTitle: "ml",
  },
};

export type ParsedUnit = "ml" | "g" | "pcs";

/**
 * Decode the subset of HTML entities Continente's tile JSON uses.
 * Numeric (decimal and hex) and a curated table of named entities
 * cover every character observed in the live HTML at the time of
 * authoring; unknown named entities pass through unchanged.
 */
export function decodeHtmlEntities(s: string): string {
  const named: Record<string, string> = {
    quot: '"',
    apos: "'",
    amp: "&",
    lt: "<",
    gt: ">",
    nbsp: " ",
    aacute: "á",
    eacute: "é",
    iacute: "í",
    oacute: "ó",
    uacute: "ú",
    atilde: "ã",
    otilde: "õ",
    ntilde: "ñ",
    ccedil: "ç",
    acirc: "â",
    ecirc: "ê",
    ocirc: "ô",
    Aacute: "Á",
    Eacute: "É",
    Iacute: "Í",
    Oacute: "Ó",
    Uacute: "Ú",
    Atilde: "Ã",
    Otilde: "Õ",
    Ccedil: "Ç",
    Acirc: "Â",
    Ecirc: "Ê",
    Ocirc: "Ô",
  };
  return s
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => named[name] ?? m);
}

/**
 * Parse a Continente "emb. <multiplier> x <quantity> <unit>" label.
 *
 *   "emb. 1 Lt"        -> 1000 ml
 *   "emb. 1.5 Lt"      -> 1500 ml
 *   "emb. 500 g"       -> 500 g
 *   "emb. 4 x 200 ml"  -> 800 ml
 *   "emb. 12 Un"       -> 12 pcs
 *   "emb. 1 Kg"        -> 1000 g
 *   "emb. 230 ml"      -> 230 ml
 *
 * Returns null for free-text labels that do not match the
 * recognised pack-size shape.
 */
export function parseSizeFromEmb(
  label: string,
): { value: number; unit: ParsedUnit } | null {
  const s = label.replace(/\xa0/g, " ").trim();
  // Try multi-pack first: "4 x 200 ml" / "6 x 1 lt" / "12 x 1 Kg"
  // / "6 x 33 cl" (Continente uses cl for beer cans / bottles).
  const multi = s.match(
    /(\d+(?:[,.]\d+)?)\s*x\s*(\d+(?:[,.]\d+)?)\s*(lt|litro|l|cl|ml|kg|kilo|g|gr|un|und|unid)\b/i,
  );
  if (multi) {
    const mult = parseFloat(multi[1]!.replace(",", "."));
    const qty = parseFloat(multi[2]!.replace(",", "."));
    const unit = normaliseUnit(multi[3]!);
    if (
      Number.isFinite(mult) &&
      Number.isFinite(qty) &&
      mult > 0 &&
      qty > 0 &&
      unit
    ) {
      return { value: Math.round(mult * qty * unit.factor), unit: unit.unit };
    }
  }
  // Single pack: "1 Lt" / "500 g" / "12 Un" / "33 cl" (beer can).
  const single = s.match(
    /(\d+(?:[,.]\d+)?)\s*(lt|litro|l|cl|ml|kg|kilo|g|gr|un|und|unid)\b/i,
  );
  if (single) {
    const qty = parseFloat(single[1]!.replace(",", "."));
    const unit = normaliseUnit(single[2]!);
    if (Number.isFinite(qty) && qty > 0 && unit) {
      return { value: Math.round(qty * unit.factor), unit: unit.unit };
    }
  }
  return null;
}

function normaliseUnit(
  raw: string,
): { unit: ParsedUnit; factor: number } | null {
  const r = raw.toLowerCase();
  if (r === "lt" || r === "litro" || r === "l") return { unit: "ml", factor: 1000 };
  if (r === "cl") return { unit: "ml", factor: 10 };
  if (r === "ml") return { unit: "ml", factor: 1 };
  if (r === "kg" || r === "kilo") return { unit: "g", factor: 1000 };
  if (r === "g" || r === "gr") return { unit: "g", factor: 1 };
  if (r === "un" || r === "und" || r === "unid") return { unit: "pcs", factor: 1 };
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
 * Sweep the search HTML, pull each `data-product-tile-impression`
 * envelope and pair it with the next `emb. <size>` label that
 * appears in the same product-tile block. The "next emb." rule is
 * exact because the markup is one impression then one
 * `pwc-tile--quantity` per card, in source order.
 */
export function extractContinenteCards(html: string): ParsedProduct[] {
  const out: ParsedProduct[] = [];
  const impressionPositions: number[] = [];
  const impressionRe = /data-product-tile-impression='([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = impressionRe.exec(html)) !== null) {
    impressionPositions.push(m.index);
  }
  for (let i = 0; i < impressionPositions.length; i++) {
    const start = impressionPositions[i]!;
    const end =
      i + 1 < impressionPositions.length
        ? impressionPositions[i + 1]!
        : html.length;
    const chunk = html.slice(start, end);
    const impressionMatch = chunk.match(
      /data-product-tile-impression='([^']+)'/,
    );
    if (!impressionMatch) continue;
    let card: ContinenteCard;
    try {
      const json = JSON.parse(decodeHtmlEntities(impressionMatch[1]!));
      const parsed = ContinenteCardSchema.safeParse(json);
      if (!parsed.success) continue;
      card = parsed.data;
    } catch {
      continue;
    }
    if (!Number.isFinite(card.price) || card.price <= 0) continue;
    const embMatch = chunk.match(/emb\.\s*([^<]{1,80})/i);
    if (!embMatch) continue;
    const size = parseSizeFromEmb(embMatch[1]!);
    if (size === null) continue;
    out.push({
      productId: card.id,
      title: decodeHtmlEntities(card.name),
      priceMajor: card.price,
      packSize: size.value,
      packUnit: size.unit,
      sourceUrl: `${BASE}/produto/${card.id}/`,
    });
  }
  return out;
}

function pickBestMatch(
  products: ParsedProduct[],
  picker: PtPicker,
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
    const url = `${BASE}${SEARCH_PATH}?q=${encodeURIComponent(query)}`;
    const res = await fetchImpl(url, {
      headers: REQUEST_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    return extractContinenteCards(html);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function scrapeContinentePt(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("continente-pt");
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
        reason: `continente-pt returned no candidates for "${picker.query}"`,
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

  return { retailer: "continente-pt", scraped, misses };
}
// @scraper: continente-pt
// @rate-limit: respect retailer crawl policy
// @retry: exponential backoff on fetch failure
// @guard: validate before processing
// @note: coordinated with PR #87
// @cleanup: remove dead code in next pass
// @guard: validate before processing
// @guard: validate at component boundary
// @note: see issue tracker for context
// @cleanup: inline single-use helper
// @edge: test with maximum input length
