import React, { useState } from 'react'
import { useAppStore } from '../store.js'
import { EXTRA_VIEW_LEVELS, useRallyBallData } from '../utils/useRallyBallData.js'
import { SMOOTHING_LEVELS } from '../utils/mergeBallTrajectory.js'


/*
 * 3D 場景右上角的球軌跡設定。每一列由上到下就是軌跡的處理順序：
 *
 *   來源     用哪一份軌跡（ball_traj / 純 2D）
 *   採用相機 一格至少要幾台相機拍到，才用它的 2D 標註（3 / 2 / 1 台以上）
 *   處理     物理模型（補空格、鉛直面、不回飛、去閃電一起開關；關掉時
 *            只畫重建點），和平滑
 *   疊加顯示 不影響軌跡本身的對照圖層：重建說明、2D 重建紅線、球拍轉向
 *   編輯     修復模式（改的是 ball_traj）
 *
 * 選 ball_traj 或在修復模式時，中間三列不作用，會淡掉。
 */

const COLLAPSED_KEY = 'badminton3d.trajectorySettings.collapsed'

const SOURCES = [
  {
    value: 'ball_traj',
    label: 'ball_traj',
    hint: '學長姐原本的軌跡，方便比對',
    title: '學長姐原本的 3D 軌跡，不做任何處理。',
  },
  {
    value: 'pure2d',
    label: '純 2D',
    hint: '只用 2D 重建與模擬，完全不參考 ball_traj',
    title: '只用 2D 重建，沒有 2D 的格子依序用物理擬合、內插、拆段擬合、往擊球推、重力拋物線盡量模擬出來，'
      + '發球前固定在第一個重建點。每格用了哪一種，看 3D 場景下方的說明列。',
  },
]

// EXTRA_VIEW_LEVELS 依序是：只用 2 組以上配對（也就是至少 3 台相機互相
// 同意）、再加只有 2 台的格子、再加只有 1 台的格子
const CAMERA_COUNT_LABELS = ['3 台以上', '2 台以上', '1 台以上']

const CAMERA_COUNT_HINTS = [
  '只用 3 台以上相機拍到、互相同意的格子',
  '只有 2 台拍到的格子也用（兩台互相差 20 px 以內）',
  '只有 1 台拍到的格子也用：把軌跡移到那台的視線上，投影回去剛好落在標註上',
]

const CAMERA_COUNT_TITLE = '一格要有幾台相機拍到球，才拿它的 2D 標註來決定位置。'
  + '都要在球場範圍內、和前後的飛行弧接得上；1 台的移動距離不超過 0.5 公尺。'


function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}


