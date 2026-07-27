import { contentHash } from './content-hash.js';

const DEFAULT_MAX_BYTES = 2_500_000;
const DEFAULT_MIN_REVIEWED_TEXT = 400;

const HTML_ENTITY_MAP = Object.freeze({
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
});

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => HTML_ENTITY_MAP[name.toLowerCase()] ?? match);
}

export function htmlToPlainText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|canvas|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|hr)\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|main|header|footer|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function contentTypeOf(response) {
  return String(response?.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
}

function contentLengthOf(response) {
  const raw = response?.headers?.get?.('content-length');
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isTextContentType(contentType, sourceUrl) {
  if (contentType.startsWith('text/')) return true;
  if (['application/xhtml+xml', 'application/xml', 'application/json'].includes(contentType)) return true;
  return /\.(?:html?|xhtml|xml|txt)(?:$|[?#])/i.test(String(sourceUrl || ''));
}

function isPdf(contentType, sourceUrl) {
  return contentType === 'application/pdf' || /\.pdf(?:$|[?#])/i.test(String(sourceUrl || ''));
}

function emptyDocument(status, retrievedAt, contentType, byteLength) {
  return {
    status,
    fetchedAt: retrievedAt,
    contentType: contentType || null,
    byteLength,
    textLength: 0,
    reviewed: false,
    pages: [],
  };
}

async function responseBuffer(response) {
  if (typeof response.arrayBuffer === 'function') {
    return Buffer.from(await response.arrayBuffer());
  }
  if (typeof response.text === 'function') {
    return Buffer.from(await response.text(), 'binary');
  }
  return Buffer.alloc(0);
}

export async function hydrateEvidenceDocument(record, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('Document hydrator requires fetch');
  if (!record?.sourceUrl) {
    return {
      record,
      diagnostics: [{ code: 'DOCUMENT_URL_MISSING', evidenceId: record?.id || null }],
    };
  }

  const retrievedAt = new Date(options.retrievedAt || Date.now()).toISOString();
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES);
  const minReviewedText = Number(options.minReviewedText || DEFAULT_MIN_REVIEWED_TEXT);

  let response;
  try {
    response = await fetchImpl(record.sourceUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.3',
        'User-Agent': options.userAgent || 'Investor-Control-Market-Intelligence/0.3',
      },
    });
  } catch (error) {
    return {
      record: {
        ...record,
        document: emptyDocument('FETCH_FAILED', retrievedAt, null, null),
      },
      diagnostics: [{
        code: 'DOCUMENT_FETCH_FAILED',
        evidenceId: record.id,
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }

  if (!response.ok) {
    return {
      record: {
        ...record,
        document: emptyDocument(
          'FETCH_FAILED',
          retrievedAt,
          contentTypeOf(response) || null,
          contentLengthOf(response),
        ),
      },
      diagnostics: [{ code: 'DOCUMENT_HTTP_ERROR', evidenceId: record.id, status: response.status }],
    };
  }

  const contentType = contentTypeOf(response);
  const declaredLength = contentLengthOf(response);
  if (declaredLength !== null && declaredLength > maxBytes) {
    return {
      record: {
        ...record,
        document: emptyDocument('TOO_LARGE', retrievedAt, contentType, declaredLength),
      },
      diagnostics: [{ code: 'DOCUMENT_TOO_LARGE', evidenceId: record.id, byteLength: declaredLength }],
    };
  }

  if (isPdf(contentType, record.sourceUrl)) {
    if (typeof options.pdfExtractor !== 'function') {
      return {
        record: {
          ...record,
          document: emptyDocument(
            'PDF_EXTRACTION_REQUIRED',
            retrievedAt,
            contentType || 'application/pdf',
            declaredLength,
          ),
        },
        diagnostics: [{ code: 'PDF_TEXT_EXTRACTION_REQUIRED', evidenceId: record.id }],
      };
    }

    const buffer = await responseBuffer(response);
    if (buffer.length > maxBytes) {
      return {
        record: {
          ...record,
          document: emptyDocument('TOO_LARGE', retrievedAt, contentType || 'application/pdf', buffer.length),
        },
        diagnostics: [{ code: 'DOCUMENT_TOO_LARGE', evidenceId: record.id, byteLength: buffer.length }],
      };
    }

    let extracted;
    try {
      extracted = await options.pdfExtractor(buffer, {
        maxBytes,
        minReviewedText,
        timeoutMs: options.pdfTimeoutMs,
      });
    } catch (error) {
      extracted = {
        status: 'PDF_EXTRACTION_FAILED',
        reviewed: false,
        text: '',
        pages: [],
        diagnostics: [{
          code: 'PDF_EXTRACTION_FAILED',
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }

    const text = String(extracted?.text || '');
    const pages = Array.isArray(extracted?.pages) ? extracted.pages : [];
    const reviewed = extracted?.reviewed === true;
    const status = extracted?.status || (reviewed ? 'REVIEWED_PDF' : 'PDF_EXTRACTION_FAILED');
    return {
      record: {
        ...record,
        rawText: text || null,
        contentHash: contentHash({
          sourceUrl: record.sourceUrl,
          publishedAt: record.publishedAt,
          text,
          pages: pages.map((page) => page.contentHash),
        }),
        document: {
          status,
          fetchedAt: retrievedAt,
          contentType: contentType || 'application/pdf',
          byteLength: buffer.length,
          textLength: text.length,
          reviewed,
          pages,
        },
      },
      diagnostics: (extracted?.diagnostics || []).map((diagnostic) => ({
        ...diagnostic,
        evidenceId: record.id,
      })),
    };
  }

  if (!isTextContentType(contentType, record.sourceUrl)) {
    return {
      record: {
        ...record,
        document: emptyDocument('UNSUPPORTED_CONTENT_TYPE', retrievedAt, contentType, declaredLength),
      },
      diagnostics: [{ code: 'DOCUMENT_CONTENT_TYPE_UNSUPPORTED', evidenceId: record.id, contentType }],
    };
  }

  const body = await response.text();
  const byteLength = Buffer.byteLength(body, 'utf8');
  if (byteLength > maxBytes) {
    return {
      record: {
        ...record,
        document: emptyDocument('TOO_LARGE', retrievedAt, contentType, byteLength),
      },
      diagnostics: [{ code: 'DOCUMENT_TOO_LARGE', evidenceId: record.id, byteLength }],
    };
  }

  const text = contentType.includes('html') || /<\w[\s\S]*>/i.test(body)
    ? htmlToPlainText(body)
    : decodeEntities(body).replace(/\s+/g, ' ').trim();
  const reviewed = text.length >= minReviewedText;
  const status = reviewed ? 'REVIEWED_TEXT' : 'TEXT_TOO_SHORT';

  return {
    record: {
      ...record,
      rawText: text || null,
      contentHash: contentHash({
        sourceUrl: record.sourceUrl,
        publishedAt: record.publishedAt,
        text,
      }),
      document: {
        status,
        fetchedAt: retrievedAt,
        contentType: contentType || 'text/plain',
        byteLength,
        textLength: text.length,
        reviewed,
        pages: [],
      },
    },
    diagnostics: reviewed
      ? []
      : [{ code: 'DOCUMENT_TEXT_TOO_SHORT', evidenceId: record.id, textLength: text.length }],
  };
}
