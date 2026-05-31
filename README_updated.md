# Badminton 3D Debugger MVP

> 羽球 3D 軌跡校正與複盤工具  
> 專案說明、執行方式、檔案功能、資料流程與使用指南

---

## 1. 專案簡介

**Badminton 3D Debugger MVP** 是一個用來檢查、視覺化、校正羽球 3D 軌跡資料的研究型工具。  
它的核心目的不是做最終產品，而是把原本分散在資料、時間軸、影片、標註、軌跡修復、多視角檢查與 2D 投影之間的工作，集中到同一個可操作的介面中，讓使用者可以更快地：

- 檢視整場比賽的 rally 分段
- 確認每一拍擊球時間點是否正確
- 檢查球的 3D 軌跡是否合理
- 標記與處理 anomaly（異常區段）
- 對照 10 個視角的影片
- 將 3D 球座標投影到 2D 影片畫面進行檢查
- 匯出修正後的標註結果

這份專案目前的定位比較接近：

- **資料校正工具**
- **模型輸出除錯介面**
- **多視角影片與 3D 軌跡對照工具**
- **研究與實驗用 MVP**

而不是一般使用者導向的商業產品。

---

## 2. 專案核心功能

### 2.1 3D 球軌跡視覺化

前端使用 **React + Three.js + react-three-fiber** 呈現羽球軌跡與球場場景，包含：

- 3D 球場平面
- 球網參考物件
- 目前球位置高亮
- 過去軌跡 / 當前軌跡顯示
- 修復模式下的軌跡點選取
- 10 支相機在 3D 場景中的位置與朝向
- 點選 3D 場景中的相機 marker 可切換右側影片視角
- 播放影片時可隱藏相機 marker，避免遮擋視線

這一塊主要用途是幫使用者快速判斷：

- 軌跡是否跳點
- 高度變化是否合理
- 某一段 interpolation 是否異常
- 某一拍前後的球路是否符合比賽邏輯
- 攝影機視角與球場空間關係是否合理

### 2.2 Timeline 編輯介面

Timeline 是這個專案最重要的操作區，整合了：

- **Rally track**：顯示來回球區段
- **Hit track**：顯示每次擊球時間點
- **X / Y / Z(t)**：顯示位置隨時間的變化
- **Speed track**：顯示球速變化
- **Anomaly track**：顯示可疑區間

可以做到：

- 拖曳 hit 位置
- 播放 / 暫停 / 單幀前進後退
- zoom timeline
- 左右平移 timeline
- 選取時間區段
- 快速跳至 rally
- 快速檢查特定 frame
- 與影片、3D 場景、2D 投影視圖同步

### 2.3 Hit 標註修正

在 Inspector 中可以對單一擊球紀錄進行修正，包括：

- `new_hit_frame`
- `shot_type`
- `hand`
- `note`

目前標註介面已改成較符合資料集的中文欄位與選項，例如：

- 球種：切球、勾球、平球、防守回抽、防守回挑、放小球、長球、後場抽平球、挑球、推球、殺球、過度切球、撲球、擋小球、點扣、發長球、發短球
- 手法：正拍、反拍

`Hit Frame`、`New Hit Frame`、`Mark Current Frame`、`Jump to Hit Frame` 保留英文，方便和資料欄位名稱對照。

### 2.4 Anomaly 管理

系統支援 anomaly 資料顯示與狀態更新。  
目前可以透過 Inspector 對 anomaly 進行處理，例如：

- `fixed`
- `false_positive`
- `needs_rebuild`

當某一段軌跡無法判斷正常端點，尤其是擊球瞬間附近軌跡整段不可靠時，建議標記為 `needs_rebuild`，不要強行用普通修復補成假軌跡。

### 2.5 軌跡修復

系統提供一個簡單但實用的軌跡修復功能：

- 在 3D 視圖中進入 repair mode
- 選取兩個軌跡端點
- 呼叫 backend 的 repair API
- 對中間點做 **cubic Hermite spline interpolation**

