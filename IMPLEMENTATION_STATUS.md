# Implementation Status

## Conclusion

目前專案已收斂為可本機 dry run 的 `v0.1 sequence-only` CLI；主功能、最小驗證鏈、browser hardening、release metadata 產物與 CI workflow 都已補齊，但 GitHub Actions 遠端實跑與可連網環境下的 `npm audit --omit=dev` 仍待最終驗證。

## Scope Decisions

- 產品範圍收斂為 `Mermaid sequenceDiagram only`
- 輸出契約收斂為固定輸出：
  - `dist/<name>.screen-readable.svg`
  - `dist/<name>.screen-readable.png`
- 不再輸出 JSON metadata
- 不再輸出 variants
- 不再保留非 sequence diagram 路徑

## Spec And Docs Updated

- [PROJECT_SPEC.md](/Users/claire/dev/readable-mermaid/PROJECT_SPEC.md)
  - 改成 `sequence-only`
  - 改成 `SVG + PNG only`
  - 移除 flowchart / metadata / variants 契約
- [README.md](/Users/claire/dev/readable-mermaid/README.md)
  - 更新輸出說明為 `svg + png`
  - 補上 release metadata 用法
- [SECURITY.md](/Users/claire/dev/readable-mermaid/SECURITY.md)
  - 更新為 `SVG + PNG` 輸出
  - 補上 temporary `user-data-dir` 與 hardened launch flags 說明
- [RELEASE.md](/Users/claire/dev/readable-mermaid/RELEASE.md)
  - 補上本機 release checklist
  - 補上 CI / release workflow 說明

## Code Changes

### CLI And Renderer

- [src/cli.js](/Users/claire/dev/readable-mermaid/src/cli.js)
  - 固定輸出 `svg + png`
  - 抽出 `renderInputFile()` 供程式內重用
- [src/render.js](/Users/claire/dev/readable-mermaid/src/render.js)
  - 保持 `sequenceDiagram only` dispatch
- [src/sequence-renderer.js](/Users/claire/dev/readable-mermaid/src/sequence-renderer.js)
  - 移除 variants 回傳
  - 改為單一 candidate 主輸出
  - 接入 hardened browser launch 與 temporary profile cleanup
- [src/render-legacy.js](/Users/claire/dev/readable-mermaid/src/render-legacy.js)
  - 已刪除

### Browser Hardening

- [src/browser.js](/Users/claire/dev/readable-mermaid/src/browser.js)
  - 新增 browser detection helper
  - 新增 local request allowlist helper
  - 新增 temporary browser profile 建立 / 清理
  - 新增 hardened Chrome args builder

目前 browser hardening 包含：

- temporary `user-data-dir`
- `--disable-background-networking`
- `--disable-component-update`
- `--disable-default-apps`
- `--disable-sync`
- `--metrics-recording-only`
- `--no-default-browser-check`
- `--password-store=basic`
- `--use-mock-keychain`

## Test And Validation Added

### Automated Tests

- [test/browser.test.js](/Users/claire/dev/readable-mermaid/test/browser.test.js)
  - `resolveChromeExecutable`
  - `isLocalBrowserRequest`
  - temporary profile create/remove
  - Chrome launch args hardening
- [test/render.test.js](/Users/claire/dev/readable-mermaid/test/render.test.js)
  - unsupported non-sequence source rejection

### Regression And Smoke

- [scripts/check-sample-artifacts.js](/Users/claire/dev/readable-mermaid/scripts/check-sample-artifacts.js)
  - 驗證 10 個 sample 都有對應 `svg + png`
- sample corpus 的 `screen-readable.svg` 基準檔已補齊
- smoke render 命令：
  - `node ./src/cli.js ./samples/run-job-sequence.mmd`

### Current Package Scripts

- `npm test`
- `npm run test:regression`
- `npm run release:licenses`
- `npm run release:checksums`
- `npm run release:artifacts`
- `npm run release:sbom`

## Release Metadata And Supply Chain Work

### Added Scripts

- [scripts/generate-license-inventory.js](/Users/claire/dev/readable-mermaid/scripts/generate-license-inventory.js)
  - 產出 `license-inventory.json`
  - 產出 `license-inventory.md`
