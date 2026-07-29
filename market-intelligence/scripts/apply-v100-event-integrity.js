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
  "    terms: ['share buyback', 'own shares', 'repurchase programme', 'repurchase program'],",
  "    terms: ['share buyback', 'share repurchase', 'repurchase of shares', 'repurchased its own shares', 'own shares', 'repurchase programme', 'repurchase program'],",
  'complete share repurchase headline terms',
);
classifier = replaceRequired(
  classifier,
  "  {\n    id: 'LEGAL_OR_SETTLEMENT',",
  "  {\n    id: 'SECURITIES_OFFERING_REGISTRATION',\n    terms: ['424b7 filing', '424b5 filing', '424b3 filing', 's-3asr filing', 's-3 filing', 'prospectus supplement'],\n    category: 'EVENT_RISK',\n    fundamentalsScore: 30,\n    catalystScore: 38,\n    riskScore: 72,\n    rationale: 'Securities-offering document that may enable issuance or resale and requires transaction-specific dilution and financing review.',\n  },\n  {\n    id: 'OWNERSHIP_OR_VOTING_RIGHTS',\n    terms: ['voting rights', 'major shareholder', 'major shareholding', 'shareholding notification', 'ownership threshold'],\n    category: 'EVENT_DRIVEN',\n    fundamentalsScore: 34,\n    catalystScore: 45,\n    riskScore: 42,\n    rationale: 'Ownership or voting-rights disclosure requiring holder identity, threshold and control-impact checks.',\n  },\n  {\n    id: 'LEGAL_OR_SETTLEMENT',",
  'offering and ownership event rules',
);
classifier = replaceRequired(
  classifier,
  "function normalizedText(record) {\n  return `${record?.title || ''} ${record?.notes || ''} ${record?.rawText || ''}`.toLowerCase();\n}\n\nexport function classifyEvidenceEvent(record) {\n  const text = normalizedText(record);\n  const rule = RULES.find((candidate) => candidate.terms.some((term) => text.includes(term)));",
  "function normalizedHeadlineText(record) {\n  return `${record?.title || ''} ${record?.notes || ''}`.toLowerCase();\n}\n\nexport function classifyEvidenceEvent(record) {\n  const headlineText = normalizedHeadlineText(record);\n  // Event type is determined only from the adapter-controlled title and notes.\n  // Full issuer/exchange pages contain menus and legal boilerplate that can refer\n  // to unrelated events and must never drive classification.\n  const rule = RULES.find((candidate) => candidate.terms.some((term) => headlineText.includes(term)));",
  'controlled-metadata-only classification',
);
write('src/event-classifier.js', classifier);

