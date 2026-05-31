# Badminton 3D Debugger MVP

羽球多視角影片、3D 球軌跡、2D 平面投影、擊球標註與軌跡修復用的研究型除錯工具。

這份專案目前定位是 **資料校正 / 模型輸出檢查 / 研究用 MVP**。

---

## 1. 目前版本重點

目前版本已包含以下功能：

- 3D 羽球場與 3D 球軌跡顯示
- 10 視角影片切換，檔名支援 `0.mp4` ~ `9.mp4`
- 影片、3D、Timeline、2D projection panel 的 frame 同步
- 影片畫面上的 3D→2D camera projection overlay
- 相機參數由 `.npy` 轉成 `camera_params.json`，前端不再手動寫死 Cam0~Cam9 參數
- 左側 3D 場景中的 camera marker 位置由 `camera_params.json` 的 extrinsic 自動推算
- Timeline 顯示 rally、hit、anomaly、XYZ 曲線、speed 曲線
- 右側中文化編輯面板，未選中 hit / anomaly 時自動隱藏
- 2D 平面投影輔助視圖：Top / Side / Front
- Hit 編輯：`New Hit Frame`、球種、手法、備註
- Anomaly 狀態管理：`fixed`、`false_positive`、`needs_rebuild`
- Repair mode：選兩個 3D 軌跡點後呼叫 backend 進行 cubic Hermite spline 修復
- CSV 匯出

---

## 2. 技術架構

### Frontend

- React
- Vite
- Zustand
- Tailwind CSS
- Three.js
- @react-three/fiber
- @react-three/drei
- Canvas 2D overlay

### Backend

- FastAPI
- SQLAlchemy
- PostgreSQL
- Pydantic
- NumPy
- pandas

### Camera / Projection

- 原始相機參數放在 `cameras/`
- 使用 `scripts/convert_camera_params.py` 將 `.npy` 轉成 `frontend/src/assets/camera_params.json`
- 前端用 `cameraProjection.js` 讀取 `camera_params.json`
- 3D 場景中的 camera marker 用 `cameraScenePose.js` 從 extrinsic 自動算出位置與朝向

---

## 3. 專案結構

```text
badminton3D-main/
├─ README.md
├─ docker-compose.yml
├─ cameras/
│  ├─ Cam_0_intrinsic.npy
│  ├─ Cam_0_extrinsic.npy
│  ├─ ...
│  ├─ Cam_9_intrinsic.npy
│  └─ Cam_9_extrinsic.npy
│
├─ scripts/
│  └─ convert_camera_params.py
│
├─ backend/
│  ├─ Dockerfile
│  ├─ requirements.txt
│  ├─ .env.example
│  └─ app/
│     ├─ db.py
│     ├─ main.py
│     ├─ models.py
│     ├─ schemas.py
│     ├─ seed.py
│     ├─ reset_db.py
│     ├─ import_12_24_1_new.py
│     ├─ read_balldata.ipynb
│     └─ datasets/
│        └─ 12_24_1_new/
│
└─ frontend/
   ├─ index.html
   ├─ package.json
   ├─ vite.config.js
   ├─ tailwind.config.cjs
   ├─ postcss.config.cjs
   └─ src/
      ├─ main.jsx
      ├─ App.jsx
      ├─ api.js
      ├─ config.js
      ├─ store.js
      ├─ styles.css
      ├─ assets/
      │  └─ camera_params.json
      ├─ utils/
      │  ├─ cameraProjection.js
      │  └─ cameraScenePose.js
      └─ components/
         ├─ TopBar.jsx
         ├─ Scene3D.jsx
         ├─ VideoPanel.jsx
         ├─ TimelinePanel.jsx
         ├─ Projection2DPanel.jsx
         └─ RightDock.jsx
```

> 注意：`node_modules/` 不建議提交版本控制。重新安裝即可。

---

## 4. 快速啟動

### 4.1 啟動 backend 與 PostgreSQL

在專案根目錄執行：

```bash
docker compose up --build
```

成功後：

- Backend: `http://localhost:8000`
- PostgreSQL: `localhost:5432`

測試 backend：

```text
http://localhost:8000/health
```

如果看到：

```json
{"ok": true}
```

代表 backend 正常。

---

### 4.2 匯入資料集

第一次啟動或資料庫是空的時候，執行：

```bash
docker compose exec backend python -m app.import_12_24_1_new
```

這支腳本會匯入：

- Match
- Rally
- Hit
- BallTraj

資料來源主要是：

```text
backend/app/datasets/12_24_1_new/
backend/app/datasets/ball_new/
backend/app/datasets/ball_final_mask_new/
```

實際資料夾名稱依目前專案放置狀態而定。

---

### 4.3 啟動 frontend

在另一個 terminal：

```bash
cd frontend
npm install
npm run dev
```

