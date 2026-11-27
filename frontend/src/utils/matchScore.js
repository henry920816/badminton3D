// Rally 的比分記在該球結束後；播放到該球終點才更新。
export function scoreAtFrame(rallies, frame) {
  const sorted = [...(rallies || [])].sort((a, b) => Number(a.start_frame) - Number(b.start_frame))
  if (!sorted.some(r => r.score || (r.up_score != null && r.down_score != null))) return null

  let completed = null
  let inProgress = null
  for (const rally of sorted) {
    if (rally.end_frame <= frame) completed = rally
    else if (rally.start_frame <= frame && frame < rally.end_frame) inProgress = rally
  }
  const gameIndex = inProgress?.game_index ?? completed?.game_index ?? sorted[0]?.game_index ?? 1
  const pointsOf = (rally, team) => Number(rally?.up_team) === team
    ? Number(rally?.up_score ?? 0)
    : Number(rally?.down_score ?? 0)
  const current = completed?.game_index === gameIndex ? completed : null
  const lastOfGame = new Map()
  for (const rally of sorted) lastOfGame.set(rally.game_index, rally)
  const gamesWon = [0, 0]
  for (const [game, last] of lastOfGame) {
    if (Number(game) >= Number(gameIndex)) continue
    const one = pointsOf(last, 0)
    const two = pointsOf(last, 1)
    if (Number.isFinite(one) && Number.isFinite(two) && one !== two) gamesWon[one > two ? 0 : 1] += 1
  }
  const named = sorted.find(r => r.up_court || r.down_court)
  const nameOf = team => {
    if (!named) return `Team ${team + 1}`
    return (Number(named.up_team) === team ? named.up_court : named.down_court) || `Team ${team + 1}`
  }
  return {
    gameIndex,
    teams: [0, 1].map(team => ({ team, name: nameOf(team), games: gamesWon[team], points: current ? pointsOf(current, team) : 0 })),
  }
}
