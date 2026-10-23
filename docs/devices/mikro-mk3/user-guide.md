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

每個模式可設定 16 顆 Pad 的 Single／Dual 色盤、共用待機／按下亮度，以及有映射的一般按鍵兩組共用亮度：Gate／Trigger／Inc 的待機／按住、Toggle 的關閉／開啟。兩組亮度獨立設定並立即儲存於目前模式；舊設定未提供 Toggle 亮度時沿用原本的一般按鍵亮度。未映射的一般按鍵保持熄滅，網頁預覽只讓按鍵文字發光。Strip 可選 Dot、Bar、Pan、色盤與亮度；原值 1–200 對應左到右，0 代表離開，預設熄燈。

在 Smart Strip 的 STRIP LIGHT 勾選「放開後保留燈光」，再按「套用至目前模式」，放手後會保留最後碰觸位置的 Dot／Bar／Pan 燈光；下次碰觸跟隨新位置。此選項隨模式儲存，預設關閉，實體燈光仍須先接管 LED。它只影響燈光，不改 MIDI Touch 的放開或位置輸出。Panic、切換模式、重新套用設定、關閉 LED 接管或斷線會清除保留位置；最後位置不儲存在 Profile。

一般按鍵的 Gate／Trigger 按住使用 on 亮度，放開恢復 off 亮度；Trigger 的 Action on 只影響 MIDI 發送時機。Toggle 使用本機映射狀態：開啟使用 on、關閉使用 off，依 Action on 在按下或放開時切換。Note Toggle 跟隨音符持有狀態；CC／其他數值 Toggle 跟隨目前模式最後的 on／off 值，切換模式或清音仍沿用既有映射狀態規則。Pad 燈光維持原有按壓行為。

Pad 與 Strip 可選 Off 加 17 種列舉色，不支援任意 RGB；按鍵使用亮度值。Strip 預設 White。燈光跟隨本機操作，尚未接入外部 MIDI In 回饋。程式無法讀回或還原其他軟體先前設定的燈光。主動中斷時會嘗試送全關；拔線或重新整理仍可能留下裝置最後的狀態。螢幕與組合鍵尚未實作。

## 設定檔格式

目前設定格式仍是 Mikro 專用，欄位、本機清單與舊版相容性見[Profile 說明](profile.md)。

## MIDI 接收端範例

