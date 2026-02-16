# Badminton 3D Debugger MVP (Web)

最小可跑版本：  
- 底部：vis-timeline 多軌道 + 游標 + Shift 拖曳框選 + hit 事件可拖曳修正時間（PATCH 到後端）  
- 底圖：在 timeline 上方畫 X(t)/Y(t) 折線（raw，無平滑）  
- 左上：R3F(Three.js) 顯示 raw points + segments（無平滑）  
- 右上：HTML5 video 多視角切換 + 與 timeline 同步（Space/方向鍵步進）  
- 右側：Hit / Anomaly 編輯面板（存 DB）  
- 後端：FastAPI + PostgreSQL（docker-compose 一鍵啟動，含 demo seed）

## 1) 一鍵啟動（建議）
需要：Docker Desktop

```bash
cd badminton_3d_debugger_mvp
docker compose up --build
```

- Backend: http://localhost:8000/health
- Frontend: (需另外啟動，見下)

## 2) 前端啟動
需要：Node.js 18+

```bash
cd frontend
npm install
npm run dev
```

打開：http://localhost:5173

## 3) 放入你自己的影片
右上角 CAM 列每個 camera 都可以選擇本機 mp4，會以 local objectURL 播放。
（Demo seed 裡的 sample_cam1.mp4 是佔位字串，不會真的存在）

## 4) 目前資料
Demo seed 會在 DB 自動建立：
- match #1
- 10 個 rally
- 每個 rally 3~7 個 hit
- 2 段 anomaly
- 90 秒的 ball_traj（60fps）

## 5) 你接下來要接真實資料（CSV -> DB）
把你的 CSV parse 後寫進 DB：
- rallies -> rallies(start_frame,end_frame)
- hits -> hits(hit_frame,new_hit_frame,shot_type,...)
- ball_traj -> ball_traj(frame,x,y,z,confidence)

你也可以先維持 CSV 匯出：TopBar 的 Export CSV 會輸出 hits。
