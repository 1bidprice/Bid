import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, v) => fs.writeFileSync(path.join(root, p), v);

function replaceRegexRequired(content, regex, replacement, marker, label) {
  if (content.includes(marker)) return content;
  regex.lastIndex = 0;
  if (!regex.test(content)) throw new Error(`v1.5.5 patch failed: missing ${label}`);
  regex.lastIndex = 0;
  return content.replace(regex, replacement);
}

function patchAthensFundamentalCandidateReview() {
  let source = read('src/adapters/euronext-athens-fundamentals.js');

  const replacement = `  const resolvedDocument = await resolveEuronextAthensFinancialDocument(company, {
    fetchImpl,
    financialDataUrl: pageUrl,
    extractFinancialDocuments: extractAthensFinancialDocuments,
    generatedAt: options.generatedAt,
    userAgent: options.userAgent || 'Investor-Control-Market-Intelligence/1.5',
    minimumIdentityScore: options.minimumIdentityScore,
    announcementLimit: options.announcementLimit,
    detailLimit: options.financialAnnouncementDetailLimit,
  });
  if (!resolvedDocument.document) {
    return {
      snapshot: null,
      diagnostics: resolvedDocument.diagnostics || [{ code: 'EURONEXT_FINANCIAL_DOCUMENT_RESOLUTION_FAILED', companyId: company?.companyId }],
    };
  }

  const resolverDiagnostics = resolvedDocument.diagnostics || [];
  const rankedCandidates = Array.isArray(resolvedDocument.candidates) && resolvedDocument.candidates.length
    ? resolvedDocument.candidates
    : [resolvedDocument.document].filter(Boolean);
  const maxCandidateReviews = Math.max(1, Math.min(Number(options.maxFinancialCandidateReviews || 6), 12));
  const pdfExtractor = options.pdfExtractor || extractPdfText;
  const candidateDiagnostics = [];
  let selected = null;

  for (let candidateIndex = 0; candidateIndex < Math.min(rankedCandidates.length, maxCandidateReviews); candidateIndex += 1) {
    const document = rankedCandidates[candidateIndex];
    const rank = candidateIndex + 1;
    let pdfResponse;
    try {
      pdfResponse = await fetchImpl(document.pdfUrl, {
        headers: { Accept: 'application/pdf', 'Cache-Control': 'no-cache', 'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/1.5' },
      });
    } catch (error) {
      candidateDiagnostics.push({
        code: 'EURONEXT_FINANCIAL_CANDIDATE_REJECTED',
        companyId: company?.companyId,
        candidateRank: rank,
        pdfUrl: document?.pdfUrl || null,
        sourceChannel: document?.sourceChannel || null,
        reason: 'PDF_FETCH_ERROR',
        error: String(error?.message || error),
      });
      continue;
    }
    if (!pdfResponse?.ok) {
      candidateDiagnostics.push({
        code: 'EURONEXT_FINANCIAL_CANDIDATE_REJECTED',
        companyId: company?.companyId,
        candidateRank: rank,
        pdfUrl: document?.pdfUrl || null,
        sourceChannel: document?.sourceChannel || null,
        reason: 'PDF_HTTP_ERROR',
        status: pdfResponse?.status ?? null,
      });
      continue;
    }

    const buffer = Buffer.from(await pdfResponse.arrayBuffer());
    const extracted = await pdfExtractor(buffer, {
      maxBytes: options.maxBytes,
      minReviewedText: options.minReviewedText,
      timeoutMs: options.timeoutMs,
    });
    if (!extracted?.reviewed) {
      candidateDiagnostics.push({
        code: 'EURONEXT_FINANCIAL_CANDIDATE_REJECTED',
        companyId: company?.companyId,
        candidateRank: rank,
        pdfUrl: document?.pdfUrl || null,
        sourceChannel: document?.sourceChannel || null,
        reason: 'PDF_NOT_REVIEWED',
        extractionStatus: extracted?.status || null,
        diagnostics: extracted?.diagnostics || [],
      });
      continue;
    }

    const pageTexts = Array.isArray(extracted.pages) && extracted.pages.length
      ? extracted.pages.map((page) => extracted.text.slice(page.textStart, page.textEnd))
      : [];
    const candidateSnapshot = buildAthensFundamentalSnapshotFromText(extracted.text, document, company, {
      generatedAt: options.generatedAt,
      pages: pageTexts,
      extractionStatus: extracted.status,
    });

    if (candidateSnapshot.model?.type === 'FINANCIAL_INSTITUTION') {
      const bankPassport = buildAthensBankPassport(pageTexts, candidateSnapshot, company, { generatedAt: candidateSnapshot.generatedAt });
      candidateSnapshot.specializedModels = { ...(candidateSnapshot.specializedModels || {}), bank: bankPassport };
      candidateSnapshot.model = {
        ...candidateSnapshot.model,
        specializedModelImplemented: true,
        modelReady: bankPassport.modelReady,
        specializedModelStatus: bankPassport.status,
      };
      candidateSnapshot.quality = {
        ...(candidateSnapshot.quality || {}),
        specializedModelImplemented: true,
        bankPassportStatus: bankPassport.status,
        bankPassportBlockers: bankPassport.blockers,
      };
      candidateSnapshot.metricsReady = bankPassport.decisionReady === true;
    }

    const bankPassport = candidateSnapshot?.specializedModels?.bank || null;
    const genericCoverage = Number(candidateSnapshot?.coverage?.available || 0);
    const bankCoreCoverage = Number(bankPassport?.coverage?.core?.availableCount || 0);
    const accountingCoverage = bankPassport ? bankCoreCoverage : genericCoverage;
    const financialStatementVerified = accountingCoverage >= Number(options.minimumFinancialStatementFacts || 3);

    if (!financialStatementVerified) {
      candidateDiagnostics.push({
        code: 'EURONEXT_FINANCIAL_CANDIDATE_REJECTED',
        companyId: company?.companyId,
        candidateRank: rank,
        pdfUrl: document?.pdfUrl || null,
        sourceChannel: document?.sourceChannel || null,
        reason: 'INSUFFICIENT_FINANCIAL_STATEMENT_CONTENT',
        extractionStatus: extracted.status,
        accountingCoverage,
        genericCoverage,
        bankCoreCoverage,
      });
      continue;
    }

    candidateSnapshot.sourceDocument = {
      ...(candidateSnapshot.sourceDocument || {}),
      candidateSelection: {
        policyVersion: '2026-08-08.1',
        reviewedSelected: true,
        candidateRank: rank,
        candidatesAvailable: rankedCandidates.length,
        candidatesAttempted: rank,
        rejectedBeforeSelection: candidateDiagnostics.filter((item) => item.code === 'EURONEXT_FINANCIAL_CANDIDATE_REJECTED').length,
        accountingCoverage,
        sourceChannel: document?.sourceChannel || null,
      },
    };
    candidateDiagnostics.push({
      code: 'EURONEXT_FINANCIAL_REVIEWED_CANDIDATE_SELECTED',
      companyId: company?.companyId,
      candidateRank: rank,
      pdfUrl: document?.pdfUrl || null,
      sourceChannel: document?.sourceChannel || null,
      extractionStatus: extracted.status,
      accountingCoverage,
      bankDecisionReady: bankPassport?.decisionReady ?? null,
    });
    selected = { document, extracted, pageTexts, snapshot: candidateSnapshot };
    break;
  }

  if (!selected) {
    return {
      snapshot: null,
      diagnostics: [
        ...resolverDiagnostics,
        ...candidateDiagnostics,
        {
          code: 'EURONEXT_FINANCIAL_NO_REVIEWED_STATEMENT_CANDIDATE',
          companyId: company?.companyId,
          candidatesAvailable: rankedCandidates.length,
          candidatesAttempted: Math.min(rankedCandidates.length, maxCandidateReviews),
        },
      ],
    };
  }

  const snapshot = selected.snapshot;
  const diagnostics = [...resolverDiagnostics, ...candidateDiagnostics];`;

  source = replaceRegexRequired(
    source,
    /  const resolvedDocument = await resolveEuronextAthensFinancialDocument\(company, \{[\s\S]*?  const diagnostics = \[\.\.\.resolverDiagnostics\];/,
    replacement,
    'EURONEXT_FINANCIAL_REVIEWED_CANDIDATE_SELECTED',
    'resolver-to-PDF single-candidate selection block',
  );

  write('src/adapters/euronext-athens-fundamentals.js', source);
}

patchAthensFundamentalCandidateReview();

const source = read('src/adapters/euronext-athens-fundamentals.js');
for (const invariant of [
  'maxFinancialCandidateReviews',
  'EURONEXT_FINANCIAL_CANDIDATE_REJECTED',
  'INSUFFICIENT_FINANCIAL_STATEMENT_CONTENT',
  'EURONEXT_FINANCIAL_REVIEWED_CANDIDATE_SELECTED',
  'EURONEXT_FINANCIAL_NO_REVIEWED_STATEMENT_CANDIDATE',
  'reviewedSelected: true',
  'accountingCoverage >= Number(options.minimumFinancialStatementFacts || 3)',
]) {
  if (!source.includes(invariant)) throw new Error(`v1.5.5 verification failed: missing ${invariant}`);
}

console.log('Investor Control v1.5.5 reviewed Euronext financial candidate selection applied.');