這個功能適合處理：

- 軌跡局部漂移
- 缺失點中間補形
- 明顯不合理的短區段軌跡

注意：修復區間不應跨過擊球 frame。擊球前後的球速與方向會突變，應分成擊球前與擊球後兩段處理。如果 hit 附近已經看不出可靠正常點，應改為標記 `needs_rebuild`。

### 2.6 CSV 匯出

前端可以直接呼叫 backend 的 export API，把目前 hits 資料匯出成 CSV，方便回寫到標註流程或後續分析工具。

### 2.7 10 視角影片與 3D→2D 投影

目前 VideoPanel 支援一次載入 `0.mp4` ~ `9.mp4`，並使用鍵盤 `0` ~ `9` 快速切換視角。

目前專案採用 **方法 A** 管理相機參數：

```text
cameras/*.npy
  ↓ scripts/convert_camera_params.py
frontend/src/assets/camera_params.json
  ↓ frontend/src/utils/cameraProjection.js
VideoPanel 2D overlay / Scene3D camera marker
```

也就是：

- 原始相機參數保留在 `cameras/`
- 前端實際讀取 `frontend/src/assets/camera_params.json`
- `VideoPanel.jsx` 使用這份 JSON 將 3D 球點與球場線投影到影片畫面
- `cameraScenePose.js` 使用同一份 JSON 反推 3D 場景中的攝影機位置與方向

右側影片目前可顯示：

- `Court`：球場線投影
- `Ball`：目前 frame 的球點投影

---

## 3. 技術架構概覽

### 前端

- React
- Vite
- Zustand
- Tailwind CSS
- Three.js
- @react-three/fiber
- @react-three/drei

### 後端

- FastAPI
- SQLAlchemy
- Pydantic
- PostgreSQL
- pandas / numpy

### 執行方式

- Docker Compose 啟動 PostgreSQL 與 FastAPI backend
- 前端以 Vite dev server 獨立啟動
- 相機 `.npy` 參數先轉成 `camera_params.json` 後由前端讀取

---

## 4. 專案目錄結構

以下是目前專案中最重要的結構。為了可讀性，這裡只保留真正有開發意義的部分。

```text
badminton3D-main/
├─ docker-compose.yml
├─ README.md
├─ package.json
├─ package-lock.json
├─ cameras/                         # Cam_0~9 intrinsic / extrinsic .npy
│  ├─ Cam_0_intrinsic.npy
│  ├─ Cam_0_extrinsic.npy
│  ├─ ...
│  ├─ Cam_9_intrinsic.npy
│  └─ Cam_9_extrinsic.npy
│
├─ scripts/
│  └─ convert_camera_params.py       # 將 cameras/*.npy 轉成 camera_params.json
│
├─ backend/
│  ├─ Dockerfile
│  ├─ requirements.txt
│  ├─ .env.example
│  ├─ app/
│  │  ├─ __init__.py
│  │  ├─ db.py
│  │  ├─ models.py
│  │  ├─ schemas.py
│  │  ├─ main.py
│  │  ├─ seed.py
│  │  ├─ reset_db.py
│  │  ├─ import_12_24_1_new.py
│  │  ├─ read_balldata.ipynb
│  │  └─ datasets/
│  │
│  └─ datasets/
│     └─ 12_24_1_new/
│
├─ frontend/
│  ├─ index.html
│  ├─ package.json
│  ├─ package-lock.json
│  ├─ vite.config.js
│  ├─ postcss.config.cjs
│  ├─ tailwind.config.cjs
│  └─ src/
│     ├─ main.jsx
│     ├─ App.jsx
│     ├─ api.js
│     ├─ config.js
│     ├─ store.js
│     ├─ styles.css
│     ├─ assets/
│     │  └─ camera_params.json       # 前端使用的相機參數 JSON
│     ├─ utils/
│     │  ├─ cameraProjection.js      # 3D→2D 投影、球場線投影
│     │  └─ cameraScenePose.js       # 從 extrinsic 反推 3D 相機位置
│     └─ components/
│        ├─ TopBar.jsx
│        ├─ Scene3D.jsx
│        ├─ VideoPanel.jsx
│        ├─ Projection2DPanel.jsx
│        ├─ TimelinePanel.jsx
│        └─ RightDock.jsx
│
└─ node_modules/                     # 若存在，建議不要納入版本控制
```

