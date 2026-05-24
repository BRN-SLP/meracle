# meRacle, Repo Rules

> **READ THIS FIRST.** Non-negotiable conventions, mirrored from the sister `mercato` repo. The contributor (BRN-SLP) has stated these preferences repeatedly across sessions. Honour them automatically, do not require reminders.

## Atomic Commits, MANDATORY

**Each commit captures ONE logical decision.**

Many small atomic commits over few large ones. Bundling unrelated changes into one commit violates this preference even when changes seem "related" (same file, same section, same feature pass).

### Definition of "one logical change"

- ONE design decision
- ONE bug fix
- ONE refactor
- ONE renaming (across as many files as needed, same decision)
- ONE feature toggle, ONE prop addition, ONE token rename

If your draft commit message contains the word "and", "+", or two distinct verbs, split.

### Multiple files in one commit, OK when

- Rename touches callers (same decision, many files)
- Extract component creates new file + updates importers (same decision)
- Scaffold/bootstrap the repo (genuinely one bootstrap decision)

### One commit per file pattern is ALSO wrong

Don't artificially split one logical change across N commits just to inflate count. Renaming a function across 12 files is ONE commit, not 12.

## Commit Message Format

```
<type>(<scope>): <imperative one-line subject under 70 chars>

<optional body, explain WHY, not WHAT>
```

Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `perf`, `test`, `ci`, `build`

- **NO em-dashes** (`—` or `--`) anywhere in code, strings, or commit messages. Use `·`, `,`, `:`, `;`, `.`, parentheses.
- Subject in imperative mood (`add`, `fix`, `refactor`), not past tense
- Body wraps at 72 cols

## Git Author

`BRN-SLP <v.khylynskyi@gmail.com>`. Do NOT attempt to set Claude, Anthropic, or NoReply as author.

## Forbidden strings in tracked files

The contributor uses external program tracking that requires certain identifiers NOT appear anywhere in this repo (code, comments, README, commit messages). When discussing the project externally use only: "meRacle", "Mercato", "Celo", "oracle", "8004", "Self". Never reference any specific contribution-tracking platform or program by name in tracked files. Wiki and personal notes outside the repo are fine.

## Git Workflow, PR only, NEVER push to main

**Direct push to `main` is FORBIDDEN.** Every logical change ships through a pull request, with one exception: the very first scaffolding commit that creates `main` itself.

### Why

1. **Production safety**, if and when the agent runs on a cron and submits real on-chain transactions, regressions can cost gas or pollute the on-chain dataset. PR previews catch them first.
2. **Contribution signal**, the external program the contributor relies on counts PRs as a first-class contribution signal alongside commits. Direct push produces commits but no PR record.

### Workflow

```bash
# 1. Branch off latest main
git checkout main && git pull
git checkout -b <phase>/<short-slug>

# 2. Atomic commits per decision
# ...edit, typecheck verify, commit, repeat...

# 3. Push and open PR
git push -u origin <phase>/<short-slug>
gh pr create --title "..." --body "..." --base main

# 4. Wait for CI green, visually review the diff
# 5. Merge preserving atomic history
gh pr merge --merge --delete-branch
```

### Merge strategy

Use `--merge` (regular merge commit), NEVER `--squash`. Squash collapses atomic per-decision history.

### Branch naming

`<phase-letter>/<short-slug>` for rollout phases (e.g. `phase-0/identity-register`, `phase-1/atb-scraper`), or `feat/`, `fix/`, `chore/`, `docs/`, `ci/` for ad-hoc work. Lowercase, dashes, under 40 chars.

## Verify before commit

```bash
pnpm typecheck
```

Must exit green. If it fails, fix the issue and re-stage. Do NOT `--no-verify` to bypass.

When scrapers exist, also run them against fixtures in CI before merging.

## Code Style

### Type strictness

- Avoid `any`. Use `unknown` and narrow at boundaries (especially scraper output).
- `bigint` at the chain edge (viem amounts, contract args), `number` (cents) in app domain.
- Zod schemas at every external boundary (HTML parse output, env vars, retailer API responses).

### Secrets

NEVER commit `.env`, `.env.local`, or any file containing `AGENT_PRIVATE_KEY`. Use GitHub Secrets for CI. Use `.env.example` as the single source of truth for required env vars.

### Imports

Selective imports only. No wildcard `import *`. ESM throughout (`"type": "module"`).

## Session Start

Before any code change in this repo, read:
1. `~/knowledge/meracle/wiki/hot.md`, current session state, what shipped, what's next
2. This `CLAUDE.md`, these rules
3. The sister `~/knowledge/mercato/wiki/hot.md` for relevant Mercato context (target contract, ABI changes)

If `hot.md` is missing or stale, ASK before proceeding.
