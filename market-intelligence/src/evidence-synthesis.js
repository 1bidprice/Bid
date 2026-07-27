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
  const return60 = marketMetrics?.returnsPct?.sessions60;
  const relative60 = marketMetrics?.relativeStrength?.sessions60Pct;
  if (Number.isFinite(revenueGrowth)) parts.push(`annual revenue growth ${revenueGrowth}%`);
  if (Number.isFinite(netMargin)) parts.push(`annual net margin ${netMargin}%`);
  if (Number.isFinite(dilution)) parts.push(`diluted-share change ${dilution}%`);
  if (Number.isFinite(return60)) parts.push(`60-session return ${return60}%`);
  if (Number.isFinite(relative60)) parts.push(`60-session relative strength ${relative60}%`);
  return parts;
}

function fundamentalRiskClaims(fundamentalRisk, evidenceIds) {
  const map = {
    NEGATIVE_FREE_CASH_FLOW: 'Reported cash generation remains negative, increasing dependence on existing liquidity or future financing.',
    CASH_RUNWAY_UNDER_ONE_YEAR: 'The deterministic cash-runway estimate is below one year, creating acute financing and dilution risk.',
    CASH_RUNWAY_UNDER_TWO_YEARS: 'The deterministic cash-runway estimate is below two years, so financing capacity must be monitored closely.',
    SEVERE_DILUTION: 'The reported diluted-share count increased materially enough to create severe per-share dilution risk.',
    MATERIAL_DILUTION: 'The reported diluted-share count increased enough to create material per-share dilution risk.',
    NON_POSITIVE_EQUITY: 'Reported shareholders’ equity is non-positive, weakening balance-sheet resilience.',
    VERY_HIGH_LIABILITIES_TO_ASSETS: 'Reported liabilities are very high relative to assets, limiting financial flexibility.',
    HIGH_LIABILITIES_TO_ASSETS: 'Reported liabilities are high relative to assets and may constrain future capital allocation.',
    EXTREME_PRICE_TO_SALES: 'The deterministic price-to-sales estimate is extreme, leaving little room for execution disappointment.',
    HIGH_PRICE_TO_SALES: 'The deterministic price-to-sales estimate is high and requires strong execution to be sustained.',
    SEVERE_NEGATIVE_NET_MARGIN: 'The latest annual net margin is severely negative, so the operating model has not yet demonstrated profitability.',
    NEGATIVE_NET_MARGIN: 'The latest annual net margin is negative, leaving the investment case dependent on future operating improvement.',
  };
  return (fundamentalRisk?.flags || [])
    .filter((flag) => map[flag])
    .map((flag) => claim(map[flag], evidenceIds, 0.88, true));
}