預設會跑在：

```text
http://localhost:5173
```

如果前端連不到 backend，可建立 `.env` 或用環境變數設定：

```bash
VITE_API_BASE=http://localhost:8000
```

---

## 5. Camera Params：目前使用方法 A

目前版本使用 **方法 A：`.npy` 轉成 JSON**。

也就是：

```text
cameras/*.npy
    ↓
scripts/convert_camera_params.py
    ↓
frontend/src/assets/camera_params.json
    ↓
前端 cameraProjection.js / cameraScenePose.js 使用
```

這樣做的好處是：

- 前端不用安裝 `.npy` parser
- Vite 可以直接 import JSON
- 部署與展示比較穩定
- 之後換相機參數，只要重新轉一次 JSON

---

### 5.1 轉換 camera params

在專案根目錄執行：

```bash
python scripts/convert_camera_params.py \
  --input cameras \
  --output frontend/src/assets/camera_params.json \
  --width 1920 \
  --height 1200
```

目前雖然實際影片常見是：

```text
1280 x 800
50 fps
```

但是 intrinsic 裡的 `cx=960, cy=600` 對應的是 `1920 x 1200` 校正座標系，所以轉 JSON 時仍建議使用：

```text
1920 x 1200
```

前端 overlay 會用：

```js
scaleX = cssWidth / cameraParams.imageWidth
scaleY = cssHeight / cameraParams.imageHeight
```

把 1920x1200 的投影結果等比例縮放到影片實際顯示大小。

---

### 5.2 `camera_params.json` 內容

`frontend/src/assets/camera_params.json` 大致結構：

```json
{
  "coordinateMode": "raw",
  "useLensDistortion": true,
  "courtWorldTransform": {
    "xOffset": 0,
    "zOffset": 0,
    "rotateDeg": 0,
    "xScale": 1,
    "zScale": 1,
    "yOffset": 0
  },
  "cameras": {
    "cam0": {
      "id": "cam0",
      "label": "Cam 0",
      "imageWidth": 1920,
      "imageHeight": 1200,
      "uOffset": 0,
      "vOffset": 0,
      "intrinsic": [...],
      "extrinsic": [[...], [...], [...]]
    }
  }
}
```

---

### 5.3 intrinsic / extrinsic 格式

每個 camera 有兩個 `.npy`：

```text
Cam_N_intrinsic.npy
Cam_N_extrinsic.npy
```

`intrinsic.npy` 格式：

```text
[fx, fy, cx, cy, k1, k2, p1, p2, k3]
```

含義：

- `fx, fy`：焦距
- `cx, cy`：主點
- `k1, k2, k3`：徑向畸變
- `p1, p2`：切向畸變

`extrinsic.npy` 格式：

```text
3 x 4 matrix = [R | t]
```

用法：

```text
P_camera = R * P_world + t
```

再用 intrinsic 投影到影像座標：

```text
u, v
```

---

## 6. Camera Projection 功能

### 6.1 影片上的 3D→2D 投影

`VideoPanel.jsx` 會在影片上疊一層 canvas overlay。

目前會顯示：

- 紅點：目前 frame 的 3D 球座標投影位置
- 黃色軌跡：目前 frame 前後一小段 3D 球軌跡投影

右上角的 `3D→2D` 按鈕可以開關 overlay。

投影流程：

```text
BallTraj: x, y, z
    ↓
project3DToImage()
    ↓
intrinsic + extrinsic + distortion
    ↓
u, v
    ↓
Canvas overlay
```

### 6.2 鏡頭畸變

目前 `cameraProjection.js` 支援 OpenCV 常見畸變模型：

```text
radial: k1, k2, k3
tangential: p1, p2
```

可用 `camera_params.json` 裡的：

```json
"useLensDistortion": true
```

控制是否套用畸變。

如果發現影片已經被 undistort，或邊緣越投影越歪，可先測：

```json
"useLensDistortion": false
```

---

## 7. 3D Scene 中的 Camera Marker

左側 3D 場景中的 camera marker 不是手動寫死位置，而是從 `camera_params.json` 自動推算。

相關檔案：

```text
frontend/src/utils/cameraScenePose.js
frontend/src/store.js
```

推算方式：

```text
extrinsic = [R | t]
相機中心 C = -Rᵀt
```

並轉成 Scene3D 顯示座標：

```text
scene = [x, -y, -z]
```

這樣可讓：

- 影片投影使用的 camera params
- 3D 場景中的相機位置
- 3D 場景中的相機方向

保持同一份來源。

---

## 8. 2D 平面投影視圖

底部可切換：

```text
TIMELINE / 2D
```

`Projection2DPanel.jsx` 提供三種數學平面視圖：

- Top view：看球在球場平面上的位置
- Side view：看深度與高度
- Front view：看左右與高度

這和影片上的 3D→2D camera projection 不一樣。

