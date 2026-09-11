"use strict";

// Owner-authored retrigger after verified one-time runtime integration.
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
