#!/usr/bin/env python3
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[2]
MARKET_DATA = ROOT / "mobile/src/market-data.js"
PORTFOLIO_APP = ROOT / "mobile/PortfolioApp.js"
BACKGROUND = ROOT / "mobile/src/background-alert-task.js"
PACKAGE = ROOT / "mobile/package.json"
VERIFY = ROOT / "mobile/scripts/verify-market-gateway-runtime-integration.cjs"

def require_replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

market = MARKET_DATA.read_text()
import_anchor = "import AsyncStorage from '@react-native-async-storage/async-storage';\n"
runtime_import = "import { fetchConfiguredMarketGatewaySnapshot, isMarketGatewayConfigured } from './market-gateway-runtime';\n"
if runtime_import not in market:
    market = require_replace_once(market, import_anchor, import_anchor + runtime_import, "market-data runtime import")

new_fetch = r'''export async function fetchPortfolioQuotes(symbols, { finnhubToken = '' } = {}) {
  const cleanSymbols = [...new Set(
    symbols.filter(Boolean).map((value) => String(value).trim().toUpperCase()),
  )];
  const gatewayEnabled = isMarketGatewayConfigured();
  const needsUsd = cleanSymbols.some((symbol) => symbol.endsWith('.US'));
  const fetched = {};
  const errors = [];
  const canonicalFeedQuotes = await readCanonicalFeedQuotes(cleanSymbols);

  let fx;
  let gatewaySnapshot = null;

  if (gatewayEnabled) {
    gatewaySnapshot = await fetchConfiguredMarketGatewaySnapshot(cleanSymbols);
    if (gatewaySnapshot?.enabled !== true) throw new Error('MARKET_GATEWAY_CONFIGURATION_INVALID');

    for (const item of gatewaySnapshot.errors || []) {
      errors.push(`${item.symbol || 'GATEWAY'}: ${item.code || 'MARKET_GATEWAY_REQUEST_FAILED'}`);
    }
    if (gatewaySnapshot.fxError) errors.push(`EURUSD: ${gatewaySnapshot.fxError}`);

    fx = needsUsd
      ? gatewaySnapshot.fxReference
        ? {
            rate: Number(gatewaySnapshot.fxReference.rate),
            updatedAt: null,
            referenceDate: gatewaySnapshot.fxReference.referenceDate || null,
            source: gatewaySnapshot.fxReference.source || 'European Central Bank reference rate',
            sourceQuality: gatewaySnapshot.fxReference.sourceQuality || null,
            valuationReferenceEligible: gatewaySnapshot.fxReference.valuationReferenceEligible === true,
            transactionEligible: gatewaySnapshot.fxReference.transactionEligible === true,
            decisionEligible: gatewaySnapshot.fxReference.decisionEligible === true,
          }
        : null
      : { rate: 1, updatedAt: null, source: null };

    for (const symbol of cleanSymbols) {
      const entry = gatewaySnapshot.quoteRegistry?.[symbol];
      if (!entry) {
        if (!(gatewaySnapshot.errors || []).some((item) => item?.symbol === symbol)) {
          errors.push(`${symbol}: MARKET_GATEWAY_QUOTE_UNAVAILABLE`);
        }
        continue;
      }
      try {
        const exchange = exchangeState(symbol);
        const native = quoteFromRegistry(symbol, entry, {
          now: Date.now(),
          exchangeOpen: exchange.open,
          exchangeSession: exchange.session,
          exchangeCalendarVerified: exchange.calendarVerified !== false,
        });
        if (!native) throw new Error('MARKET_GATEWAY_QUOTE_CONTRACT_REJECTED');
        const withFx = applyFx(symbol, native, fx);
        fetched[symbol] = classifyQuote(symbol, {
          ...withFx,
          symbol,
          checkedAt: gatewaySnapshot.checkedAt || withFx.checkedAt || new Date().toISOString(),
          marketDataMode: 'CANONICAL_GATEWAY',
          fxSource: needsUsd ? fx?.source || null : null,
          fxSourceQuality: needsUsd ? fx?.sourceQuality || null : null,
          fxReferenceDate: needsUsd ? fx?.referenceDate || null : null,
          fxValuationReferenceEligible: needsUsd ? fx?.valuationReferenceEligible === true : null,
          fxTransactionEligible: needsUsd ? fx?.transactionEligible === true : null,
          fxDecisionEligible: needsUsd ? fx?.decisionEligible === true : null,
        });
      } catch (error) {
        errors.push(`${symbol}: ${safeProviderDiagnostic(error, error?.message || 'MARKET_GATEWAY_QUOTE_REJECTED')}`);
      }
    }
  } else {
    fx = needsUsd
      ? await fetchEurUsd().catch(() => null)
      : { rate: 1, updatedAt: null, source: null };

    await Promise.all(cleanSymbols.map(async (symbol) => {
      try {
        const native = await fetchNativeQuote(symbol, finnhubToken);
        const withFx = applyFx(symbol, native, fx);
        const changeBase = finite(withFx.nativeChangeBase)
          ? Number(withFx.nativeChangeBase)
          : finite(withFx.nativePreviousClose)
            ? Number(withFx.nativePreviousClose)
            : null;
        fetched[symbol] = classifyQuote(symbol, {
          ...withFx,
          symbol,
          marketDataMode: 'LEGACY_DIRECT',
          changePct: Number.isFinite(Number(withFx.nativeProviderChangePct))
            ? Number(withFx.nativeProviderChangePct)
            : finite(changeBase)
              ? ((Number(withFx.nativePrice) - changeBase) / changeBase) * 100
              : null,
        });
      } catch (error) {
        errors.push(`${symbol}: ${safeProviderDiagnostic(error)}`);
      }
    }));
  }

  const persisted = await readPersistedPrices();
  const baseline = mergePortfolioQuotes(persisted, inMemoryQuotes);
  const canonicalBaseline = mergePortfolioQuotes(baseline, canonicalFeedQuotes);
  const newest = mergePortfolioQuotes(canonicalBaseline, fetched);
  const quotes = {};

  cleanSymbols.forEach((symbol) => {
    const selected = gatewayEnabled && fetched[symbol] ? fetched[symbol] : newest[symbol];
    if (!selected) return;
    try {
      const withFx = applyFx(symbol, selected, fx);
      quotes[symbol] = classifyQuote(symbol, {
        ...withFx,
        checkedAt: new Date().toISOString(),
        marketDataMode: gatewayEnabled ? 'CANONICAL_GATEWAY' : selected.marketDataMode || 'LEGACY_DIRECT',
        ...(gatewayEnabled && needsUsd ? {
          fxSource: fx?.source || null,
          fxSourceQuality: fx?.sourceQuality || null,
          fxReferenceDate: fx?.referenceDate || null,
          fxValuationReferenceEligible: fx?.valuationReferenceEligible === true,
          fxTransactionEligible: fx?.transactionEligible === true,
          fxDecisionEligible: fx?.decisionEligible === true,
        } : {}),
      });
      inMemoryQuotes[symbol] = quotes[symbol];
    } catch (error) {
      errors.push(`${symbol}: ${safeProviderDiagnostic(error, error?.message || 'QUOTE_REJECTED')}`);
    }
  });

  return {
    quotes,
    errors: [...new Set(errors)],
    checkedAt: new Date().toISOString(),
    fxRates: needsUsd && fx ? { EURUSD: fx } : {},
    marketDataMode: gatewayEnabled ? 'CANONICAL_GATEWAY' : 'LEGACY_DIRECT',
  };
}
'''

