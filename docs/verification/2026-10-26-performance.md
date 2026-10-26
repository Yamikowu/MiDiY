# 2026-10-26 網頁效能量測與顯示更新優化

## 方法與基準

基準為 `43eb6bc` 的程式。相同電腦、內嵌 Chromium、本機 Vite、真實 Mapping／Research UI 與 Runtime，使用記憶體儲存及 FakeInput／FakeMidi，不讀寫使用者設定或連接實體硬體。瀏覽器 user agent 與視窗寬度保存在原始 JSON。

測試工具：`npm start` 後開啟 `/test/browser/performance.html`。暖機 120 筆；Mapping、Testing 日誌開啟、Testing 日誌暫停各跑三次，每次 240 筆，每個 animation frame 投入 8 筆。Pad 1 的固定序列包含 Note On、壓力更新與 Note Off。全部合計 2,280 筆報告。

下表是三次的中位數，指 **同步輸入回呼耗時，加上 requestAnimationFrame 回呼耗時**。將延後的表格繪製時間一併計入，避免只把工作移出同步回呼就當成消失。此指標包含被量測的 JavaScript 工作，不包含全部瀏覽器 layout／paint、GPU、GC 或背景程序成本，不是 CPU 使用率、FPS 或硬體到 DAW 延遲。

| 場景／每 240 筆 | 優化前 | 優化後 | 工作時間減少 |
| --- | ---: | ---: | ---: |
| Mapping（日誌持續記錄） | 651.5 ms | 105.8 ms | 83.8% |
| Testing（日誌開啟） | 632.4 ms | 106.1 ms | 83.2% |
| Testing（日誌暫停） | 47.6 ms | 22.1 ms | 53.6% |

這是上述 Pad 回放的結果，不代表所有操作皆有相同比例的提升。每個場景只重複三次，時間仍受機器負載與瀏覽器計時精度影響；工作次數與輸出檢查較容易重現。

## 找到的重複工作

- 每 240 筆報告，原始報告表格原本重建 240 次，現在是 30 次；暫停日誌時兩版皆為 0 次。Mapping 畫面下 Research 仍持續擷取，原本也承擔相同表格成本。
- 同一回放，Mapping 的按壓、演奏模式、燈光與批次預覽各從 280 次更新降到 40 次。Runtime 狀態事件數仍為 280，沒有減少或合併 Runtime 事件。
- Runtime snapshot 讀取由每次 1,190 次降到 470 次；snapshot 本身仍保留獨立副本的契約。

## 改動與行為邊界

- `FrameTask` 只合併 Research 表格與報告計數顯示，每個畫面週期最多重建一次。CaptureSession 仍在每個 raw 事件中同步收集，沒有節流、丟棄或只取最新一筆原始資料。
- Mapping 依演奏模式、模式選擇狀態、按住 Pad／Button 與 LED 報告內容決定是否更新硬體圖；MIDI 計數或 LED 寫出確認不再重畫相同硬體圖。裝置／MIDI 狀態顯示繼續獨立更新。
- 控制項釋放、模式切換、燈光變更仍同步更新；沒有把 MIDI、實體 LED、Runtime 或 Driver 移入 animation frame。
- 日誌列與報告計數可延後至下一個畫面週期；背景頁面暫停 animation frame 時，顯示會等恢復，擷取與 MIDI 不依賴畫面排程。暫停／恢復、清除、匯入、語言切換等直接重畫會取消過期排程，dispose 也會取消它。

## 功能驗證

- `npm test`：138 項通過；`npm run build`：通過。
- [瀏覽器完整結果](2026-10-26-performance-browser.txt)：1440px 通過 93 項、390px 通過 89 項，共 182 項。涵蓋既有 Profile／Mode、草稿、Pad／Strip、快捷鍵、語言／Note 偏好與 Research。
- 新增高頻檢查：96 筆 burst 全數存入擷取，僅重建一次表格；日誌暫停仍收資料及更新計數；恢復立即呈現最近 100 筆；清除不刪已收集資料且不被過期畫面回呼覆蓋。
- 新增 FrameTask 合併／取消／錯誤恢復與 Mapping 視覺狀態失效測試。
- 前後各 2,280 筆全數記錄；9 組回放的 MIDI 數量、MIDI 序列摘要、HID 數量、HID 序列摘要與 Runtime state 事件數一致。摘要由工具內固定的非密碼學雜湊計算；這是回放一致性檢查，不是接收端驗證。
- Runtime、mikro-core、Driver、Adapter 程式未變更。既有釋放、清音、模式抑制與 LED 生命週期測試仍通過。

原始數據：[優化前](2026-10-26-performance-before.json)、[優化後](2026-10-26-performance-after.json)。[可視化量測摘要](2026-10-26-performance.html)。

## 實機範圍

本輪沒有量測實體控制器到瀏覽器／DAW 的延遲、實體 LED 或 DAW 接收結果。上述發送計數來自測試替身。沒有宣稱真實 MIDI 延遲改善或所有使用情境都無回歸；既有實機紀錄未改寫。