---

## 5. 每個主要檔案在做什麼

下面是這份專案最重要的檔案導覽。

---

### 5.1 根目錄

#### `docker-compose.yml`
負責啟動整個後端環境，主要包含：

- `db`：PostgreSQL 16
- `backend`：FastAPI service

目前 compose 會把：

- backend/app 掛載進 container
- port `8000` 對外開放
- DB port `5432` 對外開放

這是整個開發與測試流程的入口。

#### `README.md`
專案說明文件。  
目前這份 README 已依照現有版本更新，但保留原本章節結構，方便組員照原本脈絡閱讀。

#### `package.json`（根目錄）
根目錄 package 設定目前不是前端主程式運作核心。  
實際前端執行主要看 `frontend/package.json`。

#### `cameras/`
存放 10 支攝影機的原始 `.npy` 校正參數。

每個 camera 有兩個檔案：

- `Cam_N_intrinsic.npy`：相機內參，格式約為 `[fx, fy, cx, cy, k1, k2, p1, p2, k3]`
- `Cam_N_extrinsic.npy`：相機外參，格式為 `3 x 4` 的 `[R | t]`

這些檔案不直接由瀏覽器讀取，而是透過 `scripts/convert_camera_params.py` 轉成 JSON。

#### `scripts/convert_camera_params.py`
將 `cameras/*.npy` 轉成前端可直接 import 的：

```text
frontend/src/assets/camera_params.json
```

目前建議以 calibration 原始座標系 `1920 x 1200` 轉換，不要改成影片檔案的 `1280 x 800`，因為 intrinsic 裡的 `cx=960, cy=600` 對應的是 `1920 x 1200`。

---

### 5.2 Backend

#### `backend/Dockerfile`
定義 backend container 的建置方式。  
通常會：

- 使用 Python 基底映像
- 安裝 requirements
- 啟動 FastAPI / uvicorn

#### `backend/requirements.txt`
後端 Python 相依套件列表，主要包含：

- fastapi
- uvicorn
- SQLAlchemy
- psycopg2-binary
- pydantic
- pandas
- numpy

#### `backend/app/db.py`
資料庫連線設定。

功能：
- 讀取 `DATABASE_URL`
- 建立 SQLAlchemy `engine`
- 建立 `SessionLocal`
- 提供 `get_db()` 給 FastAPI route 使用

這個檔案是 backend 連接 PostgreSQL 的基礎。

#### `backend/app/models.py`
SQLAlchemy ORM model 定義。

包含資料表：
- `Match`
- `Rally`
- `Hit`
- `BallTraj`
- `Anomaly`

也定義了重要索引，例如：
- `idx_ball_match_frame`

這些 model 對應到整個系統的資料骨架。

#### `backend/app/schemas.py`
Pydantic schema 定義，用來規範 API 的輸入與輸出。

例如：
- `MatchOut`
- `TimelineOut`
- `TrajPoint`
- `HitPatch`
- `AnomalyPatch`
- `TrajRepairPayload`

它的作用是把 ORM 與 API contract 分開，讓前後端溝通更穩定。

#### `backend/app/main.py`
FastAPI 主程式，也是後端 API 核心。

目前主要提供：

- `GET /health`
- `GET /matches/{match_id}`
- `GET /matches/{match_id}/timeline`
- `GET /matches/{match_id}/traj`
- `PATCH /hits/{hit_id}`
- `PATCH /anomalies/{anomaly_id}`
- `PATCH /matches/{match_id}/traj/repair`
- `GET /export/csv`

