# MINBEIS Multi-User & Scale Foundation

Status: architecture foundation implemented; auth provider and production D1 binding not yet provisioned.

## Product rule

Multi-user support must not require uploading portfolio quantities, cost basis, P/L or personal notes.

Default product model:
- portfolio transactions remain local-first;
- account identity is separated from portfolio content;
- server stores only pseudonymous tenant/device metadata and explicitly selected alert rules;
- optional encrypted multi-device portfolio sync is a later, separate consented capability.

## Tenant isolation

A future auth adapter must first verify an external identity token.

Only a verified issuer + subject may enter the tenant contract.

The server derives a pseudonymous tenant ID using HMAC-SHA256 with a server-only secret.

Rules:
- never accept a user/tenant ID from a client header as proof of identity;
- never use email as a tenant key;
- every private database query must include tenant_id;
- cross-tenant scope mismatch fails closed;
- operational account audit records do not contain auth subject or email.

## Cloud data minimization

Initial D1 schema stores:
- pseudonymous tenant ID;
- installation ID;
- push token;
- platform/locale;
- server alert rules: symbol, rule kind, threshold.

Explicitly excluded:
- portfolio quantity;
- cost basis;
- P/L;
- transaction notes;
- broker account credentials.

## Push model

Phase 1:
- Expo Push Service from the Cloudflare backend;
- Expo push token per installation;
- generic privacy-safe notification body;
- server-side alert rules use symbol + threshold only.

The notification stack remains push-service agnostic; direct FCM/APNs can replace Expo transport later without changing the mobile product contract.

## Quote scaling

New edge batch contract:
- POST /v1/quotes;
- maximum 50 canonical symbols per batch;
- client request is rate-limited once;
- each cache miss still consumes upstream rate-limit protection;
- per-symbol edge cache is reused;
- bounded concurrency = 6;
- US batch includes one cached EUR/USD reference;
- mobile client automatically falls back to legacy per-symbol endpoints when batch is not deployed;
- portfolio quantity/cost/P&L are rejected from the batch contract.

## Instrument breadth

US:
- generic server-side quote identity verification already exists;
- full MINBEIS analysis may require research onboarding.

Euronext Athens:
- remains fail-closed for explicitly canonicalized identities;
- do not open arbitrary GR symbols until the official adapter verifies instrument identity, not merely price-page parse success.

## Production gates before account launch

1. Select auth provider after cost/security comparison.
2. Provision auth verifier and server-only tenant HMAC secret.
3. Provision D1 database and migration.
4. Add authenticated device registration endpoint.
5. Add authenticated alert-rule CRUD endpoints with tenant scoping.
6. Obtain Expo/FCM production push credentials.
7. Add account deletion and push-token revocation.
8. Add abuse/rate-limit policy for authenticated routes.
9. Add cross-tenant integration tests against real D1 binding.
10. Legal/privacy review of account and push processing.
11. Second-device user-isolation test.
12. Load tests at 100 / 500 / 1,000 tracked symbols and concurrent-user scenarios.

## Non-negotiable fund-demo claim

Until the production auth provider and D1 binding are live, say:
"Multi-user isolation architecture and data-minimization contracts are implemented; production account provisioning is the next deployment gate."

Do not say:
"MINBEIS already has production multi-user accounts."
