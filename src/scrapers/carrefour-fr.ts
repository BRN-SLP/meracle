/**
 * Carrefour France scraper, via Browser Use Cloud + Playwright CDP.
 *
 * Carrefour.fr sits behind Akamai Bot Manager. Direct curl returns 403
 * even with a desktop UA, and a naive headless playwright trips the
 * same fingerprint. We work around it by driving a remote chromium
 * that Browser Use Cloud provisions with a FR residential proxy.
 *
 * Strategy:
 *   1. Spin up remote browser (FR proxy, ~5 min session)
 *   2. Warm cookies with a homepage visit (Akamai issues a free pass
 *      cookie on a clean homepage hit; the search request rides it)
 *   3. Navigate to /s?q=<query> for each target slug
 *   4. Extract product cards from the rendered DOM
 *   5. Filter with a per-slug picker, pick cheapest match
 *
 * Carrefour ships product detail URLs as /p/<slug>-<id>. The PLP
 * embeds schema.org Product JSON-LD blocks (one per visible tile) so
 * we parse those first and fall back to anchor scraping if the LD
 * block is missing or malformed.
 *
 * Pickers are added in follow-up commits one slug-group at a time.
 * An empty PICKERS map is valid; scrapeCarrefourFr() reports every FR
 * target as a miss with reason "no picker configured", and the batch
 * pipeline tolerates that gracefully.
 *
 * The DOM selectors below are MVP-blind, they may need a tweak after
 * the first live run. The picker logic itself is product-agnostic so
 * a selector change is a one-line fix in scrapeOneSearch.
 */
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";

import { withSession } from "../browseruse.js";
import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const BASE = "https://www.carrefour.fr";
// 16 sequential searches under one session. Each query runs a goto +
// 15 s waitForFunction + DOM walk, roughly 20 s; with the homepage
// warm the budget lands around 5.5 min. 8 min cap keeps a safety
// margin for the slow tail (multi-pack water queries, the larger
// PLP for `pommes` / `tomates` heuristic searches). Browser Use bills
// per actual second, so the unused tail is free.
const SESSION_TIMEOUT_MIN = 8;

interface FrPicker {
  /** French search keyword. */
  query: string;
  /** Product title must match. */
  include: RegExp;
  /** Product title MUST NOT match. */
  exclude: readonly RegExp[];
  /** Pack size in target.unit (g or mL or pcs). */
  sizeRange: { min: number; max: number };
}

