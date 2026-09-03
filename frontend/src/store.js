import { create } from 'zustand'
import {
  getCameraScenePose,
} from './utils/cameraScenePose.js'


function normalizeCameras(
  cameras,
  fallbackFps = 50,
) {
  if (!Array.isArray(cameras)) {
    return []
  }

  return cameras.map(
    (
      camera,
      index,
    ) => {
      const projection = (
        camera?.projection
        || null
      )

      const derivedPose = (
        projection
          ? getCameraScenePose(
              projection,
              4,
            )
          : {
              position: [
                0,
                3,
                0,
              ],
              target: [
                0,
                0,
                0,
              ],
            }
      )

      const cameraId = (
        camera?.id
        || `cam${index}`
      )

      return {
        ...camera,

        id: cameraId,

        index: (
          camera?.index
          ?? index
        ),

        label: (
          camera?.label
          || `Cam ${index}`
        ),

        fileName: (
          camera?.fileName
          || camera?.file_name
          || `${index}.mp4`
        ),

        video_url: (
          camera?.video_url
          ?? camera?.url
          ?? null
        ),

        fps: (
          camera?.fps
          || fallbackFps
          || 50
        ),

        offset_frame: (
          camera?.offset_frame
          ?? camera?.offsetFrame
          ?? 0
        ),

        position: (
          camera?.position
          || derivedPose.position
        ),

        target: (
          camera?.target
          || derivedPose.target
        ),

        projection,

        has_ball_2d: Boolean(
          camera?.has_ball_2d
          ?? camera?.hasBall2D
          ?? false
        ),

        enabled: (
          camera?.enabled
          ?? true
        ),
      }
    },
  )
}


