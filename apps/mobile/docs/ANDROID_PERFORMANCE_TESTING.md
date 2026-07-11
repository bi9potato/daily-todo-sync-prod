# Android performance testing

The Expo config plugin generates an official AndroidX Macrobenchmark module on every clean prebuild.

Use a physical Android 13+ device for Baseline Profile generation and a representative mid-range physical device for measurements:

```powershell
pnpm --filter @daily-todo-sync/mobile exec expo prebuild --platform android --clean --no-install
cd apps/mobile/android
./gradlew :macrobenchmark:connectedNonMinifiedReleaseAndroidTest
```

The critical journeys cover cold startup, Today, device timeline, mobility, and the unified timeline. Copy the generated `BaselineProfileGenerator-*-baseline-prof.txt` to `app/src/main/baseline-prof.txt`, rebuild release, and compare the Macrobenchmark JSON for startup timing and frame timing before accepting a performance change.

Emulator numbers are not release evidence. Record device model, Android version, build SHA, median cold startup, frame-duration percentiles, peak memory, and 24-hour background battery/network usage with each performance release.
