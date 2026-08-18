import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, "src/mobile-intelligence-feed.js");

function replaceRequired(content, from, to, name) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.8.4 recommendation-integrity patch failed: ${name}`);
  return content.replace(from, to);
}

let content = fs.readFileSync(file, 'utf8');
const operations = [
  [
    "    REVIEW_DATE_REQUIRED: 'Λείπει ημερομηνία επανεξέτασης',\n    UNRESOLVED_CONTRADICTION: 'Υπάρχει ανεπίλυτη αντίφαση στις πηγές',",
    "    REVIEW_DATE_REQUIRED: 'Λείπει ημερομηνία επανεξέτασης',\n    COMPANY_IDENTITY_REQUIRED: 'Δεν έχει επαληθευτεί η ταυτότητα της εταιρείας',\n    DECISION_EVIDENCE_REQUIRED: 'Λείπει τεκμηρίωση δεμένη με τη συγκεκριμένη εταιρεία',\n    EVIDENCE_ENTITY_UNVERIFIED: 'Υπάρχει πηγή χωρίς επαληθευμένη σύνδεση με τη συγκεκριμένη εταιρεία',\n    EVIDENCE_ENTITY_MISMATCH: 'Εντοπίστηκε πηγή που ανήκει σε άλλη εταιρεία',\n    REFERENCE_PRICE_ENTITY_MISMATCH: 'Η τιμή αναφοράς δεν ανήκει στην ίδια εταιρεία',\n    REFERENCE_PRICE_SOURCE_NOT_APPROVED: 'Η πηγή της τιμής δεν είναι εγκεκριμένη για τελική απόφαση',\n    REFERENCE_PRICE_TIMESTAMP_NOT_VERIFIED: 'Ο χρόνος της τιμής δεν έχει επαληθευτεί',\n    REFERENCE_PRICE_NOT_DECISION_ELIGIBLE: 'Η τιμή είναι μόνο πληροφοριακή και όχι κατάλληλη για τελική απόφαση',\n    REFERENCE_PRICE_NOT_EXECUTION_ELIGIBLE: 'Η τιμή δεν είναι αρκετά φρέσκια/επαληθευμένη για άμεση ενέργεια',\n    LISTING_IDENTITY_MISMATCH: 'Το σύμβολο της τιμής δεν ταυτίζεται με τη χρηματιστηριακή εγγραφή',\n    ACTIVE_LISTING_NOT_VERIFIED: 'Δεν έχει επιβεβαιωθεί ότι η μετοχή διαπραγματεύεται ακόμη ενεργά',\n    LISTING_NOT_ACTIVE: 'Η χρηματιστηριακή εγγραφή δεν είναι ενεργή',\n    UNRESOLVED_CONTRADICTION: 'Υπάρχει ανεπίλυτη αντίφαση στις πηγές',"
  ],
  [
    "    ['REFERENCE_PRICE_REQUIRED', 'Ανάκτηση έγκυρης τρέχουσας τιμής'],\n    ['UNRESOLVED_CONTRADICTION', 'Έλεγχος και επίλυση της αντίφασης πριν από οποιαδήποτε πρόταση'],\n  ];\n  for (const [code, label] of priority) if (blockers.includes(code)) return label;\n  return blockers.length ? 'Συμπλήρωση των ελλιπών στοιχείων' : 'Έλεγχος του πλήρους φακέλου';\n}",
    "    ['COMPANY_IDENTITY_REQUIRED', 'Επαλήθευση της ταυτότητας της εταιρείας πριν από οποιαδήποτε πρόταση'],\n    ['EVIDENCE_ENTITY_MISMATCH', 'Αφαίρεση των πηγών άλλης εταιρείας και νέα διασταύρωση'],\n    ['EVIDENCE_ENTITY_UNVERIFIED', 'Σύνδεση κάθε πηγής με τη σωστή εταιρεία'],\n    ['ACTIVE_LISTING_NOT_VERIFIED', 'Επιβεβαίωση ότι η μετοχή διαπραγματεύεται ακόμη ενεργά'],\n    ['LISTING_NOT_ACTIVE', 'Απόρριψη της παλιάς/ανενεργής χρηματιστηριακής εγγραφής'],\n    ['LISTING_IDENTITY_MISMATCH', 'Επανέλεγχος ticker και χρηματιστηριακής ταυτότητας'],\n    ['REFERENCE_PRICE_ENTITY_MISMATCH', 'Ανάκτηση τιμής για τη σωστή εταιρεία'],\n    ['REFERENCE_PRICE_SOURCE_NOT_APPROVED', 'Ανάκτηση τιμής από εγκεκριμένη πηγή'],\n    ['REFERENCE_PRICE_TIMESTAMP_NOT_VERIFIED', 'Επαλήθευση χρόνου της τιμής πριν από άμεση ενέργεια'],\n    ['REFERENCE_PRICE_NOT_DECISION_ELIGIBLE', 'Ανάκτηση decision-grade τιμής πριν από τελική απόφαση'],\n    ['REFERENCE_PRICE_NOT_EXECUTION_ELIGIBLE', 'Ανάκτηση επαληθευμένης φρέσκιας τιμής πριν από άμεση ενέργεια'],\n    ['REFERENCE_PRICE_REQUIRED', 'Ανάκτηση έγκυρης τρέχουσας τιμής'],\n    ['UNRESOLVED_CONTRADICTION', 'Έλεγχος και επίλυση της αντίφασης πριν από οποιαδήποτε πρόταση'],\n  ];\n  for (const [code, label] of priority) if (blockers.includes(code)) return label;\n  return blockers.length ? 'Συμπλήρωση των ελλιπών στοιχείων' : 'Έλεγχος τεκμηρίωσης';\n}"
  ],
  [
    "    primary: item.isPrimarySource === true,\n  }));",
    "    primary: item.isPrimarySource === true,\n    companyIds: Array.isArray(item.companyIds) ? [...item.companyIds] : [],\n  }));"
  ],
  [
    "    nextStep: status === 'REVIEW_READY' ? 'Τελικός έλεγχος και απόφαση δημοσίευσης' : nextStep(blockers),",
    "    nextStep: dossier.finalAction?.status === 'FINAL'\n      ? 'Ανάγνωση τεκμηρίωσης και δική σου τελική απόφαση'\n      : status === 'REVIEW_READY'\n        ? 'Τελικός έλεγχος και απόφαση δημοσίευσης'\n        : nextStep(blockers),"
  ]
];
for (let index = 0; index < operations.length; index += 1) {
  const [from, to] = operations[index];
  content = replaceRequired(content, from, to, `mobile-intelligence-feed replacement ${index + 1}`);
}
fs.writeFileSync(file, content);
console.log("Investor Control v1.8.4 mobile-intelligence-feed integrity patch applied.");
