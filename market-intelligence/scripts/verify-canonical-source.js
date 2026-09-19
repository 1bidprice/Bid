import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const forbiddenScripts = Object.entries(pkg.scripts || {}).filter(([, command]) => /run-current-release|apply-v/i.test(String(command)));
if (forbiddenScripts.length) throw new Error(`canonical source: runtime patch command remains in package scripts: ${forbiddenScripts.map(([name]) => name).join(', ')}`);
for (const legacy of ['config/runtime-release-manifest.json', 'scripts/run-current-release.js']) {
  if (fs.existsSync(path.join(root, legacy))) throw new Error(`canonical source: legacy runtime materializer remains: ${legacy}`);
}
const scriptDir = path.join(root, 'scripts');
const patchFiles = fs.readdirSync(scriptDir).filter((name) => /^apply-v.*\.js$/i.test(name));
if (patchFiles.length) throw new Error(`canonical source: historical apply-v scripts remain (${patchFiles.length})`);
for (const folder of ['src', 'config']) {
  const start = path.join(root, folder);
  const stack = fs.existsSync(start) ? [start] : [];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (/\.(?:js|json)$/i.test(entry.name)) {
        const text = fs.readFileSync(absolute, 'utf8');
        if (/run-current-release|scripts\/apply-v/i.test(text)) throw new Error(`canonical source: runtime patch dependency remains in ${path.relative(root, absolute)}`);
      }
    }
  }
}
console.log(JSON.stringify({
  canonicalMarketIntelligenceSource: 'VERIFIED',
  runtimePatchRunnerPresent: false,
  runtimePatchManifestPresent: false,
  applyPatchFileCount: 0,
  directEntrypoints: Object.keys(pkg.scripts || {}),
}, null, 2));
