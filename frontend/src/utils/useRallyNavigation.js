import { useAppStore } from '../store.js'


/**
 * 上一個 / 下一個 rally 的按鈕邏輯，時間軸、2D 投影、品質檢查共用。
 *
 * 有選中的 rally 就照它前後跳；沒有的話，上一個是開頭在目前位置之前的
 * 最後一個，下一個是開頭在目前位置之後的第一個。跳過去會選取整段
 * rally、把播放時間移到開頭。
 *
 * rallies、目前選取與播放位置在按下時才從 store 讀，不用為此訂閱 store。
 *
 * fps 由呼叫端傳入（各面板沒有 fps 時的預設值不同）。
 * onNavigate(startSec) 是跳完之後要做的事，例如時間軸把那段捲進畫面。
 */
export function useRallyNavigation(fps, onNavigate) {
  const sortedRallies = () => (
    [...(useAppStore.getState().rallies || [])]
      .sort((a, b) => a.start_frame - b.start_frame)
  )

  const goToRallyByIndex = (targetIdx) => {
    const sorted = sortedRallies()
    if (!sorted.length) return

    const idx = Math.max(0, Math.min(sorted.length - 1, targetIdx))
    const rally = sorted[idx]
    const startSec = rally.start_frame / fps
    const endSec = rally.end_frame / fps
    const { setSelectionRange, setCurrentTime, setActiveItem } = useAppStore.getState()

    setSelectionRange(startSec, endSec)
    setCurrentTime(startSec)
    setActiveItem('rally', rally.id)
    onNavigate?.(startSec)
  }

  const goPrevRally = () => {
    const sorted = sortedRallies()
    if (!sorted.length) return

    const { activeItem, currentFrame } = useAppStore.getState()

    if (activeItem?.type === 'rally') {
      const idx = sorted.findIndex(rally => rally.id === activeItem.id)
      if (idx > 0) {
        goToRallyByIndex(idx - 1)
        return
      }
    }

    let targetIdx = -1
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].start_frame < currentFrame) {
        targetIdx = i
        break
      }
    }
    if (targetIdx === -1) targetIdx = 0
    goToRallyByIndex(targetIdx)
  }

  const goNextRally = () => {
    const sorted = sortedRallies()
    if (!sorted.length) return

    const { activeItem, currentFrame } = useAppStore.getState()

    if (activeItem?.type === 'rally') {
      const idx = sorted.findIndex(rally => rally.id === activeItem.id)
      if (idx !== -1 && idx < sorted.length - 1) {
        goToRallyByIndex(idx + 1)
        return
      }
    }

    const targetIdx = sorted.findIndex(rally => rally.start_frame > currentFrame)
    goToRallyByIndex(targetIdx === -1 ? sorted.length - 1 : targetIdx)
  }

  return { goPrevRally, goNextRally }
}
