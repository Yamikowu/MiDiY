# Mikro MK3 Profile 與本機清單

目前使用 `midiy-profile-v2`，仍是 Mikro MK3 專屬契約。權威型別與驗證器為 `packages/mikro-core/src/profile.ts`。

Profile 包含 name、initialModeId、modes、必填 padVelocityCurve（新建預設 linear）。模式使用穩定控制項 ID，含 bindings、16 顆 Pad 燈光、可選 pressureBindings 與 Strip 回饋。Channel 為 1–16，數值範圍依各 binding 驗證；不含瀏覽器埠 ID 或原生裝置物件。匯入一律經 parseProfile，取得獨立副本。Pad Hit 不接受 actionOn；一般按鍵 Note 輸出固定為 127。

本機只使用 `midiy-profile-library-v2` 保存多份設定與目前選取項目，不另寫單份設定鏡像。舊 `mpa-*` 與 v1 Profile／清單不再讀取或轉換；原有儲存資料不刪除。沒有 v2 清單時使用預設設定，清單損壞時顯示警告並使用預設設定。清單 metadata 與可攜 Profile JSON 分開，實作位於 `src/mapping/profile-library.ts`。完整 API 見[套件說明](../../../packages/mikro-core/README.md)。

草稿不寫入執行設定；套用才儲存並更新 Runtime。共用亮度與力度選單維持立即儲存。新版多裝置 Profile 與盒子路由契約屬未來規劃。

本頁描述目前 Mikro 的設定與網頁儲存實作；不是其他裝置的共用 Profile 規格。共用編輯流程見[網頁操作指南](../../user-guide.md#設定檔與模式)。

模式必填 `buttonLight: { off, on }`，作為 Gate／Trigger／Inc 的待機／按住亮度；`toggleButtonLight: { off, on }` 作為 Toggle 關閉／開啟亮度。兩組獨立，值皆為 `off`、`dim`、`normal`、`bright`，新建預設為關閉／中亮度。

FIXED VEL 可選用 `bindings.FIXED_VEL = { type: "fixed-velocity", velocity: 100 }`，力度為整數 1–127；此動作可映射至一般按鍵，每個模式最多一個；新建模式預設配置在 `FIXED_VEL`，值為 127。它是本機 Toggle 功能，不含 MIDI Channel，初始關閉；僅數值與動作會儲存，啟用狀態不會。

模式必填 `padOffBrightness` 與 `padOnBrightness`，控制 16 顆 Pad 共用待機／按下亮度，新建預設為微亮／最亮。各 Pad 保留 Single／Dual 色彩；PadLight 的 brightness 仍用於公開核心編碼介面，網頁 Driver 一律採用共用亮度。共用設定只更新回饋，不清除 MIDI 音符。

`stripLight` 可選 `hold: boolean`，缺省或 `false` 為放手熄燈，`true` 為保留最後碰觸位置的回饋。只保存開關，不保存當下位置。位置由 Runtime 維護，Driver 依目前模式編碼燈光，MIDI 原始事件不因保留燈光而改寫。

## 模式選擇

Profile 必填 `modeSelector`，預設 GROUP。可更換為一般按鍵；SHIFT、FAVORITES、BROWSER 保留快捷鍵用途，Encoder Touch 不作選擇鍵。選擇鍵在所有模式共用且不能同時配置 MIDI 映射；UI 更換前會確認是否移除該鍵已有的映射。

每個模式必填 `selectorPad: PadId | null` 與 `color: 0..17`，可選 `selectorButton: ButtonId`。指派按鍵時 `selectorPad` 必須為 null；按鍵須為前 39 個有燈號的實體按鍵，排除 SHIFT／FAVORITES／BROWSER 及 Profile 的 `modeSelector`。每個 Pad 或按鍵最多對應一個模式。Pad 與按鍵指派互斥，不影響該控制項在未按模式選擇鍵時的普通 MIDI 映射。Profile 繼續使用 `midiy-profile-v2`；未填 selectorButton 的 v2 Profile 保留原本 Pad 行為，不新增其他舊格式讀取或遷移。內建 Mikro MIDI 包含 A–H，分別對應 Pad 13–16、9–12；「＋」新增的空白 Profile 只有一個未指派 Mode。複製模式會清除 selectorPad／selectorButton，待使用者指定。

MappingEngine 處理按住選擇與觸發 Pad／按鍵的事件抑制；切換模式沿用既有 flush，選擇時敲下的 Pad／按鍵放開前不產生原本 MIDI，跨模式按住的按鍵也必須先放開再使用新映射。Runtime 將 selectingMode 狀態提供給 UI 與 Driver；Driver 編碼選擇畫面，未指派 Pad／一般按鍵關閉，目前模式高亮（bright），其餘已指派模式微亮（dim）；按鍵使用單色，Pad 使用模式顏色。實體輸出仍須先啟用 LED 接管。
