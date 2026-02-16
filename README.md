# 🏸 羽球 3D 軌跡分析與除錯系統（Badminton 3D Debugger MVP）

本專案是一個用於 **羽球比賽球軌跡視覺化與資料校正** 的工具，主要用途是：

-   檢視 AI 產生的 3D 球軌跡
-   校正擊球時間點 (Hit frame)
-   分析 rally 分段
-   標記與檢查異常軌跡 (anomaly)
-   作為運動分析與模型 debug 工具

本系統目前為研究與資料分析用途，並非正式產品。

------------------------------------------------------------------------

# 🚀 專案執行方式

## ① 啟動 Docker 系統

請先安裝：

-   Docker Desktop

進入專案根目錄後執行：

``` bash
docker compose up --build
```

第一次執行會較久，因為會：

-   建立 backend image
-   初始化 PostgreSQL 資料庫
-   安裝 Python 套件

成功後 backend 會在：

    http://localhost:8000

------------------------------------------------------------------------

## ② 匯入資料集（重要）

若沒有匯入資料：

-   timeline 不會顯示 rally/hit
-   3D trajectory 會是空的

請執行：

``` bash
docker compose exec backend python -m app.import_12_24_1_new
```

此步驟會匯入：

-   Rally segmentation
-   Hit annotations
-   球軌跡資料 (BallTraj)
-   異常標記

------------------------------------------------------------------------

## ③ 啟動前端（若非 Docker 前端）

``` bash
npm install
npm run dev
```

預設網址：

    http://localhost:5173

------------------------------------------------------------------------

# ✨ 專案功能說明

## 🕒 Timeline 時間軸

包含三種資料層：

### Rally

-   每段來回球區間
-   可顯示狀態：
    -   unchecked
    -   reviewing
    -   verified
    -   needs_fix

### Hit

-   每次擊球 frame
-   可拖曳調整
-   即時顯示 frame 編號
-   支援球種與球員標記

### Anomaly

-   標記軌跡異常：
    -   低信心點
    -   軌跡漂移
    -   缺失 frame
    -   出界偵測

------------------------------------------------------------------------

## 🧭 3D 球軌跡視覺化

使用 Three.js / react-three-fiber：

-   顯示羽球 3D trajectory
-   即時球位置標記
-   羽球場地 grid
-   網子參考平面

主要用途：

-   AI tracking debug
-   軌跡品質分析
-   比賽研究資料檢查

------------------------------------------------------------------------

## 📊 軌跡疊圖 (Overlay)

timeline 上方提供：

-   X(t) 曲線
-   Y(t) 曲線
-   支援 zoom / 拖曳 window
-   Lazy loading trajectory

------------------------------------------------------------------------

## ✏ Hit 編輯功能

可直接在 timeline：

-   拖曳擊球時間
-   自動對齊 frame
-   即時更新資料庫
-   修正 AI 預測錯誤

------------------------------------------------------------------------

## ⚠ 異常檢查功能

支援：

-   異常區段標記
-   快速跳轉異常 (Shift+N / Shift+P)
-   異常嚴重度分類

------------------------------------------------------------------------

# 🗂 專案結構

    badminton_3d_debugger_mvp/
    │
    ├─ app/                 ← FastAPI backend
    │  ├─ main.py
    │  ├─ models.py
    │  ├─ import_12_24_1_new.py
    │  ├─ datasets/
    │
    ├─ frontend/
    │  ├─ src/
    │  │  ├─ TimelinePanel.jsx
    │  │  ├─ Scene3D.jsx
    │  │  ├─ store.js
    │  │  └─ api.js
    │
    ├─ docker-compose.yml
    └─ README.md

------------------------------------------------------------------------

# 🧩 資料庫結構概念

## Matches

-   比賽基本資料
-   FPS
-   duration
-   camera 設定

## Rallies

-   rally 起訖 frame
-   狀態

## Hits

-   擊球 frame
-   球員
-   球種
-   confidence

## BallTraj

-   frame
-   x / y / z 座標
-   trajectory 信心值

## Anomaly

-   異常區間
-   嚴重度
-   類型

------------------------------------------------------------------------

# 🐞 常見問題

## Timeline 沒資料

通常未匯入 dataset：

``` bash
docker compose exec backend python -m app.import_12_24_1_new
```

------------------------------------------------------------------------

## Backend DB 連線失敗

可重新初始化：

``` bash
docker compose down -v
docker compose up --build
```

------------------------------------------------------------------------

## 3D 軌跡沒顯示

可能原因：

-   BallTraj 未匯入
-   API 未回傳資料
-   fps 設定錯誤

------------------------------------------------------------------------

# 📌 專案用途

本專案主要用於：

-   AI 羽球軌跡研究
-   運動分析資料標註
-   軌跡模型驗證
-   資料視覺化除錯

並非正式商用 viewer。

------------------------------------------------------------------------

# 🔥 未來可擴充方向

-   自動異常偵測 AI
-   多攝影機 triangulation
-   球員姿態分析
-   比賽統計分析
-   Shot type 自動分類
