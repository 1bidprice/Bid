function canonicalSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function publishedAppSymbols(report = {}) {
  const symbols = new Set();
  for (const dossier of Array.isArray(report?.researchDossiers) ? report.researchDossiers : []) {
    for (const candidate of [dossier?.referencePrice?.appSymbol, dossier?.marketQuote?.appSymbol]) {
      const symbol = canonicalSymbol(candidate);
      if (/^([A-Z0-9][A-Z0-9.-]{0,19})\.(US|GR)$/.test(symbol)) symbols.add(symbol);
    }
  }
  return symbols;
}

function verifyCompletionUpdate(update, publishedSymbols) {
  const symbol = canonicalSymbol(update?.symbol);
  if (!/^([A-Z0-9][A-Z0-9.-]{0,19})\.(US|GR)$/.test(symbol)) {
    throw new Error('Queue completion update has invalid canonical symbol');
  }
  if (update?.key !== `research:${symbol}`) {
    throw new Error(`Queue completion key mismatch for ${symbol}`);
  }
  if (update?.previousStatus !== 'QUEUED' || update?.nextStatus !== 'COMPLETED') {
    throw new Error(`Queue completion status transition is invalid for ${symbol}`);
  }
  if (update?.value?.status !== 'COMPLETED' || canonicalSymbol(update?.value?.symbol) !== symbol) {
    throw new Error(`Queue completion value mismatch for ${symbol}`);
  }
  if (update?.value?.completionSource !== 'CANONICAL_RESEARCH_DOSSIER') {
    throw new Error(`Queue completion source is not canonical for ${symbol}`);
  }
  if (update?.value?.privacy?.storesPortfolioData !== false
    || update?.value?.privacy?.storesClientIdentity !== false
    || update?.value?.privacy?.storesSymbolOnly !== true) {
    throw new Error(`Queue completion privacy invariant failed for ${symbol}`);
  }
  if (!publishedSymbols.has(symbol)) {
    throw new Error(`Queue completion would precede canonical publication for ${symbol}`);
  }
  return {
    key: update.key,
    value: JSON.stringify(update.value),
  };
}

export function buildResearchQueueKvBulk(plan = {}, publishedReport = {}) {
  if (plan?.format !== 'minbeis-research-queue-completion-plan'
    || Number(plan?.version) !== 1
    || plan?.mutationAuthority !== 'TRUSTED_PUBLISHER_ONLY'
    || plan?.publicMutationEndpoint !== false) {
    throw new Error('Research queue completion plan does not satisfy trusted mutation authority');
  }
  const updates = Array.isArray(plan?.updates) ? plan.updates : [];
  if (Number(plan?.updateCount || 0) !== updates.length) {
    throw new Error('Research queue completion update count mismatch');
  }
  const publishedSymbols = publishedAppSymbols(publishedReport);
  const bulk = updates.map((update) => verifyCompletionUpdate(update, publishedSymbols));
  return {
    format: 'minbeis-research-queue-kv-bulk',
    version: 1,
    mutationAuthority: 'TRUSTED_PUBLISHER_ONLY',
    publicMutationEndpoint: false,
    updateCount: bulk.length,
    items: bulk,
  };
}
