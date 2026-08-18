# Investor Control v1.8.0 — v1819 History Session Alignment Checkpoint

Date: 2026-08-12

## Purpose

v1819 hardens secondary daily-history validation so an older Yahoo history candle cannot be accepted merely because its price happens to be within the current quote tolerance.

Before v1819, when the latest company history date did not equal the current quote date, the validator compared that history close with `previousClose` without proving both represented the same completed market session. This could let a stale series pass if the stale close happened to be within the 5% US / 8% Athens price tolerance.

v1819 does **not** widen price tolerances. It adds a session-alignment prerequisite using the same-market benchmark daily history as a completed-session witness.

## Verified code boundary

Source head:

`c0e314bcb11365152520fb6cdc7e17d38f880d0a`

Runtime release:

`1.8.0`

Patch chain:

- 68 unique test patches
- 67 unique build patches
- final patch: `apply-v1819-history-session-alignment.js`

PR #14 remained open, draft and unmerged.

## New validation rule

For secondary daily history:

1. derive the latest company-history session date,
2. derive the latest completed benchmark-history session date,
3. if the company series is behind the benchmark, fail closed with `HISTORY_LAGS_BENCHMARK_SESSION`,
4. if it is ahead, fail closed with `HISTORY_AHEAD_OF_BENCHMARK_SESSION`,
5. do not perform a price-deviation comparison while sessions are mismatched,
6. only when company and benchmark histories are aligned may the existing quote cross-check run,
7. when the aligned completed session predates the current quote date, compare the history close with `previousClose`; when it is the current quote date, compare with `currentPrice`.

No tolerance was relaxed.

## Regression coverage

New regressions verify:

- a company series one completed session behind the benchmark is blocked even when the stale close is numerically identical to the quote reference,
- a large current-session price move does not falsely invalidate history when company and benchmark histories share the same last completed session and the historical close matches `previousClose`.

## CI verification

Market Intelligence workflow run:

`31611907400`

Job:

`94165070161`

Result:

**418 / 418 PASS — 0 FAIL**

The two v1819 session-alignment regressions passed.

The initial v1819 run had one legacy static manifest assertion that still expected v1818 to be the final patch. That failure was test-only; both new v1819 regressions were already passing. The assertion was updated to require v1818 to remain in the chain while v1819 is the final patch. No production logic changed in that correction.

## Mobile / Android exact-head verification

Mobile workflow run:

`31611907367`

Result: **SUCCESS**

Standalone Android workflow run:

`31611907363`

Result: **SUCCESS**

The v1819 slice is backend market-history validation only and did not change portfolio, transaction ledger, accounting storage, mobile UI, factor weights or final-action policy.

## Production verification

Production workflow run:

`31603311503`

v1819 attempt job:

`94165862916`

Result: **SUCCESS end-to-end**

Passed:

- deterministic source tests,
- autonomous intelligence build,
- strict production safety,
- Opportunity Hunter safety,
- forecast archive safety,
- transactional publication,
- remote published-feed verification.

Live publication source commit:

`c0e314bcb11365152520fb6cdc7e17d38f880d0a`

`staleOutput: false`

## Live operational finding

After v1819, the live feed reported:

- analysed companies: 32
- historical metric sets: 32
- history-ready sets: 17
- history coverage ratio: 0.5313
- market-data status: `DEGRADED`
- overall status: `DEGRADED`
- stale output: false

This was not a v1819 production failure. The stricter validation exposed a real freshness problem in the Yahoo daily-history fallback.

The 15 blocked instruments were:

- SPCE
- PLTR
- LEGH
- WHD
- ESNT
- JXN
- CRGY
- PR
- CRON
- INSW
- LPG
- NMIH
- VCTR
- POWW
- TWLO

For all 15:

- latest company daily history: 2026-08-10
- latest SPY benchmark daily history: 2026-08-11
- current quote date: 2026-08-12
- v1819 reason: `HISTORY_LAGS_BENCHMARK_SESSION`
- price deviation was intentionally not calculated.

Other US histories that already contained 2026-08-11 passed normally. Athens histories were also aligned with their same-market benchmark in that run.

## POWW root-cause clarification

Before v1819, POWW had been blocked as `PRICE_DEVIATION_EXCEEDED` because its 2026-08-10 history close was compared with the 2026-08-11 `previousClose`. v1819 correctly reclassified the problem as session lag rather than price disagreement.

The fix therefore improves both safety and diagnostics.

## Next bounded recovery step

The correct next action is **not** to relax the 5%/8% price tolerance or to synthesize a missing candle from `previousClose`.

A separate recovery layer may attempt a bounded recent-history refresh when a Yahoo long series lags the same-market benchmark. Any refreshed recent series must:

- cover the missing completed session,
- overlap the existing long history on multiple completed sessions,
- agree on raw closes within a strict tolerance,
- merge without rewriting old historical observations,
- remain secondary/research market data,
- fail closed if overlap or freshness validation fails.

Until that recovery is independently verified, lagging histories remain blocked.