// Pickers are added in follow-up commits one slug-group at a time.
// 5 thematic PRs: dairy, dry goods, produce, meat, beverages.
const PICKERS: Partial<Record<ProductTarget["slug"], FrPicker>> = {
  // Whole milk (lait entier). French supermarkets push demi-écrémé
  // (half-skim) harder than entier, so the query is explicit. Carrefour
  // ships own-brand "Carrefour Lait Entier UHT 1 L" at ~EUR 1.10. UHT
  // bricks and refrigerated bottles both at 1 L; sizeRange 800-1100 ml
  // catches both, normalize.ts rescales the outliers to canonical 1000.
  milk_1l: {
    query: "lait entier",
    include: /\blait\b.*\bentier\b|\bentier\b.*\blait\b/i,
    exclude: [
      /\b(demi-[ée]cr[ée]m[ée]|[ée]cr[ée]m[ée]|sans lactose|d[ée]lactos[ée]|condens[ée]|en poudre|aromatis[ée]|chocolat|cacao|fraise|vanille|miel|caf[ée])\b/i,
      /\b(soja|soya|riz|amande|coco|coconut|avoine|noisette|k[ée]fir|yaourt|cr[èe]me|cremeux|fromage)\b/i,
      /\b(infantile|infant|b[ée]b[ée]|croissance|formula|maternis[ée])\b/i,
    ],
    sizeRange: { min: 800, max: 1100 },
  },
  // Fresh eggs (oeufs frais). French packs ship 4 / 6 / 10 / 12.
  // Catalog canonical is 12, sizeRange 6..12 catches all common sizes
  // and normalize.ts rescales to per-12. Carrefour Bio + own-brand
  // "Plein Air" cage-free are the cheapest 12-packs; the picker just
  // grabs any `<N> oeufs` title.
  eggs_12: {
    query: "oeufs frais",
    include: /\b\d+\s*(?:œufs|oeufs|œuf|oeuf)\b/i,
    exclude: [
      /\b(caille|canard|oie|chocolat|p[âa]ques|raviol|tagliatell|glace|mayonnaise|liquid|albumen|blanc d'(?:œuf|oeuf)|jaune)\b/i,
    ],
    sizeRange: { min: 6, max: 12 },
  },
  // Butter (beurre). French bricks ship at 125 / 250 / 500 g. The
  // canonical 200g slug matches 250g packs, sizeRange 180-300 catches
  // the 200g and 250g variants and normalize.ts rescales. Doux (sweet)
  // is the most common, demi-sel (Brittany salted) and salé (fully
  // salted) are also accepted — all share the `beurre` stem and similar
  // price per 100g; cheapest wins.
  butter_200g: {
    query: "beurre doux",
    include: /\bbeurre\b/i,
    exclude: [
      /\b(margarine|[àa] tartiner|tartinable|spread|clarifi[ée]|ghee|ghi|anhydre)\b/i,
      /\b(cacao|chocolat|noix|noisett|arachide|s[ée]same|amande|biscuit|brioche|aromatis[ée])\b/i,
      /\b(cr[èe]me p[âa]tissi[èe]re|cr[èe]me dessert|cacahu[èe]te|peanut)\b/i,
    ],
    sizeRange: { min: 180, max: 300 },
  },
  // Hard cheese (fromage à pâte pressée). France's mass-market staples
  // are Emmental (used in cooking, sold as râpé 500g + block), Comté
  // (PDO/AOP, premium wedge), Gruyère, Cantal, Beaufort, Mimolette,
  // Tomme. The cheapest among these wins after the 350-600g sizeRange
  // filter; that's almost always Carrefour-brand Emmental Râpé 500g.
  //
  // Excludes:
  // - Soft / fresh cheeses (camembert, brie, chèvre, mozzarella,
  //   ricotta, mascarpone, fromage frais, fromage blanc, féta, halloumi)
  // - Processed / spreads (vache qui rit, kiri, fondu, à tartiner)
  // - Flavored variants (truffe, poivre, ail, fumé, herbes)
  // - Vegan / lactose-free substitutes
  // - French AOP soft / washed-rind (reblochon, munster, époisses,
  //   livarot, pont-l'évêque, maroilles, rocamadour, valençay)
  cheese_local_500g: {
    query: "emmental",
    include: /\b(emmental|comt[ée]|gruy[èe]re|cantal|beaufort|mimolette|tomme|raclette|abondance|edam|gouda)\b/i,
    exclude: [
      /\b(camembert|brie|ch[èe]vre|fromage blanc|fromage frais|f[ée]ta|mozzarella|ricotta|mascarpone|halloumi|philadelphia|reblochon|munster|maroilles|[ée]poisses|livarot|rocamadour|valen[çc]ay|crottin|b[ûu]chette?)\b/i,
      /\b(fondu|[àa] tartiner|tartinable|vache qui rit|kiri|babybel|portion|carr[ée]|coeur|stick|b[âa]tonnet|nappage)\b/i,
      /\b(truffe|poivre|piment|fum[ée]|aill?|herbes|cumin|fenouil|noix|noisette)\b/i,
      /\b(v[ée]g[ée]tal|v[ée]g[ée]talien|v[ée]gan|sans lactose|d[ée]lactos[ée])\b/i,
    ],
    sizeRange: { min: 350, max: 600 },
  },
  // Sliced packaged bread (pain de mie). The French boulangerie
  // baguette is 200-300g and doesn't fit the 500g canonical, so the
  // picker targets the supermarket sliced-loaf staple. Carrefour ships
  // own-brand "Carrefour Pain de Mie Nature" 500g at ~EUR 1.20.
  bread_500g: {
    query: "pain de mie",
    include: /\bpain\b/i,
    exclude: [
      /\b(complet|c[ée]r[ée]ales?|seigle|son|graines?|olive|tartines?|biscott|toast|grill[ée]|sucr[ée]|brioch[ée]?|cake|baguette|focaccia|p[âa]te|naan|pita|wrap|cubes?|crouton|panko|panini)\b/i,
      /\b(farci|fourr[ée]|chocolat|fruit|raisin|p[ée]pite|hot dog|burger|hamburger)\b/i,
      /\b(noix|noisette|amande)\b/i,
    ],
    sizeRange: { min: 300, max: 700 },
  },
  // White granulated sugar (sucre en poudre / sucre cristal). The
  // canonical staple is `sucre en poudre` (white granulated) sold in
  // 1 kg paper bags at ~EUR 0.90-1.40. Excludes brown / cane / icing
  // / flavored / sweetener substitutes.
  sugar_1kg: {
    query: "sucre en poudre",
    include: /\bsucre\b/i,
    exclude: [
      /\b(roux|brun|cassonade|muscovado|panela|complet|gel[ée]e|glace|impalpable|vanill[ée]|aromatis[ée])\b/i,
      /\b(canne|cane)\b/i,
      /\b(st[ée]via|fructose|maltose|aspartam|[ée]rythritol|saccharine?|[ée]dulcorant)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Rice (riz). French supermarkets stock long grain, basmati, thai
  // jasmine, parboiled, plus risotto rices (arborio, carnaroli). The
  // picker accepts any pure rice 800-1200 g; cheapest wins, which
  // tends to be Carrefour-brand long grain. Excludes prepared rices
  // and processed forms.
  rice_1kg: {
    query: "riz long",
    include: /\briz\b/i,
    exclude: [
      /\b(boisson|lait|sirop|farine|vinaigre|galette|biscuit|cracker|noir|sauvage|wild)\b/i,
      /\b(pr[ée]cuit|cuit|express|micro-ondes|surgel[ée]|congel[ée]|pr[êe]t)\b/i,
      /\b(pilaf|au lait|cantonais|asiatique|paella)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Olive oil (huile d'olive vierge extra). Canonical FR cooking
  // staple, sold in 750ml / 1L glass + PET bottles. Carrefour ships
  // own-brand + branded (Puget, Tramier, Lesieur). Cheapest 1L extra
  // virgin wins.
  olive_oil_1l: {
    query: "huile d'olive vierge extra",
    include: /\bhuile\b.*\bolive/i,
    exclude: [
      /\b(tournesol|colza|p[ée]pin|s[ée]same|noix|noisette|argan|coco|coconut|palm|arachide|cacahu[èe]te)\b/i,
      /\b(aromatis[ée]|truffe|aill?|citron|piment|romarin|basilic|origan|menthe|chili|infus[ée]|spray)\b/i,
      /\b(condiment|assaisonnement|sauce|m[ée]lang[ée])\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Fresh tomatoes (tomates). French cultivars: ronde, coeur de boeuf,
  // noire de Crimée, Roma, Marmande, ananas, cocktail, grappe (vine).
  // The picker accepts any loose 1 kg variant; cheapest wins. Processed
  // forms (purée, coulis, pelées, concentrée, sauce, ketchup) excluded.
  tomatoes_1kg: {
    query: "tomates",
    include: /\btomate/i,
    exclude: [
      /\b(pur[ée]e|coulis|pel[ée]es?|concass[ée]es?|concentr[ée]e?|sauce|ketchup|s[ée]ch[ée]es?|confit|jus|graines?|conserve)\b/i,
      /\b(farcie?s?|chutney|pesto|m[ée]lang[ée]|aromatis[ée]|saveur)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Potatoes (pommes de terre). French varieties: Charlotte, Bintje,
  // Ratte, Roseval, Amandine, Désirée, Vitelotte. Loose by kg in the
  // produce aisle, plus 1 kg netted bags. Sweet potatoes (patate /
  // pomme de terre douce) and processed forms excluded.
  potatoes_1kg: {
    query: "pommes de terre",
    include: /\bpommes?\s+de\s+terre\b/i,
    exclude: [
      /\b(douce|patate)\b/i,
      /\b(chips|frites?|cubes?|pur[ée]e|mousseline|flocons|f[ée]cule|farine|amidon|gratin|gnocchi|pr[ée]cuit|pr[êe]tes?|micro-ondes|surgel[ée]es?|congel[ée]es?|s[ée]ch[ée]es?)\b/i,
      /\b(assaisonn[ée]es?|aromatis[ée]es?|paprika|herbes|[ée]pices)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Bananas (bananes). Sold loose by kg or in 1 kg netted bags.
  // Carrefour stocks own-brand + Chiquita / Bonita branded. Excludes
  // dried / chips / baby / chocolate-coated and plantain variants.
  bananas_1kg: {
    query: "bananes",
    include: /\bbanan/i,
    exclude: [
      /\b(s[ée]ch[ée]es?|d[ée]shydrat[ée]es?|lyophilis[ée]es?|chips|cubes?|cookies?|biscuits?|smoothie|frapp[ée]|gel[ée]es?)\b/i,
      /\b(chocolat|cacao|enrob[ée]es?|caramel|aromatis[ée]es?|saveur|baby|b[ée]b[ée]|infant)\b/i,
      /\b(plantain|verte|rouge|pisang)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Apples (pommes). French cultivars: Golden, Gala, Granny Smith,
  // Pink Lady, Royal Gala, Fuji, Braeburn, Reinette. Cheapest 1 kg
  // pack wins. Critically excludes "pommes de terre" (potatoes) plus
  // processed apple products (jus, compote, cidre, vinaigre, tarte).
  apples_1kg: {
    query: "pommes",
    include: /\bpommes?\b/i,
    exclude: [
      /\bpommes?\s+de\s+terre\b/i,
      /\b(jus|boisson|compote|coulis|cidre|vinaigre|sirop|sauce|chutney|confiture|gel[ée]e)\b/i,
      /\b(s[ée]ch[ée]es?|chips|cubes?|biscuits?|tarte|crumble|strudel|chausson|beignet|p[âa]te|cake|muffin)\b/i,
      /\b(d'amour|d'or|chocolat|cacao|caramel|enrob[ée]es?|aromatis[ée]es?|d'eau|de pin|de douche)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Chicken breast (filet / blanc / escalope de poulet). Carrefour
  // ships chicken breast as `filet`, `blanc`, or `escalope de poulet`
  // in 300-650 g standard packs and 1 kg family packs. sizeRange
  // 800-1200 g catches the family pack. Smaller portion packs and
  // processed forms (nuggets, breaded, smoked, marinaded, kebab) are
  // rejected. Turkey / duck / pork / other birds also excluded.
  chicken_breast_1kg: {
    query: "filet de poulet",
    include: /\b(filets?|blancs?|escalopes?)\b.*\bpoulet\b|\bpoulet\b.*\b(filets?|blancs?|escalopes?)\b/i,
    exclude: [
      /\b(cuisses?|pilons?|ailes?|c(?:œ|oe)urs?|foies?|abats?|carcasses?)\b/i,
      /\b(nuggets?|saucisses?|wurstel|chair|hach[ée]e?s?|kebab|brochettes?|boulettes?|burgers?|hamburgers?|cordon bleu|farcies?|fourr[ée]es?)\b/i,
      /\b(marin[ée]e?s?|pan[ée]e?s?|fum[ée]e?s?|grill[ée]e?s?|r[ôo]tie?s?|cuite?s?|cuisin[ée]e?s?|pr[êe]te?s?|micro-ondes|surgel[ée]e?s?|congel[ée]e?s?|barbecue|bbq|tandoori|tikka)\b/i,
      /\b(dinde|canard|oie|caille|faisan|lapin|porc|veau|b(?:œ|oe)uf|agneau)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Ground beef (boeuf haché / viande hachée de boeuf / steak haché
  // pur boeuf). Carrefour stocks 5%, 15%, 20% fat percentages in
  // 350-500 g and 1 kg packs. sizeRange 800-1200 g catches the 1 kg
  // family pack. Mixed-meat (boeuf + porc), prepared (hamburger,
  // kofta), marinaded and ready-cook variants excluded.
  beef_ground_1kg: {
    query: "boeuf haché",
    include: /\bb(?:œ|oe)uf\b.*\bhach[ée]e?\b|\bhach[ée]e?\b.*\bb(?:œ|oe)uf\b|\bsteak hach[ée]\b/i,
    exclude: [
      /\b(porc|poulet|dinde|agneau|veau|cheval|cabri|mixte|m[ée]lang[ée]e?)\b/i,
      /\b(hamburgers?|burgers?|boulettes?|kofta|saucisses?|nuggets?|brochettes?|chapelure|cordon bleu|farcies?|fourr[ée]es?)\b/i,
      /\b(marin[ée]e?s?|fum[ée]e?s?|grill[ée]e?s?|r[ôo]tie?s?|cuite?s?|cuisin[ée]e?s?|pr[êe]te?s?|micro-ondes|surgel[ée]e?s?|congel[ée]e?s?|barbecue|bbq)\b/i,
      /\b(spaghetti|bolognaise|chili|cottage|hachis|parmentier|lasagne)\b/i,
    ],
    sizeRange: { min: 800, max: 1200 },
  },
  // Still bottled water (eau de source / eau minérale). French
  // mass-market brands: Cristaline (cheapest), Evian, Volvic, Vittel,
  // Contrex, Hépar, plus Carrefour-brand "Carrefour Source". Standard
  // 1.5 L PET bottle. Excludes sparkling (gazeuse / pétillante),
  // flavored, cosmetic (parfum, micellaire), infant, and household
  // (bain, douche, nettoyant) waters.
  //
  // Carrefour merchandises water as multi-packs by default (6 × 1.5 L
  // shrink-wraps dominate the PLP), so the sizeRange caps at 12 L to
  // catch 6 / 8 packs of 1.5 L bottles. normalize.ts rescales the
  // aggregate volume back to the 1.5 L canonical, so a 6-pack at EUR
  // 3.99 becomes EUR 0.665 per 1.5 L · within sanityRange.
  water_bottled_1500ml: {
    query: "eau de source",
    include: /\beau\b/i,
    exclude: [
      /\b(gazeuse|p[ée]tillante|gaz[ée]ifi[ée]|effervescente|finement gazeuse|tonic|p[ée]tillant|fines bulles)\b/i,
      /\b(aromatis[ée]e?|ar[ôo]me|saveur|citron|menthe|fruit|fraise|cocktail|sirop|th[ée])\b/i,
      /\b(cologne|parfum|cosm[ée]tique|micel(?:laire)?|bain|douche|shampoing|d[ée]tergent|nettoyant|d[ée]maquillant|tonique)\b/i,
      /\b(cuisson|sal[ée]e?|distill[ée]e?|d[ée]ionis[ée]e?|d[ée]min[ée]ralis[ée]e?)\b/i,
      /\b(b[ée]b[ée]|nourrissons?|infants?|formula|sevrage)\b/i,
      /\b(piscine|aquarium|d[ée]calcaire)\b/i,
    ],
    sizeRange: { min: 1200, max: 12000 },
  },
  // Imported beer (bière importée). Whitelist of mass-market
  // international brands stocked by Carrefour. Standard bottle / can
  // sizes: 25, 27.5, 33, 44, 50 cl. sizeRange 250-550 ml catches all,
  // normalize.ts rescales to per-500ml. Rejects non-alcoholic, radler /
  // shandy / panaché, and flavored variants.
  //
  // French domestic brands (Kronenbourg, 1664, Pelforth, Fischer,
  // Meteor) are commonly grouped with imported / international in FR
  // supermarkets and share the same shelf segment; Kronenbourg is
  // intentionally on the whitelist for consistency with Sainsbury's
  // and Conad. Cheapest international match wins.
  beer_imported_500ml: {
    query: "heineken",
    include: /\b(heineken|carlsberg|tuborg|stella artois|becks|budweiser|corona extra|leffe|hoegaarden|krombacher|paulaner|warsteiner|asahi|peroni|kronenbourg|guinness|grolsch|amstel|miller|estrella damm|san miguel|moretti|tyskie|zywiec|lech)\b/i,
    exclude: [
      /\b(sans alcool|alc-free|alcohol-free|0\.0\s*%|0\s*%|0,0\s*%|0 alcool|sans-alcool)\b/i,
      /\b(radler|shandy|panach[ée]|aromatis[ée]e?|saveur|cocktail|fruit[ée]e?)\b/i,
      /\b(light|l[ée]g[èe]re|low-alc|low alc)\b/i,
    ],
    sizeRange: { min: 250, max: 550 },
  },
};

export interface ParsedProduct {
  title: string;
  priceMajor: number;
  packSize: number;
  sourceUrl: string;
}

/**
 * Parse a size in grams, millilitres, or pieces from a product label.
 *
 * French label idioms:
 *   "Lait demi-écrémé UHT 1 L"     -> 1000 mL
 *   "Beurre doux 250 g"            -> 250 g
 *   "Sucre en poudre 1 kg"         -> 1000 g
 *   "Eau de source 1,5 L"          -> 1500 mL
 *   "12 oeufs frais bio"           -> 12 pieces
 *   "Heineken 33 cl"               -> 330 mL
 *   "Acheter 6x1l" (multi-pack)    -> 6000 mL (6 × 1 L)
 *   "Pommes Gala 1 kg"             -> 1000 g
 */
export function parseSize(text: string): number | null {
  // Multi-pack first ("6x1l", "4 x 500g", "2x33cl"). Carrefour's
  // search cards print the size as `Acheter {N}x{amount}{unit}` for
  // packs and `Acheter {amount}{unit}` for singles. The multi case
  // must be tried before the single-unit patterns or "6x1l" would
  // match as 1 L and the multi factor would be lost.
  let m = text.match(/\b(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(ml|cl|l|kg|g)\b/i);
  if (m) {
    const count = Number.parseInt(m[1]!, 10);
    const amount = Number.parseFloat(m[2]!.replace(",", "."));
    const unit = m[3]!.toLowerCase();
    const factor =
      unit === "ml"
        ? 1
        : unit === "cl"
          ? 10
          : unit === "l"
            ? 1000
            : unit === "kg"
              ? 1000
              : 1; // "g"
    return count * amount * factor;
  }

  // Piece counts (FR egg labels: "12 oeufs", "Boîte de 12",
  // "Pack de 10"). Tried before weight so "10 oeufs frais" doesn't
  // accidentally trip the grams regex via stray "10 g" further down.
  // The œ ligature ("œufs") and the ASCII transliteration ("oeufs")
  // are both common on Carrefour titles, hence the explicit
  // alternation rather than a character class that would swallow
  // "ufs" with the wrong prefix.
  m = text.match(/\b(\d+)\s*(?:œufs?|oeufs?)\b/i);
  if (m) return Number.parseInt(m[1]!, 10);
  m = text.match(/\b(?:bo[iî]te|pack|lot|paquet)\s+de\s+(\d+)\b/i);
  if (m) return Number.parseInt(m[1]!, 10);
  m = text.match(/\bx\s*(\d+)\b/i);
  if (m && /œuf|oeuf/i.test(text)) return Number.parseInt(m[1]!, 10);

  // mL (most specific)
  m = text.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  if (m) return Number.parseFloat(m[1]!.replace(",", "."));

  // cL (centilitres, common for beverages in France)
  m = text.match(/(\d+(?:[.,]\d+)?)\s*cl\b/i);
  if (m) return Number.parseFloat(m[1]!.replace(",", ".")) * 10;

  // L / litre / litres
  m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:litres?|L)\b/i);
  if (m) return Number.parseFloat(m[1]!.replace(",", ".")) * 1000;

  // kg
  m = text.match(/(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (m) return Number.parseFloat(m[1]!.replace(",", ".")) * 1000;

  // grams (least specific, last)
  m = text.match(/(\d+(?:[.,]\d+)?)\s*g\b/i);
  if (m) return Number.parseFloat(m[1]!.replace(",", "."));

  return null;
}

/**
 * Parse an EUR price (1,99 €, 12,34€, "1.99 €") from a label.
 *
 * Carrefour's PLP renders the price across multiple text nodes,
 * which collapse to `"1 ,10 €"` (integer, space, comma, decimal,
 * space, euro) once we read `Element.textContent`. We therefore
 * accept whitespace between every piece of the number too, not just
 * between the number and the euro sign. The decimal part is
 * always 1-2 digits (centimes).
 *
 * Limitation: a French thousands-separated price like "1 234,50 €"
 * would parse as 234.50, not 1234.50. Carrefour grocery items
 * cap below EUR 100, so this is acceptable for now. If we ever
 * scrape wine or premium goods, switch to a stricter parser.
 */
export function parsePrice(text: string): number | null {
  const m = text.match(/(\d+)(?:\s*[.,]\s*(\d{1,2}))?\s*€/);
  if (!m) return null;
  const integerPart = m[1]!;
  const rawDecimal = m[2];
  const decimalPart =
    rawDecimal === undefined
      ? "00"
      : rawDecimal.length === 1
        ? `${rawDecimal}0`
        : rawDecimal;
  return Number.parseFloat(`${integerPart}.${decimalPart}`);
}

/**
 * Extract product cards from rendered HTML using embedded JSON-LD.
 *
 * Used as a secondary path. Carrefour's PLP only embeds JSON-LD for
 * `WebSite` and `BreadcrumbList`, not `Product` blocks, so this
 * function returns an empty array on live FR search results. We
 * keep it for fixtures and for the edge case of a future retailer
 * variant that does embed Product LD.
 *
 * The primary extraction path lives in `scrapeOneSearch` and walks
 * the live DOM: anchor `<a href*="/p/">` is the seed, walk up to
 * the nearest ancestor whose textContent contains `€`, then parse
 * price + size from that card's textContent.
 *
 * Exported so future unit tests can feed in fixtures.
 */
export function parseProductsFromHtml(
  html: string,
  baseUrl = BASE,
): ParsedProduct[] {
  const out: ParsedProduct[] = [];

  const ldMatches = html.match(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  );
  if (!ldMatches) return out;

  for (const block of ldMatches) {
    const inner = block.replace(/<script[^>]*>|<\/script>/gi, "");
    try {
      const data = JSON.parse(inner) as unknown;
      const items = Array.isArray(data)
        ? data
        : typeof data === "object" && data !== null
          ? [data]
          : [];
      const flat: Array<Record<string, unknown>> = [];
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === "object") {
          const obj = n as Record<string, unknown>;
          flat.push(obj);
          for (const v of Object.values(obj)) walk(v);
        }
      };
      items.forEach(walk);
      for (const node of flat) {
        if (node["@type"] !== "Product") continue;
        const title = typeof node.name === "string" ? node.name : null;
        const offers = node.offers as Record<string, unknown> | undefined;
        const priceRaw =
          offers && typeof offers === "object"
            ? (offers as Record<string, unknown>).price
            : undefined;
        const price =
          typeof priceRaw === "string"
            ? Number.parseFloat(priceRaw.replace(",", "."))
            : typeof priceRaw === "number"
              ? priceRaw
              : null;
        const urlRaw = typeof node.url === "string" ? node.url : null;
        if (title && price !== null && Number.isFinite(price)) {
          const size = parseSize(title);
          if (size !== null) {
            out.push({
              title,
              priceMajor: price,
              packSize: size,
              sourceUrl: urlRaw ? new URL(urlRaw, baseUrl).toString() : baseUrl,
            });
          }
        }
      }
    } catch {
      // Non-JSON or malformed LD block, skip.
    }
  }

  return out;
}

function pickBestMatch(
  products: ParsedProduct[],
  picker: FrPicker,
): ParsedProduct | null {
  const candidates = products.filter((p) => {
    if (!picker.include.test(p.title)) return false;
    if (picker.exclude.some((rx) => rx.test(p.title))) return false;
    if (p.packSize < picker.sizeRange.min || p.packSize > picker.sizeRange.max)
      return false;
    return true;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.priceMajor - b.priceMajor);
  return candidates[0]!;
}

/**
 * Drive a remote chromium through a homepage warm + search navigation,
 * then extract product tiles via DOM queries inside the page context.
 *
 * Carrefour's PLP renders product tiles via React. The PLP does NOT
 * embed Product JSON-LD (only WebSite + BreadcrumbList), so we walk
 * the live DOM instead of parsing the HTML string. Each tile carries:
 *   - <a href="/p/{slug}-{ean}">       product link (sometimes 2-3 per card)
 *   - sibling text nodes with the title, price ("1 ,10 €"), and the
 *     size CTA ("Acheter 1l" or "Acheter 6x1l")
 *
 * Strategy: collect every `/p/` anchor, dedup by base href (strip
 * `?anchor=pdp-customers-reviews` review links), walk up to the
 * nearest ancestor whose textContent contains `€`, then return the
 * card's collapsed textContent. parsePrice + parseSize handle the
 * French quirks (thin-space numbers, multi-pack `6x1l`).
 */
async function scrapeOneSearch(
  browser: Browser,
  query: string,
): Promise<ParsedProduct[]> {
  const context =
    browser.contexts()[0] ?? (await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      locale: "fr-FR",
    }));
  const page = context.pages()[0] ?? (await context.newPage());

  // Warm cookies on the homepage so Akamai issues the bot-pass cookie
  // before our search request. Skip this and the very first /s?q= hit
  // tends to draw a 403.
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  const url = `${BASE}/s?q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  // Carrefour lazy-renders tiles after the search API responds. Poll
  // for any product anchor before reading, fall through on timeout so
  // the empty result is reported as a miss.
  await page
    .waitForFunction(
      () => document.querySelectorAll('a[href*="/p/"]').length > 0,
      { timeout: 15000 },
    )
    .catch(() => {
      // No tiles within 15 s, fall through to extract whatever DOM
      // returned. The empty result is reported as a miss upstream.
    });

  const rawCards = await page.evaluate(() => {
    interface RawCard {
      title: string;
      href: string;
    }
    const anchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/p/"]'),
    );
    const seen = new Set<string>();
    const out: RawCard[] = [];
    for (const a of anchors) {
      // Dedup on the base path. Carrefour emits up to 3 anchors per
      // card (title link, brand link, review-anchor link). Strip
      // ?anchor=... fragments so they collapse to one entry.
      const baseHref = a.href.split("?")[0]!.split("#")[0]!;
      if (seen.has(baseHref)) continue;
      seen.add(baseHref);
      let card: Element = a;
      for (let i = 0; i < 8; i++) {
        if ((card.textContent ?? "").includes("€")) break;
        if (!card.parentElement) break;
        card = card.parentElement;
      }
      const cardText = (card.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!cardText.includes("€")) continue;
      out.push({ title: cardText, href: baseHref });
    }
    return out;
  });

  const products: ParsedProduct[] = [];
  for (const raw of rawCards) {
    const priceMajor = parsePrice(raw.title);
    const packSize = parseSize(raw.title);
    if (priceMajor === null || packSize === null) continue;
    products.push({
      title: raw.title,
      priceMajor,
      packSize,
      sourceUrl: new URL(raw.href, BASE).toString(),
    });
  }
  return products;
}

/**
 * Live scrape, exported entry point. Requires BROWSER_USE_API_KEY.
 */
export async function scrapeCarrefourFr(): Promise<ScraperResult> {
  const targets = targetsForRetailer("carrefour-fr");
  const scrapedAt = new Date().toISOString();
  const scraped: ScrapedProduct[] = [];
  const misses: ScraperResult["misses"] = [];

  await withSession("fr", SESSION_TIMEOUT_MIN, async (session) => {
    if (!session.cdpUrl) {
      throw new Error("Browser Use session has no cdpUrl");
    }
    const browser = await chromium.connectOverCDP(session.cdpUrl);
    try {
      for (const target of targets) {
        const picker = PICKERS[target.slug];
        if (!picker) {
          misses.push({ target, reason: "no picker configured for this slug" });
          continue;
        }
        let parsed: ParsedProduct[];
        try {
          parsed = await scrapeOneSearch(browser, picker.query);
        } catch (e: unknown) {
          const reason = e instanceof Error ? e.message : String(e);
          misses.push({ target, reason: `fetch: ${reason}` });
          continue;
        }
        const match = pickBestMatch(parsed, picker);
        if (!match) {
          misses.push({
            target,
            reason: `no match for "${picker.query}" (${parsed.length} candidates parsed)`,
          });
          continue;
        }
        scraped.push({
          target,
          retailerSku: match.sourceUrl.split("/").pop() ?? match.title,
          retailerTitle: match.title,
          priceMajor: match.priceMajor,
          packSize: match.packSize,
          scrapedAt,
          sourceUrl: match.sourceUrl,
        });
      }
    } finally {
      await browser.close();
    }
  });

  return { retailer: "carrefour-fr", scraped, misses };
}
// @scraper: carrefour-fr
// @rate-limit: respect retailer crawl policy
// @retry: exponential backoff on fetch failure
// @todo: audit this for edge case handling
// @edge: what if the list is empty?
