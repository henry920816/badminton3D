import { useEffect, useRef } from 'react'

import { useAppStore } from '../store.js'


export function getCameraVideoTime(
  globalFrame,
  globalFps,
  camera,
) {
  const cameraFps = (
    camera?.fps
    || globalFps
    || 50
  )

  const offsetFrame = (
    camera?.offset_frame
    || 0
  )

  return Math.max(
    0,
    (
      globalFrame
      + offsetFrame
    )
    / cameraFps,
  )
}


function getGlobalFrameFromCameraTime(
  cameraTime,
  globalFps,
  camera,
) {
  const cameraFps = (
    camera?.fps
    || globalFps
    || 50
  )

  const offsetFrame = (
    camera?.offset_frame
    || 0
  )

  return Math.max(
    0,
    Math.round(
      cameraTime
      * cameraFps
      - offsetFrame,
    ),
  )
}


// 播放中影片播到某一格時，把播放時間推到那一格。影片是播放時唯一的時鐘
// （見 Scene3D 的 PlaybackController），所以預覽範圍、in/out 循環和
// 播到結尾停下也都在這裡處理。
// 回傳 true 表示時間被拉到別處（循環回 in 點），呼叫端不能把它當成
// 「跟著影片走」，好讓 seek effect 把影片跳過去。
function advanceClockFromVideo(frame, fps, previewRange) {
  const {
    selection,
    durationSec,
    setCurrentFrame,
    setCurrentTime,
    setPlaying,
  } = useAppStore.getState()

  if (previewRange && frame >= previewRange.endFrame) {
    setCurrentFrame(previewRange.endFrame)
    setPlaying(false)
    return false
  }

  const time = frame / fps

  if (selection.inTime != null && selection.outTime != null) {
    if (time > selection.outTime || time < selection.inTime) {
      setCurrentTime(selection.inTime)
      return true
    }
  } else if (durationSec && time >= durationSec) {
    setCurrentTime(durationSec)
    setPlaying(false)
    return false
  }

  setCurrentFrame(frame)
  return false
}


/**
 * 影片當播放時鐘：播放 / 暫停 / 速度跟著 store、影片播到哪一格就把播放
 * 時間推到哪一格（requestVideoFrameCallback，不支援時退回 timeupdate），
 * 使用者拖動播放位置時把影片 seek 過去。
 *
 * 回傳 handleTimeUpdate（接在 <video onTimeUpdate>）與 forgetVideoFrame
 * （換相機時呼叫）。
 */