function Segmented({ options, value, onChange, disabled, title }) {
  return (
    <div
      className={`inline-flex rounded border border-zinc-700 overflow-hidden ${disabled ? 'opacity-40' : ''}`}
      title={title}
    >
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          title={option.title}
          className={`px-2 py-1 border-l border-zinc-700 first:border-l-0 ${
            option.value === value
              ? 'bg-sky-700 text-white font-semibold'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}


// 開著的顏色：預設是主題藍（和選中的相機分頁一樣）；紅線、球拍轉向用
// 它們在 3D 場景裡的顏色，對得上畫面上的東西
function Toggle({ label, value, onChange, disabled, title, accent = 'theme' }) {
  const on = {
    theme: 'bg-sky-700 text-white border-sky-600',
    rose: 'bg-rose-900/50 text-rose-100 border-rose-800',
    violet: 'bg-violet-900/50 text-violet-100 border-violet-800',
  }[accent]

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onChange}
      title={title}
      className={`px-2 py-1 rounded border disabled:opacity-40 ${
        value ? `${on} font-semibold` : 'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
      }`}
    >
      {label} {value ? '開' : '關'}
    </button>
  )
}


function Row({ label, children, hint, dim }) {
  return (
    <div className={`grid grid-cols-[4.5rem_1fr] gap-x-2 items-start py-1.5 border-t border-zinc-800 first:border-t-0 ${dim ? 'opacity-50' : ''}`}>
      <div className="text-zinc-500 pt-1">{label}</div>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">{children}</div>
        {hint && <div className="text-[11px] text-zinc-500 leading-4">{hint}</div>}
      </div>
    </div>
  )
}


export default function TrajectorySettingsPanel({ racketAimBlendFrames }) {
  const source = useAppStore(s => s.trajectoryDisplaySource)
  const setSource = useAppStore(s => s.setTrajectoryDisplaySource)
  const extraViewLevel = useAppStore(s => s.extraViewLevel)
  const setExtraViewLevel = useAppStore(s => s.setExtraViewLevel)
  const physicsModel = useAppStore(s => s.usePhysicsModel)
  const togglePhysicsModel = useAppStore(s => s.togglePhysicsModel)
  const smoothingLevel = useAppStore(s => s.displaySmoothingLevel)
  const setSmoothingLevel = useAppStore(s => s.setDisplaySmoothingLevel)
  const showPairwiseTrajectory = useAppStore(s => s.showPairwiseTrajectory)
  const toggleShowPairwiseTrajectory = useAppStore(s => s.toggleShowPairwiseTrajectory)
  const racketAimEnabled = useAppStore(s => s.racketAimEnabled)
  const toggleRacketAim = useAppStore(s => s.toggleRacketAim)
  const showSmplReplay = useAppStore(s => s.showSmplReplay)
  const showBallProvenance = useAppStore(s => s.showBallProvenance)
  const toggleBallProvenance = useAppStore(s => s.toggleBallProvenance)
  const repairMode = useAppStore(s => s.repairMode)
  const setRepairMode = useAppStore(s => s.setRepairMode)
  const clearTrajSelection = useAppStore(s => s.clearTrajSelection)
  const { pairwisePoints, pairwiseStatus } = useRallyBallData()

  const [collapsed, setCollapsed] = useState(readCollapsed)

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1')
      } catch {
        // 存不了就只在這次開啟有效
      }
      return !value
    })
  }

  const sourceInfo = SOURCES.find(item => item.value === source) || SOURCES[0]
  // 中間兩列只對純 2D 有作用；修復模式下固定顯示 ball_traj
  const processing = source === 'pure2d' && !repairMode

  const summary = [
    repairMode ? '修復模式（ball_traj）' : sourceInfo.label,
    processing && `採用 ${CAMERA_COUNT_LABELS[extraViewLevel]}`,
    processing && smoothingLevel > 0 && `平滑${SMOOTHING_LEVELS[smoothingLevel]?.label}`,
    processing && physicsModel && '物理模型',
    showPairwiseTrajectory && '紅線',
  ].filter(Boolean).join(' · ')

  const pairwiseNote = showPairwiseTrajectory && (
    {
      loading: '載入中',
      error: '載入失敗',
    }[pairwiseStatus] || (pairwiseStatus === 'ready' && !pairwisePoints.length ? '無資料' : '')
  )

  return (
    <div className="w-[min(26rem,calc(100vw-2rem))] bg-zinc-900/85 border border-zinc-800 rounded shadow backdrop-blur-md text-xs">
      <button
        type="button"
        onClick={toggleCollapsed}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-800/50"
        title={collapsed ? '展開球軌跡設定' : '收起球軌跡設定'}
      >
        <span className="font-semibold text-zinc-200">球軌跡</span>
        <span className="flex-1 truncate text-zinc-400">{summary}</span>
        <span className="text-zinc-500">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-2">
          <Row
            label="來源"
            hint={repairMode ? '修復模式中，固定顯示 ball_traj' : sourceInfo.hint}
          >
            <Segmented
              options={SOURCES}
              value={source}
              onChange={setSource}
              disabled={repairMode}
            />
          </Row>

          <Row
            label="採用相機"
            dim={!processing}
            hint={
              extraViewLevel === 2 && !physicsModel
                ? '1 台的格子要開物理模型才會用（要拿補出來的位置當先驗）'
                : CAMERA_COUNT_HINTS[extraViewLevel]
            }
          >
            <Segmented
              options={EXTRA_VIEW_LEVELS.map((level, index) => ({ value: index, label: CAMERA_COUNT_LABELS[index] }))}
              value={extraViewLevel}
              onChange={setExtraViewLevel}
              disabled={!processing}
              title={CAMERA_COUNT_TITLE}
            />
          </Row>

          <Row
            label="處理"
            dim={!processing}
            hint={physicsModel
              ? '物理模型：補空格 → 鉛直面 → 平滑 → 不回飛 → 去閃電'
              : '物理模型關：只畫重建點，沒有重建點的格子空著'}
          >
            <Toggle
              label="物理模型"
              value={physicsModel}
              onChange={togglePhysicsModel}
              disabled={!processing}
              title={'用羽球的飛行物理（重力 + 空氣阻力）處理軌跡，一起開關：\n'
                + '・補空格：沒有重建點的格子依序用物理擬合、內插、拆段擬合、往擊球推、重力拋物線補上；'
                + '1 台相機的格子拿補出來的位置移到那台的視線上\n'
                + '・鉛直面：每段擬合鉛直面，把軌跡水平移到面上（實測中段會往側邊彎約 5 公分）\n'
                + '・不回飛：水平方向只有阻力，沿飛行方向的水平位置只會往前；往回超過 30 公分的段多半漏抓了擊球，不處理\n'
                + '・去閃電：一兩格跳出去又回來的，換成前後接起來的位置\n'
                + '關掉時只畫通過檢查的重建點，位置不動（平滑另外設定）'}
            />
            <span className="text-zinc-500 pl-1">平滑</span>
            <Segmented
              options={SMOOTHING_LEVELS.map((level, index) => ({
                value: index,
                label: level.label,
                title: level.halfWindow ? `前後各 ${level.halfWindow} 格擬合二次曲線` : '不平滑',
              }))}
              value={smoothingLevel}
              onChange={setSmoothingLevel}
              disabled={!processing}
              title="去掉抖動：每格用前後幾格擬合二次曲線，不跨過擊球；越強越平但弧越容易被拉直"
            />
          </Row>

          <Row label="疊加顯示" hint="對照用的圖層與說明，不改變上面算出來的軌跡">
            <Toggle
              label="重建說明"
              value={showBallProvenance}
              onChange={toggleBallProvenance}
              title="3D 場景下方說明目前這一格的球位置是怎麼決定的：用了哪種來源、為什麼沒用 2D、各相機的配對結果"
            />
            <Toggle
              label="球拍轉向"
              value={racketAimEnabled}
              onChange={toggleRacketAim}
              disabled={!showSmplReplay}
              accent="violet"
              title={`擊球瞬間把拍面中心轉到球上、拍面朝球飛出去的方向，接觸前後各 ${racketAimBlendFrames} 格漸入漸出。`
                + '關掉的話球拍完全跟著 SMPL 手腕的姿態走。'}
            />
            <Toggle
              label={`2D 重建紅線${pairwiseNote ? `（${pairwiseNote}）` : ''}`}
              value={showPairwiseTrajectory}
              onChange={toggleShowPairwiseTrajectory}
              accent="rose"
              title={'另外畫出每格 2D 標註兩兩重建的 3D 位置（紅線），只畫至少 2 組相機、在球場範圍內的格子，'
                + '也就是擊球偵測用的那批點。'}
            />
          </Row>

          <Row label="編輯" hint="改的是 ball_traj：點兩個異常的軌跡點，重算中間那一段">
            <Toggle
              label="修復模式"
              value={repairMode}
              onChange={() => {
                if (repairMode) clearTrajSelection()
                setRepairMode(!repairMode)
              }}
            />
          </Row>
        </div>
      )}
    </div>
  )
}