export const useAppStore = create(
  (
    set,
    get,
  ) => ({
    matchId: null,

    fps: 50,
    durationSec: 0,

    cameras: [],
    activeCameraId: null,
    sceneCameraTargetId: null,
    localVideoSrcMap: {},

    currentTime: 0,
    currentFrame: 0,
    playing: false,
    playbackRate: 1.0,

    selection: {
      inTime: null,
      outTime: null,
    },

    rallies: [],
    hits: [],
    anomalies: [],

    replaySegments: [],
    activeReplaySegmentId: null,
    smplReplayBySegmentId: new Map(),
    showSmplReplay: true,

    trajByFrame: new Map(),
    ball2DByCameraFrame: new Map(),
    loadedBall2DCameras: new Set(),

    pxPerSec: 100,
    scrollLeft: 0,
    bottomView: 'timeline',

    activeItem: null,
    selectedTrajFrames: [],
    repairMode: false,

    previewRange: null,

    setMatchId: id => {
      set({
        matchId: id,
      })
    },

    setZoom: px => {
      set({
        pxPerSec: px,
      })
    },

    setScrollLeft: value => {
      set({
        scrollLeft: value,
      })
    },

    setBottomView: view => {
      set({
        bottomView: (
          view === 'projection2d'
          || view === 'quality2d'
            ? view
            : 'timeline'
        ),
      })
    },

    setMatchMeta: match => {
      const fps = (
        match?.fps
        || 50
      )

      const cameras = normalizeCameras(
        match?.cameras,
        fps,
      )

      set({
        fps,

        durationSec: (
          match?.duration_sec
          ?? (
            match?.duration_frame
              ? (
                  match.duration_frame
                  / fps
                )
              : 0
          )
        ),

        cameras,

        activeCameraId: (
          cameras[0]?.id
          || null
        ),

        sceneCameraTargetId: (
          cameras[0]?.id
          || null
        ),
      })
    },

    setCurrentTime: time => {
      const fps = (
        get().fps
        || 50
      )

      const durationSec = (
        get().durationSec
        || 0
      )

      const clampedTime = (
        durationSec > 0
          ? Math.min(
              Math.max(
                0,
                time,
              ),
              durationSec,
            )
          : Math.max(
              0,
              time,
            )
      )

      set({
        currentTime: (
          clampedTime
        ),

        currentFrame: Math.max(
          0,
          Math.round(
            clampedTime
            * fps,
          ),
        ),
      })
    },

    setCurrentFrame: frame => {
      const fps = (
        get().fps
        || 50
      )

      const durationSec = (
        get().durationSec
        || 0
      )

      const maximumFrame = (
        durationSec > 0
          ? Math.round(
              durationSec
              * fps,
            )
          : Number.MAX_SAFE_INTEGER
      )

      const clampedFrame = Math.max(
        0,
        Math.min(
          frame,
          maximumFrame,
        ),
      )

      set({
        currentFrame: (
          clampedFrame
        ),

        currentTime: (
          clampedFrame
          / fps
        ),
      })
    },

    setPlaying: value => {
      set({
        playing: Boolean(value),
      })
    },

    togglePlaying: () => {
      set(
        state => ({
          playing: (
            !state.playing
          ),
        }),
      )
    },

    setPlaybackRate: rate => {
      set({
        playbackRate: (
          Number(rate)
          || 1.0
        ),
      })
    },

    setPreviewRange: range => {
      set({
        previewRange: range,
      })
    },

    clearPreviewRange: () => {
      set({
        previewRange: null,
      })
    },

    setSelectionIn: () => {
      const time = get().currentTime
      const selection = get().selection

      set({
        selection: {
          ...selection,
          inTime: time,
        },
      })
    },

    setSelectionOut: () => {
      const time = get().currentTime
      const selection = get().selection

      set({
        selection: {
          ...selection,
          outTime: time,
        },
      })
    },

    setSelectionRange: (
      inTime,
      outTime,
    ) => {
      set({
        selection: {
          inTime: Math.min(
            inTime,
            outTime,
          ),

          outTime: Math.max(
            inTime,
            outTime,
          ),
        },
      })
    },

    clearSelection: () => {
      set({
        selection: {
          inTime: null,
          outTime: null,
        },
      })
    },

    setTimelineData: ({
      rallies,
      hits,
      anomalies,
    }) => {
      set({
        rallies: (
          rallies
          || []
        ),

        hits: (
          hits
          || []
        ),

        anomalies: (
          anomalies
          || []
        ),
      })
    },

    setReplaySegments: segments => {
      set(
        state => {
          const nextSegments = segments || []
          const activeStillExists = nextSegments.some(
            segment => segment.id === state.activeReplaySegmentId,
          )

          return {
            replaySegments: nextSegments,
            activeReplaySegmentId: activeStillExists
              ? state.activeReplaySegmentId
              : nextSegments[0]?.id ?? null,
            smplReplayBySegmentId: new Map(),
          }
        },
      )
    },

    setActiveReplaySegment: id => {
      set(
        state => ({
          activeReplaySegmentId: state.replaySegments.some(
            segment => segment.id === id,
          )
            ? id
            : state.activeReplaySegmentId,
        }),
      )
    },

    setActiveReplaySegmentByRallyId: rallyId => {
      set(
        state => {
          const segment = state.replaySegments.find(
            item => item.rally_id === rallyId,
          )

          if (!segment) return {}

          return {
            activeReplaySegmentId: segment.id,
            showSmplReplay: true,
          }
        },
      )
    },

    setShowSmplReplay: value => {
      set({
        showSmplReplay: Boolean(value),
      })
    },

    toggleSmplReplay: () => {
      set(
        state => ({
          showSmplReplay: !state.showSmplReplay,
        }),
      )
    },

    setSmplReplayData: (segmentId, data) => {
      set(
        state => {
          const replayMap = new Map(
            state.smplReplayBySegmentId,
          )
          replayMap.set(segmentId, data)
          return {
            smplReplayBySegmentId: replayMap,
          }
        },
      )
    },

    updateHit: (
      id,
      updates,
    ) => {
      set(
        state => ({
          hits: state.hits.map(
            hit => (
              hit.id === id
                ? {
                    ...hit,
                    ...updates,
                  }
                : hit
            ),
          ),
        }),
      )
    },

    updateAnomaly: (
      id,
      updates,
    ) => {
      set(
        state => ({
          anomalies: (
            state.anomalies.map(
              anomaly => (
                anomaly.id === id
                  ? {
                      ...anomaly,
                      ...updates,
                    }
                  : anomaly
              ),
            )
          ),
        }),
      )
    },

    setActiveCamera: id => {
      set({
        activeCameraId: id,
      })
    },

    setActiveCameraFromScene: id => {
      set({
        activeCameraId: id,
        sceneCameraTargetId: id,
      })
    },

    setSceneCameraTarget: id => {
      set({
        sceneCameraTargetId: id,
      })
    },

    setCameraOffset: (
      id,
      offsetFrame,
    ) => {
      set(
        state => ({
          cameras: state.cameras.map(
            camera => (
              camera.id === id
                ? {
                    ...camera,

                    offset_frame: (
                      Number(
                        offsetFrame
                      )
                      || 0
                    ),
                  }
                : camera
            ),
          ),
        }),
      )
    },

    setCameraHasBall2D: (
      cameraIndex,
      value,
    ) => {
      set(
        state => ({
          cameras: state.cameras.map(
            camera => (
              Number(camera.index)
                === Number(cameraIndex)
                ? {
                    ...camera,
                    has_ball_2d: (
                      Boolean(value)
                    ),
                  }
                : camera
            ),
          ),
        }),
      )
    },

    setLocalVideoSrc: (
      cameraId,
      source,
    ) => {
      set(
        state => ({
          localVideoSrcMap: {
            ...state.localVideoSrcMap,

            [cameraId]: source,
          },
        }),
      )
    },

    setLocalVideoSrcMap: sourceMap => {
      set({
        localVideoSrcMap: (
          sourceMap
          || {}
        ),
      })
    },

    clearLocalVideoSrcMap: () => {
      set({
        localVideoSrcMap: {},
      })
    },

    setActiveItem: (
      type,
      id,
    ) => {
      set({
        activeItem: {
          type,
          id,
        },
      })
    },

    clearActiveItem: () => {
      set({
        activeItem: null,
      })
    },

    setRepairMode: value => {
      set({
        repairMode: Boolean(value),
      })
    },

    toggleRepairMode: () => {
      set(
        state => ({
          repairMode: (
            !state.repairMode
          ),
        }),
      )
    },

    toggleTrajFrameSelection: frame => {
      set(
        state => {
          let nextFrames = [
            ...state.selectedTrajFrames,
          ]

          if (
            nextFrames.includes(
              frame
            )
          ) {
            nextFrames = (
              nextFrames.filter(
                selectedFrame => (
                  selectedFrame
                  !== frame
                ),
              )
            )
          } else {
            nextFrames.push(
              frame
            )

            if (
              nextFrames.length > 2
            ) {
              nextFrames.shift()
            }
          }

          return {
            selectedTrajFrames: (
              nextFrames
            ),
          }
        },
      )
    },

    clearTrajSelection: () => {
      set({
        selectedTrajFrames: [],
      })
    },

    upsertTrajPoints: points => {
      const trajectoryMap = new Map(
        get().trajByFrame,
      )

      for (
        const point
        of points || []
      ) {
        if (
          point
          && typeof point.frame
            !== 'undefined'
        ) {
          trajectoryMap.set(
            point.frame,
            point,
          )
        }
      }

      set({
        trajByFrame: (
          trajectoryMap
        ),
      })
    },

    removeTrajFrames: frames => {
      const trajectoryMap = new Map(
        get().trajByFrame,
      )

      for (const frame of frames || []) {
        trajectoryMap.delete(
          frame
        )
      }

      set({
        trajByFrame: trajectoryMap,
      })
    },

    upsertBall2DPoints: (
      cameraIndex,
      points,
    ) => {
      const byCamera = new Map(
        get().ball2DByCameraFrame,
      )
      const cameraMap = new Map(
        byCamera.get(cameraIndex)
        || [],
      )

      for (const point of points || []) {
        if (
          point
          && typeof point.frame
            !== 'undefined'
        ) {
          cameraMap.set(
            point.frame,
            point,
          )
        }
      }

      byCamera.set(
        cameraIndex,
        cameraMap,
      )

      set({
        ball2DByCameraFrame: byCamera,
      })
    },

    removeBall2DPoints: (
      cameraIndex,
      frames,
    ) => {
      const byCamera = new Map(
        get().ball2DByCameraFrame,
      )
      const cameraMap = new Map(
        byCamera.get(cameraIndex)
        || [],
      )

      for (const frame of frames || []) {
        cameraMap.delete(
          frame
        )
      }

      byCamera.set(
        cameraIndex,
        cameraMap,
      )

      set({
        ball2DByCameraFrame: byCamera,
      })
    },

    // 整台相機的 2D 球點是一次載完的，所以只要記「這台載過沒有」
    markBall2DCameraLoaded: cameraIndex => {
      set({
        loadedBall2DCameras: new Set(
          get().loadedBall2DCameras,
        ).add(cameraIndex),
      })
    },

    hasBall2DCameraLoaded: cameraIndex => (
      get().loadedBall2DCameras.has(cameraIndex)
    ),

    resetTrajCache: () => {
      set({
        trajByFrame: new Map(),
        ball2DByCameraFrame: new Map(),
        loadedBall2DCameras: new Set(),
        smplReplayBySegmentId: new Map(),
      })
    },

    getSelectionFrameRange: () => {
      const {
        inTime,
        outTime,
      } = get().selection

      const fps = (
        get().fps
        || 50
      )

      if (
        inTime == null
        || outTime == null
      ) {
        return null
      }

      return [
        Math.max(
          0,
          Math.floor(
            Math.min(
              inTime,
              outTime,
            )
            * fps,
          ),
        ),

        Math.max(
          0,
          Math.ceil(
            Math.max(
              inTime,
              outTime,
            )
            * fps,
          ),
        ),
      ]
    },

    getVisiblePointsFor3D: (
      windowSec = 3.0,
    ) => {
      const currentTime = (
        get().currentTime
      )

      const fps = (
        get().fps
        || 50
      )

      const startFrame = Math.max(
        0,
        Math.floor(
          (
            currentTime
            - windowSec
          )
          * fps,
        ),
      )

      const endFrame = Math.max(
        0,
        Math.ceil(
          (
            currentTime
            + windowSec
          )
          * fps,
        ),
      )

      const trajectoryMap = (
        get().trajByFrame
      )

      const points = []

      for (
        let frame = startFrame;
        frame <= endFrame;
        frame += 1
      ) {
        const point = (
          trajectoryMap.get(
            frame
          )
        )

        if (point) {
          points.push(
            point
          )
        }
      }

      return points
    },
  }),
)