function eventNarrative(eventType, companyName, title) {
  const eventLabel = title || 'the verified corporate event';
  const templates = {
    SHARE_BUYBACK: {
      category: 'EVENT_DRIVEN',
      action: 'WATCH',
      horizon: 'MONTHS',
      thesis: `${companyName}'s verified share-buyback event may improve per-share value only if purchases are material, executed at an attractive valuation and funded without weakening liquidity. The event is therefore a measurable capital-allocation catalyst, not a standalone reason to buy.`,
      mechanism: 'Repurchases reduce the effective share count and can increase each remaining share’s economic participation, but only when the purchase price and funding source create net value.',
      bull: 'The company executes meaningful repurchases below a supportable valuation while operating cash generation and balance-sheet flexibility remain intact.',
      bear: 'The repurchases are immaterial, occur at an excessive valuation or consume liquidity that is later needed for operations, debt service or investment.',
      invalidation: 'Invalidate the positive interpretation if repurchases stop without completion, liquidity deteriorates materially or the effective share count does not decline.',
      catalyst: `The official source confirms ${eventLabel.toLowerCase()}.`,
      risk: 'A buyback can be optically positive while destroying value if it is too small, debt-funded or executed above a supportable valuation.',
    },
    EQUITY_ISSUANCE_OR_DILUTION: {
      category: 'EVENT_RISK',
      action: 'CONSIDER_REDUCE',
      horizon: 'WEEKS',
      thesis: `${companyName}'s verified equity issuance or dilution event can weaken per-share economics and may signal a continuing need for external capital. The impact depends on proceeds, issue price, use of funds and the company’s remaining cash runway.`,
      mechanism: 'New shares spread the company’s future value across a larger share count; the damage is reduced only when the capital raised creates more value than the dilution imposed.',
      bull: 'The capital is raised on acceptable terms and finances a clearly defined milestone that materially improves future cash generation or survival probability.',
      bear: 'Repeated financing occurs at weak prices, the share count expands faster than enterprise value and operating milestones continue to slip.',
      invalidation: 'Invalidate the risk thesis only if the financing closes on favourable terms and funded milestones are delivered without further material dilution.',
      catalyst: `The official source confirms ${eventLabel.toLowerCase()}.`,
      risk: 'Further capital requirements may cause additional dilution before the operating model becomes self-funding.',
    },
    DEBT_OR_REFINANCING: {
      category: 'EVENT_RISK',
      action: 'WATCH',
      horizon: 'MONTHS',
      thesis: `${companyName}'s verified financing event can either reduce near-term risk or increase leverage depending on pricing, maturity, covenants and cash-flow capacity. The debt terms must be assessed against liquidity and operating cash generation.`,
      mechanism: 'Refinancing changes interest cost, maturity pressure and covenant risk, which directly alters the probability that equity holders retain future enterprise value.',
      bull: 'Maturities are extended, financing cost falls and covenant headroom improves without adding excessive secured claims.',
      bear: 'The company pays a higher cost, pledges material assets or merely postpones a financing problem without improving cash generation.',
      invalidation: 'Invalidate the favourable interpretation if interest burden rises materially, covenant headroom narrows or free cash flow remains insufficient for debt service.',
      catalyst: `The official source confirms ${eventLabel.toLowerCase()}.`,
      risk: 'Headline refinancing can conceal higher interest expense, restrictive covenants or subordination of existing equity value.',
    },
    FINANCIAL_RESULTS: {
      category: 'EVENT_DRIVEN',
      action: 'WATCH',
      horizon: 'MONTHS',
      thesis: `${companyName}'s verified financial-results event provides a fresh test of revenue quality, margins, cash generation, dilution and balance-sheet resilience. A positive investment conclusion requires improvement across several measures rather than a single headline number.`,
      mechanism: 'Sustained changes in revenue, margins and cash generation alter expected future cash flows and therefore the valuation investors can rationally support.',
      bull: 'Revenue quality improves, losses narrow or cash generation strengthens while management meets operational milestones without excessive dilution.',
      bear: 'Headline growth fails to convert into cash, losses remain structurally high or the company needs repeated external financing.',
      invalidation: 'Invalidate a positive results thesis if the next reporting period reverses the improvement or cash usage and dilution remain materially worse than expected.',
      catalyst: `The official source confirms ${eventLabel.toLowerCase()}.`,
      risk: 'Reported growth may be temporary, low quality or insufficient to offset operating losses and financing needs.',
    },
    OPERATIONAL_MILESTONE: {
      category: 'SPECULATIVE_CATALYST',
      action: 'WATCH',
      horizon: 'MONTHS',
      thesis: `${companyName}'s verified operational milestone can change execution probability, but it does not by itself prove commercial scalability, customer demand or positive unit economics. The case remains speculative until milestones translate into repeatable operations and financial results.`,
      mechanism: 'Successful technical execution lowers one layer of project risk and may bring revenue generation closer, while delays or failures increase time, cost and financing requirements.',
      bull: 'The milestone is completed on schedule, repeated successfully and followed by a credible transition to commercial operations and cash receipts.',
      bear: 'Testing or certification is delayed, costs increase and the company requires additional financing before commercial operations become repeatable.',
      invalidation: 'Invalidate the constructive interpretation if the next defined milestone is delayed materially, fails technically or requires substantially more capital than planned.',
      catalyst: `The official source confirms ${eventLabel.toLowerCase()}.`,
      risk: 'A technical milestone may generate short-term price excitement without proving a sustainable business or adequate cash runway.',
    },
    LEGAL_OR_SETTLEMENT: {
      category: 'EVENT_RISK',
      action: 'WATCH',
      horizon: 'MONTHS',
      thesis: `${companyName}'s verified legal event may change cash obligations, governance risk or management distraction. The investment impact cannot be judged from the headline alone and requires quantified terms and assessment of remaining claims.`,
      mechanism: 'Legal outcomes transfer cash, alter future obligations and can expose governance weaknesses that affect the discount investors apply to the company.',
      bull: 'The matter is resolved for a manageable amount with no material continuing obligations or operational restrictions.',
      bear: 'The settlement is costly, triggers related claims or reveals broader governance and disclosure weaknesses.',
      invalidation: 'Invalidate the favourable interpretation if additional material claims emerge or the final cash and governance impact exceeds the disclosed base case.',
      catalyst: `The official source confirms ${eventLabel.toLowerCase()}.`,
      risk: 'The disclosed event may not capture related claims, legal costs, reputational damage or management distraction.',
    },
  };
  return templates[eventType] || {
    category: 'INSUFFICIENT_EVIDENCE',
    action: 'WATCH',
    horizon: 'UNDETERMINED',
    thesis: `${companyName} has a reviewed official development, but the deterministic rules cannot yet establish a sufficiently specific causal investment thesis. The event should remain under observation until its financial and market consequences are measurable.`,
    mechanism: 'The event can affect value only through a measurable change in cash flows, balance-sheet risk, share count, operating probability or valuation expectations.',
    bull: 'Subsequent verified evidence demonstrates a favourable and durable financial effect that is not already reflected in valuation.',
    bear: 'The event proves immaterial, is contradicted by later evidence or produces weaker financial outcomes than the market expects.',
    invalidation: 'Keep the case unclassified until a measurable causal link and explicit invalidation condition can be supported by verified evidence.',
    catalyst: `The official source confirms ${eventLabel.toLowerCase()}.`,
    risk: 'The available evidence may be real but not economically material for shareholders.',
  };
}

