const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

async function importPureModule(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const encoded = Buffer.from(source).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}

(async () => {
  const policy = await importPureModule('src/intelligence-notification-policy.js');
  const alwaysCurrent = { isCurrentDecision: () => true };
  const neverCurrent = { isCurrentDecision: () => false };
  const held = [{ symbol: 'SPCE.US', quantity: 720 }];

  const screenshotRegressionFeed = {
    decisions: [
      ['company:insw', 'INSW', 'International Seaways, Inc. Common Stock'],
      ['company:asc', 'ASC', 'Ardmore Shipping Corporation Common Stock'],
      ['company:chrd', 'CHRD', 'Chord Energy Corporation - Common Stock'],
    ].map(([companyId, symbol, companyName]) => ({
      companyId,
      symbol,
      companyName,
      finalAction: {
        status: 'FINAL',
        marketAction: 'HOLD',
        marketActionLabel: 'ΚΡΑΤΑ',
        holderAction: 'HOLD',
        holderActionLabel: 'ΚΡΑΤΑ',
        nonHolderAction: 'WATCH',
        nonHolderActionLabel: 'ΠΑΡΑΚΟΛΟΥΘΗΣΗ',
      },
    })),
    discoveryRadar: [{ companyId: 'company:new', discoveryScore: 99 }],
  };

  const regression = policy.buildDecisionChangeEvents(screenshotRegressionFeed, held, {}, alwaysCurrent);
  assert.equal(regression.events.length, 0, 'non-owned HOLD/WATCH research must never generate a push');
  assert.deepEqual(
    Object.values(regression.currentSnapshot).map((item) => item.action),
    ['WATCH', 'WATCH', 'WATCH'],
    'non-holder actions must be used instead of generic marketAction',
  );

  const buyFeed = {
    decisions: [{
      companyId: 'company:vctr',
      symbol: 'VCTR',
      companyName: 'Victory Capital Holdings',
      finalAction: {
        status: 'FINAL',
        marketAction: 'BUY_NOW',
        holderAction: 'HOLD',
        holderActionLabel: 'ΚΡΑΤΑ',
        nonHolderAction: 'BUY_NOW',
        nonHolderActionLabel: 'ΑΜΕΣΗ ΑΓΟΡΑ',
      },
    }],
  };
  const buy = policy.buildDecisionChangeEvents(buyFeed, held, {}, alwaysCurrent);
  assert.equal(buy.events.length, 1);
  assert.equal(buy.events[0].kind, 'NEW_BUY');
  assert.equal(buy.events[0].owned, false);
  assert.equal(buy.events[0].action, 'BUY_NOW');

  const sellFeed = {
    decisions: [{
      companyId: 'company:spce',
      symbol: 'SPCE',
      companyName: 'Virgin Galactic Holdings',
      finalAction: {
        status: 'FINAL',
        marketAction: 'AVOID',
        holderAction: 'SELL_NOW',
        holderActionLabel: 'ΑΜΕΣΗ ΠΩΛΗΣΗ / ΜΕΙΩΣΗ',
        nonHolderAction: 'AVOID',
        nonHolderActionLabel: 'ΑΠΕΦΥΓΕ',
      },
    }],
  };
  const sell = policy.buildDecisionChangeEvents(sellFeed, held, {}, alwaysCurrent);
  assert.equal(sell.events.length, 1);
  assert.equal(sell.events[0].kind, 'OWNED_SELL');
  assert.equal(sell.events[0].owned, true);

  const repeatedSell = policy.buildDecisionChangeEvents(sellFeed, held, sell.currentSnapshot, alwaysCurrent);
  assert.equal(repeatedSell.events.length, 0, 'unchanged portfolio action must not spam repeated pushes');

  const holdRecoveryFeed = {
    decisions: [{
      companyId: 'company:spce',
      symbol: 'SPCE.US',
      companyName: 'Virgin Galactic Holdings',
      finalAction: {
        status: 'FINAL',
        marketAction: 'HOLD',
        holderAction: 'HOLD',
        holderActionLabel: 'ΚΡΑΤΑ',
        nonHolderAction: 'WATCH',
        nonHolderActionLabel: 'ΠΑΡΑΚΟΛΟΥΘΗΣΗ',
      },
    }],
  };
  const recovery = policy.buildDecisionChangeEvents(holdRecoveryFeed, held, sell.currentSnapshot, alwaysCurrent);
  assert.equal(recovery.events.length, 1);
  assert.equal(recovery.events[0].kind, 'OWNED_HOLD_RECOVERY');

  const noValidity = policy.buildDecisionChangeEvents(buyFeed, held, {}, neverCurrent);
  assert.equal(noValidity.events.length, 0, 'stale/blocked/expired decisions must fail closed');

  const digest = policy.buildNotificationPayload([sell.events[0], buy.events[0], recovery.events[0]]);
  assert.equal(digest.data.type, 'INTELLIGENCE_DIGEST');
  assert.equal(digest.data.count, 3);
  assert.match(digest.body, /\+2 ακόμη/);

  assert.equal(policy.canonicalNotificationSymbol('ALWN.GR'), 'ALWN');
  assert.equal(policy.canonicalNotificationSymbol('SPCE.US'), 'SPCE');

  const task = fs.readFileSync(path.join(root, 'src/background-intelligence-task.js'), 'utf8');
  const alertTask = fs.readFileSync(path.join(root, 'src/background-alert-task.js'), 'utf8');
  const storage = fs.readFileSync(path.join(root, 'src/portfolio-state-storage.js'), 'utf8');
  assert.match(task, /buildOpenPositionLedger/);
  assert.match(task, /finalActionIsCurrent/);
  assert.match(task, /NOTIFICATION_POLICY_VERSION/);
  assert.match(task, /buildNotificationPayload/);
  assert.match(task, /PORTFOLIO_STATE_STORAGE_KEY/);
  assert.doesNotMatch(task, /discoveryEvents\(/);
  assert.doesNotMatch(task, /for \(const event of fresh\)/);
  assert.match(alertTask, /PORTFOLIO_STATE_STORAGE_KEY/);
  assert.match(storage, /investor-control-mobile-state-v2/);

  console.log('PASS portfolio-aware, transition-only, fail-closed and single-digest intelligence notification policy.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
