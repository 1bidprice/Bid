import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`v1.2.6 controlled-plan patch failed: missing ${label}`);
  return source.replace(from, to);
}

function patchFinalActionPolicy() {
  let source = read('src/final-action-policy.js');

  source = replaceRequired(
    source,
    "export const FINAL_ACTION_POLICY_VERSION = '2026-07-27.1';",
    "export const FINAL_ACTION_POLICY_VERSION = '2026-08-07.1';",
    'final action policy version',
  );

  const controlledPlan = `function buildControlledPlan(dossier, blockers, flags, quality, confidence, now) {
  const fundamentalRiskReady = dossier?.metrics?.fundamentalRisk?.metricsReady === true;
  const marketRiskReady = dossier?.metrics?.market?.readiness?.marketMetricsReady === true;
  const verifiedElevatedRisk =
    (fundamentalRiskReady && flags.severeFundamental.length > 0) ||
    (marketRiskReady && flags.severeMarket.length > 0);
  const holderActionLabel = verifiedElevatedRisk
    ? 'ΚΡΑΤΑ ΧΩΡΙΣ ΕΝΙΣΧΥΣΗ — ΕΠΑΝΕΞΕΤΑΣΗ ΚΙΝΔΥΝΟΥ'
    : 'ΚΡΑΤΑ ΧΩΡΙΣ ΕΝΙΣΧΥΣΗ';
  const rationale = verifiedElevatedRisk
    ? 'Υπάρχουν επαληθευμένες ενδείξεις αυξημένου κινδύνου, αλλά δεν έχουν περάσει ακόμη όλοι οι έλεγχοι που απαιτούνται για τελικό σήμα πώλησης ή μείωσης.'
    : 'Δεν έχουν ολοκληρωθεί όλοι οι υποχρεωτικοί έλεγχοι για τελική αγορά ή πώληση. Μέχρι τότε η πειθαρχημένη στάση είναι διατήρηση υπάρχουσας θέσης χωρίς νέα ενίσχυση και αποφυγή νέας εισόδου.';
  return {
    status: 'AVAILABLE',
    level: 'INTERIM_RISK_CONTROL',
    title: 'Πλάνο τώρα',
    holderAction: FINAL_ACTIONS.HOLD,
    holderActionLabel,
    nonHolderAction: FINAL_ACTIONS.DO_NOT_BUY,
    nonHolderActionLabel: 'ΜΗΝ ΑΓΟΡΑΣΕΙΣ ΑΚΟΜΗ',
    marketAction: FINAL_ACTIONS.WATCH,
    marketActionLabel: 'ΠΑΡΑΚΟΛΟΥΘΗΣΗ',
    newBuyAllowed: false,
    sellSignalApproved: false,
    confidenceScore: Math.min(75, Math.round(confidence)),
    dataQualityScore: Math.round(quality),
    rationale,
    blockers: unique(blockers).slice(0, 8),
    validUntil: new Date(now.getTime() + 24 * 3_600_000).toISOString(),
  };
}

`;

  source = replaceRequired(
    source,
    'function determineActions(dossier, flags, confidence, now, options) {',
    `${controlledPlan}function determineActions(dossier, flags, confidence, now, options) {`,
    'controlled-plan helper insertion',
  );

  source = replaceRequired(
    source,
    '  const blocked = freshness.blockers.length > 0;\n  const actions = blocked',
    '  const blocked = freshness.blockers.length > 0;\n  const controlledPlan = blocked ? buildControlledPlan(dossier, freshness.blockers, flags, quality, confidence, now) : null;\n  const actions = blocked',
    'controlled-plan evaluation',
  );

  source = replaceRequired(
    source,
    '    risk: {\n      riskScore: finite(dossier?.metrics?.fundamentalRisk?.riskScore),\n      fundamentalFlags: flags.fundamental,\n      marketFlags: flags.market,\n    },\n    execution: {',
    '    risk: {\n      riskScore: finite(dossier?.metrics?.fundamentalRisk?.riskScore),\n      fundamentalFlags: flags.fundamental,\n      marketFlags: flags.market,\n    },\n    controlledPlan,\n    execution: {',
    'controlled-plan output contract',
  );

  write('src/final-action-policy.js', source);
}

function patchExtremeMarginQuality() {
  let risk = read('src/fundamental-risk.js');
  risk = replaceRequired(
    risk,
    '  const netMargin = ratio(netIncome, revenue);\n  const cashRunwayYears =',
    '  const netMargin = ratio(netIncome, revenue);\n  const netMarginComparable = netMargin !== null && Math.abs(netMargin) <= 10;\n  const cashRunwayYears =',
    'net-margin comparability',
  );
  risk = replaceRequired(
    risk,
    "  if (netMargin !== null && netMargin <= -0.5) flags.push('SEVERE_NEGATIVE_NET_MARGIN');\n  else if (netMargin !== null && netMargin < 0) flags.push('NEGATIVE_NET_MARGIN');",
    "  if (netMarginComparable && netMargin <= -0.5) flags.push('SEVERE_NEGATIVE_NET_MARGIN');\n  else if (netMarginComparable && netMargin < 0) flags.push('NEGATIVE_NET_MARGIN');",
    'comparable net-margin flags',
  );
  risk = replaceRequired(
    risk,
    '      netMarginPct: netMargin === null ? null : round(netMargin * 100, 2),\n    },',
    "      netMarginPct: netMargin === null ? null : round(netMargin * 100, 2),\n      netMarginComparable,\n      netMarginDisplay: netMargin === null ? null : netMarginComparable ? `${round(netMargin * 100, 2)}%` : 'Μη συγκρίσιμο λόγω πολύ χαμηλής βάσης εσόδων',\n    },",
    'net-margin display quality',
  );
  write('src/fundamental-risk.js', risk);

  let synthesis = read('src/evidence-synthesis.js');
  synthesis = replaceRequired(
    synthesis,
    '  if (Number.isFinite(netMargin)) parts.push(`ετήσιο καθαρό περιθώριο ${netMargin}%`);',
    "  if (Number.isFinite(netMargin)) parts.push(Math.abs(netMargin) > 1000 ? 'καθαρό περιθώριο μη συγκρίσιμο λόγω πολύ χαμηλής βάσης εσόδων' : `ετήσιο καθαρό περιθώριο ${netMargin}%`);",
    'extreme net-margin narrative guard',
  );
  write('src/evidence-synthesis.js', synthesis);
}

patchFinalActionPolicy();
patchExtremeMarginQuality();

for (const [file, invariants] of Object.entries({
  'src/final-action-policy.js': ['INTERIM_RISK_CONTROL', 'ΚΡΑΤΑ ΧΩΡΙΣ ΕΝΙΣΧΥΣΗ', 'controlledPlan'],
  'src/fundamental-risk.js': ['netMarginComparable', 'Μη συγκρίσιμο λόγω πολύ χαμηλής βάσης εσόδων'],
  'src/evidence-synthesis.js': ['καθαρό περιθώριο μη συγκρίσιμο λόγω πολύ χαμηλής βάσης εσόδων'],
})) {
  const source = read(file);
  for (const invariant of invariants) {
    if (!source.includes(invariant)) throw new Error(`v1.2.6 verification failed: ${file} missing ${invariant}`);
  }
}

console.log('Investor Control v1.2.6 controlled plan and extreme-margin quality guard applied.');
