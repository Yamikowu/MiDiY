# Mikro MK3 操作指南

本頁只適用於 Maschine Mikro MK3 的目前網頁實作。共用的頁面、草稿、設定檔管理與擷取流程見[網頁操作指南](../../user-guide.md)。

## 連接與預設映射

Mikro MK3 使用 USB HID，VID `0x17CC`、PID `0x1700`。在網頁按「連接裝置」授權 WebHID，之後重用已授權的裝置；一般連線不自動接管燈光。

預設 Pad 1–16 分別送 Note 36–51、Channel 1，力度由原始值換算；其餘控制項預設停用。按下實體一般按鍵、轉動 Encoder 或觸碰 Strip，也會選取 Mapping 對應控制項。

## Pad、按鍵與 Strip

- 16 個 Pad 的 **Hit** 可選 Note、CC、Poly Pressure、Channel Pressure、Program Change 或 Pitchbend。Note 支援 Gate／Toggle；其餘五種支援 Gate／Toggle／Trigger／Inc。Hit 沒有 Action on。
- **Press** 獨立於 Hit，可選停用、Note（含觸發／放開門檻）、CC、Poly Pressure、Channel Pressure 或 Pitchbend。12-bit 原始壓力會映射到設定範圍。舊設定檔沒有 Press 欄位時保持停用。壓力會解碼和錄製；即時事件預設隱藏連續值，可手動顯示。壓力門檻與曲線尚待實機校準，未宣稱與 NI Controller Editor 一致。
- 一般按鍵與 Encoder push/touch 沒有 Hit／Press 分頁。Toggle／Trigger／Inc 可設定按下或放開時送出；Inc 可設定範圍、Step、Wrap。Start／Stop／Continue、Song Position、MCU Button 尚未放進一般按鍵選單。
- Encoder 旋轉可把原始差值轉成 CC 增減；計數回繞範圍預設為 0，代表不推測回繞值。
- Strip Position 的原值為 1–200，0 代表放開；可映射 CC、Poly Pressure、Channel Pressure、Program Change 或 Pitchbend。Touch 由位置在 0 與非零之間的轉換產生，可獨立設定 Note、CC、Pressure、Program Change、Pitchbend、Start／Stop／Continue 或 Song Position。
- Strip Position 的 CC 可選 Absolute（自訂 From／To）、Relative（每步送 1／127）、Relative (Offset)（每步送 65／63）。相對模式可調 Step 與 Resolution；滑動開始的第一個位置只建立基線，放開後重新建立。

## Pad 力度

「Pad 力度曲線」提供 Soft 3／2／1、Linear、Hard 1／2／3，切換後立即套用並儲存到 Profile。舊設定檔預設 Linear。曲線只調整使用 Pad 力度的 Hit Note On，Press 不受影響；它們是軟體曲線，尚未校準成 NI 原廠曲線。

Pad Hit 的 Note 可設定輸出最小值／最大值（0–127，預設 0／127）。先套用曲線再換算到此範圍；最小值不得大於最大值，相同值代表固定力度。有效 Note On 至少為 1，避免力度 0 被當成 Note Off。舊 Pad 固定力度設定仍可讀取。一般按鍵與 Strip Touch 的 Note 固定使用力度 127；Note 摘要顯示 Gate／Toggle。

## 裝置燈光

Pad 色彩與亮度修改會立即在網頁預覽；預覽不儲存，也不寫入裝置。按「套用至目前模式」後才保存。共用按鍵／Pad 按下亮度選單維持變更後立即儲存。

首次連線不發送燈光輸出。展開 Mapping 的「裝置燈光」，勾「接管 LED 輸出」後才發送 `0x80`、80-byte 的完整燈光狀態；關閉接管會送出全零狀態。

每個模式可設定 16 顆 Pad 的 Single／Dual 色盤、各 Pad 待機亮度、共用按下亮度，以及有映射的一般按鍵共用的待機／按下亮度。未映射的一般按鍵保持熄滅，網頁預覽只讓按鍵文字發光。Strip 可選 Dot、Bar、Pan、色盤與亮度；原值 1–200 對應左到右，0 代表離開並熄燈。

Pad 與 Strip 可選 Off 加 17 種列舉色，不支援任意 RGB；按鍵使用亮度值。Strip 預設 White。燈光跟隨本機操作，尚未接入外部 MIDI In 回饋。程式無法讀回或還原其他軟體先前設定的燈光。主動中斷時會嘗試送全關；拔線或重新整理仍可能留下裝置最後的狀態。螢幕與組合鍵尚未實作。

## 設定檔格式

目前設定格式仍是 Mikro 專用，欄位、本機清單與舊版相容性見[Profile 說明](profile.md)。

## MIDI 接收端範例

以下是 Mikro 的既有接收設定與歷史實測脈絡，並非其他控制器的預設映射。音符釋放與 Panic 的共用行為見[網頁操作指南](../../user-guide.md#音符釋放)。

## Logic Pro

若 MIDI 輸出列出 `Logic Pro Virtual In`，可直接選用。否則到「音訊 MIDI 設定 → MIDI 錄音室 → IAC 驅動程式」啟用裝置與 bus，再從 MiDiY 選該 bus。Pad 經網頁送到 Logic 有聲音的實測紀錄見[歷史實測紀錄](../../verification/2026-10-19.md)。參考 [Apple 虛擬 MIDI 說明](https://support.apple.com/guide/logicpro/virtual-midi-devices-overview-logic-pro-mac-lgcpa24ebb64/12.3/mac/15.6)與 [IAC 設定](https://support.apple.com/en-ca/guide/audio-midi-setup/ams1013/mac)。

## Mac 版 Koala

Koala 可接收同一 IAC bus。把 MIDI Channel 設為 1 或 ALL，MIDI Note Offset 設為 36，讓 Pad 1 對應第一顆取樣 Pad。若啟用 MIDI mapping，改用 Koala 的 MIDI Learn。Koala Pad 需用 Note；其他控制項可依 App 支援映射 CC。參考 [Koala MIDI 設定](https://manual.koalasampler.com/mobile/8-settings/)。透過 IAC 接收 Note 36 與 CC119 的實測紀錄見[歷史實測紀錄](../../verification/2026-10-19.md)。
