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

- **Mapping**（`/#mapping`）：以控制器參照圖編輯 MIDI 與 Pad LED。頂部集中管理設定檔及 MIDI 輸出；右側編輯目前選取的控制項，圖上顯示已映射狀態、Note／Channel 與待機燈色。
- **Testing**（`/#testing`）：控制器參照圖、逐項擷取、即時解碼、原始封包、Session 與候選 CSV 匯出。

兩頁各自保留選取狀態；切換頁面不會重新連線、丟失表單草稿或中止擷取。已啟用的 MIDI 與燈光控制會持續運作。
Testing 的 Session 與 Mapping 的設定檔仍使用各自的格式和匯入／匯出按鈕。

## MIDI 演奏與設定

1. 連接 Mikro MK3（VID `0x17CC`、PID `0x1700`）；首次授權後會重用已授權的裝置。
2. 點「授權 MIDI」，在 MIDI 輸出選擇實際的接收埠；選「停用 MIDI 輸出」可只看解碼預覽。
3. 預設 Pad 1–16 分別送 Note 36–51、Channel 1，力度使用 Rust 的原值換算。其餘控制項預設停用。
4. 在 Mapping 點控制器參照圖，選 Note、CC、Program Change、切換模式或停用，按「套用至設定檔」。
5. 填寫頂部設定檔名稱，按「儲存設定檔」更新目前項目，或「另存新檔」保留獨立版本。清單可切換已儲存的設定檔；有未儲存的變更時會先提示。
6. 展開圖下方「模式管理」可複製／重新命名模式、指定啟動模式。匯出下載可攜的 JSON；匯入後按儲存可加入本機清單。

儲存與匯出會驗證並套用目前控制項尚未套用的表單。圖上預覽只有套用後才更新。
舊版瀏覽器中單份 `mpa-profile-v1` 設定會自動讀入；命名清單使用獨立的
`mpa-profile-library-v1` 儲存，不會寫入可攜 JSON，也不會修改原始 Session。

Pad、實體按鍵和 Encoder push/touch 可設定離散動作。Encoder 可將原始差值轉成 CC 增減；
計數回繞範圍預設 0（不推測），可依實機觀察設定。Strip 可將可調原值範圍映射到 CC 0–127；
預設 1–200，原值 0 依 Rust 行為不送 CC。此範圍仍需依實機端點校準，不代表已定義觸碰手勢。
Aftertouch 會解碼及錄製，首版不轉送成 MIDI；即時事件預設隱藏壓力連續值以方便閱讀，可勾選顯示。

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

## Pad LED

首次連線不發送任何輸出。在 Mapping 參照圖下展開「裝置燈光」，勾「接管 LED 輸出」後才送 `0x80`、80-byte 完整燈光狀態。
每個模式可設定 16 顆 Pad 的色盤與待機亮度，按下時提高亮度。
「測試選取 Pad」只點亮選取 Pad；「套用模式燈光」回到模式配置；「關閉全部燈光」送全零並停用接管。

硬體使用 Off + 17 種列舉色，非任意 RGB。完整報告也包含按鍵／Strip 燈；首版將這些槽位清零。
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
Strip 兩端校準、實體斷線的接收端清音。自動測試不等同上述實機驗證。