pattern = re.compile(r"export async function fetchPortfolioQuotes\(symbols, \{ finnhubToken = '' \} = \{\}\) \{.*?\n\}\n(?=\nexport function quoteStatusText)", re.S)
market, count = pattern.subn(new_fetch, market, count=1)
if count != 1:
    raise SystemExit(f"market-data fetchPortfolioQuotes: expected one replacement, found {count}")
MARKET_DATA.write_text(market)

portfolio = PORTFOLIO_APP.read_text()
portfolio_import_anchor = "import AsyncStorage from '@react-native-async-storage/async-storage';\n"
portfolio_runtime_import = "import { isMarketGatewayConfigured } from './src/market-gateway-runtime';\n"
if portfolio_runtime_import not in portfolio:
    portfolio = require_replace_once(portfolio, portfolio_import_anchor, portfolio_import_anchor + portfolio_runtime_import, "PortfolioApp runtime import")

constant_anchor = "const LEGAL_ACCEPTANCE_KEY = 'investor-control.legal-acceptance.v1';\n"
gateway_constant = "const MARKET_GATEWAY_CONFIGURED = isMarketGatewayConfigured();\n"
if gateway_constant not in portfolio:
    portfolio = require_replace_once(portfolio, constant_anchor, constant_anchor + gateway_constant, "PortfolioApp gateway constant")