差異：

| 功能 | 位置 | 需要 camera params | 用途 |
|---|---|---:|---|
| 2D 平面投影 | `Projection2DPanel.jsx` | 不需要 | 看 x/z/y 軸哪裡異常 |
| 影片 3D→2D 投影 | `VideoPanel.jsx` | 需要 | 看 3D 球點是否落在影片中的羽球位置 |

---

## 9. 使用方式

### 9.1 載入 10 視角影片

在影片區下方按：

```text
選擇 0-9.mp4
```

請一次選擇或分批選擇：

```text
0.mp4
1.mp4
2.mp4
3.mp4
4.mp4
5.mp4
6.mp4
7.mp4
8.mp4
9.mp4
```

系統會自動對應：

```text
0.mp4 → cam0
1.mp4 → cam1
...
9.mp4 → cam9
```

也支援部分命名：

```text
cam0.mp4
cam_0.mp4
cam-0.mp4
camera0.mp4
```

---

### 9.2 切換視角

可使用：

- 上方 `0~9` 按鈕
- 鍵盤 `0~9`
- 左側 3D 場景中的 camera marker

切換視角時會同步：

- active camera
- 3D scene camera target
- 影片顯示
- frame/time

---

### 9.3 播放與 frame 控制

常用快捷鍵：

| 操作 | 快捷鍵 |
|---|---|
| 播放 / 暫停 | Space |
| 單幀前進 / 後退 | ← / → |
| 設定 In / Out | I / O |
| 切換視角 | 0~9 |
| 跳 anomaly | Shift + N / Shift + P |

---

### 9.4 編輯 hit

點選 Timeline 上的 hit 後，右側編輯面板會出現。

可編輯：

- `New Hit Frame`
- 球種
- 手法
- 備註

目前球種選項包含：

```text
切球、勾球、平球、防守回抽、防守回挑、放小球、長球、後場抽平球、挑球、推球、殺球、過度切球、撲球、擋小球、點扣、發長球、發短球
```

手法：

```text
正拍、反拍
```

---

### 9.5 編輯 anomaly

點選 anomaly 後，可在右側面板標記：

```text
fixed
false_positive
needs_rebuild
```

建議：如果 hit 附近軌跡看不出可靠端點，不要硬修，應標記為 `needs_rebuild`。

---

### 9.6 Repair mode

在 3D 視圖打開 repair mode 後：

1. 點選兩個軌跡端點
2. 呼叫 backend repair API
3. backend 使用 cubic Hermite spline 修復中間點
4. 前端重新讀取該區間軌跡

適合：

- 非 hit 附近的短區間跳點
- 明顯缺失點補形
- 有可靠前後端點的局部修正

不適合：

- 跨過 hit frame 的修復
- hit 附近整段混亂
- 找不到可信端點的區間
- 長區間硬補

---

## 10. Backend API

目前主要 API：

| Method | Path | 功能 |
|---|---|---|
| GET | `/health` | 健康檢查 |
| GET | `/matches/{match_id}` | 取得 match metadata |
| GET | `/matches/{match_id}/timeline` | 取得 rallies / hits / anomalies |
| GET | `/matches/{match_id}/traj?start=&end=` | 取得指定 frame 範圍的球軌跡 |
| PATCH | `/hits/{hit_id}` | 更新 hit 標註 |
| PATCH | `/anomalies/{anomaly_id}` | 更新 anomaly 狀態 |
| PATCH | `/matches/{match_id}/traj/repair` | 修復軌跡區間 |
| GET | `/export/csv?match_id=` | 匯出 CSV |

---

## 11. 重要檔案說明

### `frontend/src/App.jsx`

主畫面 layout。負責：

- 載入 match / timeline / trajectory
- 控制 3D、影片、Timeline、2D panel、RightDock 的排列
- 支援拖拉調整區塊大小
- 未選 hit / anomaly 時隱藏右側面板

### `frontend/src/store.js`

Zustand 全域狀態。

管理：

- matchId / fps / duration
- cameras
- activeCameraId
- sceneCameraTargetId
- currentTime / currentFrame
- playing / playbackRate
- rallies / hits / anomalies
- trajectory cache
- selection
- repair mode
- bottomView

### `frontend/src/components/Scene3D.jsx`

左側 3D 場景。

包含：

- 3D 球場
- 3D ball trajectory
- current ball
- camera markers
- repair mode
- 滑鼠游標位置 zoom
- 播放時隱藏 camera markers

### `frontend/src/components/VideoPanel.jsx`

右側影片區。

包含：

- 本機 0~9 影片載入
- 視角切換
- 影片與 store frame 同步
- `requestVideoFrameCallback` 精準同步
- 3D→2D projection overlay

### `frontend/src/components/TimelinePanel.jsx`

底部 Timeline。

包含：

