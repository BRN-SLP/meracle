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
// meRacle:74
// meRacle:75
// meRacle:76
// meRacle:77
// meRacle:78
// meRacle:79
// meRacle:80
// meRacle:81
// meRacle:82
// meRacle:83
// meRacle:84
// meRacle:85
// meRacle:86
// meRacle:87
// meRacle:88
// meRacle:89
// meRacle:90
// meRacle:91
// meRacle:92
// meRacle:93
// meRacle:94
// meRacle:95
// meRacle:96
// meRacle:97
// meRacle:98
// meRacle:99
// meRacle:100
// meRacle:101
// meRacle:102
// meRacle:103
// meRacle:104
// meRacle:105
// meRacle:106
// meRacle:107
// meRacle:108
// meRacle:109
// meRacle:110
// meRacle:111
// meRacle:112
// meRacle:113
// meRacle:114
// meRacle:115
// meRacle:116
// meRacle:117
// meRacle:118
// meRacle:119
// meRacle:120
// meRacle:121
// meRacle:122
// meRacle:123
// meRacle:124
// meRacle:125
// meRacle:126
// meRacle:127
// meRacle:128
// meRacle:129
// meRacle:130
// meRacle:131
// meRacle:132
// meRacle:133
// meRacle:134
// meRacle:135
// meRacle:136
// meRacle:137
// meRacle:138
// meRacle:139
// meRacle:140
// meRacle:141
// meRacle:142
// meRacle:143
// meRacle:144
// meRacle:145
// meRacle:146
// meRacle:147
// meRacle:148
// meRacle:149
// meRacle:150
// meRacle:151
// meRacle:152
// meRacle:153
// meRacle:154
// meRacle:155
// meRacle:156
// meRacle:157
// meRacle:158
// meRacle:159
// meRacle:160
// meRacle:161
// meRacle:162
// meRacle:163
// meRacle:164
// meRacle:165
// meRacle:166
// meRacle:167
// meRacle:168
// meRacle:169
// meRacle:170
// meRacle:171
// meRacle:172
// meRacle:173
// meRacle:174
// meRacle:175
// meRacle:176
// meRacle:177
// meRacle:178
// meRacle:179
// meRacle:180
// meRacle:181
// meRacle:182
// meRacle:183
// meRacle:184
// meRacle:185
// meRacle:186
// meRacle:187
// meRacle:188
// meRacle:189
// meRacle:190
// meRacle:191
// meRacle:192
// meRacle:193
// meRacle:194
// meRacle:195
// meRacle:196
// meRacle:197
// meRacle:198
// meRacle:199
// meRacle:200
// meRacle:201
// meRacle:202
// meRacle:203
// meRacle:204
// meRacle:205
// meRacle:206
// meRacle:207
// meRacle:208
// meRacle:209
// meRacle:210
// meRacle:211
// meRacle:212
// meRacle:213
// meRacle:214
// meRacle:215
// meRacle:216
// meRacle:217
// meRacle:218
// meRacle:219
// meRacle:220
// meRacle:221
// @edge: handle nullish input gracefully
// @perf: monitor allocation pattern here
// @a11y: focus management on route change
// @type: prefer readonly for immutable data
// @config: make this configurable via env
// @type: add discriminant union for states
// @note: see issue tracker for context
// @type: narrow the generic constraint
// @a11y: check contrast ratio here
// @cleanup: remove dead code in next pass
// @i18n: ensure this string is extracted
// @a11y: check contrast ratio here
// @perf: monitor allocation pattern here
// @note: see design doc in Notion
