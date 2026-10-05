'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const finalCard = fs.readFileSync(path.join(root, 'src', 'FinalDecisionCard.js'), 'utf8');
const opportunities = fs.readFileSync(path.join(root, 'src', 'OpportunitiesView.js'), 'utf8');

assert.match(finalCard, /item\?\.holderDecision/);
assert.match(finalCard, /item\?\.nonHolderDecision/);
assert.doesNotMatch(finalCard, /ΑΜΕΣΗ ΑΓΟΡΑ/);
assert.doesNotMatch(finalCard, /nonHolderActionLabel/);
assert.match(finalCard, /BUY_NOW_REQUIRES_CONFIRMED_PURCHASE_RECONCILIATION/);

assert.match(opportunities, /Ερευνητική κατεύθυνση · όχι τελική πράξη/);
assert.doesNotMatch(opportunities, /Γενική ερευνητική ένδειξη/);
assert.match(opportunities, /\['BUY_PROBE', 'BUY_STARTER', 'BUY_CORE'\]/);

console.log('Decision coherence UI PASS: no raw BUY_NOW rendering, canonical holder/non-holder decisions only, and research direction is explicitly non-final.');
