# Maschine Mikro MK3

目前透過桌面 Chromium WebHID 使用 USB HID。裝置 VID `0x17cc`、PID `0x1700`；定義與 Driver 在 `src/devices/mikro-mk3/`，可攜核心在 `packages/mikro-core/`。

已實作解碼 Pad、壓力、按鍵、Encoder、Strip，以及模式／映射、力度與 `0x80` LED 回饋。連線不自動寫 LED，需明確接管。螢幕輸出未實作，沒有因重構新增初始化封包。

- [協定與來源](protocol.md)
- [裝置操作指南](user-guide.md)：Pad／Press／Strip、力度、燈光與接收端範例。
- [Profile 格式與相容性](profile.md)。
- [網頁共用操作](../../user-guide.md)。
- [測試向量](../../../test/fixtures/mikro-vectors.json)

研究流程：保留完整 report、控制項動作標記、連線／裝置狀態與 quiet baseline，按 report ID 分析。原始證據以 Session 匯出；新增實驗時記錄日期、來源版本與重現步驟，未知欄位列為假說，不擴大已驗證範圍。

## 已驗證範圍

以下實機結果來自[2026-10-19 歷史紀錄](../../verification/2026-10-19.md)，本輪未重新做實機驗證。

| 項目 | 證據範圍 |
| --- | --- |
| WebHID 開啟與 LED | 使用者確認 Pad 1 紅燈；`0x80`／80 bytes，不代表所有燈色已測 |
| Logic Pro Note | 使用者確認 Virtual In 接收 Pad 有聲音 |
| Koala Note／CC | 使用者確認 Note 36／CC119 值 0、Channel 1 |
| Logic CC、Encoder／Strip 完整接收 | 待確認 |
| 全 Pad 色彩／亮度、實體斷線清音 | 未逐項完成驗證 |
| 螢幕輸出、盒子平台 | 未實作 |

本輪 Runtime／相容性程式測試及網頁檢查見[重構驗證](../../verification/2026-10-21.md)。套件測試向量可驗證程式規則，不是新的實機證據。歷史文件缺失的圖片有明確註記，不補造證據。
