const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'src', 'local-data-ownership.js');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source + '\nthis.api={createInstallationId,classifyLocalPortfolioState,attachLocalPortfolioOwner,canBackgroundTaskUsePortfolio};', sandbox);
const api = sandbox.api;

const idA = 'minbeis-a';
const idB = 'minbeis-b';

const empty = api.classifyLocalPortfolioState(null, idA);
if (empty.status !== 'EMPTY') throw new Error('Empty install must start empty');

const legacy = api.classifyLocalPortfolioState({ transactions: [{ id: 'old' }] }, idA);
if (legacy.status !== 'LEGACY_UNOWNED') throw new Error('Legacy unowned state must be quarantined');

const foreign = api.classifyLocalPortfolioState({ ownerInstallationId: idB, transactions: [{ id: 'foreign' }] }, idA);
if (foreign.status !== 'FOREIGN_OWNER') throw new Error('Foreign-owned state must not load');
if (api.canBackgroundTaskUsePortfolio(foreign.state, idA)) throw new Error('Background task must reject foreign-owned portfolio');

const ownedState = api.attachLocalPortfolioOwner({ transactions: [{ id: 'mine' }] }, idA);
const owned = api.classifyLocalPortfolioState(ownedState, idA);
if (owned.status !== 'OWNED') throw new Error('Owned state must load');
if (!api.canBackgroundTaskUsePortfolio(ownedState, idA)) throw new Error('Background task must accept owned state');

const portfolioApp = fs.readFileSync(path.join(__dirname, '..', 'PortfolioApp.js'), 'utf8');
if (!/transactions:\s*\[\]/.test(portfolioApp)) throw new Error('First-run portfolio must default to zero transactions');
if (!portfolioApp.includes('LEGACY_PORTFOLIO_QUARANTINE_KEY')) throw new Error('Legacy data quarantine is not wired into app startup');
if (!portfolioApp.includes('classifyLocalPortfolioState')) throw new Error('Portfolio startup ownership check is missing');

const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
if (appJson?.expo?.android?.allowBackup !== false) throw new Error('Android backup must remain disabled for portfolio privacy');

console.log('MINBEIS local-data isolation contract verified');
