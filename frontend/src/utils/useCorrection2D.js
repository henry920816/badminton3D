import { useEffect, useMemo, useState } from 'react'

import { api } from '../api.js'
import { useAppStore } from '../store.js'
import { getImagePointFromPointer } from './drawProjectionOverlay.js'
import { computeEpipolarGuide, evaluateGuideError } from './epipolarGuide.js'
import { useBall2DRangeLabels } from './usePairwiseBallPoints.js'
import { useRallyFrameRange } from './useRallyBallData.js'


/**
 * 影片面板的 2D 標註修正：在影片上點出這格羽球的正確位置（或標成看不見），
 * 存在獨立的修正表，原始標註不動。其他相機的標註畫成極線當參考，
 * 並算出修正點和參考視角的三角化誤差。
 *
 * onEnterMode：進入修正模式時要一起做的事（例如退出 2D 修復模式）。
 */
export function useCorrection2D({
  matchId,
  currentFrame,
  setCurrentFrame,
  setPlaying,
  activeCamera,
  activeCameraParams,
  projectionAvailable,
  safeCameras,
  activeBall2DMap,
  ball2DByCameraFrame,
  overlayCanvasRef,
  videoWrapRef,
  videoRef,
  onEnterMode,
}) {
  // 2D 標註修正：修正存在獨立的表，原始資料不會被改動
  const [
    correction2DMode,
    setCorrection2DMode,
  ] = useState(false)

  const [
    correction2DSaving,
    setCorrection2DSaving,
  ] = useState(false)

  const [
    correction2DError,
    setCorrection2DError,
  ] = useState('')

  const [
    correction2DAdvance,
    setCorrection2DAdvance,
  ] = useState(false)

  const ball2DCorrections = useAppStore(
    state => state.ball2DCorrections
  )

  const activeCorrectionMap = useMemo(
    () => (
      ball2DCorrections.get(
        Number(activeCamera?.index),
      )
      || null
    ),
    [
      ball2DCorrections,
      activeCamera,
    ],
  )

  const activeCorrection = (
    activeCorrectionMap?.get(currentFrame)
    || null
  )

  // 這格的原始標註：有修正時取修正紀錄附的原始值；沒有修正時，
  // 畫面上的 2D 點不論來源都等於原始值
  const activeOriginal2D = (
    activeCorrection
      ? activeCorrection.original
      : activeBall2DMap?.get(currentFrame) || null
  )

  // 2D 修正的參考視角：其他相機在這格有標註就預設拿來畫極線，
  // 使用者覺得哪台標錯就點掉（存的是排除的相機編號）
  const [
    correction2DExcludedIndices,
    setCorrection2DExcludedIndices,
  ] = useState([])

  const toggleCorrection2DReference = cameraIndex => {
    setCorrection2DExcludedIndices(
      previous => (
        previous.includes(cameraIndex)
          ? previous.filter(index => index !== cameraIndex)
          : [...previous, cameraIndex]
      ),
    )
  }

  // 這段 rally 所有相機的標註（時間軸的標註一致軌道也用同一份快取）
  const {
    startFrame: correctionRangeStart,
    endFrame: correctionRangeEnd,
  } = useRallyFrameRange()

  const correctionRangeLabels = useBall2DRangeLabels(
    correction2DMode ? matchId : null,
    correctionRangeStart,
    correctionRangeEnd,
  )

  // 這份只留看得見的標註、沒有 visibility 欄位，補上才和其他來源一致
  const correctionRangeLabelByKey = useMemo(
    () => new Map(
      (correctionRangeLabels.points || []).map(point => [
        `${point.frame}:${Number(point.camera_index)}`,
        { ...point, visibility: 1 },
      ]),
    ),
    [
      correctionRangeLabels.points,
    ],
  )

  // 每台相機在這格能不能當參考：參考點是那台的修正值，沒修正就用原始標註
  const correction2DReferenceOptions = useMemo(
    () => {
      if (!correction2DMode) return []

      const activeIndex = Number(activeCamera?.index)

      return safeCameras
        .filter(camera => (
          Number.isInteger(Number(camera.index))
          && Number(camera.index) !== activeIndex
          && camera.has_ball_2d
        ))
        .map(camera => {
          const cameraIndex = Number(camera.index)
          const selected = !correction2DExcludedIndices.includes(cameraIndex)
          const params = camera.projection
          const correction = ball2DCorrections.get(cameraIndex)?.get(currentFrame) || null
          const point = (
            correction
            || correctionRangeLabelByKey.get(`${currentFrame}:${cameraIndex}`)
            || ball2DByCameraFrame.get(cameraIndex)?.get(currentFrame)
            || null
          )

          let status = 'ok'

          if (!params?.intrinsic || !params?.extrinsic) status = 'noParams'
          else if (!point && correctionRangeLabels.status === 'loading') status = 'loading'
          else if (!point) status = 'none'
          else if (Number(point.visibility) !== 1) status = 'hidden'

          return {
            cameraIndex,
            label: camera.label || camera.id,
            selected,
            status,
            corrected: Boolean(correction),
            reference: (
              status === 'ok'
                ? { cameraIndex, params, u: Number(point.x), v: Number(point.y) }
                : null
            ),
          }
        })
    },
    [
      correction2DMode,
      activeCamera,
      safeCameras,
      correction2DExcludedIndices,
      ball2DCorrections,
      correctionRangeLabelByKey,
      correctionRangeLabels.status,
      ball2DByCameraFrame,
      currentFrame,
    ],
  )

  // 參考點優先用修正值，所以每台相機的修正都要載入
  useEffect(
    () => {
      if (
        !correction2DMode
        || matchId == null
      ) {
        return undefined
      }

      let cancelled = false

      for (const camera of safeCameras) {
        const cameraIndex = Number(camera.index)

        if (
          !camera.has_ball_2d
          || !Number.isInteger(cameraIndex)
          || useAppStore.getState().ball2DCorrections.has(cameraIndex)
        ) {
          continue
        }

        api.getBall2DCorrections(matchId, cameraIndex)
          .then(list => {
            if (!cancelled) {
              useAppStore.getState().setBall2DCorrections(cameraIndex, list)
            }
          })
          .catch(error => {
            if (!cancelled) setCorrection2DError(error?.message || String(error))
          })
      }

      return () => {
        cancelled = true
      }
    },
    [
      correction2DMode,
      matchId,
      safeCameras,
    ],
  )

  const correction2DReferences = useMemo(
    () => (
      correction2DReferenceOptions
        .filter(option => option.selected && option.reference)
        .map(option => option.reference)
    ),
    [
      correction2DReferenceOptions,
    ],
  )

  const correction2DGuide = useMemo(
    () => (
      correction2DMode
      && projectionAvailable
      && correction2DReferences.length > 0
        ? computeEpipolarGuide({
            targetParams: activeCameraParams,
            references: correction2DReferences,
          })
        : null
    ),
    [
      correction2DMode,
      projectionAvailable,
      activeCameraParams,
      correction2DReferences,
    ],
  )

  // 修正點和參考視角一起三角化的誤差，讓使用者點完馬上知道和參考合不合
  const correction2DGuideSummary = useMemo(
    () => {
      if (!correction2DGuide) return null

      return {
        referenceCount: correction2DGuide.references.length,
        minimumError: correction2DGuide.minimum?.error ?? null,
        correctionError: (
          Number(activeCorrection?.visibility) === 1
            ? evaluateGuideError(
                activeCameraParams,
                correction2DGuide.references,
                Number(activeCorrection.x),
                Number(activeCorrection.y),
              ).error
            : null
        ),
      }
    },
    [
      correction2DGuide,
      activeCorrection,
      activeCameraParams,
    ],
  )

  const correctionOverlay = useMemo(
    () => (
      correction2DMode
        ? {
            original: activeOriginal2D,
            correction: activeCorrection,
            guide: correction2DGuide,
          }
        : null
    ),
    [
      correction2DMode,
      activeOriginal2D,
      activeCorrection,
      correction2DGuide,
    ],
  )

  useEffect(
    () => {
      if (
        !correction2DMode
        || matchId == null
        || !Number.isInteger(
          Number(activeCamera?.index),
        )
      ) {
        return undefined
      }

      const cameraIndex = Number(
        activeCamera.index,
      )

      // 存檔 / 清除時 store 已同步更新，換資料集時會清空；
      // 讀過的相機不用每次打開修正模式都重抓
      if (
        useAppStore.getState().ball2DCorrections.has(
          cameraIndex,
        )
      ) {
        return undefined
      }

      let cancelled = false

      api.getBall2DCorrections(
        matchId,
        cameraIndex,
      )
        .then(list => {
          if (!cancelled) {
            useAppStore.getState().setBall2DCorrections(
              cameraIndex,
              list,
            )
          }
        })
        .catch(error => {
          if (!cancelled) {
            setCorrection2DError(
              error?.message
              || String(error)
            )
          }
        })

      return () => {
        cancelled = true
      }
    },
    [
      correction2DMode,
      matchId,
      activeCamera?.index,
    ],
  )

  // 讀的是修正後資料時，畫面上的 2D 點立刻換掉，兩兩重建與品質檢查
  // 只重算這一格（整個 rally 重算要好幾秒）
  const applyCorrectionToView = (
    cameraIndex,
    frame,
    point,
  ) => {
    const state = useAppStore.getState()

    if (state.ball2DSource !== 'corrected') return

    if (point) {
      state.upsertBall2DPoints(
        cameraIndex,
        [
          {
            camera_index: cameraIndex,
            frame,
            ...point,
          },
        ],
      )
    } else {
      state.removeBall2DPoints(
        cameraIndex,
        [frame],
      )
    }

    state.notifyBall2DCorrected(frame)
  }

  const saveCorrection2D = async payload => {
    if (matchId == null) return

    setCorrection2DSaving(true)
    setCorrection2DError('')

    try {
      const result = await api.saveBall2DCorrection(
        matchId,
        payload,
      )

      if (useAppStore.getState().matchId !== matchId) return

      useAppStore.getState().upsertBall2DCorrection(
        result
      )
      applyCorrectionToView(
        result.camera_index,
        result.frame,
        {
          visibility: result.visibility,
          x: result.x,
          y: result.y,
          corrected: true,
        },
      )

      if (correction2DAdvance) {
        setCurrentFrame(
          payload.frame + 1
        )
      }
    } catch (error) {
      console.error(error)
      setCorrection2DError(
        error?.message
        || String(error)
      )
    } finally {
      setCorrection2DSaving(false)
    }
  }

  const markCorrection2DHidden = () => {
    if (
      !Number.isInteger(
        Number(activeCamera?.index),
      )
    ) {
      return
    }

    saveCorrection2D({
      camera_index: Number(activeCamera.index),
      frame: currentFrame,
      visibility: 0,
      x: 0,
      y: 0,
    })
  }

  const clearCorrection2D = async () => {
    if (
      matchId == null
      || !activeCorrection
    ) {
      return
    }

    setCorrection2DSaving(true)
    setCorrection2DError('')

    try {
      const result = await api.deleteBall2DCorrection(
        matchId,
        activeCorrection.camera_index,
        activeCorrection.frame,
      )

      if (useAppStore.getState().matchId !== matchId) return

      useAppStore.getState().removeBall2DCorrection(
        result.camera_index,
        result.frame,
      )
      applyCorrectionToView(
        result.camera_index,
        result.frame,
        result.original
          ? {
              ...result.original,
              corrected: false,
            }
          : null,
      )
    } catch (error) {
      console.error(error)
      setCorrection2DError(
        error?.message
        || String(error)
      )
    } finally {
      setCorrection2DSaving(false)
    }
  }

  const handleCorrection2DPointerDown = event => {
    if (
      !correction2DMode
      || correction2DSaving
      || !Number.isInteger(
        Number(activeCamera?.index),
      )
    ) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setPlaying(false)

    const point = getImagePointFromPointer({
      event,
      canvas: overlayCanvasRef.current,
      container: videoWrapRef.current,
      video: videoRef.current,
      cameraParams: activeCameraParams,
    })

    if (!point) {
      setCorrection2DError(
        '請點在影片畫面範圍內'
      )
      return
    }

    saveCorrection2D({
      camera_index: Number(activeCamera.index),
      frame: currentFrame,
      visibility: 1,
      x: point.x,
      y: point.y,
    })
  }

  const toggleCorrection2DMode = () => {
    if (correction2DMode) {
      setCorrection2DMode(false)
      setCorrection2DExcludedIndices([])
      return
    }

    onEnterMode?.()

    setPlaying(false)
    setCorrection2DError('')
    setCorrection2DMode(true)
  }

  // 換比賽時關掉修正模式
  useEffect(
    () => {
      setCorrection2DMode(false)
      setCorrection2DError('')
      setCorrection2DExcludedIndices([])
    },
    [
      matchId,
    ],
  )

  // 只關掉模式，不清排除的參考相機（2D 修復模式打開時用）
  const exitCorrection2DMode = () => {
    setCorrection2DMode(false)
  }

  return {
    correction2DMode,
    correction2DSaving,
    correction2DError,
    correction2DAdvance,
    setCorrection2DAdvance,
    ball2DCorrections,
    activeCorrectionMap,
    activeCorrection,
    activeOriginal2D,
    correction2DReferenceOptions,
    correction2DGuideSummary,
    correctionOverlay,
    toggleCorrection2DReference,
    markCorrection2DHidden,
    clearCorrection2D,
    handleCorrection2DPointerDown,
    toggleCorrection2DMode,
    exitCorrection2DMode,
  }
}
