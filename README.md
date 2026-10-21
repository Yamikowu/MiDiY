# Mikro Protocol Analyzer (MPA)

Maschine Mikro MK3 的 WebHID 協定分析工具與可設定 MIDI 翻譯器。協定直接移植自
[r00tman 的 Rust 開源驅動](https://github.com/r00tman/maschine-mikro-mk3-driver)，
參照版本固定為 `30f9b6013f3559dc1774d3ddb82affabd376692a`。
參考專案不需執行，也不會被修改。MIT 歸屬與完整條款見
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 啟動與建置

使用 Node.js 22.12+ 或 24，安裝後以支援 WebHID／Web MIDI 的桌面 Chromium 瀏覽器開啟
`http://127.0.0.1:4173`。請固定使用同一個 origin；localhost 與 127.0.0.1 的授權和儲存資料分開。

```sh
npm install
npm start
```

`npm start` 先編譯核心套件，再啟動 Vite。`npm test` 執行協定、映射、Adapter 與原始分析測試；
`npm run build` 產生核心 ESM／型別、執行型別檢查，並將網站輸出到 `dist/`。
`npm run preview` 可預覽正式版本。一般遠端 HTTP 不提供 WebHID 所需的安全環境。

## 工作區

- **Mapping**（`/#mapping`）：以控制器參照圖選取並編輯 MIDI 與 Pad／按鍵／Strip LED。頂部集中管理設定檔及 MIDI 輸出；右側編輯目前選取的控制項，圖上顯示已映射狀態、Channel／Note 與燈光預覽。
- **Testing**（`/#testing`）：控制器參照圖、逐項擷取、即時解碼、原始封包、Session 與候選 CSV 匯出。

兩頁各自保留選取狀態；在 Mapping 頁按下實體一般按鍵、轉動 Encoder 或觸碰 Strip，會直接選取對應控制項，以白色外框標示並顯示其設定。切換頁面不會重新連線、丟失表單草稿或中止擷取。已啟用的 MIDI 與燈光控制會持續運作。
Testing 的 Session 與 Mapping 的設定檔仍使用各自的格式和匯入／匯出按鈕。

## MIDI 演奏與設定

1. 連接 Mikro MK3（VID `0x17CC`、PID `0x1700`）；首次授權後會重用已授權的裝置。
2. 點「授權 MIDI」，在 MIDI 輸出選擇實際的接收埠；選「停用 MIDI 輸出」可只看解碼預覽。
3. 預設 Pad 1–16 分別送 Note 36–51、Channel 1，力度使用 Rust 的原值換算。其餘控制項預設停用。
4. 在 Mapping 點控制器參照圖，選 Note、CC、Program Change、切換模式或停用，按「套用至目前模式」；此時更新目前模式的控制項，並自動儲存整份設定檔。
5. 頂部兩列分別選擇設定檔與模式。按「編輯」後，下拉選單變成名稱輸入欄，按鈕改為「儲存／刪除」；按「複製」會建立獨立副本並進入命名狀態。按 Escape 可放棄尚未儲存的名稱。
6. 模式列的「設為啟動模式」決定下次載入此設定檔時選用的模式。匯出下載可攜的 JSON；匯入後會儲存為本機的新設定檔。
7. 「裝置燈光」旁的「Pad 力度曲線」提供 Soft 3／2／1、Linear、Hard 1／2／3；切換後立即套用並儲存至整份 Profile，包含 JSON 匯入／匯出。舊設定檔預設 Linear。只調整使用 Pad 力度的 Hit Note On，Press 不受影響。這些是軟體曲線，未校準為 NI 原廠曲線。
8. Pad Hit 的 Note 可設定輸出最小值／最大值（0–127，預設 0／127），先套用曲線再換算至此範圍；最小值不可大於最大值，相同值代表固定力度。有效 Note On 至少為 1，避免力度 0 被當成 Note Off。舊 Pad 固定力度保留，編輯時顯示為相同的最小值／最大值。一般按鍵與 Strip Touch 的 Note 不顯示力度欄位，載入及輸出統一使用 127。Note 摘要一律顯示 Gate／Toggle。

Pad 色彩與亮度選取後會立即在參照圖預覽；這只改網頁外觀，不會寫入裝置或儲存。控制項表單的變更只有按「套用至目前模式」後才保存；已接管燈光時，也會更新裝置。切換控制項前會提示未套用的表單。匯出會驗證並套用目前控制項尚未套用的表單。
舊版瀏覽器中單份 `mpa-profile-v1` 設定會自動讀入；命名清單使用獨立的
`mpa-profile-library-v1` 儲存，不會寫入可攜 JSON，也不會修改原始 Session。

16 個 Pad 的 Hit 可選 Note、CC、Poly Pressure、Channel Pressure、Program Change 或 Pitchbend。Note 有 Gate／Toggle；
其餘五種提供 Gate／Toggle／Trigger／Inc。Pad Hit 沒有 Action on，Press 的壓力映射獨立設定。
一般實體按鍵與 Encoder push/touch 沒有 Hit／Press 分頁；Toggle／Trigger／Inc 可選按下或放開時送出，
Inc 可設定範圍、Step、Wrap。Start／Stop／Continue、Song Position 與 MCU Button 暫不提供於一般按鍵選單。
Encoder 旋轉可將原始差值轉成 CC 增減，
計數回繞範圍預設 0（不推測）。Strip 位置原值 1–200 可映射到 CC、Poly Pressure、Channel Pressure、
Program Change 或 Pitchbend；0 代表放開。Touch 由 0 與非零位置的轉換產生，可獨立設定 Note、CC、
Pressure、Program Change、Pitchbend、Start／Stop／Continue 或 Song Position。這些 MIDI 輸出仍需實機接收端驗證。
Strip Position 的 CC 可選 Absolute（自訂 From／To 範圍）、Relative（每步送 1／127）或 Relative (Offset)（每步送 65／63）。
相對模式可調 Step 與 Resolution（全長預計步數，越大越靈敏）；滑動開始的第一個位置只建立基線，放開後重新建立。
Pad 的 Hit（敲擊）與 Press（持續施壓）可分別設定。Press 可選停用、Note（含觸發／放開門檻）、
CC、Poly Pressure、Channel Pressure 或 Pitchbend；12-bit 原始壓力映射到設定的輸出範圍。
舊設定檔沒有 Press 欄位時保持停用。壓力值仍會解碼及錄製；即時事件預設隱藏連續值，可勾選顯示。
目前按壓輸出依軟體映射，壓力門檻與力度曲線尚待實機校準，亦未宣稱與 NI Controller Editor 完全一致。

切換模式、套用設定、切換 MIDI 埠與 HID 斷線都會釋放相關音符／按住的 CC。
「Panic」可主動釋放目前狀態。實體 MIDI 埠突然消失時，最後的 Note Off 可能無法送達；
接收端若仍有聲音，使用接收 App 的 Panic。重新整理分頁也會嘗試釋放音符。

### Logic Pro 與 Mac 版 Koala

Logic 若列出 `Logic Pro Virtual In`，直接選它；否則在「音訊 MIDI 設定 → MIDI 錄音室 →
IAC 驅動程式」啟用裝置及 bus，再從網頁選該 bus，Logic 接收同一來源。
使用者已在本次實測確認 Pad 經網頁送到 Logic 有聲音。
[Apple 虛擬 MIDI 說明](https://support.apple.com/guide/logicpro/virtual-midi-devices-overview-logic-pro-mac-lgcpa24ebb64/12.3/mac/15.6)、
[IAC 設定說明](https://support.apple.com/en-ca/guide/audio-midi-setup/ams1013/mac)。

Koala 可接收同一 IAC bus；將 MIDI Channel 設為 1 或 ALL，MIDI Note Offset 設為數字 36，
讓 Pad 1 對應第一顆取樣 Pad。若啟用 MIDI mapping，改用 Koala 的 MIDI Learn 建立對應。
Koala Pad 需用 Note；其他控制項可依 App 支援映射 CC。
[Koala MIDI 設定](https://manual.koalasampler.com/mobile/8-settings/)。
本次已透過 IAC 實測收到 Note 36 與 CC119（按下 127、放開 0），見[實測紀錄](docs/verification/README.md)。
MPA 不會建立虛擬 MIDI 埠，也不會自動改動 App 的 MIDI map。

## Pad、按鍵與 Strip LED

首次連線不發送任何輸出。在 Mapping 參照圖下展開「裝置燈光」，勾「接管 LED 輸出」後才送 `0x80`、80-byte 完整燈光狀態。
每個模式可設定 16 顆 Pad 的 Single／Dual 色盤與個別待機亮度；「裝置燈光」統一設定 16 顆 Pad 的按下亮度，以及有映射的一般按鍵共用的待機／按下亮度。未映射的一般按鍵保持熄滅，預覽只讓按鍵文字發光。Strip 可設定 Dot（單點）、Bar（由左累積）或 Pan（中央往觸碰位置延伸）、色盤與亮度。Strip 原值 1–200 對應左到右，0 為離開並熄燈。
關閉「接管 LED 輸出」會送出全零燈光狀態並停用接管。

Pad 與 Strip 可使用 Off + 17 種列舉色，非任意 RGB；按鍵使用亮度值。Strip 預設為 White；舊設定檔若未指定 Strip 顏色，也會以 White 色盤編碼輸出。燈光跟隨本機操作（Controller Editor 的 For MIDI Out 行為）；外部 MIDI In 回饋尚未接入。
程式無法讀回或還原之前其他軟體設定的燈光。主動中斷接管中的連線會送全關；拔線或重新整理可能留下
裝置最後的燈光狀態。螢幕與組合鍵未實作；螢幕 `0xE0` 格式只記錄在協定文件與測試樣本。

## 原始擷取與相容性

逐項擷取、baseline、變動位元組分析、JSON 匯入／匯出及候選 CSV 均保留。
`mpa-session-v1` 的 payload 仍不含 report ID，偏移從 0 開始。原始報告上限 100,000；
達到上限會停止新增錄製資料，MIDI 轉譯繼續。顯示最多 100 筆；清除顯示不會刪除工作階段。
擷取資料不會自動儲存，重新整理前請先匯出。

MIDI 設定使用獨立 `mpa-profile-v1`，模式／控制項 ID／MIDI bytes／Pad 色盤可攜；
MIDI 埠 ID、瀏覽器物件不寫入設定檔。原始工作階段與 MIDI 設定用不同的匯入按鈕。

## 核心重用與硬體移植

`packages/mikro-core` 是獨立、無 DOM／navigator 依賴的 TypeScript 套件，提供解碼器、映射引擎、
設定檔驗證與 LED 編碼。其他網頁可引用此套件；未來硬體以同一設定格式與 golden vectors 移植規則，
USB Host、供電與無線 MIDI 封包另由硬體 Adapter 實作。TypeScript 並不保證可直接執行於微控制器。
詳見[核心 API](packages/mikro-core/README.md)、[協定文件](docs/protocol.md)、
[跨語言樣本](test/fixtures/mikro-vectors.json)。

## 驗證範圍

已驗證：核心 ESM／型別與網站建置、協定／映射／Adapter 測試、舊 session 3188 筆報告與全 16 Pad 對照、
瀏覽器 WebHID 裝置開啟與 `0x80` 發送。2026-10-19 使用者確認只有最下排最左 Pad 1 亮紅燈，並確認
Pad 透過 Logic Pro Virtual In 有聲音。
Koala 經 IAC 收到 Channel 1 的 Note 36 與 CC119；接收端畫面顯示最後 CC 值為 0。

仍待逐項確認：Logic CC 實際接收、各 Pad 其餘顏色與亮度、Encoder 回繞及
Strip 新增動作的實際接收、實體斷線的接收端清音。自動測試不等同上述實機驗證。
