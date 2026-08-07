import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const write = (relativePath, content) => fs.writeFileSync(path.join(root, relativePath), content);

function replaceRequired(content, from, to, label) {
  if (content.includes(to)) return content;
  if (!content.includes(from)) throw new Error(`v1.4.2 SEC bank capital-evidence patch failed: missing ${label}`);
  return content.replace(from, to);
}

function patchDailyPipeline() {
  let source = read('src/run-daily-intelligence.js');
  source = replaceRequired(
    source,
    "import { assessFundamentalRisk } from './fundamental-risk.js';",
    "import { assessFundamentalRisk } from './fundamental-risk.js';\nimport { extractSecBankRegulatoryCapitalFromEvidence } from './sec-bank-regulatory-capital.js';\nimport { applyReviewedRegulatoryCapitalToBankPassport } from './sec-bank-passport.js';",
    'bank capital evidence imports',
  );

  if (!source.includes('function replaceFundamentalRiskAssessment(')) {
    source = replaceRequired(
      source,
      `function recordsForClaim(records, claim) {
  if (!claim?.evidenceIds?.length) return records;
  const ids = new Set(claim.evidenceIds);
  return records.filter((record) => ids.has(record.id));
}`,
      `function recordsForClaim(records, claim) {
  if (!claim?.evidenceIds?.length) return records;
  const ids = new Set(claim.evidenceIds);
  return records.filter((record) => ids.has(record.id));
}

function replaceFundamentalRiskAssessment(assessments, companyId, nextAssessment) {
  const index = assessments.findIndex((item) => item?.companyId === companyId);
  if (index >= 0) assessments[index] = nextAssessment;
  else assessments.push(nextAssessment);
}`,
      'fundamental-risk replacement helper',
    );
  }

  source = replaceRequired(
    source,
    `        officialRecords.push(record);
        evidence.push(record);
      }

      let independentRecords = [];`,
    `        officialRecords.push(record);
        evidence.push(record);
      }

      if (
        company.cik &&
        fundamentalSnapshot?.model?.type === 'FINANCIAL_INSTITUTION' &&
        fundamentalSnapshot?.specializedModels?.bank
      ) {
        const capitalResult = extractSecBankRegulatoryCapitalFromEvidence(officialRecords);
        diagnostics.push(...(capitalResult.diagnostics || []).map((item) => ({
          ...item,
          companyId: item.companyId || company.companyId,
        })));
        if (capitalResult.capital) {
          const bankPassport = applyReviewedRegulatoryCapitalToBankPassport(
            fundamentalSnapshot.specializedModels.bank,
            capitalResult.capital,
          );
          fundamentalSnapshot.specializedModels = {
            ...(fundamentalSnapshot.specializedModels || {}),
            bank: bankPassport,
          };
          fundamentalSnapshot.model = {
            ...(fundamentalSnapshot.model || {}),
            specializedModelImplemented: true,
            modelReady: bankPassport.modelReady,
            specializedModelStatus: bankPassport.status,
          };
          fundamentalSnapshot.quality = {
            ...(fundamentalSnapshot.quality || {}),
            specializedModelImplemented: true,
            bankPassportStatus: bankPassport.status,
            bankPassportBlockers: bankPassport.blockers,
            regulatoryCapitalEvidenceId: capitalResult.capital.evidenceId,
          };
          fundamentalSnapshot.metricsReady = bankPassport.decisionReady === true;

          fundamentalRisk = assessFundamentalRisk(
            fundamentalSnapshot,
            referencePriceForRisk(marketSnapshot, marketMetrics),
            {
              generatedAt: now,
              companyId: company.companyId,
              currency: company.currency || company.primaryListing?.currency || company.listings?.[0]?.currency || fundamentalSnapshot?.reporting?.currency || 'USD',
            },
          );
          replaceFundamentalRiskAssessment(fundamentalRiskAssessments, company.companyId, fundamentalRisk);
          diagnostics.push({
            code: 'SEC_BANK_REGULATORY_CAPITAL_VERIFIED',
            companyId: company.companyId,
            evidenceId: capitalResult.capital.evidenceId,
            accession: capitalResult.capital.accession,
            form: capitalResult.capital.form,
          });
        }
      }

      let independentRecords = [];`,
    'reviewed bank-capital enrichment stage',
  );

  write('src/run-daily-intelligence.js', source);
}

patchDailyPipeline();

const source = read('src/run-daily-intelligence.js');
for (const invariant of [
  'extractSecBankRegulatoryCapitalFromEvidence',
  'applyReviewedRegulatoryCapitalToBankPassport',
  'replaceFundamentalRiskAssessment',
  "fundamentalSnapshot?.model?.type === 'FINANCIAL_INSTITUTION'",
  'regulatoryCapitalEvidenceId',
  'SEC_BANK_REGULATORY_CAPITAL_VERIFIED',
]) {
  if (!source.includes(invariant)) throw new Error(`v1.4.2 verification failed: run-daily-intelligence missing ${invariant}`);
}

console.log('Investor Control v1.4.2 reviewed SEC bank regulatory-capital evidence integrated.');
