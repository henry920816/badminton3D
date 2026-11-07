import { create } from 'zustand'
import {
  getCameraScenePose,
} from './utils/cameraScenePose.js'


const BALL_2D_SOURCE_KEY = 'badminton3d.ball2DSource'


// 預設讀修正後的資料：沒有任何修正時和原始資料完全一樣
function loadBall2DSource() {
  try {
    const value = window.localStorage.getItem(BALL_2D_SOURCE_KEY)
    if (value === 'original' || value === 'corrected') return value
  } catch {
    // 無痕視窗或封鎖儲存時用預設值
  }
  return 'corrected'
}


function saveBall2DSource(value) {
  try {
    window.localStorage.setItem(BALL_2D_SOURCE_KEY, value)
  } catch {
    // 存不了就只在這次開啟有效
  }
}


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

    // 顯示用的資料集名稱，跟著 setMatchMeta 一起更新
    matchTitle: '',

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
    // 影片載入好時由影片推進時間（VideoPanel），3D 場景就不再自己推，
    // 免得兩個時鐘互相拉扯、播放線來回跳格
    videoClockActive: false,

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
    pairwiseRevision: 0,

    // 已寫入的 2D 標註改變時，重新讀取由 2D 重建的擊球軌跡。
    invalidatePairwisePoints: () => set(state => ({
      pairwiseRevision: state.pairwiseRevision + 1,
    })),

    // 讀 2D 標註時用 'original'（只看原始資料）還是 'corrected'
    // （疊上 2D 標註修正）。修正存在獨立的表，原始資料不會被改動
    ball2DSource: loadBall2DSource(),

    // 最近一次存好或清掉的 2D 標註修正 { matchId, frame, seq }。
    // 兩兩重建與品質檢查都是逐格獨立計算，收到後只重算這一格
    ball2DCorrectionTick: null,

    notifyBall2DCorrected: frame => set(state => ({
      ball2DCorrectionTick: {
        matchId: state.matchId,
        frame,
        seq: (state.ball2DCorrectionTick?.seq || 0) + 1,
      },
    })),

    // 2D 標註修正，cameraIndex -> Map(frame -> 修正)，
    // 每筆是 { camera_index, frame, visibility, x, y, original }
    ball2DCorrections: new Map(),

    setBall2DSource: source => {
      if (source === get().ball2DSource) return

      saveBall2DSource(source)

      // 換來源後已載入的 2D 球點作廢，影片面板會重新讀取。兩兩重建的快取
      // key 本來就含來源，不用 bump pairwiseRevision，切回來時還能用快取
      set({
        ball2DSource: source,
        ball2DByCameraFrame: new Map(),
        loadedBall2DCameras: new Set(),
      })
    },

    setBall2DCorrections: (cameraIndex, corrections) => {
      const byCamera = new Map(get().ball2DCorrections)
      byCamera.set(
        cameraIndex,
        new Map((corrections || []).map(item => [item.frame, item])),
      )
      set({ ball2DCorrections: byCamera })
    },

    upsertBall2DCorrection: correction => {
      const byCamera = new Map(get().ball2DCorrections)
      const cameraMap = new Map(byCamera.get(correction.camera_index) || [])
      cameraMap.set(correction.frame, correction)
      byCamera.set(correction.camera_index, cameraMap)
      set({ ball2DCorrections: byCamera })
    },

    removeBall2DCorrection: (cameraIndex, frame) => {
      const byCamera = new Map(get().ball2DCorrections)
      const cameraMap = new Map(byCamera.get(cameraIndex) || [])
      cameraMap.delete(frame)
      byCamera.set(cameraIndex, cameraMap)
      set({ ball2DCorrections: byCamera })
    },

    // 擊球瞬間把拍面轉向球飛出去的方向。關掉的話球拍就完全跟著 SMPL
    // 手腕的姿態走，方便比對這個修正到底改了什麼。預設開著，維持原本行為。
    racketAimEnabled: true,

    // 另外畫一條 2D 標註兩兩重建的 3D 軌跡，和 ball_traj 的灰線比對用
    showPairwiseTrajectory: false,

    // 3D 場景的球與軌跡線用哪一份：
    //   'ball_traj' 原本的軌跡
    //   'pure2d'    只用 2D 重建與物理擬合，完全不參考 ball_traj；
    //               兩者都沒有的格子不顯示
    trajectoryDisplaySource: 'ball_traj',

    // 純 2D 軌跡的平滑強度，是 SMOOTHING_LEVELS 的 index（0 關、1 弱、
    // 2 中、3 強）。重建點在球快的地方會抖，逐段擬合去掉抖動（不跨過擊球）
    displaySmoothingLevel: 2,

    // 純 2D 軌跡要不要也用 2 台、1 台相機拍到的格子，是 EXTRA_VIEW_LEVELS
    // 的 index（0 關、1 加 2 台、2 再加 1 台）
    extraViewLevel: 2,

    // 純 2D 的物理模型，一個開關管這些（見 buildPure2DTrace）：
    //   補空格  物理擬合、內插、盡量模擬，補沒有重建點的格子；1 台相機
    //           的格子拿補出來的位置當先驗移到視線上
    //   鉛直面  每段飛行（兩次擊球之間）用重建點擬合鉛直面，把軌跡移到
    //           面上，1 台相機的格子改用視線和面的交點（見 fitFlightPlanes）
    //   不回飛  兩次擊球之間球在水平面上不往回飛（見 enforceForwardFlight）
    //   去閃電  一兩格跳出去又回來的換成前後接起來的位置（見 removeSpikes）
    // 關掉時只畫通過檢查的重建點（平滑另外設定）
    usePhysicsModel: true,

    // 3D 場景下方的「這一格的位置怎麼決定的」說明列，預設關
    showBallProvenance: false,

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

        matchTitle: match?.title || '',

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

    setVideoClockActive: value => {
      set({ videoClockActive: Boolean(value) })
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

    toggleShowPairwiseTrajectory: () => {
      set(
        state => ({
          showPairwiseTrajectory: !state.showPairwiseTrajectory,
        }),
      )
    },

    // 'pure2d' | 'ball_traj'
    setTrajectoryDisplaySource: (source) => {
      set({ trajectoryDisplaySource: source })
    },

    // SMOOTHING_LEVELS 的 index
    setDisplaySmoothingLevel: (level) => {
      set({ displaySmoothingLevel: level })
    },

    toggleBallProvenance: () => {
      set(
        state => ({
          showBallProvenance: !state.showBallProvenance,
        }),
      )
    },

    togglePhysicsModel: () => {
      set(
        state => ({
          usePhysicsModel: !state.usePhysicsModel,
        }),
      )
    },

    // EXTRA_VIEW_LEVELS 的 index
    setExtraViewLevel: (level) => {
      set({ extraViewLevel: level })
    },

    toggleRacketAim: () => {
      set(
        state => ({
          racketAimEnabled: !state.racketAimEnabled,
        }),
      )
    },

    resetTrajCache: () => {
      set({
        trajByFrame: new Map(),
        ball2DByCameraFrame: new Map(),
        loadedBall2DCameras: new Set(),
        ball2DCorrections: new Map(),
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
