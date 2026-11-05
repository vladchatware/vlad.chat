# Native fixture App Store renders

These renderers produce the iPhone and 13-inch iPad App Store previews and their matching screenshot cards from the captured native app fixtures. They use the shared portrait background and recorded voice/music mix in `../assets/`.

## Rerender

From the repository root, run:

```sh
node ios/app-store/video/render-native-fixture-layout-iphone-v01.mjs
node ios/app-store/video/render-native-fixture-layout-ipad-v01.mjs
```

Requires macOS, Node.js with `import.meta.dirname` support, FFmpeg on `PATH` with `libx264` and `drawtext`, and the system Arial font at `/System/Library/Fonts/Supplemental/Arial.ttf`.

Each command replaces its versioned screenshot-card directory and App Preview file. The iPhone render writes seven 1206 × 2622 cards and an 886 × 1920, 30-second H.264 High Level 4.0 preview. The iPad render writes seven 2064 × 2752 cards and a 1200 × 1600, 30-second H.264 High Level 4.0 preview.

The source screen recordings and result screenshots are in `../assets/native-fixture-recording/` and `../assets/native-fixture-recording-ipad/`. `preview-background.png` and `audio-review/vlad-audio-animatic-recorded-v02.m4a` are shared by both renders.
