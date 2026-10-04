# convert_finetune_json.py 的資料是怎麼算出來的

這份文件說明 `convert_finetune_json.py` 把 fine-tune 的 per-frame JSON 匯出轉成
legacy dataset uploader 格式時，每一個輸出檔案分別是從哪裡來、用什麼規則算出來的。

**這個工具只產生球的軌跡與 SMPL/球拍姿態。** 相機參數（`cameras/`）與 rally 切分
（`rally-data/RallySeg.csv`）**刻意不產生**——那兩樣直接沿用該場比賽既有的資料
即可，由 JSON 反推反而會失真（`RallySeg` 的 `Start`/`End` 尤其如此，見第 5 節）。

---

## 1. 輸入長什麼樣子

資料來源是實驗室 server `140.113.241.176` 上的
`/train-data-3-hdd/clchen/0807_finetune150_3_18000_all.tar.zst`，下載與解壓方式見專案
README 的「從 fine-tune JSON 轉檔」。

來源目錄是「一場比賽」的資料夾，例如
`0807_finetune150_3_18000_all/0807_finetune150_3_18000_all/241224_1/`：

```
241224_1/
  1_00_01/                 <- rally id
    000/two_groups/        <- segment（同一個 rally 被切成多段預測）
      frame_000063.json
      ...
    001/two_groups/
      frame_000162.json
      ...
  1_01_02/
  ...
```

程式用 `source.rglob("frame_*.json")` 一次抓完所有 JSON，**不理會中間的
`<segment>/two_groups/` 層級**——因為 `frame_num` 在同一個 rally 內是連續的
（segment 000 是 63–161、segment 001 接著 162–214），所以各段自然接得起來。
分組的依據只有 JSON 內容裡的 `rally_id` 與 `frame_num`。

每個 `frame_*.json` 之中，這個工具實際會用到的欄位：

| 欄位 | 用途 |
| --- | --- |
| `match_id` / `rally_id` / `frame_num` | 分組與索引 |
| `ball_3d` | 3 維球位置（長度 3，可能不存在） |
| `smpl_pose` | 每人 75 維 = 前 72 維 body pose + 後 3 維 racket pose |
| `smpl_beta` | 每人 10 維體型 |
| `smpl_trans` | 每人 3 維世界座標位移 |

`cam_ids` / `intrinsics` / `extrinsics` / `image_hw` 會被讀進來但**不使用**，因為
不產生 `cameras/`。

**重點：`frame_num` 是 rally 內的區域編號，不是影片的全域 frame。**

---

## 2. 輸出結構

```
<destination>/
  ball/<rally_id>.npy
  ball-mask/<rally_id>.npy
  new_racket_npz/<match_id>/<rally_id>_<person_index>.npz
  IMPORT_INSTRUCTIONS.txt
```

---

## 3. 執行指令

三個資料夾放在同一層：

```text
<工作資料夾>/
  badminton3D/                     <- 本專案
  badminton_dataset/               <- 提供 submodules/smplx 與 SMPL 模型
  0807_finetune150_3_18000_all/    <- 從 server 下載解壓的 fine-tune 匯出
```

在 `<工作資料夾>` 執行：

```powershell
python badminton3D\backend\tools\convert_finetune_json.py `
  "0807_finetune150_3_18000_all\0807_finetune150_3_18000_all\250108_5" `
  "converted\250108_5_legacy_upload" `
  --fps 50
