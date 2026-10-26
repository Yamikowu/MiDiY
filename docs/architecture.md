# 架構與責任

## 目前網頁實作（Mikro MK3）

下圖描述目前 Mikro MK3 的實際組裝。Runtime、Driver、Adapter 與 UI 的責任分層可沿用；目前事件、映射引擎與 Profile 仍含 Mikro 專屬設計，尚未驗證為其他控制器的共用實作。

```text
app.js（瀏覽器服務、連接按鈕、pagehide）
  └─ devices/mikro-mk3/index.ts（單一 Mikro 組裝）
       ├─ mapping/TranslatorUI（協調套用、儲存、更新畫面）
       │    ├─ EditorSession（草稿／選取／歷史）
       │    ├─ Profile／Mode panel
       │    ├─ Binding editor → Pad／Button／Encoder／Strip
       │    └─ Hardware workspace + Feedback preview
       ├─ research 設定 → 共用 Testing UI + CaptureSession
       └─ Mikro TranslatorRuntime
            ├─ ControllerInput ← WebHidAdapter
            ├─ MikroDriver → mikro-core Decoder／LED Encoder
            ├─ mikro-core MappingEngine
            └─ MidiOutput → WebMidiAdapter
```

控制器 → 輸入 Adapter → Driver 解碼 → Mikro 映射引擎 → MIDI 輸出 Adapter。LED 回程由 Runtime 狀態經 Driver 編碼，再交由輸入 Adapter 寫出；輸入連線是雙向的。

## 裝置與功能邊界

- `src/app.js` 只提供瀏覽器 I/O、儲存、提示、連線按鈕與 pagehide。`devices/mikro-mk3/index.ts` 建立 Mikro Driver、Runtime、Library、Mapping 與 Research，不新增裝置選擇器。
- `src/devices/mikro-mk3/runtime.ts` 是 **Mikro Runtime**，仍擁有 Mikro 事件、Profile 與演奏狀態，沒有宣稱為多裝置通用實作。它不讀 DOM、navigator、window 或儲存。
- `mapping/editor-session.ts` 是唯一編輯狀態擁有者，集中 Profile、編輯模式、選取、分頁、單項表單值草稿、批次／貼上草稿、複製內容、dirty 與歷史；純操作不讀 DOM、不自行儲存或送裝置。
- `mapping/translator-ui.ts` 是協調器，組裝各功能的明確 context／回呼，負責 Binding 套用、儲存及歷史還原的副作用。功能模組不接收整個 TranslatorUI，也不引用它的私有型別。
- `mapping/binding-editor.ts` 協調表單、分頁與驗證顯示；Pad／Button／Encoder／Strip editor 維護控制項欄位與讀取規則。`bindings/binding-draft.ts` 組成獨立且完整驗證過的 Profile，回傳後才由協調器套用。共用欄位工具不擁有另一份 Profile 或 Runtime。
- `mapping/profile-mode-panel.ts` 負責設定清單、命名、匯入匯出與模式指派；`profile-library.ts` 保存 Mikro v2 清單，仍屬裝置專屬。
- `mapping/hardware-workspace.ts` 負責框選、快捷鍵、實體操作選取及演奏顯示；`feedback-preview.ts` 用獨立 Driver 純編碼後繪到硬體圖，不能送實體裝置。`feedback-settings.ts` 處理立即儲存的力度與共用燈光。
- `ui/hardware-view.js` 與 `ui/hardware.css` 是 Mikro 的網頁硬體圖。Driver 不依賴它們。
- `src/runtime/contracts.ts` 只定義傳輸資料、裝置資訊與 MIDI I/O；`issues.ts` 提供語言無關的診斷。不依賴 Mikro 核心。
- `src/adapters/` 保留瀏覽器 API、原生物件及 HID descriptor 驗證；不依賴 Mikro 核心。
- `src/research/` 的擷取、分析與 Testing UI 直接訂閱 Runtime。控制項、指引、硬體圖及初始選取由裝置的 `research.ts` 注入，不直接引用 Mikro 或 Mapping UI。
- `src/shared/notes/` 保留 Note 換算、輸入與獨立顯示偏好；`src/shared/` 保留頁籤與對話框；`src/i18n/` 只更新文字與摘要，不重建表單或 Runtime。
- `packages/mikro-core/` 繼續擁有協定、Profile 與映射演算法，保留既有 exports；網頁裝置目錄不複製核心實作。

### 編輯與套用

UI 的 editorModeId 與 Runtime 演奏模式分離。瀏覽 Mode 只更新編輯畫面；Mapping 草稿／預覽不寫實體裝置。Binding 按套用後才更新 Runtime，接著保存 Profile；儲存失敗時保留已套用的執行狀態與未儲存提示。Mode 指派、力度曲線與共用燈光沿用原本立即生效／儲存順序。

歷史還原先完成儲存，成功才移動歷史游標與更新 Runtime；純回饋／力度變更不釋放正在發聲的音符。切換語言、Note 偏好或分頁不重建表單、不套用設定。

### 樣式擁有者

`src/styles/index.css` 明確載入基礎、應用外框、Mikro 硬體圖、Mapping、Research。通用外框與元件樣式按功能集中；硬體尺寸、燈光與控制項外觀留在裝置目錄。已刪除被同條件、同選擇器後續規則覆蓋的宣告；不同斷點的規則仍保留條件與相對順序。

## 目前 Runtime 介面

以下為目前 Mikro Runtime 的介面與生命週期，不是所有未來裝置已共同支援的 API。基本 I/O 契約定義在 `src/runtime/contracts.ts`；Runtime snapshot 與事件定義在裝置的 `runtime.ts`。原始報告使用 `{ reportId, data: Uint8Array }`，payload 不含 ID；裝置資訊只包含序列化欄位。MIDI 狀態包含可選埠與目前埠，不暴露瀏覽器物件。

Runtime 提供 connect／disconnect、enableMidi／selectOutput、applyProfile／switchMode、setVelocityCurve／updateFeedback、setLedEnabled／panic。一般套用保留引擎的 held-control 抑制規則；載入另一份 Profile 時以 restart 重建引擎。力度與共用回饋更新不釋放正在發聲的音符。

`subscribe` 回傳取消訂閱函式；事件包括 state、raw、decoded、mode、midi、diagnostic、error、disconnected。每個訂閱者取得獨立副本，訂閱者拋錯不打斷轉譯；`snapshot` 同樣是獨立副本。MappingEngine 管理按住模式選擇鍵與 Pad／一般按鍵切換的抑制狀態，選模式及跨模式按住的按鍵須放開才恢復新映射；Runtime snapshot 的 selectingMode 供 UI 顯示，Driver 依 Profile 的模式觸發控制項編碼 Pad 色盤及單色按鍵燈號。

MIDI 寫出事件表示送出呼叫完成，不能證明 DAW 已收到。錯誤事件與 LED 狀態另外提供語言無關的 code／params／detail，由網頁翻譯；Runtime 不引用語系字典。

關閉先停止 LED producer、取消舊佇列、清音，再依接管狀態送最後全暗報告並關閉；重疊 disconnect 共用 Promise。pagehide 只做 best effort，瀏覽器不保證等待完成。輸出埠已消失時無法保證 Note Off 到達接收端。

## 後續邊界

Mikro 的控制項操作與設定細節分別見[裝置操作指南](devices/mikro-mk3/user-guide.md)與[Profile](devices/mikro-mk3/profile.md)。第二種裝置與盒子平台的調整順序、共用行為及部署方向統一記在[目標與路線圖](roadmap.md)；目前實作範圍見[支援表](support.md)。
