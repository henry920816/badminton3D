import { useEffect, useState } from 'react'

import { api } from '../api.js'
import { useAppStore } from '../store.js'
import { getImagePointFromPointer } from './drawProjectionOverlay.js'


/**
 * 影片面板的手動 2D 修復：暫停在某一格，在至少兩台相機的影片上點出
 * 羽球，後端三角化成 3D 點預覽，確認後寫回 2D 標註與 ball_traj，可以
 * 復原最後一次。
 *
 * 修復模式中跟著播放位置換格（還沒存檔時），也不讓影片播放。
 * onEnterMode：進入修復模式時要一起做的事（例如關掉 2D 修正模式）。
 */
export function useRepair2D({
  matchId,
  currentFrame,
  playing,
  setPlaying,
  activeCamera,
  activeCameraParams,
  projectionAvailable,
  repairCapableCameraCount,
  overlayCanvasRef,
  videoWrapRef,
  videoRef,
  upsertTrajPoints,
  removeTrajFrames,
  upsertBall2DPoints,
  removeBall2DPoints,
  setCameraHasBall2D,
  onEnterMode,
}) {
  const [
    repair2DMode,
    setRepair2DMode,
  ] = useState(false)

  const [
    repair2DFrame,
    setRepair2DFrame,
  ] = useState(null)

  const [
    repair2DObservations,
    setRepair2DObservations,
  ] = useState({})

  const [
    repair2DPreview,
    setRepair2DPreview,
  ] = useState(null)

  const [
    repair2DStatus,
    setRepair2DStatus,
  ] = useState('idle')

  const [
    repair2DError,
    setRepair2DError,
  ] = useState('')

  const [
    lastRepair2DId,
    setLastRepair2DId,
  ] = useState(null)

  const repair2DObservationList = (
    Object.values(
      repair2DObservations
      || {},
    )
  )

  const activeRepair2DObservation = (
    repair2DMode
    && repair2DFrame
      === currentFrame
      ? (
          repair2DObservations[
            Number(
              activeCamera?.index
            )
          ]
          || null
        )
      : null
  )

  const repair2DPreviewPoint = (
    repair2DMode
    && repair2DPreview?.frame
      === currentFrame
      ? (
          repair2DPreview
            ?.trajectory_point
          || null
        )
      : null
  )

  // 換比賽時清掉修復中的工作
  useEffect(
    () => {
      setRepair2DMode(false)
      setRepair2DFrame(null)
      setRepair2DObservations({})
      setRepair2DPreview(null)
      setRepair2DStatus('idle')
      setRepair2DError('')
      setLastRepair2DId(null)
    },
    [
      matchId,
    ],
  )

  useEffect(
    () => {
      if (
        !repair2DMode
        || lastRepair2DId != null
      ) {
        return
      }

      if (
        repair2DFrame == null
        || repair2DFrame
          !== currentFrame
      ) {
        setRepair2DFrame(
          currentFrame
        )
        setRepair2DObservations({})
        setRepair2DPreview(null)
        setRepair2DStatus('idle')
        setRepair2DError('')
      }
    },
    [
      currentFrame,
      repair2DMode,
      repair2DFrame,
      lastRepair2DId,
    ],
  )

  useEffect(
    () => {
      if (
        repair2DMode
        && playing
      ) {
        setPlaying(false)
      }
    },
    [
      repair2DMode,
      playing,
      setPlaying,
    ],
  )

  const resetRepair2DWork = (
    frame = currentFrame
  ) => {
    setRepair2DFrame(frame)
    setRepair2DObservations({})
    setRepair2DPreview(null)
    setRepair2DStatus('idle')
    setRepair2DError('')
    setLastRepair2DId(null)
  }

  const toggleRepair2DMode = () => {
    if (repair2DMode) {
      setRepair2DMode(false)
      resetRepair2DWork(null)
      return
    }

    if (
      repairCapableCameraCount < 2
    ) {
      return
    }

    setPlaying(false)
    onEnterMode?.()
    setRepair2DMode(true)
    resetRepair2DWork(
      currentFrame
    )
  }

  const handleRepair2DPointerDown = (
    event
  ) => {
    if (
      !repair2DMode
      || lastRepair2DId != null
      || !projectionAvailable
      || !Number.isInteger(
        Number(activeCamera?.index)
      )
    ) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setPlaying(false)

    const point = (
      getImagePointFromPointer({
        event,
        canvas: (
          overlayCanvasRef.current
        ),
        container: (
          videoWrapRef.current
        ),
        video: (
          videoRef.current
        ),
        cameraParams: (
          activeCameraParams
        ),
      })
    )

    if (!point) {
      setRepair2DError(
        '請點在影片畫面範圍內'
      )
      return
    }

    const cameraIndex = Number(
      activeCamera.index
    )

    setRepair2DFrame(
      currentFrame
    )
    setRepair2DObservations(
      previous => ({
        ...previous,

        [cameraIndex]: {
          camera_index: (
            cameraIndex
          ),
          x: point.x,
          y: point.y,
        },
      }),
    )
    setRepair2DPreview(null)
    setRepair2DStatus('idle')
    setRepair2DError('')
  }

  const previewRepair2D = async () => {
    if (
      matchId == null
      || repair2DFrame == null
      || repair2DObservationList.length
        < 2
    ) {
      setRepair2DError(
        '請先在至少兩個不同相機點選羽球'
      )
      return
    }

    setRepair2DStatus('previewing')
    setRepair2DError('')

    try {
      const result = await api.repairTraj2D(
        matchId,
        {
          frame: repair2DFrame,
          observations: (
            repair2DObservationList
          ),
          confirm: false,
        },
      )

      setRepair2DPreview(
        result
      )
      setRepair2DStatus('previewed')
    } catch (error) {
      console.error(error)
      setRepair2DStatus('error')
      setRepair2DError(
        error?.message
        || String(error)
      )
    }
  }

  const confirmRepair2D = async () => {
    if (
      matchId == null
      || repair2DFrame == null
      || !repair2DPreview
      || repair2DObservationList.length
        < 2
    ) {
      setRepair2DError(
        '請先完成 3D 預覽'
      )
      return
    }

    setRepair2DStatus('saving')
    setRepair2DError('')

    try {
      const result = await api.repairTraj2D(
        matchId,
        {
          frame: repair2DFrame,
          observations: (
            repair2DObservationList
          ),
          confirm: true,
        },
      )

      if (result?.trajectory_point) {
        upsertTrajPoints(
          [
            result.trajectory_point,
          ]
        )
      }

      for (
        const point
        of result?.ball_2d_points
          || []
      ) {
        upsertBall2DPoints(
          Number(
            point.camera_index
          ),
          [
            point,
          ],
        )
        setCameraHasBall2D(
          Number(
            point.camera_index
          ),
          true,
        )
      }
      if (result?.ball_2d_points?.length) {
        useAppStore.getState().invalidatePairwisePoints()
      }

      setRepair2DPreview(
        result
      )
      setLastRepair2DId(
        result.repair_id
      )
      setRepair2DStatus('saved')
    } catch (error) {
      console.error(error)
      setRepair2DStatus('error')
      setRepair2DError(
        error?.message
        || String(error)
      )
    }
  }

  const undoRepair2D = async () => {
    if (
      matchId == null
      || lastRepair2DId == null
    ) {
      return
    }

    setRepair2DStatus('undoing')
    setRepair2DError('')

    try {
      const result = (
        await api.undoTraj2DRepair(
          matchId,
          lastRepair2DId,
        )
      )

      if (result?.trajectory_point) {
        upsertTrajPoints(
          [
            result.trajectory_point,
          ]
        )
      } else if (
        result?.trajectory_deleted
      ) {
        removeTrajFrames(
          [
            result.frame,
          ]
        )
      }

      for (
        const point
        of result?.ball_2d_points
          || []
      ) {
        const cameraIndex = Number(
          point.camera_index
        )

        if (point.deleted) {
          removeBall2DPoints(
            cameraIndex,
            [
              point.frame,
            ],
          )
        } else {
          upsertBall2DPoints(
            cameraIndex,
            [
              point,
            ],
          )
        }

        if (
          typeof point.has_ball_2d
          !== 'undefined'
        ) {
          setCameraHasBall2D(
            cameraIndex,
            point.has_ball_2d,
          )
        }
      }
      if (result?.ball_2d_points?.length) {
        useAppStore.getState().invalidatePairwisePoints()
      }

      setLastRepair2DId(null)
      setRepair2DPreview(null)
      setRepair2DObservations({})
      setRepair2DStatus('undone')
    } catch (error) {
      console.error(error)
      setRepair2DStatus('error')
      setRepair2DError(
        error?.message
        || String(error)
      )
    }
  }

  const exitRepair2DMode = () => {
    setRepair2DMode(false)
    resetRepair2DWork(null)
  }

  return {
    repair2DMode,
    repair2DFrame,
    repair2DObservationList,
    repair2DPreview,
    repair2DStatus,
    repair2DError,
    lastRepair2DId,
    activeRepair2DObservation,
    repair2DPreviewPoint,
    resetRepair2DWork,
    toggleRepair2DMode,
    exitRepair2DMode,
    handleRepair2DPointerDown,
    previewRepair2D,
    confirmRepair2D,
    undoRepair2D,
  }
}
