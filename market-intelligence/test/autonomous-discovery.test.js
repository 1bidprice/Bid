import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSecCompanyUniverse } from '../src/adapters/sec-company-universe.js';
import { extractSecCurrentFilings } from '../src/adapters/sec-current-filings.js';
import { discoverAutonomousCandidates } from '../src/autonomous-discovery.js';
import { sourcePolicySummary } from '../src/source-policy.js';

const NOW = '2026-07-28T12:00:00.000Z';

const universePayload = {
  fields: ['cik', 'name', 'ticker', 'exchange'],
  data: [
    [123456, 'Example Growth Inc.', 'EXM', 'Nasdaq'],
    [654321, 'Example Risk Corp.', 'RSK', 'NYSE'],
  ],
};

const atom = `<?xml version="1.0"?><feed>
  <entry>
    <title>8-K - Example Growth Inc. reports strategic acquisition</title>
    <updated>2026-07-28T11:30:00.000Z</updated>
    <category term="8-K" />
    <cik>0000123456</cik>
    <summary>Strategic acquisition and updated guidance</summary>
    <link href="https://www.sec.gov/Archives/edgar/data/123456/example.htm" />
  </entry>
  <entry>
    <title>S-3 - Example Risk Corp. files new offering registration</title>
    <updated>2026-07-28T10:00:00.000Z</updated>
    <category term="S-3" />
    <cik>0000654321</cik>
    <summary>Registration statement for possible offering and dilution</summary>
    <link href="https://www.sec.gov/Archives/edgar/data/654321/example.htm" />
  </entry>
</feed>`;

const unresolvedAthensAnnouncementHtml = `
  <div class="form-radios">
    <div><input name="field_mig_category_2" value="777" class="form-radio" /><label>ISSUER ONLY CORP.</label></div>
  </div>
  <table><tbody>
    <tr>
      <td>ISSUER ONLY CORP.</td>
      <td><a href="/en/node/999001">Financial results announcement</a></td>
      <td>28-07-2026 13:00</td>
    </tr>
  </tbody></table>
`;

test('source selection is controlled by the deterministic governor and not runtime AI approval', () => {
  const summary = sourcePolicySummary();
  assert.equal(summary.selector, 'DETERMINISTIC_SOURCE_GOVERNOR');
  assert.equal(summary.runtimeAiSourceSelection, false);
  assert.equal(summary.runtimeAiMayProposeSources, true);
  assert.equal(summary.rules.runtimeAiMayApproveSources, false);
  assert.equal(summary.rules.runtimeDomainExpansion, false);
  assert.equal(summary.rules.primarySourceRequiredForFinalAction, true);
});

test('SEC universe adapter creates canonical companies from the official registry shape', () => {
  const result = normalizeSecCompanyUniverse(universePayload, { generatedAt: NOW });
  assert.equal(result.companies.length, 2);
  assert.equal(result.companies[0].cik, '0000123456');
  assert.equal(result.companies[0].primaryListing.symbol, 'EXM');
  assert.equal(result.companies[1].primaryListing.exchange, 'NYSE');
});

test('SEC current filing parser extracts company, form, timestamp and official link', () => {
  const result = extractSecCurrentFilings(atom, { retrievedAt: NOW });
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].form, '8-K');
  assert.equal(result.records[0].cik, '0000123456');
  assert.equal(result.records[0].isPrimarySource, true);
});

test('autonomous discovery ranks new companies and never calls discovery alone a buy', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('company_tickers_exchange')) {
      return { ok: true, json: async () => universePayload };
    }
    if (String(url).includes('getcurrent')) {
      return { ok: true, text: async () => atom };
    }
    throw new Error(`unexpected url ${url}`);
  };

  const report = await discoverAutonomousCandidates({
    now: NOW,
    fetchImpl,
    secUserAgent: 'Investor Control test test@example.com',
    seedUniverse: [],
    candidateLimit: 20,
    deepAnalysisLimit: 10,
  });

  assert.equal(report.candidateCount, 2);
  assert.equal(report.deepAnalysisCompanyCount, 2);
  assert.equal(report.shortlist[0].status, 'DISCOVERED_RESEARCH_REQUIRED');
  assert.equal(report.shortlist[0].suggestedAction, 'WATCH');
  assert.ok(report.shortlist.every((item) => item.suggestedAction === 'WATCH'));
  assert.ok(report.discoveredCompanies.every((company) => company.active === true));
});

test('issuer-only Athens evidence stays auditable but cannot enter the investment shortlist without a verified stock symbol', async () => {
  const emptySecUniverse = {
    fields: ['cik', 'name', 'ticker', 'exchange'],
    data: [],
  };
  const fetchImpl = async (url) => {
    const value = decodeURIComponent(String(url));
    if (value.includes('company_tickers_exchange')) {
      return { ok: true, json: async () => emptySecUniverse };
    }
    if (value.includes('getcurrent')) {
      return { ok: true, text: async () => '<?xml version="1.0"?><feed></feed>' };
    }
    if (value.endsWith('/market-data/announcements')) {
      return { ok: true, text: async () => unresolvedAthensAnnouncementHtml };
    }
    return { ok: true, text: async () => '<html>No verified stock listing</html>' };
  };

  const report = await discoverAutonomousCandidates({
    now: NOW,
    fetchImpl,
    secUserAgent: 'Investor Control test test@example.com',
    seedUniverse: [],
    minimumScore: 1,
    shortlistLimit: 12,
    deepAnalysisLimit: 5,
  });

  assert.equal(report.athensAnnouncementEventCount, 1);
  assert.equal(report.candidateCount, 0);
  assert.equal(report.unresolvedIdentityCount, 0);
  assert.equal(report.identityExcludedCount, 1);
  assert.equal(report.deepAnalysisCompanyCount, 0);
  assert.equal(report.shortlist.length, 0);
  assert.equal(report.identityReviewQueue.length, 1);
  assert.equal(report.identityReviewQueue[0].companyName, 'ISSUER ONLY CORP.');
  assert.equal(report.identityReviewQueue[0].identityStatus, 'SYMBOL_RESOLUTION_REQUIRED');
  assert.equal(report.identityReviewQueue[0].sources[0].sourceUrl, 'https://athens.euronext.com/en/node/999001');
  assert.ok(report.diagnostics.some((item) => item.code === 'ATHENS_UNRESOLVED_LISTING_EXCLUDED_FROM_INVESTMENT_SHORTLIST'));
});
