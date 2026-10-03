# MINBEIS Screenshot QA — v1.8.3 field review

Review date: 2026-10-03
Source: real-device screenshots supplied by the product owner.
Target remediation release: v1.8.4 build 36.

## PASS — core product behavior visible in screenshots

- Portfolio restored and visible with 3/3 pricing coverage.
- Aggregate portfolio value, total cost and P/L are internally consistent with displayed position values.
- Transaction accounting distinguishes order price, average execution price, fees and all-in cost.
- Allwyn accounting correction is visible and auditable.
- USD position keeps native-currency accounting while EUR aggregate uses conversion.
- Euronext Athens delayed/timestamp limitations are disclosed.
- Unverified daily change fails closed instead of inventing a number.
- CALM incomplete research correctly blocks final action and lists missing checks.
- Local privacy/storage state is visible and backup/export controls exist.
- Historical analogs are explicitly marked as research context, not prediction.
- No broker execution is presented as occurring automatically.

## P0/P1 issues found and remediated in v1.8.4

### 1. Portfolio history range honesty
Observed:
1W and 1Y could display the same two-day history without explaining the limited coverage.

Risk:
A user or funder could believe one year of history exists.

Fix:
Selected range now shows a partial-coverage notice when available data do not span the requested period.

### 2. P/L contribution wording
Observed:
The position contribution chart described total unrealised P/L as "today's" P/L.

Risk:
Semantically wrong financial information.

Fix:
Copy now states that bars represent each position's share of total unrealised portfolio P/L, not daily change or prediction.

### 3. "Fully automated operation"
Observed:
System status displayed "Πλήρης αυτοματοποιημένη λειτουργία".

Risk:
Conflicts with actual human-controlled decision design and could be read as autonomous investment execution.

Fix:
Replaced with "Πλήρης ροή δεδομένων και ελέγχων" and explicit statement that investment action remains with the user.

### 4. Engine-ready vs provisional positions
Observed:
System engine showed ready while individual positions still displayed provisional/confirmation-required states.

Risk:
Looks contradictory.

Fix:
System copy now explains that the evaluation engine can be available while individual positions/ideas remain provisional or blocked.

### 5. New-idea reasoning used holder language
Observed:
A new idea could display text about supporting "holding an existing position".

Risk:
Direct logical/copy inconsistency.

Fix:
New-idea clarity now uses non-holder-specific reason text based on SETUP/TRAP/NO_TRADE/CONFIRMATION_REQUIRED state.

### 6. False precision in 100/100 confidence display
Observed:
Cards displayed "Εμπιστοσύνη 100 · Δεδομένα 100" and final cards showed 100/100.

Risk:
Implies unjustified statistical certainty.

Fix:
User-facing display now uses qualitative bands (Υψηλή / Καλή / Μέτρια / Χαμηλή). Raw numeric scores remain internal/technical data.

### 7. "ΠΙΘΑΝΗ ΠΑΓΙΔΑ" wording
Observed:
Research classification could say "ΠΙΘΑΝΗ ΠΑΓΙΔΑ" while final user action was ordinary monitoring.

Risk:
Sensational and semantically awkward when combined with a neutral final action.

Fix:
User-facing label changed to "ΑΥΞΗΜΕΝΟΣ ΚΙΝΔΥΝΟΣ"; scan summary/count label changed accordingly.

### 8. Engineering jargon leaked into retail UI
Observed:
Phrases such as "canonical entry gates" and "canonical αξιολόγηση" appeared in user-facing explanations.

Risk:
Unprofessional and difficult for retail users.

Fix:
Position clarity text is now routed through the existing user-facing translation layer.

### 9. Settings row overflow
Observed:
Long values such as US data-source status and concentration-alert status were clipped horizontally.

Fix:
Review rows now wrap/flex correctly on narrow Android screens.

### 10. US quote source wording
Observed:
A closed-market Finnhub value could be labelled "τιμή αγοράς" while the card headline said "τιμή κλεισίματος".

Fix:
Source wording now distinguishes last verified close vs last available price.

### 11. Decision-overlay summary labels
Observed:
Home summary said positions need attention while Decision Control showed "Προσοχή 0", because those counters represented plan-status categories, not MINBEIS attention.

Risk:
Looks contradictory.

Fix:
Counters renamed to "Πλάνα πλήρη", "Πλάνα με προειδοποίηση", and "Νέα αγορά μπλοκαρισμένη".

## OPEN UX work after v1.8.4

These are not accounting/data-corruption blockers, but should be improved before a polished sponsor demo:

- MINBEIS screen is still vertically dense and technical for a first-time user.
- Advanced system diagnostics/source-policy details should remain collapsed by default and may need a separate expert view.
- Historical analog cards need a clearer explanation of horizon/outcome definition before public marketing.
- External licensed historical price charts are still required for Freedom24-like immediate stock history; local portfolio history cannot replace that.
- Production signing / Play Closed Testing remains open.
- Second-device privacy validation remains open.
- External beta/usability evidence remains open.

## Sponsor-demo rule

Do not present v1.8.3 screenshots as the final polished UI.
Use v1.8.4 or later after physical-device screenshot verification.

## Release rule

No PR #23 merge without explicit owner approval.
