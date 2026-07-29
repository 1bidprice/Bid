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

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.0.0 event-integrity patch failed: missing ${label}`);
  return content.replace(from, to);
}

let classifier = read('src/event-classifier.js');
classifier = replaceRequired(
  classifier,
  "  {\n    id: 'LEGAL_OR_SETTLEMENT',",
  "  {\n    id: 'OWNERSHIP_OR_VOTING_RIGHTS',\n    terms: ['voting rights', 'major shareholder', 'major shareholding', 'shareholding notification', 'ownership threshold'],\n    category: 'EVENT_DRIVEN',\n    fundamentalsScore: 34,\n    catalystScore: 45,\n    riskScore: 42,\n    rationale: 'Ownership or voting-rights disclosure requiring holder identity, threshold and control-impact checks.',\n  },\n  {\n    id: 'LEGAL_OR_SETTLEMENT',",
  'ownership event rule',
);
classifier = replaceRequired(
  classifier,
  "function normalizedText(record) {\n  return `${record?.title || ''} ${record?.notes || ''} ${record?.rawText || ''}`.toLowerCase();\n}\n\nexport function classifyEvidenceEvent(record) {\n  const text = normalizedText(record);\n  const rule = RULES.find((candidate) => candidate.terms.some((term) => text.includes(term)));",
  "function normalizedHeadlineText(record) {\n  return `${record?.title || ''} ${record?.notes || ''}`.toLowerCase();\n}\n\nfunction normalizedDocumentText(record) {\n  return String(record?.rawText || '').toLowerCase();\n}\n\nexport function classifyEvidenceEvent(record) {\n  const headlineText = normalizedHeadlineText(record);\n  const documentText = normalizedDocumentText(record);\n  // Headline and adapter notes are authoritative for event type. Full-page text\n  // is used only as a fallback because issuer/exchange templates can contain\n  // unrelated navigation or legal boilerplate.\n  const headlineRule = RULES.find((candidate) => candidate.terms.some((term) => headlineText.includes(term)));\n  const documentRule = headlineRule ? null : RULES.find((candidate) => candidate.terms.some((term) => documentText.includes(term)));\n  const rule = headlineRule || documentRule;",
  'headline-first event classification',
);
write('src/event-classifier.js', classifier);

let synthesis = read('src/evidence-synthesis.js');
synthesis = replaceRequired(
  synthesis,
  "    OPERATIONAL_MILESTONE: 60,\n    SHARE_BUYBACK: 50,",
  "    OPERATIONAL_MILESTONE: 60,\n    OWNERSHIP_OR_VOTING_RIGHTS: 55,\n    SHARE_BUYBACK: 50,",
  'ownership event priority',
);
synthesis = replaceRequired(
  synthesis,
  "    LEGAL_OR_SETTLEMENT: {\n      category: 'EVENT_RISK',",
  "    OWNERSHIP_OR_VOTING_RIGHTS: {\n      category: 'EVENT_DRIVEN',\n      action: 'WATCH',\n      horizon: 'MONTHS',\n      thesis: `Η επιβεβαιωμένη μεταβολή δικαιωμάτων ψήφου ή σημαντικής συμμετοχής στη ${companyName} αλλάζει τη χαρτογράφηση ιδιοκτησίας και πιθανής επιρροής, όχι από μόνη της τις ταμειακές ροές ή την εσωτερική αξία. Η επενδυτική σημασία εξαρτάται από τον μέτοχο, το ποσοστό, τη μονιμότητα της μεταβολής και τυχόν επίδραση στον έλεγχο ή στη στρατηγική.`,\n      mechanism: 'Μια ουσιαστική μεταβολή συμμετοχής μπορεί να αλλάξει τη συγκέντρωση ιδιοκτησίας, την επιρροή στις αποφάσεις και τις προσδοκίες για εταιρικές κινήσεις. Δεν αποτελεί αυτοτελές σήμα αγοράς ή πώλησης.',\n      bull: 'Η νέα ή αυξημένη συμμετοχή προέρχεται από μακροπρόθεσμο επενδυτή και συνοδεύεται από βελτιωμένη ευθυγράμμιση, διακυβέρνηση ή στρατηγική στήριξη.',\n      bear: 'Η μεταβολή αντανακλά αποχώρηση βασικού μετόχου, συγκέντρωση ελέγχου χωρίς προστασία μειοψηφίας ή αυξημένη πιθανότητα εταιρικής αστάθειας.',\n      invalidation: 'Οποιαδήποτε ερμηνεία ακυρώνεται εάν η γνωστοποίηση είναι καθαρά τεχνική, προσωρινή ή δεν μεταβάλλει ουσιαστικά τον έλεγχο, τη στρατηγική ή την οικονομική θέση της εταιρείας.',\n      catalyst: `Η επίσημη πηγή επιβεβαιώνει: ${eventLabel}.`,\n      risk: 'Η γνωστοποίηση δικαιωμάτων ψήφου μπορεί να είναι κανονιστική και οικονομικά ουδέτερη, επομένως δεν πρέπει να μετατρέπεται σε κατεύθυνση συναλλαγής χωρίς πρόσθετη τεκμηρίωση.',\n    },\n    LEGAL_OR_SETTLEMENT: {\n      category: 'EVENT_RISK',",
  'ownership event narrative',
);
write('src/evidence-synthesis.js', synthesis);

console.log('Investor Control v1.0.0 event classification integrity applied.');
