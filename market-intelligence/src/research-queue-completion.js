function canonicalSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function dossierSymbols(report = {}) {
  const symbols = new Set();
  for (const dossier of Array.isArray(report?.researchDossiers) ? report.researchDossiers : []) {
    const symbol = canonicalSymbol(dossier?.listing?.symbol);
    if (symbol) symbols.add(symbol);
  }
  return symbols;
}

function normalizeQueueRecord(record) {
  const symbol = canonicalSymbol(record?.symbol);
  if (!/^([A-Z0-9][A-Z0-9.-]{0,19})\.(US|GR)$/.test(symbol)) return null;
  return {
    ...record,
    symbol,
    status: String(record?.status || 'QUEUED').toUpperCase(),
  };
}

export function buildResearchQueueCompletionPlan(queueInput = {}, report = {}, options = {}) {
  const now = new Date(options.completedAt || report?.generatedAt || Date.now()).toISOString();
  const records = Array.isArray(queueInput) ? queueInput : Array.isArray(queueInput?.records) ? queueInput.records : [];
  const analysedSymbols = dossierSymbols(report);
  const updates = [];
  const untouched = [];

  for (const raw of records) {
    const record = normalizeQueueRecord(raw);
    if (!record) continue;
    const base = record.symbol.replace(/\.(US|GR)$/i, '');
    const analysed = analysedSymbols.has(base);

    if (record.status === 'QUEUED' && analysed) {
      updates.push({
        key: `research:${record.symbol}`,
        symbol: record.symbol,
        previousStatus: 'QUEUED',
        nextStatus: 'COMPLETED',
        value: {
          ...record,
          status: 'COMPLETED',
          completedAt: now,
          completionSource: 'CANONICAL_RESEARCH_DOSSIER',
          privacy: {
            storesSymbolOnly: true,
            storesPortfolioData: false,
            storesClientIdentity: false,
          },
        },
      });
    } else {
      untouched.push({
        symbol: record.symbol,
        status: record.status,
        reason: analysed ? 'ALREADY_NOT_QUEUED' : 'CANONICAL_DOSSIER_NOT_PRESENT',
      });
    }
  }

  return {
    format: 'minbeis-research-queue-completion-plan',
    version: 1,
    generatedAt: now,
    mutationAuthority: 'TRUSTED_PUBLISHER_ONLY',
    publicMutationEndpoint: false,
    updateCount: updates.length,
    untouchedCount: untouched.length,
    updates,
    untouched,
  };
}
