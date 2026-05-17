# Release Checklist

Run the local validation chain first:

```bash
npm test
npm run test:regression
```

Generate release metadata and package artifacts:

```bash
npm run release:artifacts
```

Optional network-backed audit step:

```bash
npm audit --omit=dev
```

CI and release automation:

- `.github/workflows/ci.yml` runs validation on `push`, `pull_request`, and manual dispatch.
- `.github/workflows/release.yml` runs the same checks for `v*` tags and publishes the release bundle as GitHub release assets.
- Both workflows run on `macos-latest` because the current browser detection is macOS-specific.

The `release/` directory will contain:

- package tarball from `npm pack`
- `sbom.cyclonedx.json`
- `license-inventory.json`
- `license-inventory.md`
- `manifest.json`
- `SHA256SUMS`
