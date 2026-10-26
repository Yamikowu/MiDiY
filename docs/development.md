# 開發指南

需要 Node.js 24.22.1 以上的 24.x。`.nvmrc` 與 `.node-version` 固定為 24.22.1，`package.json` 的 `engines.node` 限制相容範圍；使用 nvm 時先執行 `nvm install`、`nvm use`。根目錄執行 `npm ci`、`npm start`；固定使用 `http://127.0.0.1:4173`。localhost 與 127.0.0.1 的授權與本機儲存分開。

24.22.1 是 [2026-10-21 的官方安全修補版本](https://nodejs.org/en/blog/release/v24.22.1)。升級版本時同步更新兩份版本檔、最低版本約束與文件，並重新執行既有測試及建置。

## Docker、CI 與部署

截至 2026-10-26，儲存庫沒有 Dockerfile、Compose、CI workflow 或部署平台設定，無從確認外部主機的 Node.js 版本。若另有外部建置環境，應使用版本檔指定的 Node.js，執行 `npm ci`、`npm test`、`npm run build`。

目前 `npm run build` 產生靜態網站 `dist/`；提供靜態檔案本身不需要 Node.js。正式網站需透過 HTTPS 提供，讓瀏覽器可使用 WebHID／Web MIDI；`npm start` 與 `npm run preview` 用於本機開發／預覽。翻譯盒部署仍屬規劃。

- `npm test`：先編譯核心，再執行協定、映射、Adapter、Runtime、研究模型與相容性測試。
- `npm run build`：核心 ESM／宣告、網站型別檢查、Vite 正式輸出。
- `npm run preview`：預覽正式版本。

既有 JS 使用 allowJs 且未開 checkJs；TypeScript 通過不等於 JS UI 操作已驗證。Runtime 測試以假 Adapter 執行，不需要 DOM 或實體裝置。瀏覽器、DAW／LED 實機驗證另記。

## 修改邊界

先看[架構](architecture.md)。控制器差異進 Driver／裝置描述，瀏覽器 API 留 Adapter，草稿留裝置的 EditorSession，儲存由 Mapping 協調器與 Library 執行；研究工具訂閱 Runtime 原始資料。

新增裝置時先收集識別／連線模式、原始封包、來源版本、重現步驟與協定證據，再建立裝置實作與解碼向量，更新輸入支援表。候選位元不可直接列為已確認。第二種裝置尚未實作，本輪不假定所有控制器都符合 Mikro 的事件模型。

修改既有格式時保留匯入相容性、儲存鍵與輸出命名；套件 exports 不隨內部搬移改名。現有 Profile／本機清單的格式與支援範圍集中於[Mikro Profile](devices/mikro-mk3/profile.md)。原生盒子的 USB Host、供電與 MIDI 封裝仍須獨立實作。

裝置協定、來源版本與移植限制維護在各裝置文件；目前可參考[Mikro 裝置入口](devices/mikro-mk3/README.md)。第三方程式需保留[授權](../THIRD_PARTY_NOTICES.md)，外部參考 checkout 不是本專案建置依賴。

## 功能修改導覽

先從 `src/devices/mikro-mk3/index.ts` 看裝置組裝，再只讀此次功能的模組；不用先讀完整 UI。下表中的 Mapping 檔案均位於該裝置的 `mapping/`。

| 要修改的功能 | 優先閱讀 |
| --- | --- |
| Pad Hit／Press／燈色欄位 | `bindings/pad-editor.ts`、`bindings/button-editor.ts`（共用離散動作）、`bindings/binding-draft.ts` |
| Button Note／CC／Action on | `bindings/button-editor.ts`、`bindings/binding-fields.ts`；共用呈現由 `binding-editor.ts` 協調 |
| Encoder CC | `bindings/encoder-editor.ts` |
| Strip Position／Touch／燈光 | `bindings/strip-editor.ts` |
| 草稿、複選、複製貼上、歷史 | `editor-session.ts`、`editor-model.ts`；套用／儲存副作用在 `translator-ui.ts` |
| Profile／Mode 管理與觸發指派 | `profile-mode-panel.ts`、`profile-library.ts` |
| 硬體圖、框選與實體操作選取 | `hardware-workspace.ts`、裝置 `ui/hardware-view.js` |
| 燈光預覽／立即回饋設定 | `feedback-preview.ts`／`feedback-settings.ts` |
| 演奏轉譯、清音、連線及 LED 關閉 | 裝置 `runtime.ts`、`driver.ts`，必要時讀 `mikro-core` 對應演算法 |
| 原始資料研究 | 共用 `src/research/`；裝置指引由 Mikro `research.ts` 提供 |
| 視覺樣式 | `src/styles/index.css` 載入順序及對應功能檔；硬體表面在裝置 `ui/hardware.css` |

第二裝置加入前，不把 Mikro 的 ControlId、Pad、Strip 或 Profile 包成假通用介面。先以實機報告確認能力，再決定共用 Runtime／映射契約；有第二個相同需求才評估提取共用功能。保留 `mikro-core` exports，Profile 只接受目前 v2，禁止增加舊格式讀取或遷移。

## 瀏覽器回歸

執行 `npm start`，開啟 `/test/browser/workspace-preview.html`，同時執行 1440px 與 390px 的真實 UI／Runtime 回歸，I/O 與儲存使用測試替身。結果顯示在 `preview-results`；單一寬度可開 `/test/browser/workspace-layout.html`。包含 Profile／Mode、Pad／Strip、草稿、語系、Research 與版面檢查，不會讀寫使用者 Profile，也不能證明實體 LED 或 DAW 已收到資料。

## Capture Session：目前 HID 擷取格式

本節描述目前網頁的 HID Input Report 擷取，不是所有未來輸入方式的通用格式；不同裝置的 HID 資料仍需各自 Driver 解碼。

目前匯出格式為 `midiy-session-v1`；只接受目前格式，不再匯入 `mpa-session-v1`。權威匯入驗證在 `src/research/analysis.js`，狀態模型為 CaptureSession。

Session 保存 schema、appVersion、createdAt、device、reports、captures。每個報告保留 ISO time、相對 t（毫秒）、reportId、完整 bytes 與 changedOffsets。payload 不含 report ID，offset 從 0 開始。擷取保存控制項 ID、起訖時間、備註、按 Report ID 分開的 baseline、samples 與分析候選。

最多錄製 100,000 筆，達上限後停止收集並完成進行中的擷取，MIDI 轉譯繼續。畫面保留最近 100 筆；清除顯示不刪 Session。停止擷取後仍可記錄 Session 原始報告。Session 不自動儲存，重新整理前應匯出。

JSON 匯出名稱維持 `midiy-session-<timestamp>.json`；候選 CSV 維持 `midiy-candidates.csv` 與既有欄位。候選分析表示操作期間觀察到變化，不等於協定已證實。錄製格式與 Mapping Profile 各自匯入匯出。

## 網頁語系

`src/i18n/` 維護 `zh-TW`／`en` 字典、語言選擇與顯示綁定。英文使用相同 MessageKey 型別，測試檢查兩語系的鍵與插值參數一致。語言偏好使用獨立的 `midiy-ui-language-v1` 儲存鍵，不加入 Profile 或 Session。

文字模板使用 t；需要原地更新的 HTML 文字使用 l 或 data-i18n，屬性使用 attribute／data-i18n-aria-label 等綁定。表單標籤的 labelMarkup／labelAttributes 只處理程式定義的標籤，不可用於使用者名稱或備註。翻譯參數進入 HTML 時必須跳脫。

切換語言不呼叫 renderBinding、重新掛載頁面或更新 Runtime 設定；語言回呼只刷新摘要與顯示。Runtime／Adapter 透過 `src/runtime/issues.ts` 的 code、params、detail 提供結構化診斷，UI 的 formatError 決定顯示語言；既有 message／ledStatus 留作相容資訊。核心協定、識別 ID 與匯出資料不因語言切換而改寫。

## Note 顯示偏好回歸

`src/shared/notes/note-format.ts` 負責純換算與獨立偏好儲存，`note-input.ts` 負責網頁控制項；Runtime、Driver、Profile 格式不接收顯示偏好。數字欄位保留為編輯器的標準值，偏好刷新不派送表單事件。

執行 `npm test` 驗證全部音符的換算、偏好儲存及已連線 Runtime 的無副作用切換。執行 `npm start` 後開啟 `/test/browser/note-preferences.html`，可用實際編輯器與 Runtime 搭配假 Adapter 做瀏覽器回歸。該頁使用記憶體儲存，不讀寫使用者 Profile；「Simulate connection + MIDI + LED」啟動模擬裝置，「Check state」顯示設定、草稿及發送／事件計數。此工具不代表實機驗證。

## 效能回放

`/test/browser/performance.html` 以真實 UI／Runtime 和模擬 I/O 回放固定 Pad 序列，暖機後比較 Mapping、Testing、日誌暫停三個場景。`performance-results` 包含每筆同步回呼耗時、animation frame 回呼耗時、表格替換與 Mapping 更新次數、snapshot 讀取次數、MIDI／HID 數量及序列摘要。先確認 status 為 complete 且 allRecorded 為 true，再比較相同環境的多次結果；測試資料與正式 Profile 分開。

畫面日誌允許按顯示週期合併更新；原始資料、映射、MIDI 與實體 LED 必須保持各自的即時生命週期。比較時要把延後的畫面工作計入，不能只報同步回呼變短。方法、限制與本輪結果見[效能驗證紀錄](verification/2026-10-26-performance.md)。
