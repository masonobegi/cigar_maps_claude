# Building CigarBuddy for iOS / Android

## Prerequisites
- macOS with Xcode 14+ (iOS only)
- Android Studio (Android only)
- Apple Developer account ($99/yr) for iOS distribution
- Node.js 18+

## Steps

### 1. Install native dependencies
```bash
npm install @capacitor/ios @capacitor/android @capacitor/splash-screen @capacitor/status-bar
```

### 2. Build the web app
```bash
cd client && npm run build
```

### 3. Add platforms (first time only)
```bash
npx cap add ios
npx cap add android
```

### 4. Sync web code into native project
```bash
npx cap sync
```

### 5. Open in Xcode (iOS)
```bash
npx cap open ios
```
Then in Xcode:
- Set your Team (Apple Developer account) under Signing & Capabilities
- Change Bundle Identifier from `com.cigarbuddy.app` if needed
- Select a real device or simulator
- Hit Run (Cmd+R)

### 6. Open in Android Studio
```bash
npx cap open android
```

## Development workflow
When you change the web code:
```bash
cd client && npm run build && cd .. && npx cap sync
```

## App Store submission
1. In Xcode: Product → Archive
2. Upload to App Store Connect
3. Submit for review

## Environment note
The app currently talks to `localhost:3001`. Before shipping:
- Deploy the server to a real host (Railway, Render, Fly.io are all free tiers)
- Update `client/vite.config.js` proxy and `client/src/services/api.js` BASE URL

## App Store assets needed
- App icon: 1024x1024 PNG (no alpha, no rounded corners — Apple adds them)
- Screenshots: iPhone 6.7" (1290x2796), 6.5" (1242x2688), iPad Pro 12.9" (2048x2732)
- Privacy policy URL (required)
- App description and keywords
