# Badminton 3D Debugger MVP

羽球多視角影片、3D 球軌跡、2D 投影、擊球標註、異常檢查與軌跡修復用的研究型除錯工具。

這個專案目前主要目標是把原本分散在 CSV、npy、影片、3D 軌跡、Hit 標註、Anomaly 檢查、Camera Projection 之間的工作，集中到同一個可操作介面。

---

## 1. 目前版本功能總覽

目前版本包含以下功能：

- 3D 羽球場與 3D 球軌跡顯示
- 目前 frame 的球點高亮
- 10 視角影片切換，支援 `0.mp4` ~ `9.mp4`
- 可一次選取多支本機影片，系統會依檔名自動對應 Cam 0 ~ Cam 9
- 影片、3D、Timeline、2D 投影視圖共用同一個 `currentFrame`
- 播放速度支援 `0.125x / 0.25x / 0.5x / 1x / 2x`
- Timeline 拖曳、點擊、平移時會強制暫停，避免影片不同步
- Timeline 固定 playhead，底下時間軸內容滾動
- Rally / Hit / Anomaly / X / Y / Z / Speed 軌道顯示
- Hit 可拖曳修正 frame，放開後自動 PATCH 回 backend
- 右側 Inspector 編輯 Hit 與 Anomaly
- 2D 平面投影輔助視圖：Top / Side / Front
- 影片上的 3D→2D 投影紅點 overlay
- Camera 參數由 `.npy` 轉成 `frontend/src/assets/camera_params.json`
- 3D 場景中的相機 marker 位置由 extrinsic 自動推算
- Repair mode：選取兩個 3D 軌跡點後，用 cubic Hermite spline 修復中間軌跡
- CSV 匯出目前 Hit 標註資料

---

## 2. 技術架構

### Frontend

- React
- Vite
- Zustand
- Tailwind CSS
- Three.js
- `@react-three/fiber`
- `@react-three/drei`
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
- 使用 `scripts/convert_camera_params.py` 將 `.npy` 轉成 JSON
- 前端使用 `frontend/src/assets/camera_params.json`
- `cameraProjection.js` 負責 3D 座標投影到影片畫面
- `cameraScenePose.js` 負責把 extrinsic 反推成 3D 場景中的相機位置與朝向

---

## 3. 專案結構

