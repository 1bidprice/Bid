# Investor Control Mobile

Native React Native / Expo application for Android and iOS.

## Current native core

- Portfolio summary in EUR
- Separate EUR and USD position accounting
- Initial Allwyn and Virgin Galactic positions
- Automatic price refresh from the Investor Control market feed every 30 seconds while the app is active
- Local persistent storage with AsyncStorage
- Native transaction entry form
- Transactions, alerts and settings screens
- EAS profiles for installable Android APK and production AAB

## Local run

```bash
cd mobile
npm install
npx expo start
```

## Android APK build

```bash
cd mobile
npx eas-cli login
npx eas-cli build --platform android --profile preview
```

The preview profile creates an installable APK. The production profile creates an AAB for Google Play.

## Not completed yet

- Remote push notifications while the app is fully closed
- Cloud user accounts and encrypted server database
- Automatic statement import from Piraeus Bank and Freedom24
- Licensed real-time ATHEX market data
- Biometric app lock

These are separate native/backend stages and must not be represented as already complete.
