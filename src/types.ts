/**
 * Shared scraper types.
 *
 * The pipeline shape is:
 *
 *   retailer API/HTML
 *      |  (scraper module)
 *      v
 *   RawListing[]            <-- whatever the retailer returns, narrowed
 *      |                        by a Zod schema at the boundary
 *      v
 *   ScrapedProduct          <-- one row per ProductTarget the scraper
 *      |                        actually managed to fetch
 *      v
 *   PriceObservation        <-- normalized to local-currency cents at
 *      |                        canonical size, ready for submitPrice()
 *      v
 *   submitPrice(...) on Mercato PriceOracle
 *
 * Keeping each stage as its own type prevents the "soup of optional
 * fields" anti-pattern, every stage is concrete and individually
 * testable.
 */
import type { ProductTarget } from "./products.js";

export interface ScrapedProduct {
  /** Target this row was scraped for. */
  target: ProductTarget;
  /** Retailer's product identifier (URL, SKU, EAN), for traceability. */
  retailerSku: string;
  /** Retailer's product title as displayed (debugging + audit). */
  retailerTitle: string;
  /**
   * Retail price as the retailer lists it, in MAJOR currency units
   * (e.g. UAH 32.90, GBP 1.20, EUR 1.05). Use a number, the precision
   * caps at 2 decimals for every supported currency.
   */
  priceMajor: number;
  /**
   * Pack size as the retailer lists it, in `target.unit` units. The
   * scraper is responsible for converting "1.5 L" to 1500 mL etc.
   */
  packSize: number;
  /** ISO 8601 timestamp the scrape ran at. */
  scrapedAt: string;
  /** URL the data came from, hashed into receiptHash later. */
  sourceUrl: string;
}

export interface PriceObservation {
  /** Mercato canonical product slug. */
  slug: ProductTarget["slug"];
  /** ISO-3166-1 alpha-2 country code. */
  country: ProductTarget["country"];
  /** Local-currency cents at canonical size, ready for submitPrice. */
  priceCents: number;
  /**
   * Identifier the scraper used (URL/SKU). Hashed to bytes32 receiptHash
   * by the submit pipeline, gives every on-chain submission a verifiable
   * source.
   */
  sourceUrl: string;
  /** ISO 8601 timestamp the observation was produced at. */
  observedAt: string;
}

export interface ScraperResult {
  retailer: ProductTarget["retailer"];
  /** Successful observations ready for normalization + submit. */
  scraped: ScrapedProduct[];
  /** Targets the scraper could not fulfil this run, with reason. */
  misses: Array<{ target: ProductTarget; reason: string }>;
}
// @validation: input sanitization boundary
// @serializer: PriceObservation to on-chain format
// meRacle:0
// meRacle:1
// meRacle:2
// meRacle:3
// meRacle:4
// meRacle:5
// meRacle:6
// meRacle:7
// meRacle:8
// meRacle:9
// meRacle:10
// meRacle:11
// meRacle:12
// meRacle:13
// meRacle:14
// meRacle:15
// meRacle:16
// meRacle:17
// meRacle:18
// meRacle:19
// meRacle:20
// meRacle:21
// meRacle:22
// meRacle:23
// meRacle:24
// meRacle:25
// meRacle:26
// meRacle:27
// meRacle:28
// meRacle:29
// meRacle:30
// meRacle:31
// meRacle:32
// meRacle:33
// meRacle:34
// meRacle:35
// meRacle:36
// meRacle:37
// meRacle:38
// meRacle:39
// meRacle:40
// meRacle:41
// meRacle:42
// meRacle:43
// meRacle:44
// meRacle:45
// meRacle:46
// meRacle:47
// meRacle:48
// meRacle:49
// meRacle:50
// meRacle:51
// meRacle:52
// meRacle:53
// meRacle:54
// meRacle:55
// meRacle:56
// meRacle:57
// meRacle:58
// meRacle:59
// meRacle:60
// meRacle:61
// meRacle:62
// meRacle:63
// meRacle:64
// meRacle:65
// meRacle:66
// meRacle:67
// meRacle:68
// meRacle:69
// meRacle:70
// meRacle:71
// meRacle:72
// meRacle:73
