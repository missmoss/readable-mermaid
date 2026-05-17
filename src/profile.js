export const DOC_INLINE_PROFILE = {
  name: "doc-inline",
  pageWidthPx: 624,
  outerPaddingPx: 24,
  background: "#ffffff",
  fontFamily: "'SF Pro Text', 'Segoe UI', sans-serif",
  minFontSizePx: 15,
  maxFontSizePx: 22,
  preferredFontSizePx: 19,
  preferredNodeSpacing: 55,
  preferredRankSpacing: 70,
  minNodeSpacing: 28,
  minRankSpacing: 40,
  maxPasses: 6,
  maxAcceptableAspectRatio: 1.35,
  switchToTopBottomAspectRatio: 1.15,
  maxRenderedHeightPx: 1400,
  chromeExecutableCandidates: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  ]
};

export const SCREEN_READABLE_PROFILE = {
  ...DOC_INLINE_PROFILE,
  name: "screen-readable",
  pageWidthPx: 1120,
  outerPaddingPx: 28,
  maxRenderedHeightPx: 1800
};