- rally / hit / anomaly tracks
- XYZ 曲線
- speed 曲線
- playhead
- zoom / scroll
- hit drag
- selection range
- rally navigation
- playback controls

### `frontend/src/components/Projection2DPanel.jsx`

底部 2D 平面視圖。

包含：

- Top view
- Side view
- Front view
- 目前 frame 點
- hit / anomaly 輔助顯示

### `frontend/src/components/RightDock.jsx`

右側編輯面板。

包含：

- Hit 編輯
- Anomaly 狀態更新
- 中文介面
- 儲存狀態提示

### `frontend/src/utils/cameraProjection.js`

處理 3D→2D 投影。

包含：

- 讀取 `camera_params.json`
- 座標系轉換
- 鏡頭畸變
- camera projection
- court line 定義與投影工具

### `frontend/src/utils/cameraScenePose.js`

把 camera extrinsic 轉成 3D 場景裡的 camera marker：

```text
C = -Rᵀt
```

### `scripts/convert_camera_params.py`

把 `cameras/*.npy` 轉成前端可直接 import 的 JSON。

---

## 12. 資料模型

### `Match`

代表一場比賽。

重要欄位：

- `title`
- `fps`
- `duration_frame`
- `cameras`

### `Rally`

代表一段 rally。

重要欄位：

- `rally_index`
- `start_frame`
- `end_frame`
- `status`

### `Hit`

代表一拍擊球。

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

代表某一 frame 的球 3D 座標。

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

## 13. 資料流

```text
原始資料集
  ├─ RallySeg.csv
  ├─ shot_annotated.csv
  ├─ ball_new/*.npy
  └─ ball_final_mask_new/*.npy
        ↓
backend/app/import_12_24_1_new.py
        ↓
PostgreSQL
        ↓
FastAPI
        ↓
frontend/src/api.js
        ↓
Zustand store
        ↓
Scene3D / VideoPanel / TimelinePanel / Projection2DPanel / RightDock
```

Camera projection 資料流：

```text
cameras/Cam_N_intrinsic.npy + Cam_N_extrinsic.npy
        ↓
scripts/convert_camera_params.py
        ↓
frontend/src/assets/camera_params.json
        ↓
cameraProjection.js / cameraScenePose.js
        ↓
VideoPanel overlay / Scene3D camera markers
```

---

## 14. 開發注意事項

### 14.1 不要把 `node_modules` 當成可靠來源

如果 zip 裡附帶 `node_modules`，出現 Vite 權限錯誤時，直接重裝：

```bash
cd frontend
rm -rf node_modules
npm install
npm run dev
```

### 14.2 影片解析度與 camera params

目前影片可能是：

```text
1280 x 800
```

但 camera params 使用的是：

```text
1920 x 1200
```

因為比例相同，前端會等比例縮放。不要直接把 JSON 裡的 `imageWidth/imageHeight` 改成 1280x800，除非同時把 `fx/fy/cx/cy` 等比例縮放。

### 14.3 投影不準時的檢查順序

如果 3D→2D 投影不準，建議依序檢查：

1. `camera_params.json` 是否由正確 `cameras/` 轉出
2. `imageWidth/imageHeight` 是否仍為 1920x1200
3. `coordinateMode` 是否需要測 `raw / scene / flipZ / flipY`
4. `useLensDistortion` 是否應該開或關
5. Cam 編號是否和影片檔案完全對應
6. frame offset 是否需要微調
7. 球軌跡本身是否在 hit 附近已經不可靠

### 14.4 Repair mode 使用限制

不要用普通 repair 跨過 hit frame。擊球瞬間是速度方向突變點，跨 hit 修復會把來球與出球硬接成假軌跡。

建議：

```text
hit 前修 hit 前
hit 後修 hit 後
看不出可靠端點就標 needs_rebuild
```

---

## 15. 後續建議

目前最值得繼續補強的部分：

1. 在 Repair API 前端加防呆：禁止跨 hit frame
2. 修復前加入長度警告與確認視窗
3. 增加 repair history / undo
4. 增加 `is_repaired` / `repair_method` / `confidence` 標記
5. 讓 projection overlay 可切換：只顯示紅點 / 顯示 trail / 顯示 court line
6. 加入 per-camera `projection_frame_offset`
7. 儲存使用者調整過的 `uOffset / vOffset`
8. 若有 2D ball detection，可計算 reprojection error
9. 若有多視角人工 2D 點，可做 triangulation 重建 3D 點

---

## 16. 一句話總結

這份專案目前已經是：

```text
React + FastAPI + PostgreSQL 的多視角羽球 3D 軌跡除錯與標註修正工具
```

其中最新版本的重點是：

```text
相機參數由 .npy 自動轉 JSON，並同時支援影片 3D→2D 投影與 3D 場景 camera marker 位置同步。
```
