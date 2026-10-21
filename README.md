# MiDiY

MiDiY 研究與逆向工程控制器，透過自訂映射輸出 MIDI，並公開協定、證據與實作。目前已實作 Maschine Mikro MK3 的網頁直接使用，可即時輸出 Web MIDI，也能擷取與分析 WebHID 原始輸入。MiDiY 有兩個工作區：**Mapping** 設定 MIDI 與燈光，**Testing** 檢查原始輸入。

網頁與翻譯盒是並行方向；ESP32／樹莓派翻譯盒、BLE MIDI 與其他控制器目前尚未實作，硬體尚待選型。

## 快速開始

需要 Node.js 22.12+ 或 24，以及支援 WebHID／Web MIDI 的桌面 Chromium 瀏覽器。

```sh
npm install
npm start
```

開啟 `http://127.0.0.1:4173`，連接 Mikro MK3。請固定使用這個網址；`localhost` 與 `127.0.0.1` 的裝置授權和瀏覽器設定分開。

介面支援繁中／英文，可在裝置名稱右側切換；手動選擇會記住在此瀏覽器。

## 怎麼使用

1. 在 **Mapping** 點「授權 MIDI」，選擇要接收 MIDI 的輸出埠。
2. 點控制器參照圖上的 Pad 或按鍵，設定動作，再按「套用至目前模式」。
3. 依[Mikro 操作指南](docs/devices/mikro-mk3/user-guide.md)設定力度與燈光。
4. 到 **Testing** 查看即時輸入、逐項擷取，或匯出 Session 和候選 CSV。

設定檔與擷取 Session 分開匯入／匯出。設定細節、Logic Pro／Koala 連接方式與資料格式請看下方文件。

## 文件

- [網頁操作指南](docs/user-guide.md)：連線、Mapping、Testing 與設定檔管理。
- [支援範圍](docs/support.md)：控制器輸入、平台、MIDI 輸出與接收端。
- [架構](docs/architecture.md)、[開發與 HID 擷取格式](docs/development.md)。
- [目標與路線圖](docs/roadmap.md)：網頁、翻譯盒與後續調整順序。
- [Mikro MK3](docs/devices/mikro-mk3/README.md)（操作、Profile 與驗證摘要）、[協定](docs/devices/mikro-mk3/protocol.md)、[核心 API](packages/mikro-core/README.md)。
- [驗證紀錄](docs/verification/README.md)、[第三方授權](THIRD_PARTY_NOTICES.md)。

`npm test` 執行自動測試；`npm run build` 檢查型別並產生 `dist/`。已記錄的驗證範圍與待確認項目見[支援範圍](docs/support.md)。
