# Badminton 3D Debugger

> 品質檢查新版的自動修復與復原僅修改 2D 標註；更新方式與限制請見 [QUALITY_UPDATE.md](QUALITY_UPDATE.md)。

Badminton 3D Debugger 是一套用來檢視、同步與修正羽球比賽資料的網頁工具。系統會把多視角比賽影片、3D 羽球軌跡、Rally／擊球標註，以及人體與球拍重建結果放在同一個操作介面中，方便逐幀比對資料、找出異常並將修正結果保存到資料庫。

## 主要功能

- 同步播放 3D 場景、多視角影片與 Timeline。
- 支援 `0.mp4`～`9.mp4` 共 10 個相機視角，亦可由 3D 場上的相機圖示切換。
- 在影片上顯示 3D 羽球位置投影，協助檢查相機參數與球軌跡是否正確。
- 可在兩個以上相機影片點選同一 frame 的羽球位置，預覽並確認多視角 2D→3D 修復，且可立即復原。
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

## 準備資料集檔案

建立資料集前，先把一場比賽的檔案整理好。網頁會讓你**分類別**各選一個資料夾上傳，所以每一類放在哪個資料夾都可以；但下面標出的資料夾層級（Set 資料夾、`rally*/view*/v3`、比賽名稱資料夾）會被用來配對，必須保留。

### 檔案總覽

以 `241224_1` 這場比賽為例，建議整理成：

```text
241224_1/
├─ cameras/                        # 相機參數（必要）
│  ├─ Cam_0_intrinsic.npy
│  ├─ Cam_0_extrinsic.npy
│  └─ ...
├─ rally/                          # Rally 與擊球標註（必要）
│  ├─ set1/
│  │  ├─ RallySeg.csv
│  │  └─ shot_annotated.csv
│  └─ set2/
│     └─ RallySeg.csv
├─ ball/                           # 3D 球軌跡（選用）
│  ├─ 1_01_00.npy                  # 檔名 = RallySeg 的 Score
│  └─ ...
├─ ball-mask/                      # 球軌跡 Mask（有 ball 就必須有）
│  ├─ 1_01_00.npy
│  └─ ...
├─ ball-2d/                        # 2D 羽球標註（選用）
│  └─ rally1/view0/v3/match17_1_3162_3778_view0_ball.csv
└─ new_racket_npz/                 # 人體與球拍重建（選用）
   ├─ gender.csv
   └─ 241224_1/                    # 資料夾名稱 = 比賽名稱
      ├─ 1_01_00_0.npz
      ├─ 1_01_00_1.npz
      └─ ...

另外準備影片 0.mp4～9.mp4（不上傳，每次開網頁時從本機選取）
```

| 類別 | 是否必要 | 檔名規則 | 用什麼對應 |
| --- | --- | --- | --- |
| 相機參數 | 必要 | `Cam_{n}_intrinsic.npy`、`Cam_{n}_extrinsic.npy` | `n` = 相機編號 = 影片 `n.mp4` |
| Rally 標註 | 必要 | `RallySeg.csv` | 每一列的 `Score` 是整份資料的 rally 鍵值 |
| 擊球標註 | 選用 | `shot_annotated.csv` | 與同一個 Set 資料夾的 `RallySeg.csv` 配對；`Rally` 欄 = `Score` |
| 球軌跡 | 選用 | `{Score}.npy` | 檔名 = `Score` |
| 球軌跡 Mask | 有球軌跡就必要 | `{Score}.npy` | 檔名 = `Score`，與球軌跡同名 |
| 2D 羽球位置 | 選用 | `rally{r}/view{n}/v3/match{m}_{r}_{start}_{end}_view{n}[_calib]_ball.csv` | 檔名中的 `start` 與相機 `n` |
| 人體與球拍 | 選用 | `{Score}_0.npz`、`{Score}_1.npz`（或 `.pth`）、`gender.csv` | 檔名中的 `Score`；上一層資料夾 = 比賽名稱 |

**所有東西都靠 `Score` 串起來**（例如 `1_01_00`）。球軌跡、Mask、擊球標註、人體重建的 Score 只要和 `RallySeg.csv` 對不上，該 rally 的那份資料就會被略過，並在建立畫面顯示提醒。

### Frame 的對應方式

整個系統只有一條全域 Timeline，單位是影片 frame（預設 50 FPS）。各檔案的 frame 欄位意義不同：

