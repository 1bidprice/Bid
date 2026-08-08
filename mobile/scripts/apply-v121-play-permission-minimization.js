const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'app.json');
const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));

app.expo = app.expo || {};
app.expo.android = app.expo.android || {};
const blocked = new Set(Array.isArray(app.expo.android.blockedPermissions)
  ? app.expo.android.blockedPermissions
  : []);

[
  'android.permission.SYSTEM_ALERT_WINDOW',
  'com.google.android.c2dm.permission.RECEIVE',
].forEach((permission) => blocked.add(permission));

app.expo.android.blockedPermissions = [...blocked].sort();
fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);

const verified = JSON.parse(fs.readFileSync(appPath, 'utf8'));
for (const permission of [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'com.google.android.c2dm.permission.RECEIVE',
]) {
  if (!verified.expo.android.blockedPermissions.includes(permission)) {
    throw new Error(`Play permission minimization failed: ${permission}`);
  }
}

console.log('Investor Control v1.2.1 Play permission minimization applied.');
