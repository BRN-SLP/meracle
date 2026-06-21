/**
 * Auchan Poland scraper, via SSR `window.__INITIAL_STATE__` blob on
 * the public search page.
 *
 * Why this shape:
 *   - zakupy.auchan.pl is a React SPA with AWS WAF on the static
 *     bundle host, but the *search HTML* itself is server-rendered
 *     with a 1 MB Redux state JSON inlined inside a single
 *     `<script>window.__INITIAL_STATE__ = { ... }</script>` block.
 *   - That blob contains the full product catalog snapshot for the
 *     query: ordered product IDs, plus a productEntities dictionary
 *     with name, brand, size, price, unitPrice, categoryPath, and
 *     alcohol flag.
 *   - From EU egress, a plain `node:fetch` against `/search?q=<term>`
 *     returns 200 OK + the full SSR document with no proxy, no
 *     login, no captcha. No Browser Use Cloud needed for daily runs.
 *
 * State path of interest:
 *
 *   state.data.search.catalogue.data.productGroups[0].products
 *       -> ordered list of productId strings (search relevance)
 *
 *   state.data.products.productEntities[productId]
 *       -> { productId, retailerProductId, brand, name,
 *            size: { value: "0.4kg" | "1l" | ... },
 *            price: {
 *              current: { amount: "2.98", currency: "PLN" },
 *              unit?: {
 *                label: "fop.price.per.kg" | ".per.litre" | ".per.piece",
 *                current: { amount: "7.45", currency: "PLN" }
 *              }
 *            },
 *            available, alcohol, categoryPath: string[] }
 *
 * Pack-size parsing:
 *   - "1kg" / "0.4kg" / "1.5kg"        -> grams (multiply by 1000)
 *   - "500g" / "200g"                  -> grams
 *   - "1l" / "1L" / "1.5l"             -> millilitres
 *   - "500ml" / "330ml"                -> millilitres
 *   - "12szt" / "x12"                  -> pieces
 *   - "450g - 99999g" (loose produce)  -> NULL (rejected, range, not a pack)
 *
 * Picker shape mirrors `src/scrapers/migros-tr.ts`: include + exclude
 * regex pair, sizeRange, optional unitFromTitle to reject cross-unit
 * confusions. The picker is keyed by Mercato slug.
 */
import { z } from "zod";

import type { ProductTarget } from "../products.js";
import { targetsForRetailer } from "../products.js";
import type { ScrapedProduct, ScraperResult } from "../types.js";

const BASE = "https://zakupy.auchan.pl";
const FETCH_TIMEOUT_MS = 25_000;

// Plain desktop Chrome UA + Polish Accept-Language. Without `pl-PL`
// the SSR sometimes downgrades to a leaner template missing the
// catalogue blob. Referer makes the request indistinguishable from a
// natural search.
const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};

// Subset of the productEntities schema we depend on. The wire format
// carries dozens of fields (images, ad campaigns, promotions, badges)
// that the picker ignores.
const PriceLeafSchema = z.object({
  amount: z.string(),
  currency: z.string(),
});

const AuchanProductSchema = z.object({
  productId: z.string(),
  retailerProductId: z.string(),
  brand: z.string().optional().default(""),
  name: z.string(),
  size: z
    .object({
      value: z.string(),
    })
    .optional(),
  price: z.object({
    current: PriceLeafSchema,
    unit: z
      .object({
        label: z.string(),
        current: PriceLeafSchema,
      })
      .optional(),
  }),
  available: z.boolean().optional(),
  alcohol: z.boolean().optional(),
  categoryPath: z.array(z.string()).optional(),
});
export type AuchanProduct = z.infer<typeof AuchanProductSchema>;

interface PlPicker {
  /**
   * URL source for candidate products. Two modes:
   *
   *  - { type: "search", query }    -> /search?q=<query>
   *  - { type: "category", path }   -> /categories/<path>
   *
   * Fresh produce (bananas, apples, tomatoes, potatoes) is filed under
   * the loose-weight produce category and almost invisible to the
   * "/search" index, which heavily favours processed yogurts and
   * baby-food purees that share the noun stem. The category-page mode
   * targets the produce browse URL directly so we land on actual fresh
   * loose-weight SKUs.
   */
  source:
    | { type: "search"; query: string }
    | { type: "category"; path: string };
  /** Product name must match. */
  include: RegExp;
  /** Product name MUST NOT match. */
  exclude: readonly RegExp[];
  /** Pack size in target.unit (g or mL or pcs). */
  sizeRange: { min: number; max: number };
  /**
   * Required unit class parsed from size.value. Liquids vs solids must
   * not cross over (a 1 L "Sok Jabłkowy" juice must NOT be picked for
   * apples_1kg even though it matches the `jabłko` stem).
   */
  unitFromTitle?: ParsedUnit;
  /**
   * If true, accept candidates whose `alcohol` flag is true. Default
   * false (every non-beer slug must reject alcoholic SKUs, otherwise
   * "Whisky Jameson 700 ml" can land in the water picker).
   */
  allowAlcohol?: boolean;
}

