import { classifyEvidenceEvent } from './event-classifier.js';

function reviewedRecords(records = []) {
  return records.filter((record) => record?.document?.reviewed === true);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function claim(text, evidenceIds, confidence, inference = false) {
  return {
    text,
    evidenceIds: unique(evidenceIds),
    confidence,
    inference,
  };
}

function selectedEvent(records) {
  const priority = {
    EQUITY_ISSUANCE_OR_DILUTION: 100,
    LEGAL_OR_SETTLEMENT: 90,
    DEBT_OR_REFINANCING: 80,
    FINANCIAL_RESULTS: 70,
    OPERATIONAL_MILESTONE: 60,
    SHARE_BUYBACK: 50,
    UNCLASSIFIED_OFFICIAL_EVENT: 0,
  };
  return records
    .map((record) => ({ record, classification: classifyEvidenceEvent(record) }))
    .sort((a, b) => (priority[b.classification.eventType] || 0) - (priority[a.classification.eventType] || 0))[0] || null;
}

function metricSummary(fundamentals, marketMetrics) {
  const parts = [];
  const revenueGrowth = fundamentals?.metrics?.annualRevenueGrowthPct;
  const netMargin = fundamentals?.metrics?.annualNetMarginPct;
  const dilution = fundamentals?.metrics?.dilutedSharesChangePct;
  const return60 = marketMetrics?.returnsPct?.d60;
  const relative60 = marketMetrics?.relativeStrength?.excessReturnPct;
  if (Number.isFinite(revenueGrowth)) parts.push(`ετήσια μεταβολή εσόδων ${revenueGrowth}%`);
  if (Number.isFinite(netMargin)) parts.push(`ετήσιο καθαρό περιθώριο ${netMargin}%`);
  if (Number.isFinite(dilution)) parts.push(`μεταβολή απομειωμένου αριθμού μετοχών ${dilution}%`);
  if (Number.isFinite(return60)) parts.push(`απόδοση 60 συνεδριάσεων ${return60}%`);
  if (Number.isFinite(relative60)) parts.push(`σχετική ισχύς 60 συνεδριάσεων ${relative60}%`);
  return parts;
}

function fundamentalRiskClaims(fundamentalRisk, evidenceIds) {
  const map = {
    NEGATIVE_FREE_CASH_FLOW: 'Η καταγεγραμμένη παραγωγή ελεύθερων ταμειακών ροών παραμένει αρνητική, αυξάνοντας την εξάρτηση από την υπάρχουσα ρευστότητα ή από νέα χρηματοδότηση.',
    CASH_RUNWAY_UNDER_ONE_YEAR: 'Η ντετερμινιστική εκτίμηση ταμειακής επάρκειας είναι μικρότερη του ενός έτους, δημιουργώντας οξύ κίνδυνο χρηματοδότησης και αραίωσης.',
    CASH_RUNWAY_UNDER_TWO_YEARS: 'Η ντετερμινιστική εκτίμηση ταμειακής επάρκειας είναι μικρότερη των δύο ετών, επομένως η δυνατότητα χρηματοδότησης χρειάζεται στενή παρακολούθηση.',
    SEVERE_DILUTION: 'Ο καταγεγραμμένος απομειωμένος αριθμός μετοχών αυξήθηκε αρκετά ώστε να δημιουργεί σοβαρό κίνδυνο αραίωσης ανά μετοχή.',
    MATERIAL_DILUTION: 'Ο καταγεγραμμένος απομειωμένος αριθμός μετοχών αυξήθηκε αρκετά ώστε να δημιουργεί ουσιαστικό κίνδυνο αραίωσης ανά μετοχή.',
    NON_POSITIVE_EQUITY: 'Τα καταγεγραμμένα ίδια κεφάλαια είναι μη θετικά, μειώνοντας την ανθεκτικότητα του ισολογισμού.',
    VERY_HIGH_LIABILITIES_TO_ASSETS: 'Οι καταγεγραμμένες υποχρεώσεις είναι πολύ υψηλές σε σχέση με τα περιουσιακά στοιχεία, περιορίζοντας σημαντικά τη χρηματοοικονομική ευελιξία.',
    HIGH_LIABILITIES_TO_ASSETS: 'Οι καταγεγραμμένες υποχρεώσεις είναι υψηλές σε σχέση με τα περιουσιακά στοιχεία και μπορεί να περιορίζουν τη μελλοντική κατανομή κεφαλαίου.',
    EXTREME_PRICE_TO_SALES: 'Η ντετερμινιστική εκτίμηση τιμής προς πωλήσεις είναι ακραία, αφήνοντας ελάχιστο περιθώριο για απογοήτευση στην εκτέλεση.',
    HIGH_PRICE_TO_SALES: 'Η ντετερμινιστική εκτίμηση τιμής προς πωλήσεις είναι υψηλή και απαιτεί ισχυρή εκτέλεση για να διατηρηθεί.',
    SEVERE_NEGATIVE_NET_MARGIN: 'Το τελευταίο ετήσιο καθαρό περιθώριο είναι έντονα αρνητικό, επομένως το λειτουργικό μοντέλο δεν έχει ακόμη αποδείξει κερδοφορία.',
    NEGATIVE_NET_MARGIN: 'Το τελευταίο ετήσιο καθαρό περιθώριο είναι αρνητικό, αφήνοντας την επενδυτική υπόθεση εξαρτημένη από μελλοντική λειτουργική βελτίωση.',
  };
  return (fundamentalRisk?.flags || [])
    .filter((flag) => map[flag])
    .map((flag) => claim(map[flag], evidenceIds, 0.88, true));
}

function eventNarrative(eventType, companyName, title) {
  const eventLabel = title || 'το επιβεβαιωμένο εταιρικό γεγονός';
  const templates = {
    SHARE_BUYBACK: {
      category: 'EVENT_DRIVEN',
      action: 'WATCH',
      horizon: 'MONTHS',
      thesis: `Το επιβεβαιωμένο πρόγραμμα επαναγοράς ιδίων μετοχών της ${companyName} μπορεί να βελτιώσει την αξία ανά μετοχή μόνο εφόσον οι αγορές είναι ουσιαστικές, γίνονται σε ελκυστική αποτίμηση και χρηματοδοτούνται χωρίς αποδυνάμωση της ρευστότητας. Αποτελεί μετρήσιμο καταλύτη κατανομής κεφαλαίου, όχι αυτοτελή λόγο αγοράς.`,
      mechanism: 'Οι επαναγορές μειώνουν τον πραγματικό αριθμό μετοχών και μπορούν να αυξήσουν την οικονομική συμμετοχή κάθε εναπομείνασας μετοχής, μόνο όμως όταν η τιμή αγοράς και η πηγή χρηματοδότησης δημιουργούν καθαρή αξία.',
      bull: 'Η εταιρεία πραγματοποιεί ουσιαστικές επαναγορές κάτω από υποστηρίξιμη αποτίμηση, διατηρώντας λειτουργικές ταμειακές ροές και ευελιξία ισολογισμού.',
      bear: 'Οι επαναγορές είναι ασήμαντες, γίνονται σε υπερβολική αποτίμηση ή καταναλώνουν ρευστότητα που αργότερα χρειάζεται για λειτουργία, χρέος ή επενδύσεις.',
      invalidation: 'Η θετική ερμηνεία ακυρώνεται εάν οι επαναγορές σταματήσουν χωρίς ουσιαστική ολοκλήρωση, η ρευστότητα επιδεινωθεί σημαντικά ή ο πραγματικός αριθμός μετοχών δεν μειωθεί.',
      catalyst: `Η επίσημη πηγή επιβεβαιώνει: ${eventLabel}.`,
      risk: 'Μια επαναγορά μπορεί να φαίνεται θετική αλλά να καταστρέφει αξία όταν είναι πολύ μικρή, χρηματοδοτείται με χρέος ή εκτελείται πάνω από υποστηρίξιμη αποτίμηση.',
    },
    EQUITY_ISSUANCE_OR_DILUTION: {
      category: 'EVENT_RISK',
      action: 'CONSIDER_REDUCE',
      horizon: 'WEEKS',
      thesis: `Η επιβεβαιωμένη έκδοση μετοχών ή αραίωση της ${companyName} μπορεί να αποδυναμώσει την οικονομική αξία ανά μετοχή και να δείχνει συνεχιζόμενη ανάγκη εξωτερικής χρηματοδότησης. Η επίπτωση εξαρτάται από τα αντληθέντα κεφάλαια, την τιμή έκδοσης, τη χρήση τους και την εναπομένουσα ταμειακή επάρκεια.`,
      mechanism: 'Οι νέες μετοχές κατανέμουν τη μελλοντική αξία της εταιρείας σε μεγαλύτερο αριθμό τίτλων. Η ζημία περιορίζεται μόνο όταν το νέο κεφάλαιο δημιουργεί περισσότερη αξία από την αραίωση που επιβάλλει.',
      bull: 'Το κεφάλαιο αντλείται με αποδεκτούς όρους και χρηματοδοτεί σαφές ορόσημο που βελτιώνει ουσιαστικά τις μελλοντικές ταμειακές ροές ή την πιθανότητα επιβίωσης.',
      bear: 'Επαναλαμβανόμενες χρηματοδοτήσεις γίνονται σε χαμηλές τιμές, ο αριθμός μετοχών αυξάνεται ταχύτερα από την επιχειρηματική αξία και τα λειτουργικά ορόσημα συνεχίζουν να καθυστερούν.',
      invalidation: 'Η υπόθεση κινδύνου ακυρώνεται μόνο εάν η χρηματοδότηση ολοκληρωθεί με ευνοϊκούς όρους και τα χρηματοδοτούμενα ορόσημα επιτευχθούν χωρίς νέα ουσιαστική αραίωση.',
      catalyst: `Η επίσημη πηγή επιβεβαιώνει: ${eventLabel}.`,
      risk: 'Πρόσθετες κεφαλαιακές ανάγκες μπορεί να προκαλέσουν νέα αραίωση πριν το λειτουργικό μοντέλο γίνει αυτοχρηματοδοτούμενο.',
    },
    DEBT_OR_REFINANCING: {
      category: 'EVENT_RISK',
      action: 'WATCH',
      horizon: 'MONTHS',
      thesis: `Το επιβεβαιωμένο χρηματοδοτικό γεγονός της ${companyName} μπορεί είτε να μειώσει τον βραχυπρόθεσμο κίνδυνο είτε να αυξήσει τη μόχλευση, ανάλογα με το κόστος, τη λήξη, τους όρους και τη δυνατότητα παραγωγής ταμειακών ροών. Οι όροι του χρέους πρέπει να αξιολογούνται μαζί με τη ρευστότητα και τις λειτουργικές ταμειακές ροές.`,
      mechanism: 'Η αναχρηματοδότηση αλλάζει το κόστος τόκων, την πίεση λήξεων και τον κίνδυνο παραβίασης όρων, επηρεάζοντας άμεσα την πιθανότητα οι μέτοχοι να διατηρήσουν τη μελλοντική επιχειρηματική αξία.',
      bull: 'Οι λήξεις παρατείνονται, το κόστος χρηματοδότησης μειώνεται και το περιθώριο ασφαλείας των όρων βελτιώνεται χωρίς υπερβολικές εξασφαλισμένες απαιτήσεις.',
      bear: 'Η εταιρεία πληρώνει υψηλότερο κόστος, δεσμεύει σημαντικά περιουσιακά στοιχεία ή απλώς μεταθέτει το πρόβλημα χωρίς βελτίωση της παραγωγής μετρητών.',
      invalidation: 'Η ευνοϊκή ερμηνεία ακυρώνεται εάν το βάρος τόκων αυξηθεί ουσιαστικά, το περιθώριο των όρων περιοριστεί ή οι ελεύθερες ταμειακές ροές παραμείνουν ανεπαρκείς για την εξυπηρέτηση του χρέους.',
      catalyst: `Η επίσημη πηγή επιβεβαιώνει: ${eventLabel}.`,
      risk: 'Μια θετική επικεφαλίδα αναχρηματοδότησης μπορεί να κρύβει υψηλότερους τόκους, περιοριστικούς όρους ή υποβάθμιση της θέσης των υφιστάμενων μετόχων.',
    },
    FINANCIAL_RESULTS: {
      category: 'EVENT_DRIVEN',
      action: 'WATCH',
      horizon: 'MONTHS',
      thesis: `Τα επιβεβαιωμένα οικονομικά αποτελέσματα της ${companyName} αποτελούν νέο έλεγχο της ποιότητας εσόδων, των περιθωρίων, των ταμειακών ροών, της αραίωσης και της ανθεκτικότητας του ισολογισμού. Θετικό συμπέρασμα απαιτεί βελτίωση σε περισσότερες από μία μετρήσεις και όχι έναν μόνο τίτλο.`,
      mechanism: 'Διατηρήσιμες μεταβολές στα έσοδα, στα περιθώρια και στην παραγωγή μετρητών αλλάζουν τις αναμενόμενες μελλοντικές ταμειακές ροές και συνεπώς την αποτίμηση που μπορεί να υποστηριχθεί ορθολογικά.',
      bull: 'Η ποιότητα εσόδων βελτιώνεται, οι ζημίες περιορίζονται ή οι ταμειακές ροές ενισχύονται, ενώ η διοίκηση πετυχαίνει λειτουργικά ορόσημα χωρίς υπερβολική αραίωση.',
      bear: 'Η ονομαστική ανάπτυξη δεν μετατρέπεται σε μετρητά, οι ζημίες παραμένουν δομικά υψηλές ή η εταιρεία χρειάζεται επαναλαμβανόμενη εξωτερική χρηματοδότηση.',
      invalidation: 'Μια θετική υπόθεση αποτελεσμάτων ακυρώνεται εάν η επόμενη περίοδος αντιστρέψει τη βελτίωση ή η κατανάλωση μετρητών και η αραίωση παραμείνουν ουσιαστικά χειρότερες από το αναμενόμενο.',
      catalyst: `Η επίσημη πηγή επιβεβαιώνει: ${eventLabel}.`,
      risk: 'Η καταγεγραμμένη ανάπτυξη μπορεί να είναι προσωρινή, χαμηλής ποιότητας ή ανεπαρκής για να αντισταθμίσει λειτουργικές ζημίες και χρηματοδοτικές ανάγκες.',
    },
    OPERATIONAL_MILESTONE: {
      category: 'SPECULATIVE_CATALYST',
      action: 'WATCH',
      horizon: 'MONTHS',
      thesis: `Το επιβεβαιωμένο λειτουργικό ορόσημο της ${companyName} μπορεί να αλλάξει την πιθανότητα επιτυχούς εκτέλεσης, αλλά δεν αποδεικνύει από μόνο του εμπορική κλιμάκωση, ζήτηση ή θετικά οικονομικά ανά μονάδα. Η υπόθεση παραμένει κερδοσκοπική μέχρι τα ορόσημα να μετατραπούν σε επαναλαμβανόμενη λειτουργία και οικονομικά αποτελέσματα.`,
      mechanism: 'Η επιτυχής τεχνική εκτέλεση μειώνει ένα επίπεδο κινδύνου και μπορεί να φέρει πιο κοντά την παραγωγή εσόδων, ενώ καθυστερήσεις ή αποτυχίες αυξάνουν χρόνο, κόστος και ανάγκες χρηματοδότησης.',
      bull: 'Το ορόσημο ολοκληρώνεται έγκαιρα, επαναλαμβάνεται επιτυχώς και ακολουθείται από αξιόπιστη μετάβαση σε εμπορική λειτουργία και πραγματικές εισπράξεις.',
      bear: 'Οι δοκιμές ή οι πιστοποιήσεις καθυστερούν, το κόστος αυξάνεται και η εταιρεία χρειάζεται πρόσθετη χρηματοδότηση πριν η εμπορική λειτουργία γίνει επαναλαμβανόμενη.',
      invalidation: 'Η θετική ερμηνεία ακυρώνεται εάν το επόμενο καθορισμένο ορόσημο καθυστερήσει ουσιαστικά, αποτύχει τεχνικά ή απαιτήσει σημαντικά περισσότερο κεφάλαιο από το προβλεπόμενο.',
      catalyst: `Η επίσημη πηγή επιβεβαιώνει: ${eventLabel}.`,
      risk: 'Ένα τεχνικό ορόσημο μπορεί να προκαλέσει βραχυπρόθεσμο ενθουσιασμό στην τιμή χωρίς να αποδεικνύει βιώσιμη επιχείρηση ή επαρκή ταμειακή επάρκεια.',
    },
    LEGAL_OR_SETTLEMENT: {
      category: 'EVENT_RISK',
      action: 'WATCH',
      horizon: 'MONTHS',
      thesis: `Το επιβεβαιωμένο νομικό γεγονός της ${companyName} μπορεί να αλλάξει τις χρηματικές υποχρεώσεις, τον κίνδυνο διακυβέρνησης ή την απόσπαση της διοίκησης. Η επενδυτική επίπτωση δεν μπορεί να κριθεί μόνο από τον τίτλο και απαιτεί ποσοτικοποίηση των όρων και έλεγχο τυχόν υπολειπόμενων αξιώσεων.`,
      mechanism: 'Τα νομικά αποτελέσματα μεταφέρουν μετρητά, αλλάζουν μελλοντικές υποχρεώσεις και μπορεί να αποκαλύψουν αδυναμίες διακυβέρνησης που επηρεάζουν την έκπτωση κινδύνου της εταιρείας.',
      bull: 'Η υπόθεση επιλύεται με διαχειρίσιμο κόστος και χωρίς ουσιαστικές συνεχιζόμενες υποχρεώσεις ή λειτουργικούς περιορισμούς.',
      bear: 'Ο διακανονισμός είναι ακριβός, προκαλεί συναφείς αξιώσεις ή αποκαλύπτει ευρύτερες αδυναμίες διακυβέρνησης και γνωστοποιήσεων.',
      invalidation: 'Η ευνοϊκή ερμηνεία ακυρώνεται εάν εμφανιστούν πρόσθετες ουσιαστικές αξιώσεις ή το τελικό χρηματικό και διοικητικό κόστος ξεπεράσει σημαντικά το γνωστοποιημένο βασικό σενάριο.',
      catalyst: `Η επίσημη πηγή επιβεβαιώνει: ${eventLabel}.`,
      risk: 'Το γνωστοποιημένο γεγονός μπορεί να μην καλύπτει συναφείς αξιώσεις, νομικά έξοδα, ζημία φήμης ή απόσπαση της διοίκησης.',
    },
  };
  return templates[eventType] || {
    category: 'INSUFFICIENT_EVIDENCE',
    action: 'WATCH',
    horizon: 'UNDETERMINED',
    thesis: `Η ${companyName} έχει μια αναγνωσμένη επίσημη εξέλιξη, αλλά οι ντετερμινιστικοί κανόνες δεν μπορούν ακόμη να θεμελιώσουν αρκετά συγκεκριμένη αιτιώδη επενδυτική θέση. Το γεγονός πρέπει να παραμείνει υπό παρακολούθηση μέχρι οι οικονομικές και χρηματιστηριακές συνέπειές του να είναι μετρήσιμες.`,
    mechanism: 'Το γεγονός μπορεί να επηρεάσει την αξία μόνο μέσω μετρήσιμης αλλαγής στις ταμειακές ροές, στον κίνδυνο ισολογισμού, στον αριθμό μετοχών, στην πιθανότητα λειτουργικής επιτυχίας ή στις προσδοκίες αποτίμησης.',
    bull: 'Μεταγενέστερα επαληθευμένα στοιχεία αποδεικνύουν ευνοϊκή και διατηρήσιμη οικονομική επίδραση που δεν έχει ήδη ενσωματωθεί στην αποτίμηση.',
    bear: 'Το γεγονός αποδεικνύεται ασήμαντο, αναιρείται από νεότερα στοιχεία ή παράγει ασθενέστερα οικονομικά αποτελέσματα από όσα αναμένει η αγορά.',
    invalidation: 'Η υπόθεση παραμένει μη ταξινομημένη μέχρι να υποστηρίζονται από επαληθευμένα στοιχεία ένας μετρήσιμος αιτιώδης σύνδεσμος και σαφής συνθήκη ακύρωσης.',
    catalyst: `Η επίσημη πηγή επιβεβαιώνει: ${eventLabel}.`,
    risk: 'Τα διαθέσιμα στοιχεία μπορεί να είναι πραγματικά αλλά όχι οικονομικά ουσιαστικά για τους μετόχους.',
  };
}

function actionFromMetrics(baseAction, eventType, fundamentals, marketMetrics, fundamentalRisk) {
  if (eventType === 'EQUITY_ISSUANCE_OR_DILUTION' && (fundamentalRisk?.flags || []).some((flag) => ['SEVERE_DILUTION', 'CASH_RUNWAY_UNDER_ONE_YEAR'].includes(flag))) {
    return 'CONSIDER_REDUCE';
  }
  if (eventType === 'FINANCIAL_RESULTS') {
    const growth = fundamentals?.metrics?.annualRevenueGrowthPct;
    const margin = fundamentals?.metrics?.annualNetMarginPct;
    const relative = marketMetrics?.relativeStrength?.excessReturnPct;
    if (growth > 10 && margin > 0 && relative > 0 && fundamentalRisk?.riskScore < 55) return 'CONSIDER_BUY';
    if ((margin < -50 || fundamentalRisk?.riskScore >= 80) && relative < 0) return 'CONSIDER_REDUCE';
  }
  return baseAction;
}

export function synthesizeEvidenceOnlyResearch(input = {}) {
  const company = input.company || {};
  const reviewed = reviewedRecords(input.evidence || []);
  if (!reviewed.length) {
    return {
      category: 'INSUFFICIENT_EVIDENCE',
      proposedAction: 'WATCH',
      timeHorizon: 'UNDETERMINED',
      thesis: null,
      causalMechanism: null,
      catalysts: [],
      bullCase: null,
      bearCase: null,
      risks: [],
      invalidationCondition: null,
      reviewDate: null,
      synthesisVersion: 1,
      blockers: ['REVIEWED_EVIDENCE_REQUIRED'],
    };
  }

  const event = selectedEvent(reviewed);
  const eventType = event.classification.eventType;
  const companyName = company.displayName || company.legalName || 'εταιρεία';
  const narrative = eventNarrative(eventType, companyName, event.record.title);
  const evidenceIds = reviewed.map((record) => record.id);
  const metrics = metricSummary(input.fundamentals, input.historicalMarketMetrics);
  const metricSentence = metrics.length
    ? ` Οι ντετερμινιστικοί υπολογισμοί καταγράφουν σήμερα: ${metrics.join(', ')}. Οι τιμές αυτές αποτελούν εισόδους υπολογισμού και δεν υποκαθιστούν τους ελέγχους τεκμηρίωσης.`
    : '';
  const riskClaims = fundamentalRiskClaims(input.fundamentalRisk, evidenceIds);
  const reviewDays = eventType === 'EQUITY_ISSUANCE_OR_DILUTION' ? 30 : narrative.horizon === 'MONTHS' ? 90 : 60;
  const generatedAt = new Date(input.generatedAt || Date.now());
  const reviewDate = new Date(generatedAt.getTime() + reviewDays * 86_400_000).toISOString().slice(0, 10);

  return {
    category: narrative.category,
    proposedAction: actionFromMetrics(
      narrative.action,
      eventType,
      input.fundamentals,
      input.historicalMarketMetrics,
      input.fundamentalRisk,
    ),
    timeHorizon: narrative.horizon,
    thesis: `${narrative.thesis}${metricSentence}`,
    causalMechanism: narrative.mechanism,
    catalysts: [claim(narrative.catalyst, [event.record.id], 0.94, false)],
    bullCase: narrative.bull,
    bearCase: narrative.bear,
    risks: [
      claim(narrative.risk, [event.record.id], 0.82, true),
      ...riskClaims,
      claim('Η τιμή και η ρευστότητα της μετοχής μπορεί να αντιδράσουν διαφορετικά από την υποκείμενη εταιρική εξέλιξη, ιδιαίτερα όταν οι προσδοκίες είχαν ήδη ενσωματωθεί πριν από τη δημοσίευση.', evidenceIds, 0.72, true),
    ].slice(0, 8),
    invalidationCondition: narrative.invalidation,
    reviewDate,
    synthesisVersion: 1,
    eventType,
    sourceEvidenceIds: evidenceIds,
    blockers: [],
  };
}