| 檔案 | frame 的意思 |
| --- | --- |
| `RallySeg.csv` 的 `Start`／`End` | 影片的全域 frame |
| `shot_annotated.csv` 的 `Hit Frame`／`New Hit Frame` | 影片的全域 frame |
| `ball/`、`ball-mask/` 的第 `i` 列 | 全域 frame `= RallySeg.Start + i` |
| 2D CSV 的 `Frame` | 全域 frame `= 檔名中的 start + Frame` |
| 人體重建 `.npz` 的第 `i` 列 | 全域 frame `= RallySeg.Start + i` |

如果 3D 球和影片看起來差了固定幾格，通常是 `Start` 和 npy 的第 0 列不是同一個時間點。

### 1. 相機參數 `cameras/`

- `Cam_{n}_intrinsic.npy`：內參，9 個數字（3×3 的 K 矩陣，`(3,3)` 或 `(9,)` 都可以）。
- `Cam_{n}_extrinsic.npy`：外參，`(3, 4)` 的 `[R | t]`。
- 每個相機的 intrinsic 和 extrinsic 必須成對。也接受 `cam0_intrinsic.npy`、`0_intrinsic.npy` 這類寫法。
- 相機編號 `n` 必須和影片檔名 `n.mp4`、2D 標註的 `view{n}` 一致。
- 可以用 [read_camera.py](read_camera.py) 印出內容確認（預設讀 `cameras/` 資料夾）。

### 2. Rally 切分 `RallySeg.csv`

```csv
Score,UpCourt,DownCourt,Start,End,Comment,Player
1_01_00,Chi,Wu,3162,3778,0,2
1_01_01,Chi,Wu,4068,4418,0,1
```

| 欄位 | 必要 | 說明 |
| --- | --- | --- |
| `Score` | 必要 | 格式 `{局}_{上半場分數}_{下半場分數}`，記的是**這一球打完後**的比分。系統用它推算每球勝方，並作為整份資料的 rally 鍵值 |
| `Start`／`End` | 必要 | 這一球在影片中的全域起訖 frame |
| `UpCourt`／`DownCourt` | 建議 | 這一球站在上／下半場的選手。雙打把兩人寫在同一格，用 `/`、`&`、`,`、`、` 或 `+` 分隔。系統用它建立選手名單，並判斷單打或雙打 |
| `Comment`、`Player` | 選用 | 備註、發球方，目前只保留不使用 |

- 一局一個 Set 資料夾（`set1/`、`set2/`…），每個資料夾放一份 `RallySeg.csv`。
- 比分必須連續：同一局相鄰兩球只能有一邊 +1，否則會出現「比分和上一球接不起來」的提醒（仍可建立）。
- 中途換邊時，在換邊之後的列把 `UpCourt`／`DownCourt` 對調即可。

### 3. 擊球標註 `shot_annotated.csv`（選用）

放在和 `RallySeg.csv` 同一個 Set 資料夾，系統會自動配對。

```csv
Rally,Ball Round,Start,End,player,Hit Frame,New Hit Frame,Shot Type,Hand,Note,Diff
1_01_00,1,3162,3778,Down,3204,3200,切球,正拍,,None
1_01_00,2,3162,3778,Up,3295,,,,,91
```

| 欄位 | 說明 |
| --- | --- |
| `Rally` | 對應 `RallySeg.csv` 的 `Score` |
| `Ball Round` | 這一球的第幾拍 |
| `player` | `Up` 或 `Down`，擊球者在哪個半場 |
| `Hit Frame` | 擊球的全域 frame |
| `New Hit Frame` | 人工修正後的擊球 frame，可留空 |
| `Shot Type`、`Hand`、`Note` | 球種、正反拍、備註，可留空 |

`Start`、`End`、`Diff` 欄位不會被讀取。沒有這個檔案時，該 Set 一樣可以匯入，只是沒有擊球線。

### 4. 3D 球軌跡 `ball/` 與 `ball-mask/`（選用）

- 一個 rally 一組檔案，檔名都是 `{Score}.npy`。
- `ball/{Score}.npy`：`(N, 3)` 的 float，每列是一個 frame 的球心 3D 座標。
- `ball-mask/{Score}.npy`：`(N,)`，`1` 代表這一列有效，`0` 代表沒有球。
- 兩者長度必須相同。**只有 ball 沒有 mask 的 rally 不會匯入軌跡。**
- 第 `i` 列對應全域 frame `Start + i`；mask 為 0 的列不會寫入資料庫。

