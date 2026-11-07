import { useEffect, useState } from 'react'

import { api } from '../api.js'
import { useAppStore } from '../store.js'
import { autoRepairBad2DFrames } from './autoRepair2D.js'


/**
 * 品質檢查的自動修復：只修品質格判錯、且通過修復回驗的相機 2D 標註，
 * 修完重抓品質格。最後一批修復記在 sessionStorage，可以整批復原。
 *
 * grid、相機排序、目前 rally 由品質檢查面板傳入；修完 / 復原後用
 * setGrid、setLoadedRallyId 換上新的品質格。
 */
export function useAutoRepair2D({
  matchId,
  dataReady,
  currentRally,
  currentRallyRef,
  grid,
  sortedCameras,
  setPlaying,
  upsertBall2DPoints,
  setGrid,
  setLoadedRallyId,
}) {
  const [
    autoRepairing,
    setAutoRepairing,
  ] = useState(
    false,
  )

  const [
    autoRepairProgress,
    setAutoRepairProgress,
  ] = useState(
    null,
  )

  const [
    autoRepairResult,
    setAutoRepairResult,
  ] = useState(
    null,
  )

  const [lastRepair, setLastRepair] = useState(null)
  const [undoing, setUndoing] = useState(false)
  const [undoMessage, setUndoMessage] = useState('')

  useEffect(() => {
    try {
      setLastRepair(JSON.parse(sessionStorage.getItem(`quality-repair-2d-only-${matchId}`) || 'null'))
    } catch {
      setLastRepair(null)
    }
    setUndoMessage('')
  }, [matchId])

  const rememberRepair = batch => {
    if (useAppStore.getState().matchId === batch.matchId) setLastRepair(batch)
    try {
      sessionStorage.setItem(`quality-repair-2d-only-${batch.matchId}`, JSON.stringify(batch))
    } catch {
      // The current mounted panel still retains the undo data.
    }
  }

  // 換 Rally 時清掉上一段的修復結果
  useEffect(
    () => {
      setAutoRepairResult(
        null,
      )
    },
    [
      currentRally?.id,
    ],
  )

  /*
   * 自動修正目前 Rally。
   *
   * 不改偵測：
   * 完全直接使用 grid 裡
   * 現有的 ok / bad / no_data。
   */
  const runAutoRepair = async () => {
    if (
      !dataReady
      || autoRepairing
      || undoing
      || matchId == null
      || !currentRally
    ) {
      return
    }

    /*
     * 自動修正開始後
     * 強制暫停影片。
     */
    setPlaying(
      false,
    )

    setAutoRepairing(
      true,
    )

    setAutoRepairProgress(
      null,
    )

    setAutoRepairResult(
      null,
    )

    try {
      const result = (
        await autoRepairBad2DFrames({
          matchId,

          startFrame:
            currentRally.start_frame,

          endFrame:
            currentRally.end_frame,

          grid,

          cameras:
            sortedCameras,

          onProgress:
            setAutoRepairProgress,

          onConfirmed:
            confirmed => {
              if (useAppStore.getState().matchId !== matchId) return
              /*
               * 修正後立即更新
               * 2D cache。
               */
              const pointsByCamera = (
                new Map()
              )

              for (
                const point
                of (
                  confirmed
                    ?.ball_2d_points
                  || []
                )
              ) {
                const cameraIndex = (
                  Number(
                    point.camera_index,
                  )
                )

                if (
                  !pointsByCamera.has(
                    cameraIndex,
                  )
                ) {
                  pointsByCamera.set(
                    cameraIndex,
                    [],
                  )
                }

                pointsByCamera
                  .get(
                    cameraIndex,
                  )
                  .push(
                    point,
                  )
              }

              for (
                const [
                  cameraIndex,
                  points,
                ]
                of pointsByCamera
              ) {
                upsertBall2DPoints(
                  cameraIndex,
                  points,
                )
              }
            },
        })
      )

      if (result.repairIds?.length) {
        if (useAppStore.getState().matchId === matchId) {
          useAppStore.getState().invalidatePairwisePoints()
        }
        rememberRepair({ matchId, repairIds: result.repairIds,
          startFrame: currentRally.start_frame, endFrame: currentRally.end_frame })
        setUndoMessage('')
      }
      if (useAppStore.getState().matchId !== matchId) return

      /*
       * 全部修完後，
       * 重新跑一次原本的偵測。
       */
      const refreshed = (
        await api.getTraj2DCameraGrid(
          matchId,
          currentRally.start_frame,
          currentRally.end_frame,
          useAppStore.getState().ball2DSource,
        )
      )

      if (useAppStore.getState().matchId !== matchId || currentRallyRef.current?.id !== currentRally.id) return
      setGrid(
        refreshed,
      )

      setLoadedRallyId(
        currentRally.id,
      )

      setAutoRepairResult(
        result,
      )

    } catch (error) {
      console.error(
        error,
      )

      setAutoRepairResult({
        error: (
          error?.message
          || String(
            error,
          )
        ),
      })

    } finally {
      setAutoRepairing(
        false,
      )

      setAutoRepairProgress(
        null,
      )
    }
  }


  const undoLastRepair = async () => {
    if (!lastRepair || lastRepair.matchId !== matchId || undoing || autoRepairing) return
    const batch = lastRepair
    setPlaying(false)
    setUndoing(true)
    setUndoMessage('')
    let reverted = false
    try {
      const result = await api.undoAutoRepair(batch.matchId, batch.repairIds)
      reverted = true
      try { sessionStorage.removeItem(`quality-repair-2d-only-${batch.matchId}`) } catch {}
      if (useAppStore.getState().matchId !== batch.matchId) return
      setLastRepair(null)
      const state = useAppStore.getState()
      const grouped = new Map()
      for (const point of result.ball_2d_points || []) {
        if (!grouped.has(point.camera_index)) grouped.set(point.camera_index, [])
        grouped.get(point.camera_index).push(point)
      }
      for (const [camera, points] of grouped) state.upsertBall2DPoints(camera, points)
      if (grouped.size) state.invalidatePairwisePoints()
      setAutoRepairResult(null)
      setUndoMessage(`已復原 ${result.reverted_frames} 個 frame 的 2D 標註`)
      if (currentRally) {
        const refreshed = await api.getTraj2DCameraGrid(
          matchId, currentRally.start_frame, currentRally.end_frame, useAppStore.getState().ball2DSource,
        )
        if (useAppStore.getState().matchId === batch.matchId && currentRallyRef.current?.id === currentRally.id) {
          setGrid(refreshed)
          setLoadedRallyId(currentRally.id)
        }
      }
    } catch (error) {
      setUndoMessage(`${reverted ? '資料已復原，但品質格更新失敗，請重新開啟品質檢查' : '復原失敗'}：${error.message || error}`)
    } finally {
      setUndoing(false)
    }
  }

  return {
    autoRepairing,
    autoRepairProgress,
    autoRepairResult,
    lastRepair,
    undoing,
    undoMessage,
    runAutoRepair,
    undoLastRepair,
  }
}