```text
badminton3D-main/
├─ README.md
├─ docker-compose.yml
├─ package.json
├─ package-lock.json
├─ read_camera.py
│
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
│     ├─ __init__.py
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

---

## 4. 快速啟動

### 4.1 啟動 backend 與 PostgreSQL

在專案根目錄執行：

```bash
docker compose up --build
```

啟動成功後：

```text
Backend:    http://localhost:8000
PostgreSQL: localhost:5432
```

測試 backend：

```text
http://localhost:8000/health
```

正常會看到：

```json
{"ok": true}
```

---

### 4.2 匯入資料集(之後會做個介面方便更換dataset)

第一次啟動或資料庫是空的時候，執行：

```bash
docker compose exec backend python -m app.import_12_24_1_new
```

匯入腳本會建立：

- `Match`
- `Rally`
- `Hit`
- `BallTraj`

目前匯入腳本主要讀取：

```text
backend/app/datasets/12_24_1_new/
backend/app/datasets/ball_new/
backend/app/datasets/ball_final_mask_new/
```

其中 `import_12_24_1_new.py` 內目前設定：

```python
DATA_ROOT = "/app/app/datasets/12_24_1_new"
FPS = 50.0
NYP_FOLDER = "241224_1"
```

如果要換資料集，資料夾結構需要和目前腳本預期的格式一致，或修改這支 importer。


---

### 4.3 啟動 frontend

在另一個 terminal 執行：

```bash
cd frontend
npm install
npm run dev
```

預設網址：

```text
http://localhost:5173
```

如果前端連不到 backend，可以設定：

```bash
VITE_API_BASE=http://localhost:8000
```

或建立 frontend `.env`：

```env
VITE_API_BASE=http://localhost:8000
```

---

## 5. 重要注意：matchId

目前前端預設 match id 寫在：

```text
frontend/src/store.js
```

目前預設值是：

```js
matchId: 2
```

如果你匯入資料後 backend 顯示的 `match_id` 不是 `2`，前端會抓不到資料。這時有兩種做法：

1. 把 `frontend/src/store.js` 的 `matchId` 改成實際匯入得到的 id
2. 重新整理資料庫與匯入流程，讓目標資料對應到目前前端使用的 id

---

## 6. Camera Params 使用方式

目前專案使用 **方法 A：`.npy` 轉 JSON**。

流程如下：

```text
cameras/*.npy
    ↓
scripts/convert_camera_params.py
    ↓
frontend/src/assets/camera_params.json
    ↓
frontend/src/utils/cameraProjection.js
frontend/src/utils/cameraScenePose.js
```

### 6.1 轉換 camera params

在專案根目錄執行：

```bash
python scripts/convert_camera_params.py \
  --input cameras \
  --output frontend/src/assets/camera_params.json \
  --width 1920 \
  --height 1200
```

目前 intrinsic 的 `cx=960, cy=600` 對應的是 `1920 x 1200` 校正座標系，所以轉換時建議使用：

```text
width  = 1920
height = 1200
```

即使實際影片顯示時被縮成其他尺寸，前端 overlay 會依照影片顯示區域自動 scale：

```js
scaleX = videoDisplayWidth / cameraParams.imageWidth
scaleY = videoDisplayHeight / cameraParams.imageHeight
```

---

## 7. 前端功能說明

### 7.1 `App.jsx`

前端主要 layout 與初始資料載入檔案。

負責：

- 載入 match metadata
- 載入 timeline data
- 載入 trajectory data
- 建立 3D / Video / Timeline / 2D / Inspector 的主畫面
- 控制上方區域、底部區域、右側面板寬度
- 預載目前 frame 附近的 trajectory cache

---

### 7.2 `store.js`

Zustand 全域狀態管理中心。

主要狀態：

- `matchId`
- `fps`
- `durationSec`
- `currentTime`
- `currentFrame`
- `playing`
- `playbackRate`
- `selection`
- `rallies`
- `hits`
- `anomalies`
- `trajByFrame`
- `loadedTrajRanges`
- `activeCameraId`
- `sceneCameraTargetId`
- `localVideoSrcMap`
- `bottomView`
- `activeItem`
- `repairMode`
- `selectedTrajFrames`

3D、影片、Timeline、2D 投影、右側 Inspector 都靠這個 store 同步。

---

### 7.3 `VideoPanel.jsx`

影片顯示與同步核心。

支援：

- 選擇 `0.mp4` ~ `9.mp4`
- 檔名自動對應 Cam 0 ~ Cam 9
- 點擊影片播放 / 暫停
- 鍵盤 `0` ~ `9` 快速切換相機
- 播放速度同步到 HTML video
- 使用 `requestVideoFrameCallback` 讓影片播放時更新全域 frame
- Timeline 手動跳轉時，影片立即 seek 到對應 frame
- 3D→2D 投影紅點 overlay

目前 overlay 只畫 **目前 frame 附近的球點紅點**，不畫未來軌跡，避免畫面太亂。

---

### 7.4 `TimelinePanel.jsx`

主要時間軸操作區。

包含軌道：

- Rally
- Hit
- Anomaly
- X(t)
- Y(t)
- Z(t)
- Speed

支援操作：

- 播放 / 暫停
- 上一個 rally / 下一個 rally
- 上一幀 / 下一幀
- 長按上一幀 / 下一幀按鈕連續移動
- 速度切換：`0.125x / 0.25x / 0.5x / 1x / 2x`
- 滾輪 zoom
- 拖曳平移 timeline
- 點擊 rally 選取區段
- 拖曳 hit 修正 frame
- 拖曳 playhead 跳 frame
- 底部水平 scrollbar
- `I` 設定 selection in
- `O` 設定 selection out
- `Esc` 清除 selection / active item
- 左右方向鍵單幀移動，或在選中 rally / hit 時切換與微調

Timeline 的設計重點是：

- playhead 固定在畫面中央
- 拖 timeline 時改變底下 scroll
- 使用者拖曳或點擊 timeline 時會先暫停播放
- 避免播放中 seek 來回觸發造成影片卡頓

---

### 7.5 `Scene3D.jsx`

3D 視覺化主元件。

功能：

- 畫羽球場與球網
- 顯示目前 trajectory
- 顯示目前 frame 的球點
- 顯示相機 marker
- 點選相機 marker 切換影片視角
- 播放時可隱藏相機 marker，降低遮擋
- Repair mode 選取兩個軌跡端點
- 呼叫 backend 修復軌跡

3D 軌跡座標轉換使用：

```js
new THREE.Vector3(p.x, -p.y, -p.z)
```

這個轉換也和 `cameraScenePose.js` 裡的 `rawToScene()` 對齊。

---

### 7.6 `Projection2DPanel.jsx`

2D 平面輔助檢查視圖。

目前提供三個視角：

- Top：俯視平面
- Side：側面高度變化
- Front：正面高度變化

顯示內容：

- 目前 rally 或 selection 範圍內的軌跡
- 目前 frame 附近的點
- hit 位置
- anomaly 區段
- 最近約 `0.8` 秒的尾段軌跡強調顯示

用途：

- 3D 看不清楚時，改用 2D 平面檢查偏移
- 看球路是否突然跳點
- 看高度曲線是否不合理
- 對照 hit / anomaly 是否落在合理位置

---

### 7.7 `RightDock.jsx`

右側編輯面板。

選中 Hit 時可編輯：

- `New Hit Frame`
- 球種
- 手法
- 備註

球種選項包含：

```text
切球、勾球、平球、防守回抽、防守回挑、放小球、長球、後場抽平球、挑球、推球、殺球、過度切球、撲球、擋小球、點扣、發長球、發短球
```

手法選項包含：

```text
正拍、反拍
```

選中 Anomaly 時可更新狀態：

- `fixed`
- `false_positive`
- `needs_rebuild`

---

## 8. Backend API

### `GET /health`

檢查 backend 是否正常。

---

### `GET /matches/{match_id}`

取得 match metadata。

回傳內容包含：

- `id`
- `title`
- `fps`
- `duration_frame`
- `duration_sec`
- `cameras`

---

### `GET /matches/{match_id}/timeline`

取得 Timeline 需要的資料。

包含：

- rallies
- hits
- anomalies

---

### `GET /matches/{match_id}/traj?start={start}&end={end}`

取得指定 frame 範圍內的球軌跡。

每一點包含：

- `frame`
- `t_sec`
- `x`
- `y`
- `z`
- `speed`
- `confidence`

---

### `PATCH /hits/{hit_id}`

更新 Hit。

可更新欄位：

```json
{
  "new_hit_frame": 1234,
  "shot_type": "殺球",
  "hand": "正拍",
  "note": "人工修正"
}
```

---

### `PATCH /anomalies/{anomaly_id}`

更新 Anomaly。

可更新欄位：

```json
{
  "status": "fixed",
  "comment": "已確認",
  "severity": 3,
  "kind": "jump"
}
```

---

### `PATCH /matches/{match_id}/traj/repair`

修復一段 trajectory。

request body：

```json
{
  "start_frame": 100,
  "end_frame": 130
}
```

backend 會使用 cubic Hermite spline interpolation 修復中間點。

注意：不建議讓修復區段跨過擊球瞬間，因為擊球前後速度與方向本來就會突變。

---

### `GET /export/csv?match_id={match_id}`

匯出目前 Hit 標註資料。

輸出檔名格式：

```text
shot_annotated_match_{match_id}.csv
```

---

## 9. 資料庫模型

### `Match`

代表一場比賽。

重要欄位：

- `title`
- `fps`
- `duration_frame`
- `cameras`

---

### `Rally`

代表一段來回球。

重要欄位：

- `match_id`
- `rally_index`
- `start_frame`
- `end_frame`
- `status`

---

### `Hit`

代表一次擊球。

重要欄位：

- `match_id`
- `rally_id`
- `ball_round`
- `player`
- `hit_frame`
- `new_hit_frame`
- `shot_type`
- `hand`
- `note`
- `confidence`

---

### `BallTraj`

代表某一 frame 的球座標。

重要欄位：

- `match_id`
- `frame`
- `t_sec`
- `x`
- `y`
- `z`
- `speed`
- `confidence`

並有索引：

```python
Index("idx_ball_match_frame", BallTraj.match_id, BallTraj.frame)
```

---

### `Anomaly`

代表可疑軌跡區段。

重要欄位：

- `match_id`
- `start_frame`
- `end_frame`
- `kind`
- `severity`
- `status`
- `comment`

---

## 10. 資料匯入流程

目前正式資料匯入是由：

```text
backend/app/import_12_24_1_new.py
```

負責。

主要流程：

1. 掃描 `DATA_ROOT` 下含有 `_set` 且包含 `RallySeg.csv` 的資料夾
2. 讀取每個 set 的 `RallySeg.csv`
3. 建立 `Rally`
4. 依照 `Score` 找到對應 `.npy` 軌跡檔
5. 讀取 `ball_new`
6. 讀取 `ball_final_mask_new`
7. 如果有 `ball_speed`，一起讀取速度
8. 將有效 mask 的球點寫入 `BallTraj`
9. 讀取 `shot_annotated.csv`
10. 建立 `Hit`
11. 建立完整 `Match`

---

## 11. 重設資料庫

如果資料匯入錯誤或想重新開始，可以執行：

```bash
docker compose exec backend python -m app.reset_db
```

這會刪掉目前資料庫內所有 table 並重新建立。

注意：這會清空資料庫，不會只刪某一場 match。

---

## 12. 影片使用方式

1. 啟動 backend
2. 匯入資料
3. 啟動 frontend
4. 打開 `http://localhost:5173`
5. 在影片區上方點選「選擇 0-9.mp4」
6. 一次選取 `0.mp4` ~ `9.mp4`
7. 系統會依檔名自動對應相機
8. 使用上方 Cam 按鈕或鍵盤 `0` ~ `9` 切換視角

檔名必須包含對應數字，例如：

```text
0.mp4
1.mp4
2.mp4
...
9.mp4
```

目前影片是用瀏覽器本機 `blob:` URL 播放，沒有上傳到 backend。

---

## 13. 操作快捷鍵

### 全域 / Timeline

```text
Space              播放 / 暫停
ArrowLeft          上一幀，或微調選中的 hit
ArrowRight         下一幀，或微調選中的 hit
I                  設定 selection in
O                  設定 selection out
Esc                清除 selection / 取消選取
0 ~ 9              切換影片相機
```

### 按鈕操作

```text
Prev rally         跳到上一個 rally
Next rally         跳到下一個 rally
Prev frame         上一幀
Next frame         下一幀
0.125x             八分之一速播放
0.25x              四分之一速播放
0.5x               半速播放
1x                 正常速度
2x                 兩倍速
```

---

## 14. 軌跡修復建議

Repair mode 適合處理短區段、局部錯誤的軌跡。

建議使用情況：

- 單段小範圍漂移
- 中間缺點但前後端點可信
- 只有一小段跳點

不建議使用情況：

- 修復區間跨過擊球 frame
- 前後端點本身也不可信
- 整段 rally 都偏掉
- 2D 投影與影片明顯對不上

遇到不適合修復的情況，建議標記 anomaly 為：

```text
needs_rebuild
```

---

## 15. 目前限制與注意事項

- 前端 `matchId` 目前是寫死在 `frontend/src/store.js`
- 影片選取只是在瀏覽器本機載入，沒有上傳到 backend
- 目前資料集匯入是透過 Python script，不是前端選擇資料夾後自動匯入
- Camera projection 準確度依賴 `.npy` intrinsic / extrinsic 與座標系是否一致
- `camera_params.json` 需要由目前最新 `.npy` 重新轉換，否則前端仍會用舊參數
- `reset_db.py` 會清空所有 table，使用前要確認是否要保留資料
- `node_modules/` 不應該作為專案核心檔案提交
- 如果 Docker 第一次啟動時 backend 連不上 DB，通常等 PostgreSQL ready 後重啟 backend 即可


## 16. 常見問題

### Q1：前端顯示 Backend 連不上？

先確認 backend 是否有啟動：

```text
http://localhost:8000/health
```

如果沒有回應，重新執行：

```bash
docker compose up --build
```

---

### Q2：Backend 正常，但前端沒有資料？

檢查三件事：

1. 是否已匯入資料
2. 匯入後的 `match_id` 是多少
3. `frontend/src/store.js` 的 `matchId` 是否和資料庫一致

---

### Q3：影片有載入，但和 Timeline 不同步？

檢查：

1. 影片 fps 是否和 match fps 一致，目前預設 `50 fps`
2. 檔名是否正確對應 `0.mp4` ~ `9.mp4`
3. `camera.offset_frame` 是否需要補償
4. 是否在播放中手動拖 timeline；目前拖曳會強制暫停以避免不同步

---

### Q4：3D→2D 紅點偏移？

可能原因：

1. intrinsic / extrinsic 和影片不是同一套
2. `camera_params.json` 不是由最新 `.npy` 轉出
3. 影片解析度與校正解析度不同，但 scale 設定不一致
4. 3D 軌跡座標系與 camera world 座標系不一致
5. 球場中心或座標軸方向假設不同

優先檢查：

```bash
python read_camera.py
python scripts/convert_camera_params.py --input cameras --output frontend/src/assets/camera_params.json --width 1920 --height 1200
```

---

### Q5：Repair mode 修復後還是不合理？

Repair 只適合前後端點可信的小範圍補點。若擊球瞬間附近整段都不可信，應標記為 `needs_rebuild`，不要硬用 interpolation 補成假軌跡。

---

## 18. 開發檢查清單

修改程式後建議檢查：

```bash
# backend health
curl http://localhost:8000/health

# frontend build
cd frontend
npm run build
```

如果 `npm run build` 失敗，先檢查 `node_modules` 權限或重新安裝：

```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

---