// Auchan files all fresh fruit and vegetables (bananas, apples, fresh
// tomatoes, potatoes) under the same browse URL. We hit it once and
// share the parsed candidate list across the four produce pickers.
const FRESH_PRODUCE_PATH =
  "artyku%C5%82y-spo%C5%BCywcze/owoce-warzywa-i-zio%C5%82a/2134";

// Picker bank. Polish nouns inflect (genitive `mleka`, accusative
// `mleko`, plural `chlebów`), so the include regex anchors on the
// shortest stem that survives common case markers and uses Unicode
// boundary lookarounds. JavaScript `\b` is ASCII-only and would
// silently fail on `ł`, `ż`, `ć`, etc.
//
// Stems chosen by inspecting actual SSR catalogue dumps for each query,
// not from a Polish dictionary. The aim is the cheapest STAPLE: own-
// brand or mass-market 1-2 PLN/kg-tier item, not an organic / sparkling /
// premium variant.
const PICKERS: Partial<Record<ProductTarget["slug"], PlPicker>> = {
  // Whole UHT milk in 1 L cartons. Auchan ships own-brand
  // "Mleko UHT 3.2% Auchan 1 l" at ~3.28 PLN, plus Łaciate, Mlekovita,
  // Piątnica, Robico. Exclude flavoured, plant-based, baby formula,
  // cream, yogurt, kefir.
  milk_1l: {
    source: { type: "search", query: "mleko" },
    include: /(?<!\p{L})mleko/iu,
    exclude: [
      /(?<!\p{L})(?:roślinne|sojowe|owsiane|migdałowe|ryżowe|kokosowe|orzechowe)/iu,
      /(?<!\p{L})(?:kakao|czekolada|truskawka|wanilia|miód|kawa|cappuccino)/iu,
      /(?<!\p{L})(?:bez laktozy|laktozowolne|niemowlęc|junior|formula|początk|następ)/iu,
      /(?<!\p{L})(?:śmietan|śmietanka|jogurt|kefir|maślank|serek|twaróg|ser|krem|sernik)/iu,
      /(?<!\p{L})(?:zagęszczone|skondensowane|w proszku|sproszkowane|smakowe?)/iu,
      /(?<!\p{L})(?:budyń|pudding|deser|koktajl|drink|smoothie)/iu,
    ],
    sizeRange: { min: 800, max: 1100 },
    unitFromTitle: "ml",
  },
  // Sliced toast loaf. Auchan and Wasa own-brand "Chleb Tostowy" 500 g
  // is the staple; allow rye / wheat / mixed. Excludes flatbreads
  // (pita, tortilla, wrap), pastries, biscuits, croutons, breadsticks.
  bread_500g: {
    source: { type: "search", query: "chleb tostowy" },
    include: /(?<!\p{L})(?:chleb|tost(?:owy)?)/iu,
    exclude: [
      /(?<!\p{L})(?:pita|tortilla|wrap|naan|chapati|matza|lavash|placek|paczek|pączek)/iu,
      /(?<!\p{L})(?:bułka|bagietka|chałka|drożdż|brioche|focaccia|ciabatta)/iu,
      /(?<!\p{L})(?:bułka|biszkopt|herbatnik|krakers|paluszek|grissini|kruton|panko|sucharki)/iu,
      /(?<!\p{L})(?:keks|ciasto|babka|sernik|szarlotka|cinnamon|cynamon)/iu,
      /(?<!\p{L})(?:dżemowy|kanapk|hamburger|hot ?dog|bun|bułczana)/iu,
    ],
    sizeRange: { min: 250, max: 750 },
    unitFromTitle: "g",
  },
  // Fresh eggs in 10 / 12 / 15 / 30 packs. Auchan own-brand and
  // Fermy Drobiu Woźniak ship 10-packs at ~6 PLN. Excludes liquid
  // egg, powdered egg, quail/duck/goose, chocolate/easter eggs.
  // Auchan's search ranks "jajka" / "jaja" toward vegan substitutes
  // and chocolate Easter eggs over actual fresh eggs (a known quirk
  // of the personalised relevance model). The "jaja z wolnego
  // wybiegu" phrase forces the real fresh-egg products to the top:
  // Auchan own-brand and Pewni Dobrego 6 / 10 / 20 packs in M / L /
  // XL grades. Auchan encodes egg pack size as "10 na paczkę" in
  // size.value, not as "szt", which parseSize handles via the
  // `na paczkę` branch.
  eggs_12: {
    source: { type: "search", query: "jaja z wolnego wybiegu" },
    include: /(?<!\p{L})jaj(?:o|a|ka|ek|kami)/iu,
    exclude: [
      /(?<!\p{L})(?:przepiórcz|kacze|gęsi|strusi)/iu,
      /(?<!\p{L})(?:płynne|w proszku|suszone|białko|żółtko|liofiliz)/iu,
      /(?<!\p{L})(?:czekoladow|wielkanocn|świąt|niespodzia|zabawka)/iu,
      /(?<!\p{L})(?:majonez|pasta|gotowane|marynowane)/iu,
    ],
    sizeRange: { min: 6, max: 30 },
    unitFromTitle: "pcs",
  },
  // Butter in 200 / 250 / 300 g bricks. Polish staple "Masło Extra"
  // 82% fat. Excludes margarine, smalec (lard), ghee, flavoured /
  // herbed / spreadable variants, peanut butter, cocoa butter.
  butter_200g: {
    source: { type: "search", query: "masło" },
    include: /(?<!\p{L})masło/iu,
    exclude: [
      /(?<!\p{L})(?:margaryna|smalec|sadło|ghi|ghee|klarowane)/iu,
      /(?<!\p{L})(?:orzechow|arachidow|kakaow|migdałow|sezamow|kokosow|czekoladow)/iu,
      /(?<!\p{L})(?:smarowidł|smarowne|miks|miks ło|miksło|do smarowania)/iu,
      /(?<!\p{L})(?:czosnk|ziołow|aromat|pieprz|paprykow|cynamon|wanilia)/iu,
      /(?<!\p{L})(?:roślinn|wegańsk|wegański|wegan|laktoz)/iu,
    ],
    sizeRange: { min: 180, max: 320 },
    unitFromTitle: "g",
  },
  // White granulated sugar in 1 / 2 kg bags. Diamant, Krajowa Spółka
  // Cukrowa, Auchan own-brand. Excludes brown, cane, icing, vanilla,
  // sweetener substitutes (stevia, ksylitol, erytrytol).
  sugar_1kg: {
    source: { type: "search", query: "cukier" },
    include: /(?<!\p{L})cukier/iu,
    exclude: [
      /(?<!\p{L})(?:trzcinow|brązow|brunatn|muscovado|panela|kandyzowan|kostk|w kostkach)/iu,
      /(?<!\p{L})(?:puder|drobny|wanil|wanilin|cynamon|skórk)/iu,
      /(?<!\p{L})(?:stevia|stewia|ksylit|erytryt|aspartam|sacharyn|sukraloz|maltitol|izomalt)/iu,
      /(?<!\p{L})(?:słodzik|sweetener|zamiennik|dietetyczn|bezcukrow|bez cukru)/iu,
      /(?<!\p{L})(?:lukier|posypka|cukierek|krówk|fanta|żelk|bombon)/iu,
    ],
    sizeRange: { min: 800, max: 2200 },
    unitFromTitle: "g",
  },
  // White rice in 1 kg bags. Auchan own-brand "Ryż biały długi Auchan
  // 1 kg" 3.99 PLN is the staple. Allow Basmati, Jaśminowy, Parboiled,
  // długi, średnioziarnisty. Exclude rice flour, rice drinks, baby
  // food, ready-to-microwave, wraps and crackers.
  rice_1kg: {
    source: { type: "search", query: "ryż" },
    include: /(?<!\p{L})ryż/iu,
    exclude: [
      /(?<!\p{L})(?:mąka|napój|drink|sos|krem|sok|wafle|wafelki|chrupk|chrupin)/iu,
      /(?<!\p{L})(?:papier ryżow|sushi nori|nori)/iu,
      /(?<!\p{L})(?:gotowy|pronto|express|błyskaw|prepared|podgrzewan|gotowan|smażon)/iu,
      /(?<!\p{L})(?:papka|kasza|jaglana|gryczana|kuskus|bulgur|mannna|owsiana)/iu,
      /(?<!\p{L})(?:dla niemowlą|dla dzieci|baby|junior|kaszk)/iu,
      /(?<!\p{L})(?:ryżankow|przekąsk|chipsy|chipsów|cookie|ciastka)/iu,
    ],
    sizeRange: { min: 800, max: 2200 },
    unitFromTitle: "g",
  },
  // Fresh tomatoes per kg loose (Auchan sells "Pomidory Warzywa Auchan
  // na wagę ok. 500 g" with unit price 9.98 PLN/kg) and as 500 g
  // punnets. SSR encodes loose produce with a size RANGE ("450g -
  // 99999g") which our parser rejects, so the picker must accept the
  // packed-punnet form. Excludes canned, paste, sauce, dried,
  // confectionery, baby food.
  tomatoes_1kg: {
    source: { type: "category", path: FRESH_PRODUCE_PATH },
    include: /(?<!\p{L})pomidor/iu,
    exclude: [
      /(?<!\p{L})(?:passata|pasta|przecier|koncentr|puszka|w puszc|konserwow)/iu,
      /(?<!\p{L})(?:pulpa|pulpy|pulpie|pulp)/iu,
      /(?<!\p{L})(?:krojon|pocięt|w kawałk|w plast|w zalewi)/iu,
      /(?<!\p{L})(?:cebul|czosn|chili|bazyli|oregano|rozmaryn)/iu,
      /(?<!\p{L})(?:sok|sos|ketchup|keczup|zupa|krem|gulasz|leczo|salsa)/iu,
      /(?<!\p{L})(?:suszon|w occie|marynowan|kiszon|smażon)/iu,
      /(?<!\p{L})(?:papka|przekąsk|dżem|musztarda|pesto|tapenad)/iu,
    ],
    sizeRange: { min: 200, max: 1500 },
    unitFromTitle: "g",
  },
  // Fresh potatoes per kg loose, also 2.5 / 5 kg bags. Auchan own
  // varieties "Ziemniaki Młode" / "Ziemniaki na wagę". Excludes
  // frozen fries, crisps, sweet potato (batat), pancake mix.
  potatoes_1kg: {
    source: { type: "category", path: FRESH_PRODUCE_PATH },
    include: /(?<!\p{L})ziemniak/iu,
    exclude: [
      /(?<!\p{L})(?:batat|słodki|słodkie|sweet potato)/iu,
      /(?<!\p{L})(?:frytk|chips|chipsy|chipsów|smażone|prażon|krokiet|placuszk|placek|placki)/iu,
      /(?<!\p{L})(?:mrożon|mrożona|mrożone|gotowan|gotowe|przygotowan|pyzy|knedli|kluski)/iu,
      /(?<!\p{L})(?:purée|puree|płatki|błyskaw|express|prosz|w proszku)/iu,
      /(?<!\p{L})(?:obran|pokrojon|krojon|nadziewan|nadziewane)/iu,
    ],
    sizeRange: { min: 500, max: 6000 },
    unitFromTitle: "g",
  },
  // Extra-virgin olive oil in 0.5 / 1 L bottles. Carbonell, Borges,
  // Auchan own-brand, Monini, Costa d'Oro. Excludes seed oils
  // (rzepak, słonecznik, kukurydza, soja, sezam), aromatised, sprays,
  // cosmetic.
  olive_oil_1l: {
    source: { type: "search", query: "oliwa z oliwek" },
    include: /(?<!\p{L})oliw/iu,
    exclude: [
      /(?<!\p{L})(?:rzepak|słonecznik|kukurydz|soj|sezam|len|lnian|orzech|wiesiołek|pestk)/iu,
      /(?<!\p{L})(?:aromatyzowan|smakow|czosnk|trufl|chili|cytrynow|bazyli|rozmaryn|tymianek)/iu,
      /(?<!\p{L})(?:spray|aerozol|kosmetyk|kosmetyczn|krem|szampon|do skór|do ciała)/iu,
      /(?<!\p{L})(?:hummus|tapenad|pesto|sos|marynat|do sałat|sałatk|musztarda)/iu,
    ],
    sizeRange: { min: 400, max: 1200 },
    unitFromTitle: "ml",
  },
  // Still bottled water in 1.5 L PET. Cisowianka, Żywiec Zdrój,
  // Kropla Beskidu, Nałęczowianka, Muszynianka. Excludes sparkling
  // (gazowana), mineral high-sodium, flavoured, baby water, glass
  // bottles, cosmetic micellar water.
  water_bottled_1500ml: {
    source: { type: "search", query: "woda niegazowana" },
    include: /(?<!\p{L})wod/iu,
    exclude: [
      /(?<!\p{L})(?:gazowan|musując|musujące|mocno gaz|lekko gaz|nasycon|wzbogacona w co2)/iu,
      /(?<!\p{L})(?:smakow|aromat|owocow|cytryn|jabłko|truskawk|malina|mięt|herbat|cocktail|kola)/iu,
      /(?<!\p{L})(?:niemowlęc|dla dzieci|baby|junior|sterylna|sterylizowan)/iu,
      /(?<!\p{L})(?:micelarn|micelar|kosmetyczn|toaletow|do twarz|po golen)/iu,
      /(?<!\p{L})(?:destylowan|demineraliz|dejonizowan|gotowan|sterylna)/iu,
      /(?<!\p{L})(?:woda toaletowa|woda perfumowan|kolońska)/iu,
      // Tonic / energy / soda are not "woda" in our sense.
      /(?<!\p{L})(?:tonik|tonic|cola|cocktail|enerf|red bull|napój|isotonic|izotonik)/iu,
    ],
    sizeRange: { min: 1000, max: 6000 },
    unitFromTitle: "ml",
  },
  // Bananas per kg loose. Auchan sells "Banany Auchan na wagę" with a
  // size range; the packed 1 kg bunches are the parser-friendly form.
  // Exclude dried bananas, banana chips, smoothies, baby puree,
  // chocolate-coated, dessert products.
  bananas_1kg: {
    // Auchan's `/search?q=banany` returns only banana-flavoured yogurts
    // and baby-food purees; the real loose-weight banana SKUs are
    // category-bound. Hit the produce browse URL instead.
    source: { type: "category", path: FRESH_PRODUCE_PATH },
    include: /(?<!\p{L})banan/iu,
    exclude: [
      /(?<!\p{L})(?:suszon|liofiliz|chips|chipsy|chipsów|prażon|kandyzowan)/iu,
      /(?<!\p{L})mus(?!\p{L})/iu,
      /(?<!\p{L})(?:smoothie|sok|nektar|przecier|musem|w czekoladzie|czekoladow)/iu,
      /(?<!\p{L})(?:pure|puree|babci|baby|junior|dla dzieci|niemowlęc|deser)/iu,
      /(?<!\p{L})(?:aromat|smakow|jogurt|napój|drink|koktajl|musi|wafelki)/iu,
      /(?<!\p{L})(?:actimel|fantasia|protein|kefir|maślank|śmietan)/iu,
      /(?<!\p{L})(?:truskawk|malina|wiśni|mango|kiwi|jabłko|gruszk)/iu,
      /(?<!\p{L})(?:ciasto|babka|tort|babk|brownie|szarlotka|sernik|deserowy)/iu,
    ],
    sizeRange: { min: 200, max: 3000 },
    unitFromTitle: "g",
  },
  // Apples per kg loose. Auchan sells "Jabłka deserowe Auchan" by the
  // kg. Allow gala, golden, jonagold, ligol, champion, idared, red
  // delicious, granny smith. Exclude apple juice, dried, vinegar,
  // mus / puree, baby food, candy, snack bars.
  apples_1kg: {
    source: { type: "category", path: FRESH_PRODUCE_PATH },
    include: /(?<!\p{L})jabł(?:ko|ka)/iu,
    exclude: [
      /(?<!\p{L})(?:sok|nektar|kompot|syrop|wino)/iu,
      /(?<!\p{L})(?:ocet|octowy|jabłeczn)/iu,
      /(?<!\p{L})(?:suszon|liofiliz|chips|chipsy|chipsów|kandyzowan|prażon)/iu,
      /(?<!\p{L})(?:mus|musem|musi|przecier|pure|puree|babci|baby|junior|dla dzieci|niemowlęc)/iu,
      /(?<!\p{L})(?:szarlotka|ciasto|placek|sernik|babk|cynamon|strudel|tart|tarteleta)/iu,
      /(?<!\p{L})(?:cukierek|żelk|gum|bonbon|cukier|miód jabłk)/iu,
      /(?<!\p{L})(?:aromat|smakow|napój|drink|koktajl|cydr|cider)/iu,
    ],
    sizeRange: { min: 200, max: 3000 },
    unitFromTitle: "g",
  },
  // Chicken breast fillet in 400 / 500 / 800 / 1000 g packs. Auchan
  // own, Drosed, Indykpol, Konspol. Exclude wings, drumsticks, whole
  // birds, sausages, nuggets, kabanos, marinated, frozen.
  chicken_breast_1kg: {
    source: { type: "search", query: "filet z kurczaka" },
    include:
      /(?<!\p{L})(?:filet|pierś)[^.]*(?<!\p{L})(?:z\s+kurczaka|kurczak|kurczęc)/iu,
    exclude: [
      /(?<!\p{L})(?:skrzydeł|nogi|udo|udziec|podudzi|kawałk|porcja|tuszka|kurczak cały)/iu,
      /(?<!\p{L})(?:nugget|naggets|kotlet|kotlety|panierow|panierce|chrupiąc|crispy|burger|sosis|kabanos|salami|szynk)/iu,
      /(?<!\p{L})(?:marynowan|grillow|wędzon|pieczon|gotowan|smażon|prażon|sushi)/iu,
      /(?<!\p{L})(?:mrożon|frozen|zamrażon)/iu,
      /(?<!\p{L})(?:indyk|kacz|gęsi|przepiórc|woło|wieprz|jagnięc)/iu,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Ground beef in 400 / 500 g trays. Include needs "wołow|wołowin"
  // AND "mielon". Exclude pork (wieprzow), turkey (indyk), chicken,
  // mixed meat, sausages, ready-meals, frozen-prepared dishes.
  beef_ground_1kg: {
    source: { type: "search", query: "wołowina mielona" },
    // Either order: "Wołowina mielona Auchan" OR "Mielona wołowina Auchan".
    // Polish title-case for fresh meat varies between producers.
    include:
      /(?:(?<!\p{L})wołow[a-ząęłńóśź]*[^.]*?(?<!\p{L})mielon|(?<!\p{L})mielon[a-ząęłńóśź]*[^.]*?(?<!\p{L})wołow)/iu,
    exclude: [
      /(?<!\p{L})(?:wieprz|kurczak|indyk|kacz|jagnięc|cielęc|jagnię|baranin)/iu,
      /(?<!\p{L})(?:kotlet|burger|pulpet|klopsy|hamburger|mieszana|miks|wieprzowo|wieprzowo-wołow)/iu,
      /(?<!\p{L})(?:kabanos|kiełbasa|salami|salam|szynk|parówk|wędlina|sosis|pasztet|pasztetow)/iu,
      /(?<!\p{L})(?:gotowan|pieczon|grillow|smażon|prażon|prażone|marynowan|wędzon)/iu,
      /(?<!\p{L})(?:mrożon|frozen|gotowy|pronto|w sosie|w puszc|konserw)/iu,
    ],
    sizeRange: { min: 300, max: 1500 },
    unitFromTitle: "g",
  },
  // Hard cheese 200 / 400 / 500 g blocks. Polish staple is gouda,
  // edam, salami, podlaski, tylżycki, ementaler, parmezan; Auchan
  // own-brand ser żółty 500 g is the cheapest. Excludes processed
  // (topione, plastry serowe), white brined (feta, mozzarella), fresh
  // (mascarpone, ricotta, twaróg, twarożek), spread, slices for
  // burgers, with herbs / spices.
  cheese_local_500g: {
    source: { type: "search", query: "ser żółty" },
    include:
      /(?<!\p{L})(?:gouda|edam|podlask|tylż|tylzyc|gourmet ser|ser żółty|ementaler|emmental|parmezan|parmesan|gruyere|mozzarella tw|cheddar|maasdam|salami)/iu,
    exclude: [
      /(?<!\p{L})(?:topion|seropłat|plastr|plaster|plasterk|w plastrach|w plastr|krojony|na kanapk|toast|do toast)/iu,
      /(?<!\p{L})(?:tarty|tartych|do pizz|pizza)/iu,
      /(?<!\p{L})(?:twaróg|twarożek|twarogow|kozi|owczy|ricotta|mascarpone|krem|kremowy|labne|fet|feta|halloumi|burrata)/iu,
      /(?<!\p{L})(?:śmietank|smetana|jogurt|kefir|maślank)/iu,
      /(?<!\p{L})(?:czosnk|ziołow|chili|pieprz|papryczk|kminek|trufl|orzech|cynamon|wino)/iu,
      /(?<!\p{L})(?:wegan|wegańsk|wegański|roślinn|bezlaktoz)/iu,
    ],
    sizeRange: { min: 150, max: 800 },
    unitFromTitle: "g",
  },
  // Imported beer 330 / 500 ml bottles or cans. Heineken, Carlsberg,
  // Tuborg, Corona, Becks, Stella, Krombacher, Pilsner, Guinness.
  // Excludes alcohol-free / radler / cocktail / sangria / aperitif
  // styles, beer glasses / openers, multipack packaging vehicles.
  beer_imported_500ml: {
    source: { type: "search", query: "piwo" },
    include:
      /(?<!\p{L})(?:heineken|carlsberg|tuborg|stella|becks|budweiser|corona|leffe|hoegaarden|krombacher|paulaner|warsteiner|asahi|peroni|kronenbourg|guinness|grolsch|miller|amstel|desperados|pilsner urquell)/iu,
    exclude: [
      /(?<!\p{L})(?:bezalkoholow|0\.0|0%|nieal|n\/a|alcohol-free|0,0)/iu,
      /(?<!\p{L})(?:radler|shandy|cydr|cider|wino|whisky|wódka|gin|rum|aperit|likier|sangria)/iu,
      /(?<!\p{L})(?:szklank|kufel|otwiera|akcesori|gadżet|opakowan|prezent|set|zestaw|pakiet)/iu,
      /(?<!\p{L})(?:syrop|sirop|aromat|smakow|nektar)/iu,
    ],
    sizeRange: { min: 250, max: 600 },
    unitFromTitle: "ml",
    allowAlcohol: true,
  },
};

/**
 * Parse Auchan's `size.value` format into our canonical pack size.
 *
 * Examples:
 *   "1kg"          -> 1000 g
 *   "0.4kg"        -> 400 g
 *   "500g"         -> 500 g
 *   "1l"           -> 1000 mL
 *   "1.5L"         -> 1500 mL
 *   "500ml"        -> 500 mL
 *   "12szt"        -> 12 pcs
 *   "450g - 999g"  -> null (loose-produce range, not a fixed pack)
 *
 * Exported for unit tests.
 */
export type ParsedUnit = "ml" | "g" | "pcs";

export function parseSize(sizeValue: string): { value: number; unit: ParsedUnit } | null {
  // Reject loose-produce ranges (e.g. "450g - 99999g"). Auchan encodes
  // weight-priced fresh produce this way and the per-unit price model
  // would mis-weight them.
  if (sizeValue.includes("-") || sizeValue.includes("–")) return null;

  const s = sizeValue.trim();
  // "0.4kg", "1kg", "1.5kg"
  const kg = s.match(/^(\d+(?:[,.]\d+)?)\s*kg$/i);
  if (kg) {
    const v = parseFloat(kg[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 100)
      return { value: Math.round(v * 1000), unit: "g" };
  }
  // "500g", "200g"
  const g = s.match(/^(\d+(?:[,.]\d+)?)\s*g$/i);
  if (g) {
    const v = parseFloat(g[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0) return { value: Math.round(v), unit: "g" };
  }
  // "1l", "1.5L"
  const l = s.match(/^(\d+(?:[,.]\d+)?)\s*l$/i);
  if (l) {
    const v = parseFloat(l[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 50)
      return { value: Math.round(v * 1000), unit: "ml" };
  }
  // "500ml", "330ml"
  const ml = s.match(/^(\d+(?:[,.]\d+)?)\s*ml$/i);
  if (ml) {
    const v = parseFloat(ml[1]!.replace(",", "."));
    if (Number.isFinite(v) && v > 0) return { value: Math.round(v), unit: "ml" };
  }
  // "12szt", "12 szt", "10 sztuk", "10 na paczkę" (Auchan's encoding for
  // multi-pack eggs and yogurt cups).
  const szt =
    s.match(/^(\d+(?:[,.]\d+)?)\s*sztuk?$/i) ||
    s.match(/^(\d+)\s*szt$/i) ||
    s.match(/^(\d+)\s*na\s+paczk/i);
  if (szt) {
    const v = parseInt(szt[1]!, 10);
    if (Number.isFinite(v) && v > 0 && v < 200) return { value: v, unit: "pcs" };
  }
  return null;
}

interface ParsedProduct {
  productId: string;
  retailerProductId: string;
  title: string;
  brand: string;
  priceMajor: number;
  packSize: number;
  packUnit: ParsedUnit;
  available: boolean;
  alcohol: boolean;
  sourceUrl: string;
}

/**
 * Loose-weight fresh produce ships with `size.value` as a bare number
 * (e.g. "1.2" or "1") and the canonical pack size encoded in
 * `price.unit.label` (e.g. "fop.price.per.kg"). The bare-number form
 * never reaches parseSize because there's no unit suffix; this fallback
 * promotes the price.unit.label into the unit field.
 */
function parseSizeWithUnitFallback(p: AuchanProduct): { value: number; unit: ParsedUnit } | null {
  if (!p.size?.value) return null;
  const direct = parseSize(p.size.value);
  if (direct) return direct;

  const bareNum = p.size.value.trim().match(/^(\d+(?:[,.]\d+)?)$/);
  if (!bareNum) return null;
  const n = parseFloat(bareNum[1]!.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;

  const unitLabel = p.price.unit?.label ?? "";
  if (/per\.?kg/i.test(unitLabel)) {
    if (n < 100) return { value: Math.round(n * 1000), unit: "g" };
  }
  if (/per\.?litre|per\.?liter/i.test(unitLabel)) {
    if (n < 50) return { value: Math.round(n * 1000), unit: "ml" };
  }
  if (/per\.?piece|per\.?szt/i.test(unitLabel) || /per\.?pack/i.test(unitLabel)) {
    if (n < 200) return { value: Math.round(n), unit: "pcs" };
  }
  return null;
}

/**
 * Convert one productEntities entry into the picker's working shape.
 * Returns null when the entry has no parseable size or no valid price
 * (Auchan ships out-of-stock items with current.amount of "0.00").
 *
 * Exported for unit tests.
 */
export function parseProduct(p: AuchanProduct): ParsedProduct | null {
  const size = parseSizeWithUnitFallback(p);
  if (size === null) return null;
  const priceMajor = parseFloat(p.price.current.amount.replace(",", "."));
  if (!Number.isFinite(priceMajor) || priceMajor <= 0) return null;
  return {
    productId: p.productId,
    retailerProductId: p.retailerProductId,
    title: p.name,
    brand: p.brand ?? "",
    priceMajor,
    packSize: size.value,
    packUnit: size.unit,
    available: p.available ?? true,
    alcohol: p.alcohol ?? false,
    sourceUrl: `${BASE}/products/${p.retailerProductId}`,
  };
}

/**
 * Extract the SSR'd `window.__INITIAL_STATE__` JSON blob from a
 * search HTML document. Walks the balanced braces from the first `{`
 * after the assignment, respecting string literals. Returns null when
 * the marker isn't present or the JSON fails to parse.
 *
 * Exported for unit tests.
 */
export function extractInitialState(html: string): unknown {
  const idx = html.indexOf("window.__INITIAL_STATE__");
  if (idx < 0) return null;
  const start = html.indexOf("{", idx);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (c === "\\") {
        esc = true;
      } else if (c === '"') {
        inStr = false;
      }
    } else {
      if (c === '"') {
        inStr = true;
      } else if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
  }
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(start, end));
  } catch {
    return null;
  }
}

/**
 * Decode the SSR'd Auchan search page into an ordered list of parsed
 * products. The order preserves search relevance (the SSR returns its
 * own `personalized` ranking inside `productGroups[0].products`),
 * which the picker uses as a soft tiebreaker after the per-unit price
 * sort.
 *
 * Exported for unit tests.
 */
export function parseSearchHtml(html: string): ParsedProduct[] {
  const state = extractInitialState(html);
  if (state === null || typeof state !== "object") return [];
  const root = state as Record<string, unknown>;
  const data = (root.data as Record<string, unknown> | undefined) ?? {};
  const products = (data.products as Record<string, unknown> | undefined) ?? {};
  const entities = (products.productEntities as Record<string, unknown> | undefined) ?? {};

  // Search and category pages use different productGroups paths.
  //   - /search?q=...   -> state.data.search.catalogue.data.productGroups
  //   - /categories/... -> state.data.products.catalogue.data.productGroups
  // Try both and concatenate; the first non-empty wins because both
  // populate the same productEntities dictionary, so ordering matters
  // only for tie-breaking.
  const groupsFromSearch = (() => {
    const search = (data.search as Record<string, unknown> | undefined) ?? {};
    const catalogue = (search.catalogue as Record<string, unknown> | undefined) ?? {};
    const cd = (catalogue.data as Record<string, unknown> | undefined) ?? {};
    return (cd.productGroups as unknown[] | undefined) ?? [];
  })();
  const groupsFromCategory = (() => {
    const catalogue = (products.catalogue as Record<string, unknown> | undefined) ?? {};
    const cd = (catalogue.data as Record<string, unknown> | undefined) ?? {};
    return (cd.productGroups as unknown[] | undefined) ?? [];
  })();
  const groups = groupsFromSearch.length > 0 ? groupsFromSearch : groupsFromCategory;

  // Build ordered list of productIds from groups[].products[]. Each
  // group contributes its own ordering.
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    if (!g || typeof g !== "object") continue;
    const gp = (g as Record<string, unknown>).products;
    if (!Array.isArray(gp)) continue;
    for (const pid of gp) {
      if (typeof pid === "string" && !seen.has(pid)) {
        seen.add(pid);
        orderedIds.push(pid);
      }
    }
  }

  // Some category pages return an empty productGroups for an
  // unauthenticated session but still populate productEntities (the
  // initial-page-load hydration writes both stores). Fall back to
  // enumerating every entity directly so we don't drop the candidates.
  if (orderedIds.length === 0) {
    for (const pid of Object.keys(entities)) {
      orderedIds.push(pid);
    }
  }

  const out: ParsedProduct[] = [];
  for (const pid of orderedIds) {
    const raw = entities[pid];
    if (!raw || typeof raw !== "object") continue;
    const parsed = AuchanProductSchema.safeParse(raw);
    if (!parsed.success) continue;
    const pp = parseProduct(parsed.data);
    if (pp) out.push(pp);
  }
  return out;
}

function pickBestMatch(
  products: ParsedProduct[],
  picker: PlPicker,
): ParsedProduct | null {
  const candidates = products.filter((p) => {
    if (!p.available) return false;
    if (p.alcohol && !picker.allowAlcohol) return false;
    if (!picker.include.test(p.title)) return false;
    if (picker.exclude.some((rx) => rx.test(p.title))) return false;
    if (picker.unitFromTitle && p.packUnit !== picker.unitFromTitle) return false;
    if (p.packSize < picker.sizeRange.min || p.packSize > picker.sizeRange.max)
      return false;
    return true;
  });
  if (candidates.length === 0) return null;
  // Sort by per-canonical-unit price so multi-kg bags compete fairly
  // with single-unit items inside the same sizeRange.
  candidates.sort((a, b) => a.priceMajor / a.packSize - b.priceMajor / b.packSize);
  return candidates[0]!;
}

function urlForSource(source: PlPicker["source"]): string {
  if (source.type === "search") {
    return `${BASE}/search?q=${encodeURIComponent(source.query)}`;
  }
  return `${BASE}/categories/${source.path}`;
}

/**
 * Fetch one SSR HTML page (either a search URL or a category URL) and
 * return the parsed candidate list. Returns empty array on any
 * non-2xx, parse error, or timeout (caller treats as "no candidates").
 *
 * Exported for unit tests via the fetchImpl seam. The shape mirrors
 * the migros-tr scraper for parity.
 */
export async function fetchQueryProducts(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedProduct[]> {
  return fetchFromSource({ type: "search", query }, fetchImpl);
}

export async function fetchFromSource(
  source: PlPicker["source"],
  fetchImpl: typeof fetch = fetch,
): Promise<ParsedProduct[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(urlForSource(source), {
      headers: REQUEST_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseSearchHtml(html);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Live scrape, exported entry point. Pure HTTP, no Browser Use Cloud.
 *
 * Distinct source URLs are fetched only once; the four fresh-produce
 * slugs share a single fetch of the produce category page.
 */
export async function scrapeAuchanPl(
  fetchImpl: typeof fetch = fetch,
): Promise<ScraperResult> {
  const targets = targetsForRetailer("auchan-pl");
  const scrapedAt = new Date().toISOString();
  const scraped: ScrapedProduct[] = [];
  const misses: ScraperResult["misses"] = [];

  const cache = new Map<string, ParsedProduct[]>();

  for (const target of targets) {
    const picker = PICKERS[target.slug];
    if (!picker) {
      misses.push({ target, reason: "no picker configured for this slug" });
      continue;
    }
    const cacheKey = urlForSource(picker.source);
    let candidates = cache.get(cacheKey);
    if (!candidates) {
      try {
        candidates = await fetchFromSource(picker.source, fetchImpl);
      } catch (e: unknown) {
        const reason = e instanceof Error ? e.message : String(e);
        misses.push({ target, reason: `fetch: ${reason}` });
        continue;
      }
      cache.set(cacheKey, candidates);
    }
    if (candidates.length === 0) {
      const label =
        picker.source.type === "search"
          ? `"${picker.source.query}"`
          : `/categories/${picker.source.path}`;
      misses.push({
        target,
        reason: `auchan returned no parseable candidates for ${label}`,
      });
      continue;
    }
    const match = pickBestMatch(candidates, picker);
    if (!match) {
      const label =
        picker.source.type === "search"
          ? `"${picker.source.query}"`
          : `/categories/${picker.source.path}`;
      misses.push({
        target,
        reason: `no match for ${label} (${candidates.length} parsed candidates)`,
      });
      continue;
    }
    scraped.push({
      target,
      retailerSku: match.retailerProductId,
      retailerTitle: match.title,
      priceMajor: match.priceMajor,
      packSize: match.packSize,
      scrapedAt,
      sourceUrl: match.sourceUrl,
    });
  }

  return { retailer: "auchan-pl", scraped, misses };
}
// @scraper: auchan-pl
// @rate-limit: respect retailer crawl policy
// @perf: lazy load this component
// @cleanup: remove legacy fallback path
// @a11y: ensure keyboard navigation works
// @a11y: focus management on route change
