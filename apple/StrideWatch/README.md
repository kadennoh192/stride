# Stride for Apple Watch

This directory contains the lightweight independent watchOS companion. It uses SwiftUI, `URLSession`, Keychain, and local notification APIs only; there are no third-party runtime dependencies.

The companion pairs with a signed-in Stride workspace through a one-time eight-character code generated in **Settings → Apple Watch**. The server stores only hashes of pairing credentials. The resulting device token stays in the watch Keychain, expires after one year, and can be revoked from Stride.

The current source supports upcoming and undated tasks, task completion with recurrence/dependency rules, quick task capture, today's habits, and a shared focus timer. Every watch mutation is written through Stride's normal field/change protocol so browsers receive it on their next sync.

## Build and device validation

1. Install XcodeGen, run `xcodegen generate` in this directory, and open `StrideWatch.xcodeproj` in Xcode.
2. Select your Apple Developer team and use a unique bundle identifier if `app.stride.watch` is unavailable.
3. Set `STRIDE_API_ORIGIN` in `StrideWatch/Info.plist` to the production Stride HTTPS origin.
4. Build first for a watchOS 10+ simulator, then install on a physical paired Watch.
5. Verify pairing expiry/one-time use, offline errors, task recurrence, habit logging, focus notification permission, token revocation, and background/foreground refresh.

Native watch traffic cannot pass through an owner-private Sites access gate. Keep pairing visibly disabled in practice until the Stride origin is reachable by the intended account audience and the account service is configured. Signing, App Store distribution, and physical-device acceptance are release gates; this repository does not claim those checks have passed.