let synthesis = read('src/evidence-synthesis.js');
synthesis = replaceRequired(
  synthesis,
  "    EQUITY_ISSUANCE_OR_DILUTION: 100,\n    LEGAL_OR_SETTLEMENT: 90,",
  "    EQUITY_ISSUANCE_OR_DILUTION: 100,\n    SECURITIES_OFFERING_REGISTRATION: 95,\n    LEGAL_OR_SETTLEMENT: 90,",
  'offering event priority',
);
synthesis = replaceRequired(
  synthesis,
  "    OPERATIONAL_MILESTONE: 60,\n    SHARE_BUYBACK: 50,",
  "    OPERATIONAL_MILESTONE: 60,\n    OWNERSHIP_OR_VOTING_RIGHTS: 55,\n    SHARE_BUYBACK: 50,",
  'ownership event priority',
);
synthesis = replaceRequired(
  synthesis,
  "    LEGAL_OR_SETTLEMENT: {\n      category: 'EVENT_RISK',",
  "    SECURITIES_OFFERING_REGISTRATION: {\n      category: 'EVENT_RISK',\n      action: 'WATCH',\n      horizon: 'WEEKS',\n      thesis: `Το επιβεβαιωμένο έγγραφο προσφοράς τίτλων της ${companyName} δημιουργεί δυνατότητα έκδοσης ή μεταπώλησης μετοχών, αλλά δεν αποδεικνύει από μόνο του ότι ολοκληρώθηκε νέα χρηματοδότηση ή αραίωση. Απαιτείται έλεγχος του αριθμού τίτλων, του πωλητή, της τιμής, των καθαρών εσόδων και της χρήσης κεφαλαίων.`,\n      mechanism: 'Μια πραγματική νέα έκδοση μπορεί να αυξήσει τη ρευστότητα της εταιρείας αλλά να μοιράσει τη μελλοντική αξία σε περισσότερες μετοχές. Έγγραφο μεταπώλησης υφιστάμενων τίτλων μπορεί να επηρεάσει την προσφορά στην αγορά χωρίς να εισφέρει νέο κεφάλαιο.',\n      bull: 'Η χρηματοδότηση ολοκληρώνεται με ελεγχόμενη αραίωση, επαρκή τιμή και σαφή χρήση κεφαλαίων που αυξάνει ουσιαστικά την πιθανότητα επίτευξης λειτουργικών οροσήμων.',\n      bear: 'Οι τίτλοι εκδίδονται ή πωλούνται σε μεγάλη κλίμακα, σε χαμηλή τιμή ή χωρίς επαρκή βελτίωση της ταμειακής επάρκειας και της επιχειρηματικής προόδου.',\n      invalidation: 'Η υπόθεση κινδύνου αλλάζει εάν το έγγραφο αφορά αποκλειστικά τεχνική καταχώριση ή μεταπώληση χωρίς νέα έκδοση, ή εάν οι τελικοί όροι αποδειχθούν περιορισμένοι και οικονομικά ουδέτεροι.',\n      catalyst: `Η επίσημη πηγή επιβεβαιώνει: ${eventLabel}.`,\n      risk: 'Η ύπαρξη prospectus ή registration statement δεν ισοδυναμεί με ολοκληρωμένη αραίωση και δεν πρέπει να παρουσιάζεται ως τετελεσμένο γεγονός.',\n    },\n    OWNERSHIP_OR_VOTING_RIGHTS: {\n      category: 'EVENT_DRIVEN',\n      action: 'WATCH',\n      horizon: 'MONTHS',\n      thesis: `Η επιβεβαιωμένη μεταβολή δικαιωμάτων ψήφου ή σημαντικής συμμετοχής στη ${companyName} αλλάζει τη χαρτογράφηση ιδιοκτησίας και πιθανής επιρροής, όχι από μόνη της τις ταμειακές ροές ή την εσωτερική αξία. Η επενδυτική σημασία εξαρτάται από τον μέτοχο, το ποσοστό, τη μονιμότητα της μεταβολής και τυχόν επίδραση στον έλεγχο ή στη στρατηγική.`,\n      mechanism: 'Μια ουσιαστική μεταβολή συμμετοχής μπορεί να αλλάξει τη συγκέντρωση ιδιοκτησίας, την επιρροή στις αποφάσεις και τις προσδοκίες για εταιρικές κινήσεις. Δεν αποτελεί αυτοτελές σήμα αγοράς ή πώλησης.',\n      bull: 'Η νέα ή αυξημένη συμμετοχή προέρχεται από μακροπρόθεσμο επενδυτή και συνοδεύεται από βελτιωμένη ευθυγράμμιση, διακυβέρνηση ή στρατηγική στήριξη.',\n      bear: 'Η μεταβολή αντανακλά αποχώρηση βασικού μετόχου, συγκέντρωση ελέγχου χωρίς προστασία μειοψηφίας ή αυξημένη πιθανότητα εταιρικής αστάθειας.',\n      invalidation: 'Οποιαδήποτε ερμηνεία ακυρώνεται εάν η γνωστοποίηση είναι καθαρά τεχνική, προσωρινή ή δεν μεταβάλλει ουσιαστικά τον έλεγχο, τη στρατηγική ή την οικονομική θέση της εταιρείας.',\n      catalyst: `Η επίσημη πηγή επιβεβαιώνει: ${eventLabel}.`,\n      risk: 'Η γνωστοποίηση δικαιωμάτων ψήφου μπορεί να είναι κανονιστική και οικονομικά ουδέτερη, επομένως δεν πρέπει να μετατρέπεται σε κατεύθυνση συναλλαγής χωρίς πρόσθετη τεκμηρίωση.',\n    },\n    LEGAL_OR_SETTLEMENT: {\n      category: 'EVENT_RISK',",
  'offering and ownership event narratives',
);
write('src/evidence-synthesis.js', synthesis);

console.log('Investor Control v1.0.0 controlled event classification integrity applied.');
