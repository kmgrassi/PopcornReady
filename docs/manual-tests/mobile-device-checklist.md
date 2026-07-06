# Mobile Device Manual Test Checklist

Use this checklist for PRs that touch mobile layout, upload, PWA install, share
target handling, or background/resume behavior. Playwright mobile projects cover
browser emulation; this checklist covers the native phone behaviors that cannot
be invoked reliably from desktop CI.

## PR Deploy Preview

1. Open the Netlify deploy-preview URL from the PR on an iPhone and an Android
   device when both are available. At minimum, test the platform affected by the
   change.
2. Sign in or use the documented test account for the preview environment.
3. Confirm the first viewport has no horizontal scroll, important controls fit
   without overlap, and primary tap targets are reachable with one hand.
4. Install the PWA from the browser:
   - iOS Safari: Share -> Add to Home Screen.
   - Android Chrome: browser menu -> Add to Home screen or Install app.
5. Launch Popcorn Ready from the home-screen icon and confirm it opens the same
   preview origin in standalone PWA mode.

## Native Capture And Upload

1. Start a new upload flow from the installed PWA.
2. Use the camera `capture` path to record a short video, then attach it.
3. Use the camera-roll picker to attach an existing portrait video.
4. Upload once on Wi-Fi and once over cellular when the change touches upload
   transport, retries, progress, or resume.
5. During an active upload, background the PWA for at least 20 seconds, return
   to it, and confirm progress resumes or fails with a retry action.
6. Confirm the finished upload appears in the expected project or gallery state.

## Share Sheet

1. Install the PWA before testing the share target; browsers only expose the
   native share-sheet entry for installed PWAs.
2. From Photos or Files, share a camera-roll video.
3. Choose "Popcorn Ready" from the native share sheet.
4. Confirm the PWA opens into the upload flow and the shared video is attached.
5. Complete or cancel the upload, then repeat with a second file to catch stale
   share-target cache state.

## Local Device Loop Before A PR

Use this path when the change is not on a deploy preview yet.

1. Install `mkcert` once on the Mac:

   ```sh
   brew install mkcert nss
   ```

2. Start the web app on the local network from the repo root:

   ```sh
   npm run dev:device
   ```

   The script finds the Mac's LAN IP, creates a trusted local certificate under
   `/.local/device-certs`, and prints a URL like
   `https://192.168.1.10:3000`.

3. If the phone does not trust the page, install the printed `rootCA.pem` on the
   phone and explicitly trust it:
   - iOS: AirDrop or host the file, install the profile, then enable full trust
     in Settings -> General -> About -> Certificate Trust Settings.
   - Android: copy the file to the device and install it from Settings ->
     Security -> Encryption & credentials -> Install a certificate.
4. Keep the phone and Mac on the same Wi-Fi network and open the printed HTTPS
   URL on the phone.
5. Run the PR deploy-preview checklist against this local URL. PWA features need
   HTTPS on a real hostname or LAN IP; plain `http://<LAN-IP>:3000` is not enough.

## PR Notes

Include the tested device/browser and a short result in the PR body, for example:

```md
Mobile manual check:
- iPhone 15, iOS 18 Safari, Netlify deploy preview: PWA install, share target,
  camera capture, cellular upload, and background resume passed.
```
