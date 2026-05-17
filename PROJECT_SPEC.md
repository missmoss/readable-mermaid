# Project Spec

## Overview

本專案是一個 local-first、system-Chrome-only 的 CLI package，專注把 Mermaid `sequenceDiagram` `.mmd` 檔轉成可直接貼入 Word、Google Docs 與現代文件工具的 doc-ready `SVG` 與 `PNG` 資產。

## 1. Goals

### 1.1 Primary Goals

- 讓人在企業文件流程中，能把原本難讀的 Mermaid 圖快速轉成可直接閱讀與分享的圖片。
- 讓 AI 在產生 Mermaid 後，能把本工具當成標準後處理步驟，自動輸出文件可用圖檔。

### 1.2 Enterprise Tool Traits

- 全程本機執行，不上傳資料，不依賴 SaaS。
- 僅使用系統已安裝的 Chrome-compatible browser，不自帶 browser binary。
- 依賴少、版本固定、可鎖版、可審計。
- 介面穩定、可無互動執行、輸出路徑可預測。
- 失敗模式明確，可用 exit code 與 stderr 判斷。
- 無自動更新、可由企業內部 registry 或固定 artifact 發佈。
- 具備 lockfile、SBOM、license 清單與 dependency 掃描能力。
- 採最小權限原則，不讀工作目錄外資料、不額外啟動非必要子程序。

## 2. Implementation Plan

### 2.1 High-Level Design

- 採用單一本機 render engine，避免 human path 與 AI path 分叉。
- 以自有 `sequenceDiagram` parser/layout engine 搭配 system Chrome PNG rasterization，固定支援範圍並保持輸出可審計。
- 以 opinionated screen-readable profile 做 zero-config 輸出，先解決 sequence diagram 可讀性，再考慮彈性。

### 2.2 Why This Is Low Risk

- Mermaid `sequenceDiagram` 語法保留為唯一輸入格式，避免人工重畫與中間格式轉換。
- 自有 renderer 僅支援明確定義的語法子集，未支援語法直接報錯，避免 silent corruption。
- local-only + pinned deps + no bundled browser，較符合企業內部採用條件。
- 發佈模型可鎖定為固定版本 artifact，降低供應鏈更新風險。

### 2.3 Architecture

- `CLI Layer`: 讀取 `.mmd`、解析輸入/輸出路徑、寫入 SVG/PNG。
- `Render Engine`: 解析支援的 Mermaid `sequenceDiagram` 語法子集，產生自有 layout 與 SVG。
- `Optimizer`: 套用固定 screen-readable profile 與 sequence-specific layout heuristic，產生單一主輸出。
- `Rasterizer`: 啟動 system Chrome、阻擋外部網路請求，將本機 SVG 轉成 PNG。
- `Output Layer`: 產出單一 `SVG` 與單一 `PNG`。

### 2.4 Module Boundaries

- `src/cli.js`: human/AI 共用 entrypoint。
- `src/render.js`: sequence-only dispatch 與高層 render contract。
- `src/sequence-renderer.js`: custom parser、layout、SVG renderer 與 PNG rasterization。
- `src/profile.js`: 固定 doc target 與 browser target 設定。
- `README.md` / `SECURITY.md`: 安裝、安全模型與企業採用說明。
- release metadata: lockfile、SBOM、license inventory、artifact checksum。

### 2.5 Low-Level Direction

- 目前只支援 `sequenceDiagram`。
- 目前支援的 `sequenceDiagram` 子集包含：
  - `autonumber`
  - `participant` / `actor`
  - message arrows: `->>`, `-->>`, `->`, `-->`, `-)`, `--)`
  - `Note over`
  - `alt` / `else`
  - `par` / `and`
  - `opt`
  - `loop`
  - `activate` / `deactivate`
- 未支援的合法 Mermaid sequence 語法必須明確報錯，不可靜默忽略。
- sequence diagram 先優化可讀性，再考慮是否擴充更多 diagram type。
- browser 啟動需使用最小網路/背景功能 flags 與暫時 user-data-dir。
- render 過程需阻擋外部網路請求並限制輸入/輸出檔案邊界。

## 3. Interaction Interfaces

### 3.1 Human Interface

- 介面: 單一 CLI 命令，例如 `readable-mermaid input.mmd`。
- 用法: 讀取目前工作目錄內的本機檔案，輸出到目前工作目錄的 `dist/` 中。
- 原因: 最低心智負擔，適合同事手動轉圖與文件工作流。

### 3.2 AI Interface

- 介面: 同一個非互動式 CLI，但要求穩定輸出路徑、穩定檔名與穩定 exit code。
- 用法: AI 先生成 `.mmd`，再呼叫 CLI，最後把輸出 `SVG` 或 `PNG` 貼入文件流程。
- 原因: CLI 最容易被 agent、腳本、CI、editor plugin 與 automation pipeline 調用。

### 3.3 Interface Rules

- human mode 與 AI mode 共用 engine，不共用互動方式。
- human 優先簡單預設；AI 優先 deterministic I/O。
- 不引入必填互動參數或 GUI 作為主路徑。
- 輸入與輸出路徑都必須限制在 CLI 啟動時的 working directory 內。

## 4. Testing And Acceptance Plan

### 4.1 Test Plan

- Unit: path boundary、browser detection、unsupported type handling、unsupported syntax handling、exit code mapping。
- Render: sequence / wide sequence / long labels / long messages。
- Security: render 過程不得發出外部 `http/https` 請求。
- Security: 驗證不使用持久 browser profile、無自動更新行為、無非必要子程序。
- Supply chain: lockfile、license、SBOM、SCA/audit 掃描納入 CI 或 release checklist。
- Compatibility: Google Chrome / Chromium / Edge on supported local environments。
- Regression: 重建 sample SVG baselines 並比對是否維持可讀性與穩定命名。
- Smoke: 以真實 CLI render 至少一個 sample，驗證 `SVG + PNG` 產出路徑。

### 4.2 Acceptance Criteria

- 人類可在 100% 文件縮放下閱讀主要文字，無需先放大看 header/entity。
- sequence diagram 在 7-10 participants 下仍可辨識 entity 與主要流程。
- AI 可用單次 CLI 呼叫穩定產出 `SVG` 與 `PNG`，無需互動。
- 所有輸入均留在本機，render 過程無外部網路依賴。
- CLI 對工作目錄外輸入或輸出路徑必須明確拒絕。
- CLI 對未支援 diagram type 或未支援 sequence syntax 必須回傳穩定非零 exit code。
- direct runtime dependencies 維持極少且版本固定。
- release artifact 可被固定版本引用，並附帶 checksum 與 dependency inventory。
- package 可通過基本 dependency scan 與 license review。

### 4.3 Validation Method

- 用至少 10 個真實或擬真 `.mmd` 樣本做人工驗收。
- 每個樣本至少覆蓋一張文件截圖，確認貼入 Word / Google Docs 後可讀。
- 用腳本檢查輸出檔名、`SVG/PNG` 是否存在、exit code、路徑邊界與無網路 request 行為。
- 在 release 前執行 `npm audit` / SCA 掃描、license inventory 檢查與 SBOM 產生。