這個檔案負責：

- 建表初始化
- CORS
- 查詢 match / timeline / trajectory
- hit patch
- anomaly patch
- trajectory repair
- CSV 匯出

#### `backend/app/seed.py`
用來建立 demo data 的種子資料腳本。  
如果設定 `SEED_DEMO=1`，系統啟動時會自動寫入示範資料。

它適合在沒有正式資料集時，先確認前後端功能有沒有通。

#### `backend/app/import_12_24_1_new.py`
真實資料集匯入腳本，是這個專案很重要的一支程式。

主要做的事：

1. 建立 `Match`
2. 讀取各 set 的 `RallySeg.csv`
3. 建立 `Rally`
4. 讀取 `shot_annotated.csv`
5. 建立 `Hit`
6. 從 `.npy` 與 mask 檔讀入有效球軌跡
7. 批量寫入 `BallTraj`

這支腳本會把原始資料整理成系統可用的 DB 內容。

#### `backend/app/reset_db.py`
用來清空 / 重建資料庫結構的輔助腳本。  
適合在資料匯入流程改動後重新初始化環境。

#### `backend/app/read_balldata.ipynb`
Notebook 類型的實驗 / 檢查工具。  
用途通常是：

- 檢視原始軌跡
- 測試資料讀取
- 驗證 npy / mask / speed 資料內容
- 檢查 XY / XZ / YZ 平面投影

#### `backend/app/datasets/` 與 `backend/datasets/`
資料集所在位置。  
目前匯入腳本是針對 `12_24_1_new` 這類資料結構做設計的。

---

### 5.3 Frontend

#### `frontend/src/main.jsx`
React 入口點。  
負責把整個 App 掛載到頁面。

#### `frontend/src/App.jsx`
前端總容器與畫面佈局主檔案。

主要負責：

- 載入 match metadata
- 載入 timeline data
- 載入 trajectory
- 排版組合：TopBar / 3D / Video / Timeline 或 Projection2D / Inspector
- 管理主畫面各區塊大小與分割
- 在沒有選 hit / anomaly 時隱藏右側 Inspector
- 底部可切換 Timeline 與 2D Projection 視圖

如果想調整主畫面 layout，通常會先從這裡下手。

#### `frontend/src/api.js`
前端呼叫 backend API 的封裝。

目前整理了：
- `getMatch`
- `getTimeline`
- `getTraj`
- `repairTraj`
- `patchHit`
- `patchAnomaly`

這可以避免每個元件自己散落寫 `fetch`。

#### `frontend/src/config.js`
前端 API base URL 設定。  
預設走：

- `VITE_API_BASE`
- 若未設定則 fallback 到 `http://localhost:8000`

#### `frontend/src/store.js`
Zustand 全域狀態管理核心。

這個檔案是整個前端互動的中樞，包含：

- 當前時間 / frame
- 播放狀態
- selection range
- rallies / hits / anomalies
- trajectory cache
- zoom / scroll
- active item
- 10 視角 camera 設定
- active camera
- scene camera target
- trajectory selection（修復模式）

目前 camera 預設資料會透過 `cameraScenePose.js` 從 `camera_params.json` 反推真實相機位置，不再需要手動寫死 3D marker 位置。

#### `frontend/src/styles.css`
前端的全域樣式設定。

#### `frontend/src/assets/camera_params.json`
由 `scripts/convert_camera_params.py` 從 `cameras/*.npy` 轉出的相機參數。

包含：

- `coordinateMode`
- `useLensDistortion`
- `courtWorldTransform`
- `cameras.cam0` ~ `cameras.cam9`

這份 JSON 同時供 `VideoPanel.jsx` 的 3D→2D 投影與 `Scene3D.jsx` 的相機 marker 使用。

