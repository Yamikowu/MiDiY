# Mikro Protocol Analyzer (MPA)

Maschine Mikro MK3 的本機 WebHID Input Report 分析工具。控制項清單根據 [Native Instruments Mikro MK3 手冊](https://docs.native-instruments.com/ni-tech-manuals/maschine-mikro-mk3-manual/en/quick-reference)；[r00tman 的開源驅動](https://github.com/r00tman/maschine-mikro-mk3-driver) 作為後續比對參考。本站目前只讀取輸入，**沒有發送 HID Output Reports**。這避免在尚未驗證輸出封包前誤操作 LED 或螢幕。

## 啟動

在此資料夾執行 `npm start`，然後用支援 WebHID 的桌面瀏覽器開啟 `http://localhost:4173`。`localhost` 是 WebHID 所需的安全環境；一般遠端 HTTP 網址無法使用。可執行 `npm test` 驗證分析函式。

## 使用流程

1. 點「連接裝置」，在瀏覽器裝置選擇器選 Mikro MK3（VID `0x17CC`、PID `0x1700`）。
2. 等待控制器靜止，再點圖上的控制項，按「開始擷取」。
3. 依提示只操作這一個控制項，完成後按「停止並分析」。
4. 需要測 Shift 組合時，在備註中記下組合；建議先各自測 Shift 與目標按鈕，再測組合。
5. 匯出完整 JSON 保存原始資料；CSV 是每次擷取的候選變化欄位摘要。

候選欄位是同一 Report ID 的相鄰封包位元組變化，不等同已證實的控制項解碼。背景雜訊、模式狀態、同時操作其他按鈕都可能出現在結果。請重複擷取並比對按下、放開、不同力度與方向。

## JSON 資料格式

`schema: "mpa-session-v1"`。`reports` 保存接收順序、ISO 時間、`performance.now()` 毫秒值、Report ID、完整 payload 位元組陣列和相對上一筆同 ID 報告的變化偏移。Report ID 與 payload 分開存放，與 WebHID `inputreport` 事件一致。`captures` 保存控制項 ID、起訖時間、操作備註、開始時每個 Report ID 的 baseline、該時段完整樣本及候選摘要。偏移從 **0** 開始，且只針對 payload，不含 Report ID。

頁面最多保留 100,000 筆報告，以限制記憶體使用。畫面表格只顯示最近 100 筆。資料不會自動上傳或持久化；重新整理前請先匯出 JSON。

## 尚待實機驗證

- 各控制項的 Report ID、bit/byte 對應與狀態值。
- Pad 壓力／力度曲線，Encoder 方向與增量，Smart Strip 觸碰／位置。
- 不同模式及 Shift 組合的輸入差異。
- LED、螢幕的輸出格式與安全初始化流程。
