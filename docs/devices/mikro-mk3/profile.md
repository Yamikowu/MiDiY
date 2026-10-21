# Mikro MK3 Profile 與本機清單

目前 `midiy-profile-v1` 仍是 Mikro MK3 專屬契約。權威型別與驗證器為 `packages/mikro-core/src/profile.ts`；本輪未變更 schema。

Profile 包含 name、initialModeId、modes、可選 padVelocityCurve。模式使用穩定控制項 ID，含 bindings、16 顆 Pad 燈光、可選 pressureBindings 與共用按鍵／Strip 回饋。Channel 為 1–16，數值範圍依各 binding 驗證；不含瀏覽器埠 ID 或原生裝置物件。匯入一律經 parseProfile，取得獨立副本。

`mpa-profile-v1` 繼續可讀，載入後正規化為 MiDiY schema。缺省的壓力映射維持關閉；缺省力度曲線維持 linear。完整 API 見[套件說明](../../../packages/mikro-core/README.md)。

本機清單使用 `midiy-profile-library-v1`，目前設定使用 `midiy-profile-v1`；舊 `mpa-profile-library-v1`／`mpa-profile-v1` 仍讀取，下次儲存寫新鍵，不刪舊鍵。清單 metadata 與可攜 Profile JSON 分開，實作位於 `src/mapping/profile-library.ts`。

草稿不寫入執行設定；套用才儲存並更新 Runtime。既有共用亮度與力度選單維持立即儲存。新版多裝置 Profile 與盒子路由契約屬未來規劃。

本頁描述目前 Mikro 的設定與網頁儲存實作；不是其他裝置的共用 Profile 規格。共用編輯流程見[網頁操作指南](../../user-guide.md#設定檔與模式)，套件型別與驗證器以現有實作為準。