#### `frontend/src/utils/cameraProjection.js`
投影工具檔。

功能包含：

- 讀取 `camera_params.json`
- 取得指定 camera 的 intrinsic / extrinsic
- 將 3D 球座標投影成 2D 影片座標
- 可選擇是否使用鏡頭畸變參數
- 投影標準羽球場白線，用來檢查相機參數和影片是否對齊
- 提供 `courtWorldTransform` 對球場座標做微調

#### `frontend/src/utils/cameraScenePose.js`
根據相機外參 `[R | t]` 反推 3D 場景中的 camera center 與光軸方向。

公式核心：

```text
C = -R^T t
```

Scene3D 使用的座標轉換為：

```text
scene = [x, -y, -z]
```

#### `frontend/src/components/TopBar.jsx`
上方資訊列。

主要顯示：
- match id
- current time
- current frame
- fps
- selection 範圍
- 匯出 CSV 按鈕

#### `frontend/src/components/Scene3D.jsx`
3D 視圖主元件。

功能包含：
- 畫球場
- 顯示球軌跡
- 顯示當前球位置
- 顯示 10 支相機 marker 與箭頭方向
- 點擊相機 marker 切換右側影片視角
- 播放時隱藏相機 marker，避免遮擋
- repair mode 點選軌跡點
- 呼叫 trajectory repair API
- 滑鼠游標位置 zoom in / zoom out

這是整個專案中最直觀的視覺區塊之一。

#### `frontend/src/components/VideoPanel.jsx`
影片區塊。

功能包含：
- 一次選擇 `0.mp4` ~ `9.mp4`
- 與 store 的 `currentTime / currentFrame` 同步
- 播放 / 暫停同步
- requestVideoFrameCallback 同步 frame
- 鍵盤 `0` ~ `9` 快速切換視角
- 顯示 `Court` 球場線投影
- 顯示 `Ball` 目前 frame 球點投影

影片實際檔案可能是 `1280 x 800`，但 camera calibration 參數使用 `1920 x 1200` 座標系。因比例同為 1.6，前端會等比例縮放 overlay，不建議直接把 `imageWidth / imageHeight` 改成 1280 / 800，除非同時縮放 `fx, fy, cx, cy`。

#### `frontend/src/components/Projection2DPanel.jsx`
底部 2D 平面投影視圖。

功能是把 3D 軌跡投影到數學平面，用來觀察：

- Top view
- Side view
- Front view
- X / Y / Z 中哪個軸突然跳動
- 哪一段軌跡高度或水平位置不合理

這和 VideoPanel 的「相機影片 2D 投影」不同。Projection2DPanel 是輔助分析平面圖，不需要相機參數。

#### `frontend/src/components/TimelinePanel.jsx`
時間軸主編輯區。

這個檔案目前是前端中最複雜的一塊，負責：

- timeline 畫布繪製
- rally / hit / anomaly 軌顯示
- speed 與 xyz 曲線
- playhead
- zoom / scroll
- scrubbing
- dragging hit
- keyboard 操作
- selection range
- 跳轉 rally

簡單說，這是整個工具的主要操作台。

#### `frontend/src/components/RightDock.jsx`
右側 Inspector。

功能包含：
- 顯示選中的 hit 或 anomaly
- 修改 hit 欄位
- 修改 anomaly 狀態
- 將修改寫回 backend
- 中文化標註介面

未選取 hit 或 anomaly 時，右側面板會隱藏，避免佔用主畫面空間。

---

## 6. 資料模型說明

### `Match`
代表一場比賽。

重要欄位：
- `title`
- `fps`
- `duration_frame`
- `cameras`

### `Rally`
代表一次來回球區段。

重要欄位：
- `rally_index`
- `start_frame`
- `end_frame`
- `status`

### `Hit`
代表一拍擊球事件。

重要欄位：
- `ball_round`
- `player`
- `hit_frame`
- `new_hit_frame`
- `shot_type`
- `hand`
- `note`
- `confidence`

