# 2026-10-19 驗證紀錄

## 程式與封包

- 26 項測試通過：Rust 協定規則、全 16 Pad、按鍵、Encoder／Strip、短封包與未知事件、映射與釋放、設定檔、LED、Adapter、原有分析功能及本機設定檔清單。
- 舊 `mpa-session-v1` 的 3188 筆原始報告可讀取，既有候選分析測試通過。
- 核心 ESM／型別宣告、網站型別檢查與 Vite 正式建置通過。
- 套件打包清單包含 ESM、型別宣告、README 與 MIT LICENSE。
- 瀏覽器儲存及設定匯出／匯入已確認；設定解析／往返有自動測試。

## Testing／Mapping 工作區改版

以下在實際瀏覽器頁面操作確認：

- 兩頁各自顯示參照圖及編輯內容；Testing 選取 Shift 不會改動 Mapping 的 Pad 選取。
- Mapping 修改 Pad 2 為 Note 60 後，切換 Testing 再返回，表單草稿仍在。
- 將草稿另存為 Studio，圖上更新 Note 60；重新整理後仍可載入。原 Mikro MIDI 的 Pad 2 仍為 Note 37。
- 設定匯出為 `mpa-profile.json`，再選取同一檔案匯入，顯示正確名稱與尚未儲存狀態。
- 切換設定檔前取消提示，名稱草稿保留；選擇捨棄後，載入原設定檔。單鍵草稿的取消／捨棄亦確認。
- Testing 匯入舊 Session，顯示 3,188 reports、72 captures、58/58 coverage，以及 Pad 1 的候選分析。
- 390px 窄視窗下，頁面沒有水平溢出；參照圖可獨立水平捲動，編輯器排在下方。

![Mapping 工作區](mapping-workspace.png)

![Testing 匯入舊 Session](testing-workspace.png)

此次介面改版未重新執行實體 DAW／LED 測試；下節為先前已完成的實機紀錄。

## 裝置與 App

| 項目 | 實測結果 | 證據範圍 |
| --- | --- | --- |
| WebHID 連線與 LED | 通過 | 使用者確認僅 Pad 1（最下排最左）亮紅燈；報告 ID `0x80`，payload 80 bytes |
| Logic Pro Note | 通過 | 選用 Logic Pro Virtual In；使用者確認敲 Pad 有聲音 |
| Koala Note／CC | 通過 | 網頁選 IAC bus；實體 Pad 1 及 Shift 操作後，Koala 顯示 Note 36、CC119 值 0，Channel 1 |
| Logic Pro CC | 待確認 | 網頁送出不代表接收端已確認 |
| Encoder／Strip 校準 | 待確認 | 回繞範圍與 Strip 有效端點可設定，目前未宣稱已校準 |
| 實體斷線清音 | 待確認 | 已測試程式釋放邏輯；埠失效時無法保證最後的 Note Off 能送達 |

Koala 測試時，Shift 暫設 CC119（按下 127、放開 0），以免更動現有 CC1／CC4 映射。
網頁事件記錄包含 `90 24 40`、`80 24 00`、`b0 77 7f`、`b0 77 00`。
測試後 Shift 已恢復停用並儲存；預設仍只有 Pad 1–16 的 Note 36–51 映射。

![Koala 實際接收到 Note 36 與 CC119 值 0](koala-midi.png)

其他 Pad 色彩／亮度、完整 DAW 映射流程尚未逐項實測。螢幕與組合鍵依計畫留待下一階段。
