# Badminton 3D Debugger

Badminton 3D Debugger 是一套用來檢視、同步與修正羽球比賽資料的網頁工具。系統會把多視角比賽影片、3D 羽球軌跡、Rally／擊球標註，以及人體與球拍重建結果放在同一個操作介面中，方便逐幀比對資料、找出異常並將修正結果保存到資料庫。

## 主要功能

- 同步播放 3D 場景、多視角影片與 Timeline。
- 支援 `0.mp4`～`9.mp4` 共 10 個相機視角，亦可由 3D 場上的相機圖示切換。
- 在影片上顯示 3D 羽球位置投影，協助檢查相機參數與球軌跡是否正確。
- 顯示 Rally、X／Y／Z 軌跡曲線、擊球位置與異常區段。
- 支援逐幀移動、Rally 切換、範圍選取與 `0.125x`～`2x` 倍速播放。
- 編輯擊球 frame、球種、正反拍與備註。
- 將異常標記為已修復、誤判或需要重建。
- 在 3D 場景選取異常區段的兩個端點，自動插值修復球軌跡。
- 顯示人體與球拍重建結果，並依 Rally 播放。
- 從前端選擇資料夾建立資料集，不必手動將檔案複製進容器。
- 切換、刪除既有資料集，或將目前資料匯出為 CSV。

## 系統畫面

介面分成四個主要區域：

| 區域 | 用途 |
| --- | --- |
| 左上 3D 場景 | 顯示球場、球軌跡、相機位置、人物與球拍；亦可執行軌跡修復 |
| 右上影片 | 載入並切換 0～9 號影片，顯示 3D 球點的 2D 投影 |
| 下方 Timeline／2D | 查看 Rally、三軸軌跡與異常；也可切換到 2D 軌跡檢視 |
| 右側編輯面板 | 編輯擊球標註或更新異常狀態；點擊 Timeline 項目後才會出現 |

各區域之間的分隔線可以拖曳，因此可依工作需要調整 3D、影片、Timeline 與右側面板的大小。

## 技術架構

- 前端：React、Vite、Zustand、Three.js、React Three Fiber、Tailwind CSS
- 後端：FastAPI、SQLAlchemy、NumPy、Pandas、PyTorch CPU
- 資料庫：PostgreSQL 16
- 執行環境：Docker Compose（後端與資料庫）＋ Node.js（前端）

## 啟動方式

### 1. 環境需求

請先安裝：

