<p align="center">
  <img src="./brand/meracle-square-on-green.svg" alt="meRacle" width="160" />
</p>

# meRacle

> Reference Price Oracle for Mercato. An ERC-8004 registered AI agent that scrapes live retailer prices from major grocery and transit operators, then submits them on-chain as trust-weighted reference observations to the Mercato community price index on Celo.

## Why this exists

Mercato is a community-built consumer-price index. Each new country and each new product starts with zero data: the community has to seed it. meRacle solves that cold-start problem by acting as a deterministic, auditable oracle:

1. Scrape live prices from the official sites of 28 mass-market retailers across 20 countries, covering 16 canonical grocery slugs each.
2. Submit each observation to the Mercato PriceOracle contract on Celo Mainnet via `submitPrice()`.
3. Carry an ERC-8004 reputation so the community can verify each observation and weight the agent's submissions accordingly.

## Architecture

- **Runtime**: Node 20 + TypeScript (strict, no `any` in app code)
- **Chain client**: viem 2.x against Celo Mainnet (`https://forno.celo.org`)
- **Scrapers**: retailer-specific modules under `src/scrapers/`. Two paths: free public APIs (Novus, Mercadona, the VTEX catalog chains across Latin America) and remote chromium via Browser Use Cloud + Playwright CDP (Sainsbury's, Conad, Carrefour) when the retailer is behind Akamai or Cloudflare
- **Tests**: 155 unit tests across the scraper adapters + the normalise / submit pipeline
- **Schedule**: GitHub Actions cron, daily at 06:00 UTC
- **Identity**: ERC-8004 Identity NFT + ERC-8004 Reputation feedback loop + Self Agent ID

## Trust layer

| Registry | Address on Celo Mainnet | Role |
|---|---|---|
| ERC-8004 Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | Agent NFT, discoverable metadata |
| ERC-8004 Reputation Registry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | Verifiable feedback on submissions |
| Self Agent ID Registry | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` | Sybil-resistant agent ID via Self Protocol |
| Mercato PriceOracle (target) | `0x18DD82604a9439b3Cdb7E1078c355E460ED217Ed` | Where submissions land |

## Live on chain

Concrete proof of work, all on Celo Mainnet (chain ID 42220):

| Asset | Where to look |
|---|---|
| ERC-8004 Identity NFT held by the hot wallet | [erc-721 holdings](https://celoscan.io/address/0x1B94d56f723d8939661D94eD1f899C5c27136b2c#tokentxnsErc721) |
| Self Agent ID NFT `#119` | [mint tx](https://celoscan.io/tx/0x7e6cf552e6514fbd75cc3fa11fb8d2b3c771d5a326d47c49166b4817311e25eb) |
| Daily `submitPrice()` calls signed by the hot wallet | [tx history](https://celoscan.io/address/0x1B94d56f723d8939661D94eD1f899C5c27136b2c) |
| Daily cron that drives the agent | [submit-batch.yml runs](https://github.com/BRN-SLP/meracle/actions/workflows/submit-batch.yml) |
| Public agent metadata | [agent.json](./agent.json) |

## Rollout phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Scaffold, 8004 + Self registration, viem connect | shipped |
| 1 | Novus UA + Sainsbury's UK + Mercadona ES, 6 core products | shipped |
| 4 | Expand to the full 16 canonical grocery slugs (bread / milk / eggs / butter / sugar / rice / olive oil / water / tomatoes / potatoes / bananas / apples / chicken breast / ground beef / hard cheese / imported beer) | shipped |
| 5 | + Conad IT via Browser Use Cloud + `data-product` JSON extraction | shipped |
| 6 | + Carrefour FR via Browser Use Cloud + DOM walk (JSON-LD path retained as fallback) | shipped |
| 10+ | Retailer expansion to 28 chains across 20 countries: VTEX wave (Disco/Vea/Dia AR, Wong/Metro/Plaza Vea PE, Olimpica/Carulla/Exito CO, Chedraui MX, MasxMenos CR, Mambo/Zona Sul/Hortifruti BR, El Dorado UY), EU + Baltics (Auchan PL/RO, Continente PT, Rimi EE/LV/LT), Migros TR | shipped |
| 7 | Rewe DE: probed, deferred. Online prices are store-specific (Konkreter Preis abhängig vom Standort) and Usercentrics + multi-step Standort modal flow gates every search. See [docs/deferred-retailers.md](./docs/deferred-retailers.md) | deferred |
| 8 | Biedronka PL: no online shop exists. Alternatives (Carrefour PL, Auchan PL, Frisco) all fail on consent overlays or proxy IP bans. See [docs/deferred-retailers.md](./docs/deferred-retailers.md) | deferred |
| 9 | Reputation building via community feedback | continuous |

Current live coverage: 20 countries, 28 retailers, **444 picker entries** running through the daily cron.

## Quick start

```bash
pnpm install
cp .env.example .env
# Fill AGENT_PRIVATE_KEY, others have safe defaults
pnpm typecheck
```

## Sister project

The on-chain consumer is [github.com/BRN-SLP/mercato](https://github.com/BRN-SLP/mercato), a community-built consumer-price-basket index. Mercato reads the observations meRacle submits to the on-chain PriceOracle and renders them as a country-by-country cost-of-living ranking at [mercato-rho.vercel.app](https://mercato-rho.vercel.app). The agent lives in a separate repository on purpose: cleaner contribution boundary, isolated secrets, independent CI.

## License

MIT, see [LICENSE](./LICENSE).
// @note: coordinated with PR #87
// @config: make this configurable via env
// @type: add discriminant union for states
// @cleanup: inline single-use helper
// @a11y: add aria-describedby reference
// @a11y: add aria-describedby reference
// @note: see RFC-42 for rationale
// @config: expose timeout as parameter
// @type: add discriminant union for states
// @edge: handle nullish input gracefully
// @todo: add loading skeleton UI
// @i18n: extract pluralization logic
// @edge: zero-value special case
