# Deferred retailers · DE and PL

`src/products.ts` carries 16 catalog entries each for `rewe-de` and
`biedronka-pl`, but no scraper modules ship for those slots. This doc
captures why and what the next pass would tackle.

## Live coverage (5 / 7 countries)

| Country | Retailer | Approach | Status |
|---|---|---|---|
| UA | Novus | zakaz.ua public API | live |
| GB | Sainsbury's | Browser Use Cloud, JSON-LD + anchor | live |
| ES | Mercadona | tienda.mercadona.es public API | live |
| IT | Conad | Browser Use Cloud, `data-product` JSON | live |
| FR | Carrefour | Browser Use Cloud, DOM walk + JSON-LD | live |
| DE | Rewe | (deferred) | scaffold not shipped |
| PL | Biedronka | (deferred, no online shop exists) | scaffold not shipped |

## Why the two slots are deferred

### DE · Rewe online sets prices per delivery store

Rewe's online shop (`shop.rewe.de`) shows the literal text
`Konkreter Preis abhängig vom Standort` ("price depends on
location") on every search result before a delivery postcode is set.
The product cards include `"price":"unknown"` JSON until a store is
selected.

Setting the postcode requires a multi-step UI dance:

1. Dismiss a **Usercentrics** consent overlay that intercepts every
   pointer event on the search page
2. Open the **Standort wählen** modal (its trigger is not a clickable
   button in the DOM, only a text node next to the unknown price)
3. Fill the postcode input (e.g. `10115` for Berlin Mitte)
4. Wait for the city / store autocomplete to populate
5. Click the suggested market
6. Toggle Lieferservice (delivery) mode
7. Then navigate to the search URL and prices appear

The submit button remained `disabled` even after filling the postcode
field directly · the autocomplete + city click is mandatory. This is
roughly four extra UI assertions per session, much more fragile than
the other five retailers, and any Rewe consent or modal redesign
breaks the scraper.

Probe alternatives that were ruled out:

- **Kaufland (kaufland.de)** · is a general-merchandise marketplace
  (Mähroboter / Staubsauger / E Bike), not a grocery online shop.
  Search for `milch` returns the same 15 homepage carousel items.
- **Knuspr.de** (Schwarz Group) · nationwide-uniform but only delivers
  in Munich / Frankfurt / Berlin / Düsseldorf / Hamburg, and we would
  still need to probe the consent + delivery flow.

### PL · category-wide anti-scraping defences

The Polish grocery ecosystem is materially more hostile than DE:

- **Biedronka (biedronka.pl)** · has no online shop. The site only
  hosts weekly flyers (gazetka) and store-locator. No PLP exists to
  scrape.
- **Carrefour PL (carrefour.pl)** · Next.js + Material-UI SPA gated by
  a **OneTrust** consent overlay plus a **Cloudflare Turnstile**
  mid-session challenge. The Browser Use Cloud probe returned 0
  product anchors even after the CF challenge cookie was issued; the
  consent overlay blocks SPA hydration.
- **Auchan PL (auchan.pl)** · Vue SPA, no bot protection per curl
  (200 OK from a local IP). Browser Use Cloud sessions failed with
  `ERR_TUNNEL_CONNECTION_FAILED` from both `de` and `us` proxies, so
  Auchan blocks proxy IPs at the network layer before any browser-
  fingerprint check.
- **Frisco.pl** · React SPA with `new-product-box-placeholder`
  placeholder cards in the SSR shell; products only land after
  hydration via the same React tree as Carrefour PL.

Browser Use Cloud also does not currently expose a `pl` proxy code
(supported set: `uk us de fr es it nl se ie`), so PL geo-spoofing is
not available · the closest neighbours are `de` and `nl`.

## What a future pass would tackle

The deferred work is plausible engineering but each step is novel
relative to the existing five scrapers:

1. **Generic consent-dismissal helper** in `src/browseruse.ts` that
   recognises Usercentrics and OneTrust shells and clicks the accept
   button before page operations begin. This unblocks any future
   retailer behind either platform.
2. **`rewe-de` scraper** that uses the helper, opens the Standort
   modal, runs the postcode → autocomplete → city-click → mode-select
   flow once at session start, then runs the 16 queries normally.
   Berlin `10115` is a reasonable default sample.
3. **`carrefour-pl` scraper** that uses the helper plus retries the
   CF Turnstile challenge if it reappears mid-session.

Until those land, the two catalog slots stay populated but score zero
observations per daily cron run, and the batch pipeline silently
moves on.

## Catalog stability

`Retailer = "novus-ua" | "sainsburys-uk" | "mercadona-es" |
"biedronka-pl" | "rewe-de" | "carrefour-fr" | "conad-it"` stays as-is.
Adding a new PL or DE scraper later is a single-file change in
`src/scrapers/` plus wiring in `scripts/submit-batch.ts`; the catalog
union and the 32 affected `PRODUCT_TARGETS` rows do not move.