function actionFromMetrics(baseAction, eventType, fundamentals, marketMetrics, fundamentalRisk) {
  if (eventType === 'EQUITY_ISSUANCE_OR_DILUTION' && (fundamentalRisk?.flags || []).some((flag) => ['SEVERE_DILUTION', 'CASH_RUNWAY_UNDER_ONE_YEAR'].includes(flag))) {
    return 'CONSIDER_REDUCE';
  }
  if (eventType === 'FINANCIAL_RESULTS') {
    const growth = fundamentals?.metrics?.annualRevenueGrowthPct;
    const margin = fundamentals?.metrics?.annualNetMarginPct;
    const relative = marketMetrics?.relativeStrength?.sessions60Pct;
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
  const companyName = company.displayName || company.legalName || 'The company';
  const narrative = eventNarrative(eventType, companyName, event.record.title);
  const evidenceIds = reviewed.map((record) => record.id);
  const metrics = metricSummary(input.fundamentals, input.historicalMarketMetrics);
  const metricSentence = metrics.length
    ? ` Deterministic metrics currently report ${metrics.join(', ')}; these figures are calculation inputs and do not replace the evidence gates.`
    : '';
  const riskClaims = fundamentalRiskClaims(input.fundamentalRisk, evidenceIds);
  const reviewDays = ['WEEKS'].includes(narrative.horizon) ? 30 : narrative.horizon === 'MONTHS' ? 90 : 60;
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
      claim('Market price and liquidity may react differently from the underlying corporate development, particularly when expectations were already embedded before publication.', evidenceIds, 0.72, true),
    ].slice(0, 8),
    invalidationCondition: narrative.invalidation,
    reviewDate,
    synthesisVersion: 1,
    eventType,
    sourceEvidenceIds: evidenceIds,
    blockers: [],
  };
}
