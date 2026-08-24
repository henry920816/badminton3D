import { API_BASE } from '../config.js'


async function parseResponse(
  response,
) {
  const text = (
    await response.text()
  )

  let data = null

  if (text) {
    try {
      data = JSON.parse(
        text,
      )
    } catch {
      data = text
    }
  }

  if (!response.ok) {
    if (
      data
      && typeof data === 'object'
      && 'detail' in data
    ) {
      throw new Error(
        typeof data.detail === 'string'
          ? data.detail
          : JSON.stringify(
              data.detail,
            ),
      )
    }

    throw new Error(
      typeof data === 'string'
        ? data
        : `HTTP ${response.status}`,
    )
  }

  return data
}


export async function autoRepairBad2DFrames({
  matchId,
  startFrame,
  endFrame,
  onProgress,
  onConfirmed,
  dryRun = false,
}) {
  if (
    matchId == null
    || startFrame == null
    || endFrame == null
  ) {
    throw new Error(
      '缺少自動修正範圍',
    )
  }

  onProgress?.({
    current: 0,
    total: 1,
    frame: startFrame,
  })

  const response = (
    await fetch(
      (
        `${API_BASE}/matches/${matchId}`
        + '/traj2d/auto-repair'
      ),
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json',
        },

        body:
          JSON.stringify({
            start_frame:
              Number(
                startFrame,
              ),

            end_frame:
              Number(
                endFrame,
              ),

            dry_run:
              Boolean(
                dryRun,
              ),
          }),
      },
    )
  )

  const data = (
    await parseResponse(
      response,
    )
  )

  const repairedFrames = (
    data?.frames || []
  ).filter(
    item => (
      item.status
        === 'repaired'
      || item.status
        === 'would_repair'
    ),
  )

  const pointsByFrame = (
    new Map()
  )

  for (
    const point
    of data?.ball_2d_points || []
  ) {
    const frame = (
      Number(
        point.frame,
      )
    )

    if (
      !pointsByFrame.has(
        frame,
      )
    ) {
      pointsByFrame.set(
        frame,
        [],
      )
    }

    pointsByFrame
      .get(
        frame,
      )
      .push(
        point,
      )
  }

  repairedFrames.forEach(
    (
      item,
      index,
    ) => {
      onProgress?.({
        current:
          index + 1,

        total:
          repairedFrames.length,

        frame:
          item.frame,
      })

      if (
        !dryRun
        && typeof onConfirmed
          === 'function'
      ) {
        onConfirmed({
          confirmed:
            true,

          repair_id:
            item.repair_id,

          trajectory_point:
            item.trajectory_point,

          ball_2d_points: (
            pointsByFrame.get(
              Number(
                item.frame,
              ),
            )
            || []
          ),
        })
      }
    },
  )

  const failures = (
    data?.frames || []
  )
    .filter(
      item => (
        item.status
        === 'skipped'
      ),
    )
    .map(
      item => ({
        frame:
          item.frame,

        reason: (
          item.reason
          || '未通過安全回驗'
        ),
      }),
    )

  return {
    detectedFrames:
      Number(
        data?.detected_bad_frames
        || 0,
      ),

    repairedFrames:
      Number(
        data?.repaired_frames
        || 0,
      ),

    repairedPoints:
      Number(
        data?.repaired_2d_points
        || 0,
      ),

    skippedFrames:
      Number(
        data?.skipped_frames
        || 0,
      ),

    failures,

    repairIds:
      data?.repair_ids
      || [],

    frames:
      data?.frames
      || [],

    grid:
      data?.grid
      || [],

    dryRun:
      Boolean(
        data?.dry_run,
      ),
  }
}