### `BallTraj`
代表球在某一 frame 的 3D 軌跡點。

重要欄位：
- `frame`
- `t_sec`
- `x`
- `y`
- `z`
- `speed`
- `confidence`

### `Anomaly`
代表軌跡異常區段。

重要欄位：
- `start_frame`
- `end_frame`
- `kind`
- `severity`
- `status`
- `comment`

---

## 7. 系統資料流

這份專案的資料流可以簡化成下面這條路徑：

```text
原始資料集
  └─ RallySeg.csv / shot_annotated.csv / npy / mask / speed
      ↓
import_12_24_1_new.py
      ↓
PostgreSQL
      ↓
FastAPI API
      ↓
frontend/api.js
      ↓
Zustand store
      ↓
Scene3D / TimelinePanel / VideoPanel / Projection2DPanel / RightDock
```

相機參數資料流則是：

```text
cameras/Cam_0~9_intrinsic.npy / extrinsic.npy
      ↓
scripts/convert_camera_params.py
      ↓
frontend/src/assets/camera_params.json
      ↓
cameraProjection.js / cameraScenePose.js
      ↓
VideoPanel 2D overlay / Scene3D camera markers
```

也就是說：

1. 原始標註與軌跡資料先匯入 DB
2. 後端提供統一 API
3. 前端用 store 作為同步中心
4. 各畫面元件共同讀取同一份狀態
5. 相機 `.npy` 參數先轉成 JSON，再供前端投影與 3D 相機 marker 使用

這個設計的優點是：

- 3D / timeline / inspector / video / 2D projection 之間可以同步
- 某一個元件更新後，其他元件可以立即反映
- 資料來源比較一致
- 相機參數不用手動寫死在 JS 裡

---

## 8. 如何執行這份專案

下面提供一個最實際、最穩的啟動流程。

### 步驟 1：啟動 backend 與資料庫

在專案根目錄執行：

```bash
docker compose up --build
```

成功後：

- PostgreSQL 會跑在 `localhost:5432`
- FastAPI backend 會跑在 `localhost:8000`

可先測試：

```bash
http://localhost:8000/health
```

看到 `{"ok": true}` 代表 backend 正常。

---

### 步驟 2：匯入資料集

如果是第一次執行，或 DB 目前沒有正式資料，請執行：

```bash
docker compose exec backend python -m app.import_12_24_1_new
```

這一步會把：

- rally segmentation
- hit annotation
- trajectory points

匯入資料庫。

> 注意：目前這支匯入腳本主要匯入 `Match / Rally / Hit / BallTraj`。  
> 如果你預期 anomaly 也要從資料集自動建立，則需要額外擴充匯入流程。

---

### 步驟 3：轉換相機參數

目前專案採用方法 A：將 `.npy` 轉成 JSON，前端讀 JSON。

在專案根目錄執行：

```bash
python scripts/convert_camera_params.py --input cameras --output frontend/src/assets/camera_params.json --width 1920 --height 1200
```

不要直接用 `1280 x 800` 轉，除非你同時把 `fx, fy, cx, cy` 等比例縮放。  
目前 intrinsic 裡的 `cx=960, cy=600` 對應的是 `1920 x 1200` 校正座標系。

---

### 步驟 4：啟動前端

進入前端資料夾：

```bash
cd frontend
npm install
npm run dev
```

預設網址：

```bash
http://localhost:5173
```

如果 backend 不在預設位置，可以設定：

```bash
VITE_API_BASE=http://localhost:8000
```

---

### 步驟 5：操作流程建議

進入頁面後，建議使用順序如下：

1. 先確認 3D 視圖與 timeline 有資料
2. 在 VideoPanel 一次選擇本機 `0.mp4` ~ `9.mp4`
3. 使用 `0` ~ `9` 切換視角
4. 開啟 `Court` 檢查球場線投影是否貼合影片白線
5. 開啟 `Ball` 檢查目前 frame 的球點投影是否合理
6. 在 timeline 找到特定 rally / hit
7. 調整 hit frame
8. 如需補軌跡，進入 repair mode 處理短區間
9. 在 Inspector 補 shot type / hand / note
10. 最後匯出 CSV