export function useVideoClock({
  videoRef,
  activeCamera,
  activeCameraId,
  activeSource,
  fps,
  currentFrame,
  playing,
  safePlaybackRate,
  previewRange,
}) {
  const syncFromVideoRef = useRef(false)

  const lastVideoDrivenFrameRef = useRef(
    null
  )

  useEffect(
    () => {
      const video = (
        videoRef.current
      )

      if (!video) {
        return
      }

      try {
        video.playbackRate = (
          safePlaybackRate
        )
      } catch {
        // Ignore unsupported playback rate.
      }
    },
    [
      safePlaybackRate,
      activeSource,
      activeCameraId,
    ],
  )

  useEffect(
    () => {
      const video = (
        videoRef.current
      )

      if (!video) {
        return
      }

      try {
        video.playbackRate = (
          safePlaybackRate
        )
      } catch {
        // Ignore unsupported playback rate.
      }

      if (
        playing
        && activeSource
      ) {
        const promise = (
          video.play()
        )

        if (
          promise
          && typeof promise.catch
            === 'function'
        ) {
          // 瀏覽器擋掉播放（例如沒有使用者操作的有聲自動播放）時，
          // 影片不會前進，改由 3D 場景推進時間
          promise.catch(
            () => useAppStore.getState().setVideoClockActive(false)
          )
        }
      } else {
        video.pause()
      }
    },
    [
      playing,
      activeSource,
      safePlaybackRate,
    ],
  )

  // 影片載入好（有 metadata）就由影片當播放時鐘；載入失敗、換來源或
  // 卸載時交還給 3D 場景。緩衝中仍算影片的：時間停著等影片，不讓 3D
  // 先跑走、回頭又把影片 seek 過去
  useEffect(
    () => {
      const video = videoRef.current
      const { setVideoClockActive, setPlaying: stopPlaying } = useAppStore.getState()

      if (!video || !activeSource) {
        setVideoClockActive(false)
        return undefined
      }

      const activate = () => setVideoClockActive(true)
      const deactivate = () => setVideoClockActive(false)
      const handleEnded = () => stopPlaying(false)

      if (video.readyState >= 1 && !video.error) activate()

      video.addEventListener('loadedmetadata', activate)
      video.addEventListener('playing', activate)
      video.addEventListener('error', deactivate)
      video.addEventListener('emptied', deactivate)
      video.addEventListener('ended', handleEnded)

      return () => {
        video.removeEventListener('loadedmetadata', activate)
        video.removeEventListener('playing', activate)
        video.removeEventListener('error', deactivate)
        video.removeEventListener('emptied', deactivate)
        video.removeEventListener('ended', handleEnded)
        deactivate()
      }
    },
    [
      activeSource,
      activeCamera?.id,
    ],
  )

  useEffect(
    () => {
      const video = (
        videoRef.current
      )

      if (
        !video
        || !activeCamera
        || !fps
      ) {
        return
      }

      if (
        syncFromVideoRef.current
      ) {
        return
      }

      const targetTime = (
        getCameraVideoTime(
          currentFrame,
          fps,
          activeCamera,
        )
      )

      if (
        !Number.isFinite(
          targetTime
        )
      ) {
        return
      }

      const difference = Math.abs(
        video.currentTime
        - targetTime
      )

      const lastVideoFrame = (
        lastVideoDrivenFrameRef.current
      )

      const frameDifference = (
        lastVideoFrame == null
          ? Infinity
          : Math.abs(
              currentFrame
              - lastVideoFrame
            )
      )

      const tolerance = Math.max(
        2,
        Math.round(
          fps * 0.08
        ),
      )

      const normalPlaybackUpdate = (
        playing
        && frameDifference
          <= tolerance
      )

      if (normalPlaybackUpdate) {
        return
      }

      const seekThreshold = (
        playing
          ? 0.025
          : 0.015
      )

      if (
        difference
        > seekThreshold
      ) {
        try {
          video.currentTime = (
            targetTime
          )
        } catch {
          // Ignore invalid seek.
        }
      }
    },
    [
      currentFrame,
      fps,
      activeCamera,
      activeSource,
      playing,
    ],
  )

  useEffect(
    () => {
      const video = (
        videoRef.current
      )

      if (
        !video
        || !activeCamera
        || !fps
      ) {
        return undefined
      }

      let callbackId = null
      let stopped = false

      const updateFrame = (
        now,
        metadata,
      ) => {
        if (
          stopped
          || !videoRef.current
        ) {
          return
        }

        const mediaTime = (
          metadata?.mediaTime
          ?? videoRef.current.currentTime
        )

        const frame = (
          getGlobalFrameFromCameraTime(
            mediaTime,
            fps,
            activeCamera,
          )
        )

        lastVideoDrivenFrameRef.current = (
          frame
        )

        if (
          !useAppStore.getState().playing
        ) {
          if (
            videoRef.current
              .requestVideoFrameCallback
            && !stopped
          ) {
            callbackId = (
              videoRef.current
              .requestVideoFrameCallback(
                updateFrame
              )
            )
          }

          return
        }

        syncFromVideoRef.current = true
        advanceClockFromVideo(frame, fps, previewRange)
        syncFromVideoRef.current = false

        if (
          videoRef.current
            .requestVideoFrameCallback
          && !stopped
        ) {
          callbackId = (
            videoRef.current
            .requestVideoFrameCallback(
              updateFrame
            )
          )
        }
      }

      if (
        video
          .requestVideoFrameCallback
      ) {
        callbackId = (
          video
          .requestVideoFrameCallback(
            updateFrame
          )
        )
      }

      return () => {
        stopped = true

        if (
          callbackId
          && video
            .cancelVideoFrameCallback
        ) {
          video.cancelVideoFrameCallback(
            callbackId
          )
        }
      }
    },
    [
      fps,
      activeCamera,
      previewRange,
      activeSource,
    ],
  )

  const handleTimeUpdate = () => {
    const video = (
      videoRef.current
    )

    if (
      !video
      || !activeCamera
      || !fps
    ) {
      return
    }

    if (
      video
        .requestVideoFrameCallback
    ) {
      return
    }

    const frame = (
      getGlobalFrameFromCameraTime(
        video.currentTime,
        fps,
        activeCamera,
      )
    )

    lastVideoDrivenFrameRef.current = (
      frame
    )

    if (
      !useAppStore.getState().playing
    ) {
      return
    }

    syncFromVideoRef.current = true
    advanceClockFromVideo(frame, fps, previewRange)
    syncFromVideoRef.current = false
  }

  // 換相機時影片會重新載入，上一台最後播到的那格不能再拿來判斷要不要 seek
  const forgetVideoFrame = () => {
    lastVideoDrivenFrameRef.current = null
  }

  return {
    handleTimeUpdate,
    forgetVideoFrame,
  }
}
