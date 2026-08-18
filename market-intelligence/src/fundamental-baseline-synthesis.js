export const FUNDAMENTAL_BASELINE_SYNTHESIS_VERSION = '2026-08-08.1';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function claim(text, evidenceIds, confidence, inference = true) {
  return {
    text,
    evidenceIds: [...new Set((evidenceIds || []).filter(Boolean))],
    confidence,
    inference,
  };
}

function fmt(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function reviewDate(generatedAt, days = 30) {
  const date = new Date(generatedAt || Date.now());
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function marketState(market = {}) {
  return {
    relative60: finite(market?.relativeStrength?.excessReturnPct),
    return60: finite(market?.returnsPct?.d60 ?? market?.returns?.return60Pct),
    distance50: finite(market?.trend?.distanceFromSma50Pct),
    distance200: finite(market?.trend?.distanceFromSma200Pct),
    volatility: finite(market?.volatility?.annualizedPct ?? market?.risk?.annualizedVolatilityPct),
    liquidity: finite(market?.liquidity?.score),
  };
}

function operatingSynthesis(input, evidenceIds) {
  const f = input.fundamentals || {};
  const risk = input.fundamentalRisk || {};
  const market = marketState(input.historicalMarketMetrics);
  const growth = finite(f?.metrics?.annualRevenueGrowthPct);
  const margin = finite(f?.metrics?.annualNetMarginPct);
  const dilution = finite(f?.metrics?.dilutedSharesChangePct);
  const riskScore = finite(risk?.riskScore);
  const ps = finite(risk?.valuation?.priceToSales);
  const pb = finite(risk?.valuation?.priceToBook);
  const flags = Array.isArray(risk?.flags) ? risk.flags : [];
  const severe = flags.some((flag) => ['CASH_RUNWAY_UNDER_ONE_YEAR', 'SEVERE_DILUTION', 'NON_POSITIVE_EQUITY', 'VERY_HIGH_LIABILITIES_TO_ASSETS', 'SEVERE_NEGATIVE_NET_MARGIN'].includes(flag)) || (riskScore !== null && riskScore >= 85);
  const weak = (market.relative60 !== null && market.relative60 < -10) || (market.distance50 !== null && market.distance50 < -8);
  const positive = (market.relative60 ?? -999) > 0 && (market.distance50 ?? -999) > 0;
  const valuationExtreme = (ps !== null && ps >= 15) || (pb !== null && pb >= 8);

  let proposedAction = 'HOLD';
  let category = 'FUNDAMENTAL_BASELINE';
  if (severe) {
    proposedAction = 'AVOID';
    category = 'FUNDAMENTAL_RISK';
  } else if (riskScore !== null && riskScore >= 70 && weak) {
    proposedAction = 'CONSIDER_REDUCE';
    category = 'FUNDAMENTAL_RISK';
  } else if (
    riskScore !== null && riskScore <= 50 &&
    growth !== null && growth > 5 &&
    margin !== null && margin > 0 &&
    positive && !valuationExtreme
  ) {
    proposedAction = 'CONSIDER_BUY';
    category = 'FUNDAMENTAL_QUALITY';
  }

  const metrics = [
    growth !== null ? `μεταβολή εσόδων ${fmt(growth)}%` : null,
    margin !== null ? `καθαρό περιθώριο ${fmt(margin)}%` : null,
    ps !== null ? `P/S ${fmt(ps)}x` : null,
    pb !== null ? `P/B ${fmt(pb)}x` : null,
    riskScore !== null ? `fundamental risk ${fmt(riskScore, 0)}/100` : null,
    market.relative60 !== null ? `σχετική ισχύς 60 συνεδριάσεων ${fmt(market.relative60)}%` : null,
  ].filter(Boolean);

  const fundamentalRiskText = severe
    ? 'Η επαληθευμένη θεμελιώδης εικόνα περιλαμβάνει σοβαρό risk flag ή πολύ υψηλό συνολικό fundamental risk score.'
    : flags.length
      ? `Οι βασικοί θεμελιώδεις κίνδυνοι που παραμένουν ενεργοί είναι: ${flags.join(', ')}.`
      : 'Δεν ενεργοποιείται σοβαρό deterministic fundamental risk flag στα διαθέσιμα επαληθευμένα στοιχεία.';
  const marketRiskText = weak
    ? 'Η ανεξάρτητη χρηματιστηριακή εικόνα είναι αδύναμη σε σχετική ισχύ ή βραχυμεσαία τάση και αυξάνει τον κίνδυνο λανθασμένου timing.'
    : 'Η χρηματιστηριακή εικόνα δεν αναιρεί από μόνη της τη θεμελιώδη θέση, αλλά παραμένει πηγή μεταβλητότητας και timing risk.';

  return {
    decisionBasis: 'FUNDAMENTAL_BASELINE',
    category,
    proposedAction,
    timeHorizon: 'MONTHS',
    thesis: `Η επενδυτική θέση βασίζεται αποκλειστικά σε επαληθευμένα οικονομικά στοιχεία και ανεξάρτητη κατάσταση αγοράς, χωρίς να χρησιμοποιεί μη διασταυρωμένο εταιρικό γεγονός ως καταλύτη. ${metrics.length ? `Οι κύριες μετρήσεις είναι ${metrics.join(', ')}.` : ''} Η κατεύθυνση παραμένει συντηρητική και επανεξετάζεται όταν αλλάξει ουσιωδώς η κερδοφορία, ο ισολογισμός, η αποτίμηση ή η σχετική ισχύς.`,
    causalMechanism: 'Η αξία ανά μετοχή επηρεάζεται από τη διατηρήσιμη ανάπτυξη εσόδων και κερδών, την παραγωγή ταμειακών ροών, τη χρηματοοικονομική ανθεκτικότητα, την αραίωση και την τιμή που πληρώνει ο επενδυτής σε σχέση με τα οικονομικά μεγέθη. Η αγορά χρησιμοποιείται ως ανεξάρτητη διάσταση επιβεβαίωσης του κινδύνου και όχι ως απόδειξη εταιρικού claim.',
    catalysts: [claim(
      growth !== null && growth > 0
        ? `Ο βασικός επαληθευμένος fundamental driver είναι η καταγεγραμμένη αύξηση εσόδων κατά ${fmt(growth)}%, εφόσον διατηρηθεί χωρίς υποβάθμιση περιθωρίων ή ισολογισμού.`
        : 'Ο βασικός driver της θέσης είναι η μελλοντική βελτίωση των επαληθευμένων οικονομικών μεγεθών χωρίς επιδείνωση ισολογισμού ή αραίωση.',
      evidenceIds,
      0.86,
      true,
    )],
    bullCase: 'Το θετικό σενάριο απαιτεί διατηρήσιμη ανάπτυξη, σταθερή ή βελτιούμενη κερδοφορία, ελεγχόμενο ισολογισμό και αποτίμηση που δεν επεκτείνεται ταχύτερα από τα θεμελιώδη μεγέθη.',
    bearCase: 'Το αρνητικό σενάριο ενεργοποιείται εάν η ανάπτυξη επιβραδυνθεί, τα περιθώρια ή οι ταμειακές ροές επιδεινωθούν, αυξηθεί η αραίωση/μόχλευση ή η αγορά συνεχίσει να υποαποδίδει παρά την υποτιθέμενη θεμελιώδη βελτίωση.',
    risks: [
      claim(fundamentalRiskText, evidenceIds, 0.9, true),
      claim(marketRiskText, evidenceIds, 0.82, true),
    ],
    invalidationCondition: 'Η θέση ακυρώνεται ή υποβαθμίζεται όταν τα επόμενα επαληθευμένα αποτελέσματα παραβιάσουν τις βασικές παραδοχές κερδοφορίας/ισολογισμού ή όταν η αποτίμηση και η αγορά κινηθούν σε επίπεδα ασύμβατα με το αποδεκτό risk/reward.',
    reviewDate: reviewDate(input.generatedAt, 45),
    requireCanonicalClaim: false,
    sourceEvidenceIds: evidenceIds,
    blockers: [],
  };
}

function bankSynthesis(input, evidenceIds) {
  const risk = input.fundamentalRisk || {};
  const bank = risk?.specializedAnalysis || {};
  const bankRisk = bank?.riskAssessment || {};
  const score = finite(bankRisk?.score);
  const flags = Array.isArray(bankRisk?.flags) ? bankRisk.flags : [];
  const valuation = bank?.valuation || {};
  const pb = finite(valuation?.priceToBook);
  const metrics = bank?.metrics || {};
  const loanDeposit = finite(metrics?.loanToDepositPct);
  const stage3 = finite(metrics?.stage3GrossLoansPct ?? metrics?.nonaccrualToLoansPct);
  const capital = bank?.regulatoryCapital || {};
  const compliant = capital?.compliant !== false;
  const market = marketState(input.historicalMarketMetrics);
  const positive = (market.relative60 ?? -999) > 0 && (market.distance50 ?? -999) > -3;
  const weak = (market.relative60 !== null && market.relative60 < -10) || (market.distance50 !== null && market.distance50 < -8);
  const severe = !compliant || flags.some((flag) => ['BANK_CAPITAL_BELOW_REQUIREMENT', 'BANK_HIGH_STAGE3_LOANS'].includes(flag)) || (score !== null && score >= 80);

  let proposedAction = 'HOLD';
  let category = 'BANK_FUNDAMENTAL_BASELINE';
  if (severe) {
    proposedAction = 'AVOID';
    category = 'BANK_RISK';
  } else if (score !== null && score >= 65 && weak) {
    proposedAction = 'CONSIDER_REDUCE';
    category = 'BANK_RISK';
  } else if (score !== null && score <= 45 && pb !== null && pb <= 1.25 && positive && (stage3 === null || stage3 <= 4) && (loanDeposit === null || loanDeposit <= 105)) {
    proposedAction = 'CONSIDER_BUY';
    category = 'BANK_QUALITY_VALUE';
  }

  const capitalBufferText = capital?.buffersPct
    ? `CET1 buffer ${fmt(finite(capital.buffersPct.cet1))} π.μ., Tier 1 buffer ${fmt(finite(capital.buffersPct.tier1))} π.μ. και συνολικό capital buffer ${fmt(finite(capital.buffersPct.total))} π.μ.`
    : 'Οι κεφαλαιακοί δείκτες χρησιμοποιούνται μόνο όταν έχουν εξαχθεί από επαληθευμένο εποπτικό πίνακα.';

  return {
    decisionBasis: 'FUNDAMENTAL_BASELINE',
    category,
    proposedAction,
    timeHorizon: 'MONTHS',
    thesis: `Η τραπεζική θέση βασίζεται στο εξειδικευμένο Bank Passport και όχι σε generic P/S ή cash-runway μοντέλο. ${pb !== null ? `Η τρέχουσα P/B εκτίμηση είναι ${fmt(pb)}x.` : ''} ${loanDeposit !== null ? `Ο δείκτης δανείων προς καταθέσεις είναι ${fmt(loanDeposit)}%.` : ''} ${stage3 !== null ? `Ο δείκτης προβληματικών/Stage 3 δανείων που χρησιμοποιεί το μοντέλο είναι ${fmt(stage3)}%.` : ''} ${capitalBufferText}`, 
    causalMechanism: 'Για τράπεζα, η δημιουργία αξίας εξαρτάται από απόδοση ιδίων κεφαλαίων, ποιότητα ενεργητικού, κόστος πιστωτικού κινδύνου, χρηματοδότηση μέσω καταθέσεων και κεφαλαιακά περιθώρια πάνω από τις εποπτικές απαιτήσεις. Η αποτίμηση ελέγχεται κυρίως έναντι λογιστικής αξίας και όχι με operating-company multiples.',
    catalysts: [claim(
      'Ο βασικός fundamental driver είναι η διατήρηση επαρκών κεφαλαιακών buffers μαζί με βελτίωση κερδοφορίας και ποιότητας ενεργητικού.',
      evidenceIds,
      0.9,
      true,
    )],
    bullCase: 'Η κερδοφορία και η απόδοση ιδίων κεφαλαίων βελτιώνονται, οι προβληματικές εκθέσεις παραμένουν ελεγχόμενες, οι καταθέσεις χρηματοδοτούν επαρκώς το δανειακό βιβλίο και τα κεφαλαιακά buffers παραμένουν σαφώς πάνω από τις απαιτήσεις.',
    bearCase: 'Η ποιότητα ενεργητικού επιδεινώνεται, οι προβλέψεις αυξάνονται, οι καταθέσεις ή τα κεφαλαιακά buffers πιέζονται και η κερδοφορία δεν δικαιολογεί την αποτίμηση.',
    risks: [
      claim(flags.length ? `Το Bank Passport ενεργοποιεί τους εξής risk flags: ${flags.join(', ')}.` : 'Δεν ενεργοποιείται σοβαρό bank-specific risk flag στα διαθέσιμα επαληθευμένα στοιχεία.', evidenceIds, 0.92, true),
      claim(weak ? 'Η ανεξάρτητη εικόνα αγοράς παραμένει αδύναμη και αυξάνει τον κίνδυνο timing ακόμη και αν οι λογιστικοί δείκτες είναι επαρκείς.' : 'Η τιμή της τραπεζικής μετοχής παραμένει ευαίσθητη σε πιστωτικό κύκλο, επιτόκια, καταθέσεις, ρυθμιστικές αλλαγές και market sentiment.', evidenceIds, 0.84, true),
    ],
    invalidationCondition: 'Η θέση ακυρώνεται εάν οι πραγματικοί κεφαλαιακοί δείκτες πλησιάσουν ή υποχωρήσουν κάτω από τις απαιτήσεις, η ποιότητα ενεργητικού επιδεινωθεί ουσιωδώς ή η κερδοφορία/ROE δεν στηρίζει πλέον την αποτίμηση.',
    reviewDate: reviewDate(input.generatedAt, 30),
    requireCanonicalClaim: false,
    sourceEvidenceIds: evidenceIds,
    blockers: [],
  };
}

export function synthesizeFundamentalBaseline(input = {}) {
  const corroboration = input.decisionCorroboration || null;
  const profile = input.instrumentProfile || null;
  if (corroboration?.ready !== true) {
    return {
      decisionBasis: 'FUNDAMENTAL_BASELINE',
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
      requireCanonicalClaim: false,
      sourceEvidenceIds: corroboration?.evidenceIds || [],
      blockers: corroboration?.blockers || ['DECISION_CORROBORATION_REQUIRED'],
    };
  }
  const evidenceIds = corroboration.evidenceIds || [];
  if (profile?.analysisModel === 'EQUITY_OPERATING') return operatingSynthesis(input, evidenceIds);
  if (profile?.analysisModel === 'EQUITY_BANK') return bankSynthesis(input, evidenceIds);
  return {
    decisionBasis: 'FUNDAMENTAL_BASELINE',
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
    requireCanonicalClaim: false,
    sourceEvidenceIds: evidenceIds,
    blockers: ['BASELINE_MODEL_NOT_SUPPORTED'],
  };
}