- [scripts/generate-checksums.js](/Users/claire/dev/readable-mermaid/scripts/generate-checksums.js)
  - 產出 `SHA256SUMS`
- [scripts/prepare-release-artifacts.js](/Users/claire/dev/readable-mermaid/scripts/prepare-release-artifacts.js)
  - 執行 `npm pack`
  - 產出 CycloneDX SBOM
  - 產出 license inventory
  - 產出 manifest
  - 產出 checksums
  - 使用 workspace-local `.npm-cache-release`，避免全域 npm cache 權限問題

### Generated Release Bundle

目前 [release](/Users/claire/dev/readable-mermaid/release) 內已生成：

- [release/readable-mermaid-0.1.0.tgz](/Users/claire/dev/readable-mermaid/release/readable-mermaid-0.1.0.tgz)
- [release/sbom.cyclonedx.json](/Users/claire/dev/readable-mermaid/release/sbom.cyclonedx.json)
- [release/license-inventory.json](/Users/claire/dev/readable-mermaid/release/license-inventory.json)
- [release/license-inventory.md](/Users/claire/dev/readable-mermaid/release/license-inventory.md)
- [release/manifest.json](/Users/claire/dev/readable-mermaid/release/manifest.json)
- [release/SHA256SUMS](/Users/claire/dev/readable-mermaid/release/SHA256SUMS)

### Tarball Contents Verified

`release/readable-mermaid-0.1.0.tgz` 目前包含：

- `package/src/browser.js`
- `package/src/cli.js`
- `package/src/profile.js`
- `package/src/render.js`
- `package/src/sequence-renderer.js`
- `package/README.md`
- `package/SECURITY.md`
- `package/LICENSE`
- `package/package.json`

## CI And Release Automation

### Added Workflows

- [.github/workflows/ci.yml](/Users/claire/dev/readable-mermaid/.github/workflows/ci.yml)
  - `push`
  - `pull_request`
  - `workflow_dispatch`
- [.github/workflows/release.yml](/Users/claire/dev/readable-mermaid/.github/workflows/release.yml)
  - `v*` tag push
  - `workflow_dispatch`

### Workflow Steps

兩個 workflow 目前都會執行：

- `npm ci`
- `npm test`
- `npm run test:regression`
- `node ./src/cli.js ./samples/run-job-sequence.mmd`
- `npm audit --omit=dev`
- `npm run release:artifacts`

其中 release workflow 另外會：

- upload workflow artifact
- 在 `v*` tag 時用 GitHub Release 發佈：
  - tarball
  - SBOM
  - license inventory
  - manifest
  - checksums

### Platform Constraint

- workflow 目前使用 `macos-latest`
- 原因是 browser detection 現在只支援 macOS `/Applications/...` 路徑

## Local Dry Run Result

本機已完成並通過：

- `npm test`
- `npm run test:regression`
- `node ./src/cli.js ./samples/run-job-sequence.mmd`
- `npm run release:artifacts`

驗證結果：

- 單元測試 6/6 通過
- 10 個 sample 都有對應 `svg + png`
- smoke render 成功輸出：
  - `samples/dist/run-job-sequence.screen-readable.svg`
  - `samples/dist/run-job-sequence.screen-readable.png`
- release bundle 成功生成

## Git Ignore Updates

- [.gitignore](/Users/claire/dev/readable-mermaid/.gitignore)
  - `release/`
  - `.npm-cache-release/`
  - `.DS_Store`

## Remaining Items

### Not Yet Verified Remotely

- GitHub Actions workflow 尚未在遠端實際跑過
- `v*` tag release asset upload 尚未實際跑過
- `npm audit --omit=dev` 尚未在可連網 CI / release 環境實跑

### Optional Next Improvements

- 支援非 macOS browser detection，讓 CI 可跑在 Linux
- 增加更細的 exit code taxonomy
- 補更多 render acceptance baseline，例如尺寸或可讀性快照檢查

## Suggested Verification Commands

本機再驗一次可直接跑：

```bash
npm test
npm run test:regression
node ./src/cli.js ./samples/run-job-sequence.mmd
npm run release:artifacts
```

若要驗證 release 目錄：

```bash
find release -maxdepth 1 -type f | sort
tar -tzf release/readable-mermaid-0.1.0.tgz
```