```

- 來源與輸出路徑都是相對於目前所在的資料夾。
- 輸出資料夾**必須不存在**，否則直接 `FileExistsError`。
- `--dataset-root` 預設是 `badminton3D` 旁邊的 `badminton_dataset`（相對於這支
  腳本的位置計算）；放在別處時再用 `--dataset-root` 指定。
- 該目錄底下必須有 `submodules/smplx` 與
  `body_models/human_model_files/smpl`；程式在讀 JSON **之前**就會先檢查並載入
  SMPL 模型，路徑錯的話會立刻報錯，不會白跑幾萬個檔案。
- 需要能 `import torch` 與 `import chumpy` 的環境（SMPL `.pkl` 要靠 chumpy 才讀得進來）。

---

## 4. 各檔案的計算方式

### ball/ 與 ball-mask/

一個 rally 一組檔案。長度定義為：

```
length = 該 rally 最大的 frame_num + 1
```

也就是**保留 JSON 的區域 frame 編號當作陣列 index**。如果 rally 的第一個 frame 是
57，那 0–56 就是全零的前導空白，這樣 index 才跟 `frame_num` 對得起來。

- `ball/<rally>.npy`：`(length, 3) float32`，第 `frame_num` 列填 `ball_3d`。
- `ball-mask/<rally>.npy`：`(length,) uint8`，有球的 frame 填 1，其餘 0。

`ball_3d` 缺漏或長度不是 3 的 frame，兩邊都留 0（mask=0）。

### new_racket_npz/

一個 rally、一個人一個 `.npz`，檔名 `<rally_id>_<person_index>.npz`，放在
`new_racket_npz/<match_id>/` 底下。人數取該 rally 中「單一 frame 出現過的最多
人數」。內容：

| key | shape | 來源 |
| --- | --- | --- |
| `data/body_pose` | `(L, 72)` | `smpl_pose[:72]` |
| `data/racket_pose` | `(L, 3)` | `smpl_pose[72:75]` |
| `data/trans` | `(L, 3)` | `smpl_trans` |
| `data/beta` | `(1, 10)` | 該人在有偵測到的 frame 上的 `smpl_beta` **平均值** |
| `data/mask` | `(L,)` | 該人有被偵測到的 frame 為 1 |
| `racket_transform` | `(L, 4, 4)` | SMPL FK，見下 |
| `racket_frame_offset` | `(L, 3)` | SMPL FK，見下 |
| `__metadata_json__` | — | 轉檔來源、rally/match id、frame 數等紀錄 |

`beta` 取平均是因為 JSON 每個 frame 都重新估一次體型，但 npz 格式只放一組
`(1,10)`；同一個人在一個 rally 內體型幾乎不變，取平均即可。

`racket_transform` / `racket_frame_offset` 的做法是重現
`badminton_dataset/recover_racket_pose.py`：用該專案 `submodules/smplx` 那份改過的
SMPL（把 `racket_pose` 當成掛在手腕上的第 25 個關節）做 forward kinematics，取
`A[:, -1]` 當球拍的全域轉換矩陣；`racket_frame_offset` 則是標準姿勢下的手腕位置。

這兩個陣列就是一定要找得到 `badminton_dataset` 的原因：少了它們，前端只能用自己的
client-side FK 估算，球拍會跟手脫節。

> 注意：原始腳本算標準手腕位置時寫的是 `smpl_model.forward(beta=beta)`，但
> `beta`（單數）不是 `forward()` 真正的參數名，會被 `**kwargs` 吃掉，實際用的是
> 模型預設的零體型。這個「bug」**刻意照抄**，因為真實比賽的 npz 就是這樣產的，
> 不照抄反而對不上。

---

## 5. 為什麼不產生 cameras 與 RallySeg

### cameras/

相機參數在整場比賽是固定的，既有資料已經有了，沒必要從 JSON 再導一次。

### rally-data/RallySeg.csv

參考格式（`rally/set1/RallySeg.csv`）是：

```
Score,UpCourt,DownCourt,Start,End,Comment,Player
1_01_00,Chi,Wu,3162,3778,0,2
```

其中只有 `Score`（等於 `rally_id`）能從 JSON 直接拿到，其餘都有問題：

- **`Start` / `End` 還原不了。** 參考檔是**影片的真實 frame**，rally 之間有空檔
  （換邊、撿球、暫停）。JSON 只有 rally 內的 `frame_num`，那些空檔長度沒有任何
  地方記錄。硬產只能產出「rally 首尾相接」的假時間軸，長度對、絕對位置全錯。
- **`UpCourt` / `DownCourt`** 球員姓名在 JSON 裡完全不存在。
- **`Player`**（發球方）沒有標記，只能用「第一顆被追到的球最靠近誰、那個人在
  z 軸哪一側」去猜。實測 241224_1 對 58 個 rally 猜對 57 個，但仍是猜的。
- **`Comment`** 參考檔整份都是 0。

所以這一整塊改成沿用既有資料，不再由本工具產生。

---

## 6. 其他沒有產生的東西

- **`shot_annotated.csv`**（拍數、擊球 frame、球種、正反拍…）是人工標註，
  資料裡推不出來。
- **2D 檔案與 human / skeleton 骨架檔**不複製。