可以用下面的「[從 fine-tune JSON 轉檔](#從-fine-tune-json-轉檔)」產生。

### 5. 2D 羽球位置（選用）

- 路徑必須是 `rally{r}/view{n}/v3/` 底下，檔名 `match{m}_{r}_{start}_{end}_view{n}[_calib]_ball.csv`。資料夾的 `r`、`n` 必須和檔名一致。
- 內容欄位：`Frame,Visibility,X,Y`。`Frame` 從 0 開始，全域 frame = 檔名的 `start` + `Frame`；`Visibility` 為 1 才顯示；`X`、`Y` 是影片像素座標。
- 品質檢查與多視角 2D→3D 修復都需要這份資料。

### 6. 人體與球拍重建 `new_racket_npz/`（選用）

- 每個 rally 兩個檔案：`{Score}_0.npz`（或 `.pth`）與 `{Score}_1.npz`，分別是兩位球員；缺任一個會提醒。`.pth` 會在上傳時由後端轉成 `.npz`。
- 檔案的上一層資料夾名稱就是比賽名稱（例如 `new_racket_npz/241224_1/`）。一次上傳多場比賽時，建立畫面會讓你選要用哪一場。
- `.npz` 內容：`data/body_pose (N,72)`、`data/beta (1,10)`、`data/trans (N,3)`、`data/racket_pose (N,3)`、`data/mask (N,)`，以及選用的 `racket_transform (N,4,4)`、`racket_frame_offset (N,3)`。少了後兩個時，前端會自己估算球拍位置，看起來可能和手脫節。
- `gender.csv`（選用）指定每場比賽要用的 SMPL 體型：

  ```csv
  comp_name,gender
  241224_1,female
  ```

  `gender` 可填 `male`、`female`、`neutral`。沒上傳時使用後端內建的 [reconstruction_gender.csv](backend/app/reconstruction_gender.csv)；上傳的優先。

### 7. 多視角影片

- 檔名 `0.mp4`～`9.mp4`，編號與相機參數一致，不必十支都有。
- 影片**不會上傳到後端**，每次重新整理網頁都要在影片區重新選取。影片的第 0 幀應對應全域 frame 0；若有時間差，在建立資料集時用各相機的 `offset_frame` 校正。

## 從 JSON 轉檔

模型的輸出是「每個 frame 一個 JSON」，不能直接上傳。請用 [backend/tools/convert_finetune_json.py](backend/tools/convert_finetune_json.py) 轉成上傳格式。每個輸出檔案的計算方式詳見 [backend/tools/CONVERT_FINETUNE_JSON.md](backend/tools/CONVERT_FINETUNE_JSON.md)。

### 轉檔會產生什麼、不會產生什麼

| 產生 | 不產生（要從該場比賽既有資料拿） |
| --- | --- |
| `ball/{Score}.npy` | `cameras/` 相機參數 |
| `ball-mask/{Score}.npy` | `RallySeg.csv`（JSON 裡沒有影片的全域 frame 和選手名字） |
| `new_racket_npz/{match_id}/{Score}_{0,1}.npz`（含 `racket_transform`） | `shot_annotated.csv`（人工標註） |
| `IMPORT_INSTRUCTIONS.txt` | 2D 羽球標註、`gender.csv`、影片 |

### 1. 資料準備

資料來源在 server `140.113.241.176` 上（需要該 server 的帳號）：

```text
/train-data-3-hdd/clchen/0807_finetune150_3_18000_all.tar.zst
```

解壓縮後，每場比賽的資料夾在**兩層同名資料夾**底下：

```text
0807_finetune150_3_18000_all/
  0807_finetune150_3_18000_all/
    241217_1/
    241224_1/                # 一場比賽
      1_00_01/               # rally id（= Score）
        000/two_groups/
          frame_000063.json
          ...
        001/two_groups/
          frame_000162.json
      1_01_02/
      ...
  log/                       # 預測時的紀錄，轉檔用不到
```

每個 JSON 會用到 `rally_id`、`frame_num`、`match_id`、`ball_3d`、`smpl_pose`（每人 75 維 = 72 body + 3 racket）、`smpl_beta`、`smpl_trans`。`frame_num` 是 rally 內的編號，會直接當成 npy 的列號，所以它的 0 必須對應到 `RallySeg.csv` 的 `Start`。

### 2. 準備 `badminton_dataset` 與 Python 環境

- Python（以 3.10 測試過），安裝 `numpy`、`torch`、`chumpy`；`ujson` 選用，可加快讀取。`chumpy` 是讀取 SMPL `.pkl` 必需的，缺少時會出現 `No module named 'chumpy'`。

  ```bash
  pip install numpy torch chumpy
  ```

- 一份 `badminton_dataset`。底下要有：
  - `submodules/smplx`：支援 `racket_pose` 的 SMPL 修改版
  - `body_models/human_model_files/smpl/SMPL_*.pkl`：SMPL 模型檔
  
  轉檔用它計算球拍跟著手腕的位置；找不到時，程式會在讀 JSON 之前就報錯。

### 3. 擺放資料夾

腳本使用相對路徑，把三個資料夾放在同一層最省事：

```text
<工作資料夾>/
├─ badminton3D/                     # 本專案
├─ badminton_dataset/               # SMPL 修改版與模型檔
└─ 0807_finetune150_3_18000_all/    # 第 1 步解壓的資料
```

`--dataset-root` 預設就是 `badminton3D` 旁邊的 `badminton_dataset`。放在別處時，再用 `--dataset-root` 指定路徑。

### 4. 執行轉檔

在 `<工作資料夾>` 執行（PowerShell），一次轉一場比賽：

```powershell
python badminton3D\backend\tools\convert_finetune_json.py `
  "0807_finetune150_3_18000_all\0807_finetune150_3_18000_all\241224_1" `
  "converted\241224_1_legacy_upload" `
  --fps 50
```

| 參數 | 說明 |
| --- | --- |
| 第 1 個 | 一場比賽的 JSON 資料夾，相對於目前所在的資料夾 |
| 第 2 個 | 輸出資料夾，**必須不存在**，相對於目前所在的資料夾 |
| `--fps` | 影片 FPS，預設 50 |
| `--dataset-root` | `badminton_dataset` 的路徑，預設為 `badminton3D` 旁邊的 `badminton_dataset` |
| `--gender` | 計算球拍位置用的 SMPL 體型：`male`、`female`、`neutral`（預設） |

執行時會每 500 個 JSON 印一次進度；結束時若有缺球或缺人體的 frame，會印出數量提醒。

### 5. 轉完之後上傳

1. 把該場比賽既有的 `RallySeg.csv`（和 `shot_annotated.csv`，如果有）依 Set 資料夾放進輸出資料夾，例如 `rally/set1/RallySeg.csv`，並確認 `Score` 和 `ball/` 的檔名對得上。
2. 準備該場的 `cameras/`，以及需要的 2D 標註、`gender.csv`。
3. 依「[建立步驟](#建立步驟)」上傳，類別對應如下：

| 輸出資料夾 | 上傳到的類別 |
| --- | --- |
| `ball/` | 球軌跡 |
| `ball-mask/` | 球軌跡 Mask |
| `new_racket_npz/`（連同 `gender.csv`） | 人體與球拍重建 |
| `rally/` | Rally 與擊球標註 |
| `cameras/` | 相機參數 |

## 第一次使用：建立資料集

進入網頁後，點選上方的「建立新資料集」。系統會建立暫存上傳工作階段，接著依畫面分類別選擇資料夾。各類檔案的格式請見上一節「[準備資料集檔案](#準備資料集檔案)」。

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

### 10. 從多視角 2D 影片修復單一 3D 點

這個模式只修正目前單一 frame，不會平滑或跨越 Hit frame。

1. 將 Timeline 移到需要修正的 frame。
2. 在右上影片區開啟「2D 修復」，系統會自動暫停播放。
3. 在目前相機影片中點選真實羽球位置；紫色點代表手動選取位置。
4. 切換到另一個具有 camera params 的相機，點選同一 frame 的羽球；至少需要兩個不同相機。
5. 按「預覽 3D」。系統會先進行鏡頭反畸變與多視角 triangulation，顯示綠色預覽投影、3D 座標及重投影誤差，此時不會修改資料庫。
6. 確認各視角的綠色預覽點位置後，按「確認寫入」。
7. 若結果不正確，可立即按「復原此次修復」，系統會還原原本 3D 點與各相機原本的 2D 標註。

RMS 或最大重投影誤差過大時，應重新點選，或改用視角差異較大的相機。確認後的修復只會更新資料庫，不會修改原始上傳檔案。

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

系統只接受指定檔名與副檔名。請確認瀏覽器選擇的是資料夾，且檔名符合本 README 的「[準備資料集檔案](#準備資料集檔案)」。不要先把資料夾壓縮成 ZIP 再選取。

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
│  ├─ tools/convert_finetune_json.py # fine-tune JSON → 上傳格式轉檔
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
