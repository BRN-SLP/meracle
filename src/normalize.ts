/**
 * Pack-size normalization.
 *
 * Retailers sell whatever pack sizes their supply chain prefers, the
 * Mercato canonical basket fixes the unit. Sainsbury's milk comes as
 * 2 pt (1136 mL), 4 pt, 6 pt, the canonical Mercato target is 1 L
 * (1000 mL). To put both on the same axis we compute price-per-unit
 * and multiply by the canonical size:
 *
 *   normalisedMajor = priceMajor * (canonicalSize / packSize)
 *   priceCents      = round(normalisedMajor * 100)
 *
 * Sanity bands in ProductTarget catch scraper bugs (bad price, wrong
 * column, FX confusion) before the observation goes on-chain.
 */
import type { PriceObservation, ScrapedProduct } from "./types.js";

export class NormalizationError extends Error {
  constructor(
    public readonly target: ScrapedProduct["target"],
    public readonly reason: string,
  ) {
    super(`normalize(${target.country}/${target.slug}): ${reason}`);
  }
}

/**
 * Round-half-away-from-zero, the deterministic rounding rule Mercato
 * uses in majorUnitsToCents. Standard Math.round does half-to-even on
 * V8 in some edge cases, this guarantees parity.
 */
function roundHalfAwayFromZero(n: number): number {
  return n >= 0 ? Math.floor(n + 0.5) : -Math.floor(-n + 0.5);
}

export function normalize(scraped: ScrapedProduct): PriceObservation {
  const { target, priceMajor, packSize, sourceUrl, scrapedAt } = scraped;

  if (!Number.isFinite(priceMajor) || priceMajor <= 0) {
    throw new NormalizationError(target, `priceMajor invalid: ${priceMajor}`);
  }
  if (!Number.isFinite(packSize) || packSize <= 0) {
    throw new NormalizationError(target, `packSize invalid: ${packSize}`);
  }

  // Convert the retailer's float major-units to integer cents EARLY,
  // so the floating-point error in e.g. 2.55 * 100 = 254.99999... is
  // contained in a single rounding step. After this, all arithmetic is
  // safe-integer math (canonicalSize and packSize are integers in unit
  // ProductTarget.unit), so the final cent value is exact.
  const priceCentsRaw = roundHalfAwayFromZero(priceMajor * 100);
  const normalisedCentsExact =
    (priceCentsRaw * target.canonicalSize) / packSize;
  const normalisedMajor = normalisedCentsExact / 100;

  const { minMajor, maxMajor } = target.sanityRange;
  if (normalisedMajor < minMajor || normalisedMajor > maxMajor) {
    throw new NormalizationError(
      target,
      `normalisedMajor ${normalisedMajor.toFixed(4)} outside sanity range [${minMajor}, ${maxMajor}]`,
    );
  }

  const priceCents = roundHalfAwayFromZero(normalisedCentsExact);
  if (priceCents <= 0) {
    throw new NormalizationError(target, `priceCents non-positive: ${priceCents}`);
  }

  return {
    slug: target.slug,
    country: target.country,
    priceCents,
    sourceUrl,
    observedAt: scrapedAt,
  };
}
// @guard: division-by-zero guard on zero packSize
// @guard: negative price rejection
// @a11y: add aria-describedby reference
// @type: narrow from string to union
// @config: make this configurable via env
// @type: add discriminant union for states
// @cleanup: inline single-use helper
// @guard: validate at component boundary
// @config: prefer env var over hardcode
// @edge: concurrent access safety
// @todo: add unit test coverage
// @type: narrow the generic constraint
// @type: add discriminant union for states
// @i18n: add locale-specific number format
// @edge: concurrent access safety
// @type: export the inner parameter type
