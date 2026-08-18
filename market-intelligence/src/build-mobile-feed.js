import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildMobileIntelligenceFeed } from './mobile-intelligence-feed.js';

export async function buildMobileFeedFromFile(options = {}) {
  const reportPath = path.resolve(options.reportPath || 'out/daily-intelligence.json');
  const outputPath = path.resolve(options.outputPath || 'out/mobile-intelligence-feed.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const feed = buildMobileIntelligenceFeed(report, { generatedAt: options.generatedAt });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(feed, null, 2)}\n`, 'utf8');
  return feed;
}

async function main() {
  const [reportPath, outputPath] = process.argv.slice(2);
  const feed = await buildMobileFeedFromFile({ reportPath, outputPath });
  console.log(`Built mobile feed with ${feed.published.length} published, ${feed.reviewReady.length} review-ready and ${feed.research.length} research items`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
