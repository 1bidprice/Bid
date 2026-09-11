#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MARKET = ROOT / "mobile/src/market-data.js"
VERIFY = ROOT / "mobile/scripts/verify-market-gateway-runtime-integration.cjs"

market = MARKET.read_text()
old = """  cleanSymbols.forEach((symbol) => {\n    const selected = gatewayEnabled && fetched[symbol] ? fetched[symbol] : newest[symbol];\n    if (!selected) return;\n"""
new = """  cleanSymbols.forEach((symbol) => {\n    const persistedGateway = persisted[symbol]?.marketDataMode === 'CANONICAL_GATEWAY'\n      ? persisted[symbol]\n      : null;\n    const memoryGateway = inMemoryQuotes[symbol]?.marketDataMode === 'CANONICAL_GATEWAY'\n      ? inMemoryQuotes[symbol]\n      : null;\n    const canonicalRegistryQuote = canonicalFeedQuotes[symbol]?.canonicalRegistry === true\n      ? canonicalFeedQuotes[symbol]\n      : null;\n    const trustedGatewayFallback = chooseMostRecentQuote(\n      symbol,\n      chooseMostRecentQuote(symbol, persistedGateway, memoryGateway),\n      canonicalRegistryQuote,\n    );\n    const selected = gatewayEnabled\n      ? fetched[symbol] || trustedGatewayFallback\n      : newest[symbol];\n    if (!selected) return;\n"""
if market.count(old) != 1:
    raise SystemExit(f"gateway fallback selector: expected exactly one match, found {market.count(old)}")
market = market.replace(old, new, 1)
MARKET.write_text(market)

verify = VERIFY.read_text()
anchor = "assert.match(marketData, /marketDataMode: 'CANONICAL_GATEWAY'/);\n"
extra = """assert.match(marketData, /const persistedGateway = persisted\\[symbol\\]\\?\\.marketDataMode === 'CANONICAL_GATEWAY'/);\nassert.match(marketData, /const memoryGateway = inMemoryQuotes\\[symbol\\]\\?\\.marketDataMode === 'CANONICAL_GATEWAY'/);\nassert.match(marketData, /const canonicalRegistryQuote = canonicalFeedQuotes\\[symbol\\]\\?\\.canonicalRegistry === true/);\nassert.match(marketData, /const selected = gatewayEnabled[\\s\\S]*?fetched\\[symbol\\] \\|\\| trustedGatewayFallback[\\s\\S]*?: newest\\[symbol\\]/);\n"""
if extra not in verify:
    if verify.count(anchor) != 1:
        raise SystemExit(f"verification anchor: expected exactly one match, found {verify.count(anchor)}")
    verify = verify.replace(anchor, anchor + extra, 1)
VERIFY.write_text(verify)

print("gateway fallback integrity hardening applied")
