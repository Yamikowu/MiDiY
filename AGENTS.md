# MiDiY 開發規則

- 先讀 docs/architecture.md；本輪是單一 Mikro 網頁實作，盒子與其他控制器是規劃。
- Driver 負責裝置差異；瀏覽器 API 留 Adapter；Runtime 不讀 DOM、navigator、window 或儲存。
- Mapping 草稿／預覽不直接寫實體裝置；Research 訂閱 Runtime，不依賴 Mapping UI。
- 保留 mikro-core exports、目前功能及釋放／LED 生命週期；Profile 使用 midiy-profile-v2 與 midiy-profile-library-v2，不保留舊設定讀取或遷移。
- 改執行流程後跑 npm test 與 npm run build；UI 改動另做瀏覽器回歸。
- 區分程式、瀏覽器與實機驗證；假說不列為已確認，未重測不改寫歷史結果。
- 保留既有未提交變更、來源版本與第三方授權；不修改旁邊參考 driver checkout。
