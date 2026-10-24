export const INSTALLATION_ID_SECURE_KEY = 'minbeis.installation-id.v1';
export const LEGACY_PORTFOLIO_QUARANTINE_KEY = 'minbeis.portfolio-quarantine.v1';

export function createInstallationId(now = Date.now(), random = Math.random()) {
  const stamp = Number(now).toString(36);
  const entropy = Math.floor(Number(random) * Number.MAX_SAFE_INTEGER).toString(36);
  return `minbeis-${stamp}-${entropy}`;
}

export function classifyLocalPortfolioState(raw, installationId) {
  if (!raw || typeof raw !== 'object') return { status: 'EMPTY', state: null };
  const ownerInstallationId = String(raw.ownerInstallationId || '').trim();
  if (!ownerInstallationId) return { status: 'LEGACY_UNOWNED', state: raw };
  if (ownerInstallationId !== installationId) return { status: 'FOREIGN_OWNER', state: raw };
  return { status: 'OWNED', state: raw };
}

export function attachLocalPortfolioOwner(raw, installationId) {
  return {
    ...(raw && typeof raw === 'object' ? raw : {}),
    ownerInstallationId: String(installationId || ''),
  };
}

export function canBackgroundTaskUsePortfolio(raw, installationId) {
  const classified = classifyLocalPortfolioState(raw, installationId);
  return classified.status === 'OWNED';
}
