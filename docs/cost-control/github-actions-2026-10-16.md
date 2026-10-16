# GitHub Actions cost control — 2026-10-16

## Observed facts (read-only audit)

Source: GitHub Billing usageReport export for 2026-10-01 through 2026-10-16.

| Metric | Amount |
| --- | ---: |
| Account gross metered Actions usage | $47.745952 |
| Account billed amount in the export | $0 |
| Runner usage | 7,106 Linux minutes (gross $42.636) |
| Artifact storage | 15,207.288836 GB-hours (gross $5.109952) |
| Bid artifact storage | 14,835.247128 GB-hours (~97.55% of storage GB-hours) |

GitHub actions_storage is measured in GB-hours accrued over time, not GB stored at this instant. On 2026-10-15, Bid recorded ~985.78 GB-hours, equivalent to ~41.07 GB average storage across that complete day. Net billed in the CSV is zero; future charges depend on billing settings and usage.

Sampled workflow-run artifacts in 1bidprice/Bid:
- Standalone release APKs named exactly investor-control-standalone-release-apk: approximately 30–32 MB each.
- Several copies were created in rapid succession in September and October, with expiry dates up to January 2027, reflecting 90-day retention. Verified runs include 37344375422, 37342011372, 37155053578 and 36143618220.
- Other workflows are NOT targeted by cleanup: Investor Control Production Intelligence v2 keeps artifacts 30 days and Investor Control Prospective V2 Runtime 90 days.
- The standalone APK build workflow itself was NOT present in the current main branch workflow directory at the time of audit. Revalidate before changing build scheduling.

## Safe plan and boundaries

1. Keep application sources, GitHub branches, releases, PRs, Play signing, databases, and production feeds untouched.
2. Proposed workflow .github/workflows/cost-control-artifact-audit.yml remains in a separate branch and draft PR. It runs only by manual workflow_dispatch, defaults to audit, and NEVER deletes in audit mode.
3. Only artifacts named exactly investor-control-standalone-release-apk may be selected for future deletion. Protect the newest 10 copies and every copy less than 7 days old. Limit a single explicitly approved deletion execution to 100 copies. The workflow logs candidate IDs, sizes, and dates.
4. Before any deletion, review the audit output and verify that no old APK is required for testing, rollback, or release distribution. Adjust safeguards first if needed.
5. Deletion is irreversible. It frees current capacity, but does NOT erase GB-hours already accrued. GitHub billing storage usage can have reporting delay.
6. Do not merge, execute deletion, edit production workflows, change plans, or incur costs without explicit user approval.

## Verification after a separate merge approval

- Run Actions > Cost Control - Audit old standalone APK artifacts > Run workflow, selecting operation=audit.
- Review count, protected set, and eligible size against required APK availability.
- Only with separate cleanup approval, select operation=delete and enter the precise phrase DELETE_OLD_APK_ARTIFACTS.
- Re-check Actions storage and billing after GitHub updates its reporting.

No APK, artifact, production file, database, or existing GitHub workflow has been deleted by this audit.
