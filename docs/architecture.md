# 架構與責任

## 目前網頁實作（Mikro MK3）

下圖描述目前 Mikro MK3 的實際組裝。Runtime、Driver、Adapter 與 UI 的責任分層可沿用；目前事件、映射引擎與 Profile 仍含 Mikro 專屬設計，尚未驗證為其他控制器的共用實作。

```text
app.js（組裝與瀏覽器生命週期）
  ├─ Mapping UI + Profile Library（表單／草稿／儲存）
  ├─ Testing UI + CaptureSession（研究／分析／匯出）
  └─ TranslatorRuntime
       ├─ ControllerInput ← WebHidAdapter
       ├─ MikroDriver → @midiy/mikro-core 的 Decoder／LED Encoder
       ├─ @midiy/mikro-core 的 MappingEngine
       └─ MidiOutput ← WebMidiAdapter
```

控制器 → 輸入 Adapter → Driver 解碼 → 映射引擎 → MIDI 輸出 Adapter。LED 回程由 Runtime 狀態與模式設定經 Driver 編碼，再送至控制器輸入 Adapter。輸入 Adapter 因此是雙向連線，不是只能讀取。

- `src/app.js`：實例組裝、頁面掛載、連接按鈕、錯誤提示、pagehide。Runtime 不自行註冊 window 事件。
- `src/runtime/`：連線與轉譯生命週期、已套用設定、模式、清音、LED 接管／佇列。透過注入的 I/O 運作，不讀 DOM、navigator 或儲存。
- `src/adapters/input/`、`src/adapters/output/`：分別處理控制器資料與 MIDI 接收端。WebHID descriptor 驗證與原生瀏覽器物件只留在 Adapter。
- `src/devices/mikro-mk3/`：裝置識別、控制項與擷取指引、Driver、網頁硬體圖。硬體圖依賴 DOM；Driver 不引用硬體圖。
- `src/mapping/`：編輯草稿、預覽、匯入匯出與本機設定清單。UI 的 editorModeId 與 Runtime 演奏模式分離；瀏覽 Mode 只更新 UI，模式指派畫面由獨立 MikroDriver 純編碼後繪到參照圖，不送裝置。只有套用才更新執行映射；Mode 綁定、力度曲線與共用燈光依既有操作立即儲存。
- `src/research/`：CaptureSession 管理原始資料與擷取狀態，Testing UI 訂閱 Runtime；不需要 Mapping UI。
- `src/i18n/`：繁中／英文顯示與語言偏好；只更新標記文字和 UI 摘要，不重建表單或 Runtime。
- `src/shared/`：頁籤與對話框等網頁共用工具。
- `packages/mikro-core/`：保留既有套件 API、Mikro 事件、Profile、映射演算法與編碼；沒有改成多裝置通用套件。

## 目前 Runtime 介面

以下為目前 Mikro Runtime 的介面與生命週期，不是所有未來裝置已共同支援的 API。契約定義在 `src/runtime/contracts.ts`。原始報告使用 `{ reportId, data: Uint8Array }`，payload 不含 ID；裝置資訊只包含序列化欄位。MIDI 狀態包含可選埠與目前埠，不暴露瀏覽器物件。

Runtime 提供 connect／disconnect、enableMidi／selectOutput、applyProfile／switchMode、setVelocityCurve／updateFeedback、setLedEnabled／panic。一般套用保留引擎的 held-control 抑制規則；載入另一份 Profile 時以 restart 重建引擎。力度與共用回饋更新不釋放正在發聲的音符。

`subscribe` 回傳取消訂閱函式；事件包括 state、raw、decoded、mode、midi、diagnostic、error、disconnected。每個訂閱者取得獨立副本，訂閱者拋錯不打斷轉譯；`snapshot` 同樣是獨立副本。MappingEngine 管理按住模式選擇鍵與 Pad／一般按鍵切換的抑制狀態，選模式及跨模式按住的按鍵須放開才恢復新映射；Runtime snapshot 的 selectingMode 供 UI 顯示，Driver 依 Profile 的模式觸發控制項編碼 Pad 色盤及單色按鍵燈號。

MIDI 寫出事件表示送出呼叫完成，不能證明 DAW 已收到。錯誤事件與 LED 狀態另外提供語言無關的 code／params／detail，由網頁翻譯；Runtime 不引用語系字典。

關閉先停止 LED producer、取消舊佇列、清音，再依接管狀態送最後全暗報告並關閉；重疊 disconnect 共用 Promise。pagehide 只做 best effort，瀏覽器不保證等待完成。輸出埠已消失時無法保證 Note Off 到達接收端。

## 後續邊界

Mikro 的控制項操作與設定細節分別見[裝置操作指南](devices/mikro-mk3/user-guide.md)與[Profile](devices/mikro-mk3/profile.md)。第二種裝置與盒子平台的調整順序、共用行為及部署方向統一記在[目標與路線圖](roadmap.md)；目前實作範圍見[支援表](support.md)。
