import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { contentHash } from './content-hash.js';

const execFile = promisify(execFileCallback);
const DEFAULT_MAX_BYTES = 12_000_000;
const DEFAULT_MIN_REVIEWED_TEXT = 400;

function normalizePageText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export function splitPdfTextPages(value) {
  return String(value || '')
    .split('\f')
    .map(normalizePageText)
    .filter(Boolean);
}

export function buildPageProvenance(pageTexts = []) {
  let text = '';
  const pages = [];

  for (let index = 0; index < pageTexts.length; index += 1) {
    const pageText = normalizePageText(pageTexts[index]);
    if (!pageText) continue;
    if (text) text += '\n\n';
    const textStart = text.length;
    text += pageText;
    const textEnd = text.length;
    pages.push({
      pageNumber: index + 1,
      textStart,
      textEnd,
      textLength: pageText.length,
      contentHash: contentHash({ pageNumber: index + 1, text: pageText }),
    });
  }

  return { text, pages };
}

function failureCode(error) {
  if (error?.code === 'ENOENT') return 'PDF_EXTRACTOR_UNAVAILABLE';
  if (error?.killed || error?.signal) return 'PDF_EXTRACTION_TIMEOUT';
  return 'PDF_EXTRACTION_FAILED';
}

export async function extractPdfText(bufferInput, options = {}) {
  const buffer = Buffer.isBuffer(bufferInput) ? bufferInput : Buffer.from(bufferInput || []);
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES);
  const minReviewedText = Number(options.minReviewedText || DEFAULT_MIN_REVIEWED_TEXT);
  const execFileImpl = options.execFileImpl || execFile;

  if (!buffer.length) {
    return {
      status: 'PDF_EXTRACTION_FAILED',
      reviewed: false,
      text: '',
      pages: [],
      diagnostics: [{ code: 'PDF_EMPTY' }],
    };
  }

  if (buffer.length > maxBytes) {
    return {
      status: 'TOO_LARGE',
      reviewed: false,
      text: '',
      pages: [],
      diagnostics: [{ code: 'PDF_TOO_LARGE', byteLength: buffer.length }],
    };
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'investor-control-pdf-'));
  const inputPath = path.join(workDir, 'input.pdf');
  const outputPath = path.join(workDir, 'output.txt');

  try {
    await writeFile(inputPath, buffer);
    try {
      await execFileImpl(
        options.command || 'pdftotext',
        ['-layout', '-enc', 'UTF-8', inputPath, outputPath],
        {
          timeout: Number(options.timeoutMs || 30_000),
          maxBuffer: Number(options.maxOutputBytes || 20_000_000),
        },
      );
    } catch (error) {
      return {
        status: 'PDF_EXTRACTION_FAILED',
        reviewed: false,
        text: '',
        pages: [],
        diagnostics: [{
          code: failureCode(error),
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }

    let rawText = '';
    try {
      rawText = await readFile(outputPath, 'utf8');
    } catch (error) {
      return {
        status: 'PDF_EXTRACTION_FAILED',
        reviewed: false,
        text: '',
        pages: [],
        diagnostics: [{
          code: 'PDF_TEXT_OUTPUT_MISSING',
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }

    const { text, pages } = buildPageProvenance(splitPdfTextPages(rawText));
    const reviewed = pages.length > 0 && text.length >= minReviewedText;
    return {
      status: reviewed ? 'REVIEWED_PDF' : 'PDF_TEXT_TOO_SHORT',
      reviewed,
      text,
      pages,
      diagnostics: reviewed
        ? []
        : [{ code: 'PDF_TEXT_TOO_SHORT', textLength: text.length, pageCount: pages.length }],
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