以下是 Mikro 的既有接收設定與歷史實測脈絡，並非其他控制器的預設映射。音符釋放與 Panic 的共用行為見[網頁操作指南](../../user-guide.md#音符釋放)。

## Logic Pro

若 MIDI 輸出列出 `Logic Pro Virtual In`，可直接選用。否則到「音訊 MIDI 設定 → MIDI 錄音室 → IAC 驅動程式」啟用裝置與 bus，再從 MiDiY 選該 bus。Pad 經網頁送到 Logic 有聲音的實測紀錄見[歷史實測紀錄](../../verification/2026-10-19.md)。參考 [Apple 虛擬 MIDI 說明](https://support.apple.com/guide/logicpro/virtual-midi-devices-overview-logic-pro-mac-lgcpa24ebb64/12.3/mac/15.6)與 [IAC 設定](https://support.apple.com/en-ca/guide/audio-midi-setup/ams1013/mac)。

## Mac 版 Koala

Koala 可接收同一 IAC bus。把 MIDI Channel 設為 1 或 ALL，MIDI Note Offset 設為 36，讓 Pad 1 對應第一顆取樣 Pad。若啟用 MIDI mapping，改用 Koala 的 MIDI Learn。Koala Pad 需用 Note；其他控制項可依 App 支援映射 CC。參考 [Koala MIDI 設定](https://manual.koalasampler.com/mobile/8-settings/)。透過 IAC 接收 Note 36 與 CC119 的實測紀錄見[歷史實測紀錄](../../verification/2026-10-19.md)。

### FIXED VEL 固定輸出力度

在參照圖選取 FIXED VEL，將輸出動作設為「固定輸出力度」，設定 1–127 後套用。按一下實體按鍵啟用，再按一下關閉；啟用時後續 Pad Hit 的 Note（Gate／Toggle）統一使用此值，覆蓋各 Pad 的力度範圍、固定值與力度曲線。關閉後恢復各 Pad 原本設定；不改動正在發聲的音符、Note Off、Press 壓力或非 Note 輸出。FIXED VEL 本身不發送 MIDI，LED 使用 Toggle 關閉／開啟亮度。草稿不會啟用固定力度；切換模式、套用設定、Panic、MIDI 輸出切換／遺失或斷線後會關閉，啟用狀態不儲存。原有設定檔與其他 FIXED VEL 映射保持原行為，需自行選取此新動作。

16 顆 Pad 的待機亮度統一在「裝置燈光」設定，變更後立即儲存；個別 Pad 僅保留 Single／Dual 色彩設定。舊 Profile 若有不同的個別亮度，選單顯示「沿用舊個別亮度」；選取共用亮度後即套用全部 Pad。

### 多選、批次編輯與歷史紀錄

點選控制項可單選；拖曳參照圖框選，Shift＋點選／框選可追加或取消選取。控制器上方顯示選取／映射狀態圖例，下方置中提供快捷鍵提示、撤回、重做、複製、貼上與選取數量。批次編輯僅顯示共同支援的欄位，不同值顯示「多個值」；只有修改過的欄位會套用，Note Number 等未修改值各自保留。Pad 可批次修改 Hit、Press 與色彩。草稿與色彩預覽不更新 Runtime。

複製使用已套用的控制項設定，保存在本頁記憶體；單一來源可貼到同類多個目標，多項來源則需目標數量相同，按固定控制項順序配對（Pad 1–16）。Pad 包含 Hit、Press、色彩，Strip 包含 Position、Touch 與燈光；共用亮度不複製。控制項類型、特殊動作或目標模式不相容時整批拒絕。貼上先成為草稿，按套用後才儲存並生效。

⌘／Ctrl＋C、V 複製／貼上；⌘／Ctrl＋Z 撤回；⌘／Ctrl＋Shift＋Z 或 Ctrl＋Y 重做。輸入框、選單、可編輯文字與對話框保留原本快捷鍵。一次批次套用／貼上是一個歷史步驟，最多 100 步；新修改清除重做分支，載入另一份 Profile 或重新載入頁面會清除歷史。單純選取、演奏與連線不進歷史。已套用映射的撤回／重做會依既有 Runtime 套用流程清音，僅亮度或力度曲線的歷史操作不釋放正在持有的音符。

「跟隨實體操作選取」位於參照圖下方工具列，預設關閉且不儲存啟用狀態。開啟後有效 Pad 打擊、按鍵、Encoder 或 Strip 操作會選取對應設定；多選時仍保留批次選取。關閉只停止自動切換設定面板，MIDI、按壓顯示與燈光回饋照常運作，滑鼠仍可選取。

### LED 接管實體快捷鍵

按住 SHIFT，再按 FAVORITES，即可切換 LED 接管；同一份 HID 報告同時按下兩鍵也支援。每次按下 FAVORITES 切換一次，持續按住不重複切換。組合鍵中的 FAVORITES 按下／放開不執行其 MIDI 映射，也不觸發設定面板自動選取；單獨 FAVORITES 與 SHIFT 本身的映射保留。先按住 FAVORITES 再按 SHIFT 不會觸發，需重新按 FAVORITES。此操作不需要 MIDI 輸出埠，也不依賴 Mapping 頁面或跟隨選取開關。仍遵守 Adapter 的 LED 報告支援檢查，關閉接管送全暗，斷線後不自動重新接管。

### 中斷裝置實體快捷鍵

按住 SHIFT，再按 BROWSER，會沿用中斷流程清音、停止 LED producer、在已接管時送最後全暗報告，最後關閉裝置。此組合鍵優先於同份報告中的其他映射與 LED 接管快捷鍵，不執行 BROWSER 的 MIDI 動作，也不切換設定面板；單獨 BROWSER 維持原映射。兩鍵同份報告按下亦支援，先按 BROWSER 再按 SHIFT 不觸發。中斷後不再接收實體按鍵，請用網頁「連接裝置」重新連接；重新連接仍預設不接管 LED。
