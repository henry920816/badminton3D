/**
 * 播放到某一格時的比賽比分。
 *
 * rally 上的 up_score / down_score 是這一球「打完之後」的比分，而且是
 * 相對於場地上下半邊；up_team 記哪一隊在上半場（一局中間可能換邊）。
 * 這裡換算成以隊伍（team 0 / 1）為準。
 *
 * 規則：
 *   - 一球打到一半時顯示這球開始前的比分，播到 end_frame 那一格就更新
 *     （不能等「超過」end_frame：影片常在最後一球的 end_frame 結束，
 *     in/out 選一球循環播放時也會在 end_frame 跳回開頭）
 *   - 新一局的第一球開始時歸零；開始前的空檔仍顯示上一局的終局比分
 *   - 已贏局數只算目前這局之前、已經打完的局
 *
 * 沒有比分資料（沒有任何 rally 有 score）時回傳 null。
 */
export function scoreAtFrame(sortedRallies, frame) {
  if (!sortedRallies.length || !sortedRallies.some(rally => rally.score)) return null

  let completed = null
  let inProgress = null

  for (const rally of sortedRallies) {
    if (rally.end_frame <= frame) completed = rally
    else if (rally.start_frame <= frame) inProgress = rally
  }

  const gameIndex = (
    inProgress?.game_index
    ?? completed?.game_index
    ?? sortedRallies[0].game_index
  )

  const pointsOf = (rally, team) => (
    Number(rally.up_team) === team ? Number(rally.up_score) : Number(rally.down_score)
  )

  const current = completed && completed.game_index === gameIndex ? completed : null

  // 每一局的最後一球決定那局誰贏
  const lastRallyOfGame = new Map()
  for (const rally of sortedRallies) lastRallyOfGame.set(rally.game_index, rally)

  const gamesWon = [0, 0]
  for (const [game, last] of lastRallyOfGame) {
    if (game >= gameIndex) continue
    const team0 = pointsOf(last, 0)
    const team1 = pointsOf(last, 1)
    if (team0 !== team1) gamesWon[team0 > team1 ? 0 : 1] += 1
  }

  const named = sortedRallies.find(rally => rally.up_court || rally.down_court)
  const nameOf = team => {
    if (!named) return `Team ${team + 1}`
    return (Number(named.up_team) === team ? named.up_court : named.down_court) || `Team ${team + 1}`
  }

  return {
    gameIndex,
    teams: [0, 1].map(team => ({
      team,
      name: nameOf(team),
      games: gamesWon[team],
      points: current ? pointsOf(current, team) : 0,
    })),
  }
}
