# 2D 修正工具與 Dataset 檔案操作

## 品質檢查

- **藍色一鍵消除**：掃描目前資料集內全部 Rally，符合藍格規則的 2D 點設為不可見；不需確認視窗。
- **紅色一鍵修正**：掃描全部 Rally，只修改符合現有 `quality_review.py` 高可信條件的紅色格。仍要求兩台其他視角支持 3D、排除擊球保護區與已有人工作業的標註；不會把所有 >50px 點不加判斷地移動。
- 兩個功能各自構成單一歷史批次，頂端的「上一步／下一步」可以整批還原或重做。
- 修正僅寫入 `ball_position_2d_corrections`；原始 `ball_positions_2d` 不會修改。
- 這次沒有更動藍、紅、紫、黃的分類門檻。

## Update Dataset

上方原本的「2D 檔案」已改成 **Update Dataset**，專門放現有資料集的 2D CSV 部分重傳。可以一次選擇多個 `*_ball.csv`；伺服器會先完成全部格式檢查，然後同一交易更新指定 Rally／相機。

注意：現有資料集的其他類別尚未提供原地覆蓋更新。此處 2D CSV 是「替換指定 Rally × 相機的原始標註」，不是刪除原有修正紀錄。若上傳檔案已經包含舊修正、舊修正層仍存在，畫面將以修正層優先。重傳前請先匯出備份。

## Export Dataset

上方新增 **Export Dataset**，可勾選以下類別，預設勾選 2D：

| 類別 | 匯出內容 | 備註 |
|---|---|---|
| 相機參數 | `Cam_*_intrinsic.npy`、`Cam_*_extrinsic.npy`、設定 JSON | 使用 DB 已載入的校正參數 |
| Rally 與擊球標註 | `Set*/RallySeg.csv`、`shot_annotated.csv` | 由 DB 重建，原始 CSV 額外欄位無法還原 |
| 球軌跡 | `{Score}.npy` | 由 DB 有效 3D 點重建，缺失座標為 NaN |
| 球軌跡 Mask | `{Score}.npy` | 由 DB 有效 3D 點重建 0／1 Mask，**非原始 Mask 的逐位元副本** |
| 2D 羽球位置 | 每個 Rally／Cam 的 `*_ball.csv` + `corrections.csv` | 匯出已套用修正的有效結果 |
| 人體與球拍重建 | 現存轉換後 `*.npz` 和重建資訊 | 不是原始 `*.pth`；資料不存在時只輸出資訊 |

所選類別打包成 ZIP，內附 `export_info.json` 說明匯出來源及檔案數。**ZIP 是可再分析的資料快照，不是逐位元備份原始上傳檔案**；若要保存原始 Mask、PTH 或未載入欄位，應另外備份原始檔案。

## 畫面出現 Not Found

原本藍色一鍵按下出現 `Not Found` 表示前端向舊版後端呼叫了尚未註冊的整場 API，或 API 位址不是目前執行的後端。更新包包含 `backend/app/main.py`、`dataset_blue_cleanup.py` 等路由。解壓後在專案根目錄執行：

```powershell
docker compose up -d --build --force-recreate backend
```

再確認：

```powershell
(Invoke-RestMethod http://localhost:8000/openapi.json).paths.PSObject.Properties.Name | Select-String 'review-hide-dataset|review-repair-dataset|dataset-export'
```

三個路由都出現後才在瀏覽器重新整理。此檢查不需要刪資料庫或重新匯入資料。

## 測試範圍

單元測試使用 SQLite 模擬多個 Rally：驗證整場紅色修正、已修點保護、上一步／下一步、分類勾選匯出與 ZIP 內容。未在使用者的 Windows、Docker/PostgreSQL、影片環境完成端對端測試。
