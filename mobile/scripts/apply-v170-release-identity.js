const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const RELEASE_VERSION = '1.7.0';
const ANDROID_VERSION_CODE = 28;
const PACKAGE_ID = 'gr.investorcontrol.app';

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function patchRuntimeVersion(relativePath) {
  let source = read(relativePath);
  const target = `const VERSION = '${RELEASE_VERSION}';`;
  if (source.includes(target)) return;

  const known = [
    "const VERSION = '1.2.0';",
    "const VERSION = '1.2.4';",
    "const VERSION = '1.2.5';",
  ];
  const anchor = known.find((candidate) => source.includes(candidate));
  if (!anchor) {
    throw new Error(`Investor Control v1.7.0 release identity patch failed: missing version anchor in ${relativePath}`);
  }

  source = source.replace(anchor, target);
  write(relativePath, source);
}

function patchAppConfig() {
  const appPath = path.join(root, 'app.json');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  app.expo = app.expo || {};
  app.expo.android = app.expo.android || {};
  app.expo.ios = app.expo.ios || {};

  if (app.expo.android.package && app.expo.android.package !== PACKAGE_ID) {
    throw new Error(`Investor Control package changed unexpectedly: ${app.expo.android.package}`);
  }
  if (app.expo.ios.bundleIdentifier && app.expo.ios.bundleIdentifier !== PACKAGE_ID) {
    throw new Error(`Investor Control iOS bundle changed unexpectedly: ${app.expo.ios.bundleIdentifier}`);
  }

  app.expo.version = RELEASE_VERSION;
  app.expo.android.package = PACKAGE_ID;
  app.expo.android.versionCode = ANDROID_VERSION_CODE;
  app.expo.ios.bundleIdentifier = PACKAGE_ID;
  app.expo.ios.buildNumber = String(ANDROID_VERSION_CODE);

  fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);
}

patchRuntimeVersion('PortfolioApp.js');
patchRuntimeVersion('DecisionOverlay.js');
patchAppConfig();

console.log(`Investor Control mobile release identity ${RELEASE_VERSION} (${ANDROID_VERSION_CODE}) applied.`);
