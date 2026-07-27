const RULES = [
  {
    id: 'SHARE_BUYBACK',
    terms: ['share buyback', 'own shares', 'repurchase programme', 'repurchase program'],
    category: 'EVENT_DRIVEN',
    fundamentalsScore: 45,
    catalystScore: 72,
    riskScore: 30,
    rationale: 'Capital return event that requires valuation, liquidity and execution checks.',
  },
  {
    id: 'EQUITY_ISSUANCE_OR_DILUTION',
    terms: ['unregistered sales of equity', 'stock issuance', 'share capital increase', 'new ordinary shares', 'dilution'],
    category: 'EVENT_RISK',
    fundamentalsScore: 25,
    catalystScore: 35,
    riskScore: 82,
    rationale: 'Potential dilution or capital-structure event requiring document-level review.',
  },
  {
    id: 'DEBT_OR_REFINANCING',
    terms: ['term loan', 'senior secured notes', 'debt refinancing', 'repricing of its eur term loan'],
    category: 'EVENT_RISK',
    fundamentalsScore: 42,
    catalystScore: 48,
    riskScore: 64,
    rationale: 'Financing event that can improve or weaken the risk profile depending on terms.',
  },
  {
    id: 'FINANCIAL_RESULTS',
    terms: ['financial results', 'preliminary results', 'quarterly report', 'annual report', '10-q filing', '10-k filing'],
    category: 'EVENT_DRIVEN',
    fundamentalsScore: 58,
    catalystScore: 55,
    riskScore: 45,
    rationale: 'Results event requiring deterministic comparison with prior periods and expectations.',
  },
  {
    id: 'OPERATIONAL_MILESTONE',
    terms: ['flight test', 'returns to the skies', 'test program', 'test programme', 'commercial service'],
    category: 'SPECULATIVE_CATALYST',
    fundamentalsScore: 22,
    catalystScore: 78,
    riskScore: 88,
    rationale: 'Operational milestone with potentially high upside and high execution risk.',
  },
  {
    id: 'LEGAL_OR_SETTLEMENT',
    terms: ['settlement', 'derivative actions', 'litigation', 'legal proceedings'],
    category: 'EVENT_RISK',
    fundamentalsScore: 38,
    catalystScore: 40,
    riskScore: 68,
    rationale: 'Legal event requiring quantified financial and governance impact.',
  },
];

function normalizedText(record) {
  return `${record?.title || ''} ${record?.notes || ''}`.toLowerCase();
}

export function classifyEvidenceEvent(record) {
  const text = normalizedText(record);
  const rule = RULES.find((candidate) => candidate.terms.some((term) => text.includes(term)));

  if (!rule) {
    return {
      eventType: 'UNCLASSIFIED_OFFICIAL_EVENT',
      category: 'INSUFFICIENT_EVIDENCE',
      fundamentalsScore: 20,
      catalystScore: 20,
      priceConfirmationScore: 0,
      liquidityScore: 50,
      riskScore: 55,
      requiresDeepReview: true,
      rationale: 'Official event detected, but its investment effect is not established from the index-level evidence.',
    };
  }

  return {
    eventType: rule.id,
    category: rule.category,
    fundamentalsScore: rule.fundamentalsScore,
    catalystScore: rule.catalystScore,
    priceConfirmationScore: 0,
    liquidityScore: 50,
    riskScore: rule.riskScore,
    requiresDeepReview: true,
    rationale: rule.rationale,
  };
}

export function candidateFromEvidence(record, options = {}) {
  const classification = classifyEvidenceEvent(record);
  return {
    companyId: record.companyIds?.[0] || null,
    category: classification.category,
    evidence: [record],
    fundamentalsScore: classification.fundamentalsScore,
    catalystScore: classification.catalystScore,
    priceConfirmationScore: classification.priceConfirmationScore,
    liquidityScore: Number(options.liquidityScore ?? classification.liquidityScore),
    personalisationScore: Number(options.personalisationScore ?? 50),
    riskScore: classification.riskScore,
    contradictionPenalty: 0,
    stalenessPenalty: 0,
    hasPosition: options.hasPosition === true,
    eventType: classification.eventType,
    requiresDeepReview: classification.requiresDeepReview,
    rationale: classification.rationale,
  };
}