- [Git](https://git-scm.com/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js](https://nodejs.org/) 18 以上版本，建議使用 Node.js 20 LTS

Windows 使用者請先啟動 Docker Desktop，再執行下列指令。

### 2. 下載專案

```bash
git clone https://github.com/henry920816/badminton3D.git
cd badminton3D
```

### 3. 啟動資料庫與後端

在專案根目錄執行：

```bash
docker compose up --build -d
```

確認服務狀態：

```bash
docker compose ps
```

後端健康檢查：<http://localhost:8000/health>

若看到以下內容，代表後端已啟動：

```json
{"ok": true}
```

FastAPI API 文件：<http://localhost:8000/docs>

第一次建置後端時需要下載 CPU 版 PyTorch，因此等待時間可能較長。

### 4. 啟動前端

開啟另一個終端機：

```bash
cd badminton3D/frontend
npm install
npm run dev
```

瀏覽器開啟：<http://localhost:5173>

如果前端與後端不是在同一台電腦，可建立 `frontend/.env`：

```env
VITE_API_BASE=http://後端IP:8000
```

修改後請重新啟動 `npm run dev`，並同步調整 `docker-compose.yml` 中的 `CORS_ORIGINS`。

### 5. 關閉系統

前端終端機按 `Ctrl + C`，再於專案根目錄執行：

```bash
docker compose down
```

一般關閉不會刪除 PostgreSQL 或已上傳的資料。若執行 `docker compose down -v`，所有 Docker volumes 與其中的資料都會被刪除，請勿在需要保留資料時使用。

## 第一次使用：建立資料集

進入網頁後，點選上方的「建立新資料集」。系統會建立暫存上傳工作階段，接著依畫面選擇各類資料夾。

### 資料類型與檔案需求

| 類型 | 是否必要 | 接受的檔案 | 說明 |
| --- | --- | --- | --- |
| 相機參數 | 必要 | `Cam_*_intrinsic.npy`、`Cam_*_extrinsic.npy` | 每個相機的內參與外參必須成對 |
| Rally 與擊球標註 | 必要 | `RallySeg.csv`、`shot_annotated.csv` | 系統會依相同 Set 資料夾自動配對 |
| 球軌跡 | 選用 | `.npy` | 未提供時仍可建立資料集，但不會顯示 3D 球軌跡 |
| 球軌跡 Mask | 選用 | `.npy` | 依檔名與球軌跡配對；缺少時不會匯入對應軌跡 |
| 2D 羽球位置 | 選用 | `match{n}_{rally}_{start}_{end}_view{camera}[_calib]_ball.csv` | 讀取 `rally*/view*/v3` 下的 `Frame,Visibility,X,Y`，顯示於對應視角影片 |
| 人體與球拍重建 | 選用 | `.pth`、`.npz`、`gender.csv` | `.pth` 會在建立資料集時由後端轉為 NPZ |

相機檔名可使用 `Cam_0_intrinsic.npy`、`Cam_0_extrinsic.npy` 這類格式。Rally 資料應保留原本的 Set 資料夾層級，讓同一組 `RallySeg.csv` 與 `shot_annotated.csv` 能被正確配對。

人體與球拍資料可選擇單一比賽資料夾，或選擇包含 `new_racket` 與 `gender.csv` 的最外層資料夾。重建檔案使用 `{Score}_0.pth` 與 `{Score}_1.pth` 命名，分別對應兩位球員。

### 建立步驟

1. 點選「建立新資料集」。
2. 輸入資料集名稱與 FPS；預設 FPS 為 50。
3. 依序選擇相機參數、Rally 標註、球軌跡、Mask、2D 羽球位置，以及人體／球拍資料夾。
4. 確認系統顯示的檔案數量、配對結果、錯誤與提醒。
5. 視資料格式設定影像寬高、座標模式、鏡頭畸變及球場座標微調。
6. 若上傳多個人體重建比賽資料夾，選擇目前資料集要使用的比賽。
7. 必要資料顯示準備完成後，點選「建立資料集」。
8. 建立完成後系統會自動切換至新資料集並載入 Timeline 與 3D 軌跡。

大檔案會自動分批上傳。請在「資料集建立完成」前保持頁面開啟，並避免讓電腦進入睡眠。

### 座標與相機設定

- 原始座標：保留輸入資料的座標定義。
- 3D 場景座標：使用系統場景的座標定義顯示。
- 使用鏡頭畸變參數：投影時套用相機畸變係數；若原始影片已去畸變，應關閉此選項。
- 球場座標微調：可設定 X／Z 位移、旋轉、縮放與 Y 高度，用來對齊資料軌跡與 3D 球場。
- 各相機可另外設定影片 FPS 與 `offset_frame`，用來校正影片和全域 Timeline 的時間差。

## 操作說明

### 1. 載入多視角影片

影片不會存入後端資料庫，重新整理頁面後需要再次選取：

1. 在右上影片區點選「選擇 0-9.mp4」。
2. 一次多選 `0.mp4`～`9.mp4`；不必十支全部提供。
3. 點選影片上方的數字按鈕切換視角。
4. 也可以點擊 3D 球場中的 📷 相機圖示切換對應影片。
5. 鍵盤數字鍵 `0`～`9` 亦可快速切換相機。

檔名必須保留相機編號，例如 `0.mp4`、`1.mp4`。若檔名無法辨識，影片不會自動配對到正確視角。

### 2. 播放與 Timeline

中央控制列由左到右提供：上一個 Rally、下一個 Rally、上一幀、回到選取起點、播放／暫停、下一幀，以及倍速選擇。

可用倍速：`0.125x`、`0.25x`、`0.5x`、`1x`、`2x`。

Timeline 操作：

- 點擊時間位置：跳到該時間。
- 拖曳藍色播放線：快速定位，拖曳時會暫停播放。
- 拖曳空白區域：左右平移 Timeline。
- 滾動滑鼠滾輪：縮放時間尺度。
- 點擊 Rally：選取完整 Rally 並跳至開始位置。
- 拖曳 Hit 線：修改擊球 frame；放開後會寫入後端。
- 在空白處按住 `Shift` 拖曳：建立 In／Out 選取範圍。
- 在 Timeline 按右鍵或按 `Esc`：取消目前選取。

當播放位置接近可視範圍邊緣時，Timeline 會自動跟隨捲動。

### 3. 快捷鍵

| 快捷鍵 | 功能 |
| --- | --- |
| `Space` | 播放／暫停 |
| `←`／`→` | 一般狀態下逐幀移動 |
| `←`／`→` | 選取 Rally 時切換上一個／下一個 Rally |
| `←`／`→` | 選取 Hit 時將擊球位置前移／後移一幀 |
| `I` | 將目前時間設為選取範圍起點 |
| `O` | 將目前時間設為選取範圍終點 |
| `Esc` | 清除範圍與目前選取項目 |
| `0`～`9` | 切換對應相機影片 |

輸入文字或編輯備註時，快捷鍵不會觸發。

### 4. 3D 場景

- 左鍵拖曳：旋轉視角。
- 右鍵拖曳：平移視角。
- 滑鼠滾輪：以游標位置為中心縮放。
- 點擊場上的 📷：切換影片相機。
- 「人物球拍 開／關」：顯示或隱藏目前 Rally 的人體與球拍重建。
- 人物球拍控制列的 `◀`／`▶`：切換上一個或下一個 Rally 重播。

若已選取 Timeline 範圍，3D 軌跡只會使用該範圍；未選取時則顯示目前 Rally 的軌跡。

### 5. 影片上的 3D→2D 投影

載入影片並選到具有相機內外參的視角後，點選右上角「3D→2D」即可顯示或隱藏投影點。投影會跟隨目前 frame 與影片同步更新。

若按鈕無法使用，請確認：

- 此相機的 intrinsic 與 extrinsic 檔案已成功匯入。
- 選取的影片編號與相機編號相同。
- 影像寬高、座標模式與鏡頭畸變設定符合原始資料。
- 相機 FPS 與 `offset_frame` 設定正確。

若建立資料集時有上傳 2D 羽球位置，Video Panel 會另外提供「2D 標註」開關。青色點代表 CSV 中目前精確 frame 的可見座標；`Visibility=0` 不顯示且不會自動插值。2D 標註可與紅色 3D 投影同時開啟，以便比較兩者誤差。

### 6. Timeline 與 2D 檢視切換

下方左側可以在 `TIMELINE` 與 `2D` 之間切換。

- `TIMELINE`：查看 Rally、X／Y／Z 曲線、Hit 線及異常區段。
- `2D`：從 2D 角度查看目前 Rally 或選取範圍的球軌跡，並可使用上一個／下一個 Rally 操作。

### 7. 編輯擊球標註

1. 在 Timeline 點選一條 Hit 線。
2. 右側編輯面板會顯示原始 `Hit Frame` 與 `New Hit Frame`。
3. 可直接輸入新 frame，或先移動到正確畫面後按「Mark Current Frame」。
4. 「Jump to Hit Frame」可跳至目前設定的擊球位置。
5. 選擇球種、正拍／反拍並填寫備註。
6. 按下儲存，將修改寫入資料庫。

可標註的球種包含殺球、長球、挑球、放小球、切球、平球、發長球、發短球等。

### 8. 處理異常區段

在 Timeline 點選異常區段後，可在右側查看異常類型、嚴重程度與 frame 範圍，並更新為：

- 已修復
- 誤判
- 需要重建

### 9. 修復 3D 球軌跡

此功能會修改資料庫內指定範圍的軌跡值，不會修改原始上傳檔案。

1. 在左上 3D 場景開啟 `Repair mode`。
2. 點選異常區段頭尾的兩個 3D 軌跡點。
3. 確認顯示的兩個 frame。
4. 點選「執行修復」。
5. 後端會在兩個端點之間進行插值，完成後重新載入該段軌跡。

端點應選在異常資料的前後兩側，而且兩端本身必須是可信的正確位置。若選錯，可按「清除」重新選取。

## 資料集管理

### 切換資料集

點選上方「切換資料集」，選擇目標資料集後確認。切換時會停止播放、清除目前選取與軌跡快取，再載入新資料。

### 刪除資料集

點選「刪除資料集」，選擇資料集並再次確認。刪除會一併移除：

- Match、Rally、Hit、Anomaly 與球軌跡資料庫紀錄。
- 該資料集上傳後產生的人體／球拍等資產。

此操作無法復原，刪除前請先確認資料集名稱與 ID。

### 匯出 CSV

目前有載入資料集時，可點選上方 `Export CSV`。匯出內容包含目前資料庫中的軌跡及已儲存的修正結果。

## 資料保存位置

Docker Compose 使用三個 volumes：

| Volume | 內容 |
| --- | --- |
| `badminton_pgdata` | PostgreSQL 資料庫 |
| `badminton_dataset_assets` | 建立完成的資料集資產 |
| `badminton_upload_sessions` | 尚未完成的暫存上傳資料 |

因此重新 build 或重新建立 container 通常不會清除資料。若要完整重置開發環境，才使用：

```bash
docker compose down -v
docker compose up --build -d
```

注意：以上指令會永久刪除所有已建立資料集。

## 常見問題

### `port is already allocated` 或連接埠被占用

本專案預設使用：

- 前端：5173
- 後端：8000
- PostgreSQL：5432

先找出占用程式並關閉，或修改 `docker-compose.yml` 左側的主機連接埠。例如將 PostgreSQL 改成 `5433:5432` 不會影響容器內後端連線。

### 後端顯示資料庫尚未就緒

目前 Compose 已設定 PostgreSQL healthcheck，請使用：

```bash
docker compose up --build -d
docker compose logs -f db backend
```

待資料庫顯示 healthy 後，後端才會啟動。

### 網頁開啟但沒有資料

先確認已建立或切換資料集，再檢查：

```bash
docker compose ps
docker compose logs --tail=200 backend
```

也可直接開啟 <http://localhost:8000/health> 測試後端連線。

### 選擇資料夾後顯示沒有可上傳檔案

系統只接受指定檔名與副檔名。請確認瀏覽器選擇的是資料夾，且檔名符合本 README 的「資料類型與檔案需求」。不要先把資料夾壓縮成 ZIP 再選取。

### 影片沒有出現或視角對不上

請將影片命名為 `0.mp4`～`9.mp4`，並一次多選。相機按鈕存在不代表影片已上傳；影片是由瀏覽器本機載入，每次重新整理後都必須重新選擇。

### 3D→2D 紅點偏移

依序檢查：

1. intrinsic／extrinsic 是否屬於目前影片相機。
2. 影像寬高是否符合校正時使用的解析度。
3. 原影片是否已經去畸變，以及「使用鏡頭畸變參數」是否設定正確。
4. 原始座標與 3D 場景座標是否選對。
5. 球場座標微調是否造成額外位移、旋轉或縮放。
6. 影片 FPS 與 `offset_frame` 是否正確。

### 修改程式後畫面沒有更新

前端由 Vite 自動更新；若沒有生效，可停止後重新執行 `npm run dev`。後端程式透過 volume 掛載，但目前 Uvicorn 沒有使用 `--reload`，修改 Python 後請執行：

```bash
docker compose restart backend
```

若修改了 `requirements.txt` 或 `Dockerfile`，請重新建置：

```bash
docker compose up --build -d backend
```

## 專案目錄

```text
badminton3D/
├─ backend/
│  ├─ app/
│  │  ├─ main.py                 # FastAPI API、標註與軌跡操作
│  │  ├─ dataset_upload.py       # 分批上傳、檢查、匯入與資料集管理
│  │  ├─ models.py               # SQLAlchemy 資料表模型
│  │  └─ reconstruction_assets.py# 人體／球拍重建資產處理
│  ├─ Dockerfile
│  └─ requirements.txt
├─ frontend/
│  ├─ public/models/             # 球拍、羽球與 SMPL 顯示資產
│  └─ src/
│     ├─ components/             # 3D、影片、Timeline、2D 與資料集 UI
│     ├─ utils/                  # 相機投影與座標計算
│     ├─ api.js                  # 前端 API 封裝
│     └─ store.js                # 全域播放及介面狀態
├─ scripts/                      # 相機及 SMPL 資產轉換工具
└─ docker-compose.yml
```

## 開發用指令

前端檢查正式版建置：

```bash
cd frontend
npm run build
```

查看後端紀錄：

```bash
docker compose logs -f backend
```

查看資料庫紀錄：

```bash
docker compose logs -f db
```

重新啟動後端：

```bash
docker compose restart backend
```

