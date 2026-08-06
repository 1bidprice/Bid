const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'app.json');
const packagePath = path.join(root, 'package.json');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function setRuntimeVersion(relativePath) {
  let source = read(relativePath);
  source = source.replace("const VERSION = '1.2.0';", "const VERSION = '1.2.1';");
  if (!source.includes("const VERSION = '1.2.1';")) {
    throw new Error(`v1.2.1 runtime version missing in ${relativePath}`);
  }
  write(relativePath, source);
}

setRuntimeVersion('PortfolioApp.js');
setRuntimeVersion('DecisionOverlay.js');

const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
app.expo = app.expo || {};
app.expo.version = '1.2.1';
app.expo.android = app.expo.android || {};
app.expo.android.versionCode = 24;
app.expo.ios = app.expo.ios || {};
app.expo.ios.buildNumber = '24';

const blocked = new Set(Array.isArray(app.expo.android.blockedPermissions)
  ? app.expo.android.blockedPermissions
  : []);

[
  'android.permission.SYSTEM_ALERT_WINDOW',
  'com.google.android.c2dm.permission.RECEIVE',
].forEach((permission) => blocked.add(permission));

app.expo.android.blockedPermissions = [...blocked].sort();
fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.version = '1.2.1';
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const verifiedApp = JSON.parse(fs.readFileSync(appPath, 'utf8'));
const verifiedPackage = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (verifiedApp.expo.version !== '1.2.1' || verifiedApp.expo.android.versionCode !== 24) {
  throw new Error('Play release identity mismatch');
}
if (verifiedPackage.version !== '1.2.1') {
  throw new Error('Package release identity mismatch');
}
for (const permission of [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'com.google.android.c2dm.permission.RECEIVE',
]) {
  if (!verifiedApp.expo.android.blockedPermissions.includes(permission)) {
    throw new Error(`Play permission minimization failed: ${permission}`);
  }
}

console.log('Investor Control v1.2.1 release identity and Play permission minimization applied.');