---

## 9. 常用指令

### 啟動系統

```bash
docker compose up --build
```

### 後端 shell

```bash
docker compose exec backend bash
```

### 匯入資料

```bash
docker compose exec backend python -m app.import_12_24_1_new
```

### 重設資料庫（若有提供 reset 腳本）

```bash
docker compose exec backend python -m app.reset_db
```

### 轉換相機參數

```bash
python scripts/convert_camera_params.py --input cameras --output frontend/src/assets/camera_params.json --width 1920 --height 1200
```

### 啟動前端

```bash
cd frontend
npm install
npm run dev
```

---

## 10. 目前前端可操作功能總覽

### Timeline

- 播放 / 暫停
- 單幀前後移動
- 拖曳空白區平移
- 拖曳藍線 scrub
- 拖曳 hit 位置
- 設定選取區間
- 跳轉前後 rally
- timeline 縮放

### 3D

- 顯示軌跡
- 顯示球位置
- 顯示 10 支攝影機位置與方向
- 點擊 3D 相機 marker 切換影片視角
- 播放時隱藏相機 marker
- 開啟 repair mode
- 點兩個端點做短區間軌跡修復
- 滑鼠游標位置 zoom in / zoom out

### Inspector

- 檢視 hit 詳細資訊
- 更新 shot type / hand / note / new frame
- 更新 anomaly 狀態
- 未編輯時自動隱藏右側面板

### Video

- 一次載入 `0.mp4` ~ `9.mp4`
- 鍵盤 `0` ~ `9` 快速切換視角
- 與時間同步
- 與播放狀態同步
- 顯示球場線 3D→2D 投影
- 顯示球點 3D→2D 投影

### Projection2D

- 顯示 3D 軌跡的平面投影
- 可輔助判斷 X / Y / Z 哪個軸出現跳動
- 和 VideoPanel 的相機投影不同，不需要 camera calibration

---

## 11. 目前 API 一覽

### `GET /health`
檢查 backend 是否正常。

### `GET /matches/{match_id}`
取得比賽基本資料。

### `GET /matches/{match_id}/timeline`
取得 rally / hit / anomaly 資料。

### `GET /matches/{match_id}/traj?start=...&end=...`
取得某段 frame 區間內的球軌跡。

### `PATCH /hits/{hit_id}`
更新單一 hit。

### `PATCH /anomalies/{anomaly_id}`
更新單一 anomaly。

### `PATCH /matches/{match_id}/traj/repair`
修復某段 trajectory。

### `GET /export/csv?match_id=...`
匯出 hits CSV。

---

## 12. 建議閱讀順序

如果是第一次接手這份專案，建議依照下面順序讀：

### 後端
1. `backend/app/models.py`
2. `backend/app/schemas.py`
3. `backend/app/main.py`
4. `backend/app/import_12_24_1_new.py`
5. `backend/app/db.py`

### 前端
1. `frontend/src/store.js`
2. `frontend/src/App.jsx`
3. `frontend/src/api.js`
4. `frontend/src/components/TimelinePanel.jsx`
5. `frontend/src/components/Scene3D.jsx`
6. `frontend/src/components/VideoPanel.jsx`
7. `frontend/src/utils/cameraProjection.js`
8. `frontend/src/utils/cameraScenePose.js`
9. `frontend/src/components/Projection2DPanel.jsx`
10. `frontend/src/components/RightDock.jsx`

### 相機參數
1. `cameras/`
2. `scripts/convert_camera_params.py`
3. `frontend/src/assets/camera_params.json`

這樣最容易先理解整個系統的資料流，再進入互動細節。

---

