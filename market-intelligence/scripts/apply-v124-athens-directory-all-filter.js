import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adapterPath = path.join(root, 'src/adapters/euronext-athens-discovery.js');
let source = fs.readFileSync(adapterPath, 'utf8');

const from = "export const ATHENS_TRADING_ISSUERS_URL = 'https://athens.euronext.com/en/trade/trading-products/trading-issuers';";
const to = "export const ATHENS_TRADING_ISSUERS_URL = 'https://athens.euronext.com/en/trade/trading-products/trading-issuers?letter=All';";
if (!source.includes(to)) {
  if (!source.includes(from)) throw new Error('v1.2.4 Athens directory filter patch failed: URL constant missing');
  source = source.replace(from, to);
}
source = source.replace(
  "export const ATHENS_DISCOVERY_VERSION = '2026-08-05.2';",
  "export const ATHENS_DISCOVERY_VERSION = '2026-08-05.3';",
);
fs.writeFileSync(adapterPath, source);

const verified = fs.readFileSync(adapterPath, 'utf8');
if (!verified.includes('trading-issuers?letter=All')) throw new Error('v1.2.4 Athens directory filter verification failed');
console.log('Investor Control v1.2.4 populated Athens trading directory view applied.');
