# Badminton 3D Debugger MVP

> 羽球 3D 軌跡校正與複盤工具  
> 專案說明、執行方式、檔案功能、資料流程與使用指南

---

## 1. 專案簡介

**Badminton 3D Debugger MVP** 是一個用來檢查、視覺化、校正羽球 3D 軌跡資料的研究型工具。  
它的核心目的不是做最終產品，而是把原本分散在資料、時間軸、影片、標註、軌跡修復之間的工作，集中到同一個可操作的介面中，讓使用者可以更快地：

- 檢視整場比賽的 rally 分段
- 確認每一拍擊球時間點是否正確
- 檢查球的 3D 軌跡是否合理
- 標記與處理 anomaly（異常區段）
- 匯出修正後的標註結果

這份專案目前的定位比較接近：

- **資料校正工具**
- **模型輸出除錯介面**
- **研究與實驗用 MVP**


---

## 2. 專案核心功能

### 2.1 3D 球軌跡視覺化

前端使用 **React + Three.js + react-three-fiber** 呈現羽球軌跡與球場場景，包含：

- 3D 球場平面
- 球網參考物件
- 目前球位置高亮
- 過去軌跡 / 當前軌跡顯示
- 修復模式下的軌跡點選取

這一塊主要用途是幫使用者快速判斷：

- 軌跡是否跳點
- 高度變化是否合理
- 某一段 interpolation 是否異常
- 某一拍前後的球路是否符合比賽邏輯

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

### 2.3 Hit 標註修正

在 Inspector 中可以對單一擊球紀錄進行修正，包括：

- `new_hit_frame`
- `shot_type`
- `hand`
- `note`

這讓使用者可以把模型預測到的擊球點，人工修正成更準確的版本。

### 2.4 Anomaly 管理

系統支援 anomaly 資料顯示與狀態更新。  
目前可以透過 Inspector 對 anomaly 進行處理，例如：

- `fixed`
- `false_positive`
- `needs_rebuild`

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

### 2.6 CSV 匯出

前端可以直接呼叫 backend 的 export API，把目前 hits 資料匯出成 CSV，方便回寫到標註流程或後續分析工具。

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

---

## 4. 專案目錄結構

以下是目前專案中最重要的結構。為了可讀性，這裡只保留真正有開發意義的部分。

```text
badminton3D-main/
├─ docker-compose.yml
├─ README.md
├─ gemini-chat-20260119-114439.md
├─ package.json
├─ package-lock.json
├─ node_modules/                     # 根目錄 node_modules，建議不要納入版本控制
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
│  │     └─ 12_24_1_new/
│  │
│  └─ datasets/
│
├─ frontend/
│  ├─ index.html
│  ├─ package.json
│  ├─ package-lock.json
│  ├─ vite.config.js
│  ├─ postcss.config.cjs
│  ├─ tailwind.config.cjs
│  ├─ node_modules/                  # 前端 node_modules，建議不要納入版本控制
│  └─ src/
│     ├─ main.jsx
│     ├─ App.jsx
│     ├─ api.js
│     ├─ config.js
│     ├─ store.js
│     ├─ styles.css
│     └─ components/
│        ├─ TopBar.jsx
│        ├─ Scene3D.jsx
│        ├─ VideoPanel.jsx
│        ├─ TimelinePanel.jsx
│        └─ RightDock.jsx
│
└─ badminton3D-main/                 # 壓縮或整理過程中留下的重複資料夾，建議後續清理
   └─ backend/
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
目前專案原本附帶的說明文件。  
有基本介紹，但內容與實際實作之間有一些落差，因此這份 `RENAMED.md` 可以視為更完整、較新的專案說明版本。

#### `package.json`（根目錄）
這份根目錄 package 設定目前只有 `jsdom`，不屬於前端主程式運作核心。  
實際前端執行主要還是看 `frontend/package.json`。

#### `gemini-chat-20260119-114439.md`
額外的紀錄型檔案，不屬於實際系統運作核心。

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

#### `backend/app/datasets/12_24_1_new/`
資料集所在位置。  
目前匯入腳本是針對這份資料做設計的。

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
- 排版組合：TopBar / 3D / Video / Timeline / Inspector
- 管理主畫面各區塊大小與分割

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
- trajectory selection（修復模式）

如果沒有這個 store，3D、timeline、影片、inspector 之間就很難同步。

#### `frontend/src/styles.css`
前端的全域樣式設定。

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
- repair mode 點選軌跡點
- 呼叫 trajectory repair API

這是整個專案中最直觀的視覺區塊之一。

#### `frontend/src/components/VideoPanel.jsx`
影片區塊。

功能包含：
- 選擇本機影片檔案
- 與 store 的 `currentTime / currentFrame` 同步
- 播放 / 暫停同步
- requestVideoFrameCallback 同步 frame

這讓影片可以和 3D 與 timeline 一起對齊。

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

它是時間軸編輯後的詳細欄位操作區。

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
Scene3D / TimelinePanel / VideoPanel / RightDock
```

也就是說：

1. 原始標註與軌跡資料先匯入 DB
2. 後端提供統一 API
3. 前端用 store 作為同步中心
4. 各畫面元件共同讀取同一份狀態

這個設計的優點是：

- 3D / timeline / inspector 之間可以同步
- 某一個元件更新後，其他元件可以立即反映
- 資料來源比較一致

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

### 步驟 3：啟動前端

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

### 步驟 4：操作流程建議

進入頁面後，建議使用順序如下：

1. 先確認 3D 視圖與 timeline 有資料
2. 若有影片，先在 VideoPanel 選擇本機影片
3. 在 timeline 找到特定 rally / hit
4. 調整 hit frame
5. 如需補軌跡，進入 repair mode 處理
6. 在 Inspector 補 shot type / hand / note
7. 最後匯出 CSV

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
- 開啟 repair mode
- 點兩個端點做軌跡修復

### Inspector

- 檢視 hit 詳細資訊
- 更新 shot type / hand / note / new frame
- 更新 anomaly 狀態

### Video

- 載入本機影片
- 與時間同步
- 與播放狀態同步

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
6. `frontend/src/components/RightDock.jsx`
7. `frontend/src/components/VideoPanel.jsx`

這樣最容易先理解整個系統的資料流，再進入互動細節。

---