## 13. 專案目前值得注意的地方

這一段不是批評，而是接手時很有用的提醒。

### 13.1 `TimelinePanel.jsx` 是高複雜度檔案

這個檔案目前承擔非常多責任：

- 繪圖
- hit 拖曳
- playhead
- 滑鼠互動
- scroll / zoom
- keyboard
- selection

後續如果要擴充功能，建議最終還是逐步拆分，不然維護成本會繼續上升。

### 13.2 匯入腳本目前偏資料集特化

`import_12_24_1_new.py` 明顯是為某一份資料結構量身寫的。  
如果換另一份 dataset，可能需要調整：

- 路徑
- set 名稱
- npy folder
- duration 計算方式
- anomaly 生成策略

### 13.3 專案中存在重複或臨時性檔案

例如：

- 根目錄 `node_modules`
- `frontend/node_modules`
- 壓縮或整理過程中可能留下的重複資料夾

這些不影響核心功能，但之後整理 repo 時建議清理，避免結構混亂。

### 13.4 README 與實作可能有版本落差

目前這份 README 已依照上傳版本更新，但如果後續程式繼續變動，仍建議以實際程式碼為準。

### 13.5 2D 投影必須先校準球場線

如果 `Court` 投影線沒有貼合影片白線，不應直接拿 `Ball` 紅點判斷球座標準不準。  
建議流程是：

1. 先確認 camera 編號是否對應影片
2. 確認 `camera_params.json` 使用 `1920 x 1200`
3. 測試 `coordinateMode`
4. 測試 `useLensDistortion`
5. 必要時微調 `courtWorldTransform`
6. 球場線基本對上後，再檢查球點投影

### 13.6 修復功能不適合跨越 hit frame

擊球瞬間是球速與方向的斷點，不應直接用普通 repair 跨過。  
如果 hit 附近完全看不出正常端點，應標記 `needs_rebuild`，不要硬補成平滑軌跡。

---

## 14. 適合後續擴充的方向

如果這份專案要繼續往下一階段發展，下面幾個方向最值得做：

### 14.1 多視角影片支援
目前已支援 10 視角切換與 3D→2D 投影。後續可以加上更完整的多視角同步校正、每個 camera 的 frame offset 校準，以及一鍵比較多視角投影誤差。

### 14.2 更完整的 anomaly 產生流程
現在 anomaly 可以顯示與更新，但產生與匯入邏輯仍可再完整化。後續可以加入速度 / 加速度 / mask / reprojection error 的自動 anomaly 偵測。

### 14.3 使用者操作歷史 / undo redo
對資料校正工具來說，這會非常重要。尤其 trajectory repair 目前會直接改資料，未來應加入 repair history、restore original 或 undo last repair。

### 14.4 更穩定的資料預載策略
目前 trajectory 載入策略可以再針對大型資料做最佳化。

### 14.5 Timeline 模組化
讓 timeline 更容易維護與擴充。

### 14.6 2D correction 與 triangulation
目前已能把 3D 點投影到 2D 影片。下一步可以加入人工 2D 標點，當同一 frame 有兩個以上視角標到球時，用 triangulation 重建 3D 球點。

---

## 15. 快速總結

這份專案的本質可以用一句話概括：

> **把羽球 3D 軌跡、擊球標註、時間軸、多視角影片、2D 投影與資料修復，整合成同一個可互動的校正平台。**

它的價值不在單純展示球軌跡，而在於：

- 可以看
- 可以查
- 可以修
- 可以對照多視角影片
- 可以檢查 3D→2D 投影
- 可以匯出
- 可以作為模型 debug 與資料重建的工作台

對研究型專題來說，這是一個很有延展性的基礎架構。

---

## 16. 建議檔名與用途

建議直接保留為：

```text
README.md
```

適合用途：

- 專案交接文件
- 報告前的結構說明
- 給教授 / 組員快速理解專案
- 後續整理正式專案文件的基礎版本
