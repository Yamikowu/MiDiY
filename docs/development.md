# 開發指南

需要 Node.js 22.12+ 或 24。根目錄執行 `npm install`、`npm start`；固定使用 `http://127.0.0.1:4173`。localhost 與 127.0.0.1 的授權與本機儲存分開。

- `npm test`：先編譯核心，再執行協定、映射、Adapter、Runtime、研究模型與相容性測試。
- `npm run build`：核心 ESM／宣告、網站型別檢查、Vite 正式輸出。
- `npm run preview`：預覽正式版本。

既有 JS 使用 allowJs 且未開 checkJs；TypeScript 通過不等於 JS UI 操作已驗證。Runtime 測試以假 Adapter 執行，不需要 DOM 或實體裝置。瀏覽器、DAW／LED 實機驗證另記。

## 修改邊界

先看[架構](architecture.md)。控制器差異進 Driver／裝置描述，瀏覽器 API 留 Adapter，草稿與儲存留 Mapping UI；研究工具訂閱 Runtime 原始資料。

新增裝置時先收集識別／連線模式、原始封包、來源版本、重現步驟與協定證據，再建立裝置實作與解碼向量，更新輸入支援表。候選位元不可直接列為已確認。第二種裝置尚未實作，本輪不假定所有控制器都符合 Mikro 的事件模型。

修改既有格式時保留匯入相容性、儲存鍵與輸出命名；套件 exports 不隨內部搬移改名。現有 Profile／本機清單的格式與遷移細節集中於[Mikro Profile](devices/mikro-mk3/profile.md)。原生盒子的 USB Host、供電與 MIDI 封裝仍須獨立實作。

裝置協定、來源版本與移植限制維護在各裝置文件；目前可參考[Mikro 裝置入口](devices/mikro-mk3/README.md)。第三方程式需保留[授權](../THIRD_PARTY_NOTICES.md)，外部參考 checkout 不是本專案建置依賴。

## Capture Session：目前 HID 擷取格式

本節描述目前網頁的 HID Input Report 擷取，不是所有未來輸入方式的通用格式；不同裝置的 HID 資料仍需各自 Driver 解碼。

目前匯出格式為 `midiy-session-v1`；`mpa-session-v1` 仍可匯入，載入後正規化，原始檔不改寫。權威匯入驗證在 `src/research/analysis.js`，狀態模型為 CaptureSession。

Session 保存 schema、appVersion、createdAt、device、reports、captures。每個報告保留 ISO time、相對 t（毫秒）、reportId、完整 bytes 與 changedOffsets。payload 不含 report ID，offset 從 0 開始。擷取保存控制項 ID、起訖時間、備註、按 Report ID 分開的 baseline、samples 與分析候選。

最多錄製 100,000 筆，達上限後停止收集並完成進行中的擷取，MIDI 轉譯繼續。畫面保留最近 100 筆；清除顯示不刪 Session。停止擷取後仍可記錄 Session 原始報告。Session 不自動儲存，重新整理前應匯出。

JSON 匯出名稱維持 `midiy-session-<timestamp>.json`；候選 CSV 維持 `midiy-candidates.csv` 與既有欄位。候選分析表示操作期間觀察到變化，不等於協定已證實。錄製格式與 Mapping Profile 各自匯入匯出。

## 網頁語系

`src/i18n/` 維護 `zh-TW`／`en` 字典、語言選擇與顯示綁定。英文使用相同 MessageKey 型別，測試檢查兩語系的鍵與插值參數一致。語言偏好使用獨立的 `midiy-ui-language-v1` 儲存鍵，不加入 Profile 或 Session。

文字模板使用 t；需要原地更新的 HTML 文字使用 l 或 data-i18n，屬性使用 attribute／data-i18n-aria-label 等綁定。表單標籤的 labelMarkup／labelAttributes 只處理程式定義的標籤，不可用於使用者名稱或備註。翻譯參數進入 HTML 時必須跳脫。

切換語言不呼叫 renderBinding、重新掛載頁面或更新 Runtime 設定；語言回呼只刷新摘要與顯示。Runtime／Adapter 透過 `src/runtime/issues.ts` 的 code、params、detail 提供結構化診斷，UI 的 formatError 決定顯示語言；既有 message／ledStatus 留作相容資訊。核心協定、識別 ID 與匯出資料不因語言切換而改寫。
