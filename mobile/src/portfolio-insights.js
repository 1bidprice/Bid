function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function nonNegative(value) {
  return finite(value) && Number(value) >= 0;
}

export function buildPortfolioInsights(positionsInput = []) {
  const positions = Array.isArray(positionsInput) ? positionsInput : [];
  const valued = positions
    .filter((position) => nonNegative(position?.eurValue))
    .map((position) => ({
      symbol: String(position.symbol || '').trim().toUpperCase(),
      company: String(position.company || position.symbol || '').trim(),
      value: Number(position.eurValue),
      pnl: finite(position?.eurPnl) ? Number(position.eurPnl) : null,
    }))
    .filter((position) => position.symbol);

  const totalValue = valued.reduce((sum, position) => sum + position.value, 0);
  const allocation = valued
    .map((position) => ({
      ...position,
      weightPct: totalValue > 0 ? (position.value / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.weightPct - a.weightPct || a.symbol.localeCompare(b.symbol));

  const top1Pct = allocation[0]?.weightPct || 0;
  const top3Pct = allocation.slice(0, 3).reduce((sum, item) => sum + item.weightPct, 0);
  const pnlItems = allocation
    .filter((item) => finite(item.pnl))
    .map((item) => ({ ...item, absPnl: Math.abs(item.pnl) }))
    .sort((a, b) => b.absPnl - a.absPnl || a.symbol.localeCompare(b.symbol));
  const totalAbsPnl = pnlItems.reduce((sum, item) => sum + item.absPnl, 0);
  const pnlContribution = pnlItems.map((item) => ({
    ...item,
    contributionPct: totalAbsPnl > 0 ? (item.absPnl / totalAbsPnl) * 100 : 0,
  }));

  return {
    positionCount: positions.length,
    valuedPositionCount: valued.length,
    coverage: positions.length ? `${valued.length}/${positions.length}` : '0/0',
    totalValue,
    allocation,
    top1Pct,
    top3Pct,
    pnlContribution,
  };
}
