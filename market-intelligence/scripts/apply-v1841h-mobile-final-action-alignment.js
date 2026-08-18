import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/mobile-intelligence-feed.js');

function replaceRequired(content, from, to, name) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.8.4 mobile final-action alignment failed: ${name}`);
  return content.replace(from, to);
}

let content = fs.readFileSync(file, 'utf8');
content = replaceRequired(
  content,
  "function compactDossier(dossier, generatedAt) {\n  const blockers = Array.isArray(dossier?.readiness?.blockers) ? dossier.readiness.blockers : [];\n  const status = dossier.status;",
  "function compactDossier(dossier, generatedAt) {\n  const readinessBlockers = Array.isArray(dossier?.readiness?.blockers) ? dossier.readiness.blockers : [];\n  const finalBlockers = Array.isArray(dossier?.finalAction?.blockers) ? dossier.finalAction.blockers : [];\n  const blockers = [...new Set([...readinessBlockers, ...finalBlockers])];\n  const status = dossier.status;\n  const effectiveAction = dossier.finalAction?.status === 'BLOCKED'\n    ? 'WATCH'\n    : status === 'DRAFT_RESEARCH'\n      ? 'WATCH'\n      : dossier.proposedAction;",
  'effective blocked action',
);
content = replaceRequired(
  content,
  "    action: status === 'DRAFT_RESEARCH' ? 'WATCH' : dossier.proposedAction,\n    actionLabel: actionLabel(status === 'DRAFT_RESEARCH' ? 'WATCH' : dossier.proposedAction),",
  "    action: effectiveAction,\n    actionLabel: actionLabel(effectiveAction),",
  'card action alignment',
);
content = replaceRequired(
  content,
  "    nextStep: dossier.finalAction?.status === 'FINAL'\n      ? 'Ανάγνωση τεκμηρίωσης και δική σου τελική απόφαση'\n      : status === 'REVIEW_READY'\n        ? 'Τελικός έλεγχος και απόφαση δημοσίευσης'\n        : nextStep(blockers),",
  "    nextStep: dossier.finalAction?.status === 'FINAL'\n      ? 'Ανάγνωση τεκμηρίωσης και δική σου τελική απόφαση'\n      : dossier.finalAction?.status === 'BLOCKED'\n        ? nextStep(blockers)\n        : status === 'REVIEW_READY'\n          ? 'Τελικός έλεγχος και απόφαση δημοσίευσης'\n          : nextStep(blockers),",
  'blocked next-step alignment',
);
fs.writeFileSync(file, content);
console.log('Investor Control v1.8.4 mobile blocked-action alignment applied.');