portfolio = require_replace_once(
    portfolio,
    "if (loading || token.trim().length < 20 || !liveUsProviderSymbols.length) return undefined;",
    "if (loading || MARKET_GATEWAY_CONFIGURED || token.trim().length < 20 || !liveUsProviderSymbols.length) return undefined;",
    "PortfolioApp Finnhub WebSocket guard",
)
PORTFOLIO_APP.write_text(portfolio)

background = BACKGROUND.read_text()
bg_import_anchor = "import * as SecureStore from 'expo-secure-store';\n"
bg_runtime_import = "import { isMarketGatewayConfigured } from './market-gateway-runtime';\n"
if bg_runtime_import not in background:
    background = require_replace_once(background, bg_import_anchor, bg_import_anchor + bg_runtime_import, "background runtime import")
background = require_replace_once(
    background,
    "const token = await SecureStore.getItemAsync(FINNHUB_TOKEN_KEY);",
    "const token = isMarketGatewayConfigured() ? '' : await SecureStore.getItemAsync(FINNHUB_TOKEN_KEY);",
    "background Finnhub token guard",
)
BACKGROUND.write_text(background)

package = json.loads(PACKAGE.read_text())
scripts = package.setdefault("scripts", {})
scripts["test:gateway-runtime"] = "node scripts/verify-market-gateway-runtime-integration.cjs"
core = scripts["test:core"]
if "npm run test:gateway-runtime" not in core:
    scripts["test:core"] = core + " && npm run test:gateway-runtime"
PACKAGE.write_text(json.dumps(package, indent=2, ensure_ascii=False) + "\n")

verify_source = r'''"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const marketData = fs.readFileSync(path.join(root, "src", "market-data.js"), "utf8");
const runtime = fs.readFileSync(path.join(root, "src", "market-gateway-runtime.js"), "utf8");
const portfolio = fs.readFileSync(path.join(root, "PortfolioApp.js"), "utf8");
const background = fs.readFileSync(path.join(root, "src", "background-alert-task.js"), "utf8");

assert.match(runtime, /process\.env\.EXPO_PUBLIC_MARKET_GATEWAY_URL/);
assert.equal(runtime.includes("EXPO_PUBLIC_FINNHUB"), false);
assert.equal(runtime.includes("FINNHUB_TOKEN"), false);
assert.match(marketData, /const gatewayEnabled = isMarketGatewayConfigured\(\);/);
assert.match(marketData, /fetchConfiguredMarketGatewaySnapshot\(cleanSymbols\)/);
assert.match(marketData, /marketDataMode: 'CANONICAL_GATEWAY'/);
assert.match(marketData, /fxSourceQuality/);
assert.match(marketData, /fxReferenceDate/);
assert.match(marketData, /if \(gatewayEnabled\)[\s\S]*?\} else \{[\s\S]*?fetchNativeQuote\(symbol, finnhubToken\)/);
assert.match(portfolio, /const MARKET_GATEWAY_CONFIGURED = isMarketGatewayConfigured\(\);/);
assert.match(portfolio, /if \(loading \|\| MARKET_GATEWAY_CONFIGURED \|\| token\.trim\(\)\.length < 20 \|\| !liveUsProviderSymbols\.length\) return undefined;/);
assert.match(background, /const token = isMarketGatewayConfigured\(\) \? '' : await SecureStore\.getItemAsync\(FINNHUB_TOKEN_KEY\);/);
console.log("market gateway dormant runtime integration invariant: PASS");
'''
VERIFY.write_text(verify_source)
print("dormant gateway integration patch applied")
