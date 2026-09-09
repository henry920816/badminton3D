"""選手名單、隊伍歸屬與比分的解讀。

RallySeg.csv 只給兩件事：每一球上下半場各站著誰，以及 `{局}_{上半場}_{下半場}`
這個比分字串。實測兩份資料共 103 球，那個比分是**這一球打完之後**的分數，而且
相鄰兩球一定恰好有一邊 +1，所以每一球的勝方可以直接讀出來。

換邊可能發生在一局中間（實際資料裡有一場在 11 分時換邊），所以「誰在哪一邊」
必須逐球記錄。但誰對誰是整場固定的，那屬於比賽層級的名單。這個模組就是在這兩
者之間做轉換。
"""

from __future__ import annotations

import re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import MatchPlayer, Player, Rally


# 一邊寫了多個名字就是雙打
DOUBLES_SEPARATOR = re.compile(r"[/／&＆,，、+＋]")

SCORE_PATTERN = re.compile(r"^(\d+)_(\d+)_(\d+)$")


def normalize_player_key(name: str) -> str:
    return re.sub(r"\s+", " ", str(name or "").strip()).lower()


def split_court_names(value: str) -> list[str]:
    """把一邊的欄位拆成名字。單打得到一個，雙打得到兩個。"""

    return [
        part.strip()
        for part in DOUBLES_SEPARATOR.split(str(value or ""))
        if part.strip()
    ]


def parse_score_label(label: str) -> tuple[int, int, int] | None:
    """`1_09_21` -> (局, 上半場分數, 下半場分數)。"""

    match = SCORE_PATTERN.match(str(label or "").strip())

    if match is None:
        return None

    return (
        int(match.group(1)),
        int(match.group(2)),
        int(match.group(3)),
    )


def assign_teams(rally_rows: list[dict]) -> tuple[dict[str, int], dict[str, str], list[str]]:
    """決定每個名字屬於哪一隊。

    第一球在上半場的那一隊是 team 0。之後的球只用來補進新出現的名字（雙打的
    另一位搭檔可能到後面才出現），依該球同半邊已知隊友的隊伍歸屬。
    """

    team_of: dict[str, int] = {}
    source_names: dict[str, str] = {}
    warnings: list[str] = []

    def remember(name: str, team: int) -> None:
        key = normalize_player_key(name)

        if not key:
            return

        source_names.setdefault(key, str(name).strip())
        team_of.setdefault(key, team)

    for index, row in enumerate(rally_rows):
        up = split_court_names(row.get("up_court"))
        down = split_court_names(row.get("down_court"))

        if not team_of:
            for name in up:
                remember(name, 0)

            for name in down:
                remember(name, 1)

            continue

        for names in (up, down):
            known = {
                team_of[normalize_player_key(name)]
                for name in names
                if normalize_player_key(name) in team_of
            }

            if len(known) == 1:
                team = known.pop()

                for name in names:
                    remember(name, team)

            elif len(known) > 1:
                warnings.append(
                    f"第 {index + 1} 個 rally 的同一半場出現了不同隊的選手："
                    + "、".join(names)
                )

    unknown = [
        source_names.get(key, key)
        for key in source_names
        if key not in team_of
    ]

    if unknown:
        warnings.append(
            "無法判斷隊伍歸屬的選手：" + "、".join(unknown)
        )

    return team_of, source_names, warnings


def resolve_up_team(row: dict, team_of: dict[str, int]) -> int | None:
    """這一球是哪一隊在上半場。"""

    for name in split_court_names(row.get("up_court")):
        team = team_of.get(normalize_player_key(name))

        if team is not None:
            return team

    for name in split_court_names(row.get("down_court")):
        team = team_of.get(normalize_player_key(name))

        if team is not None:
            return 1 - team

    return None


def resolve_player(db: Session, name: str, gender: str = "unknown") -> Player | None:
    """取得或建立一位選手。已存在的只在原本沒有性別時才補上。"""

    key = normalize_player_key(name)

    if not key:
        return None

    player = db.execute(
        select(Player).where(Player.key == key)
    ).scalar_one_or_none()

    if player is None:
        player = Player(
            key=key,
            name=str(name).strip()[:80],
            display_name="",
            gender=gender or "unknown",
        )
        db.add(player)
        db.flush()

    elif player.gender in ("", "unknown") and gender not in ("", "unknown"):
        player.gender = gender

    return player


def build_match_roster(
    db: Session,
    *,
    match_id: int,
    rally_rows: list[dict],
    gender: str = "unknown",
) -> dict:
    """建立這場比賽的出賽名單，並回報每個名字的隊伍歸屬。

    rally_rows 依照 rally 順序，每筆帶著 up_court / down_court。
    """

    team_of, source_names, warnings = assign_teams(rally_rows)

    seats: dict[int, int] = {0: 0, 1: 0}
    player_count = 0

    for key in sorted(team_of, key=lambda item: (team_of[item], source_names.get(item, item))):
        team = team_of[key]
        player = resolve_player(db, source_names.get(key, key), gender)

        if player is None:
            continue

        db.add(
            MatchPlayer(
                match_id=match_id,
                player_id=player.id,
                team=team,
                seat=seats[team],
                source_name=source_names.get(key, key)[:80],
            )
        )
        seats[team] += 1
        player_count += 1

    db.flush()

    return {
        "team_of": team_of,
        "player_count": player_count,
        "warnings": warnings,
    }


def apply_match_gender(db: Session, match_id: int, gender: str) -> int:
    """把重建資料推得的性別補給這場比賽裡還沒有性別的選手。

    性別要等 import_reconstruction_assets 跑完才知道，那時名單已經建好了，
    所以分成兩步。已經有性別的選手不覆蓋。
    """

    if gender not in ("male", "female"):
        return 0

    players = db.execute(
        select(Player)
        .join(MatchPlayer, MatchPlayer.player_id == Player.id)
        .where(MatchPlayer.match_id == match_id)
    ).scalars().all()

    updated = 0

    for player in players:
        if player.gender in ("", "unknown"):
            player.gender = gender
            updated += 1

    db.flush()

    return updated


def match_roster(db: Session, match_id: int) -> dict[int, list[dict]]:
    """{隊伍: [選手]}，隊內依 seat 排序。"""

    rows = db.execute(
        select(
            MatchPlayer.team,
            MatchPlayer.seat,
            Player.id,
            Player.name,
            Player.display_name,
            Player.gender,
        )
        .join(Player, Player.id == MatchPlayer.player_id)
        .where(MatchPlayer.match_id == match_id)
        .order_by(MatchPlayer.team, MatchPlayer.seat)
    ).all()

    roster: dict[int, list[dict]] = {}

    for team, seat, player_id, name, display_name, player_gender in rows:
        roster.setdefault(int(team), []).append(
            {
                "player_id": player_id,
                "name": display_name or name,
                "gender": player_gender,
                "seat": int(seat),
            }
        )

    return roster


def match_players(db: Session, match_id: int) -> list[dict]:
    """一場比賽出現過的選手，附上出賽 rally 數與站過的半場。

    半場是逐球決定的（Rally.up_team），所以這裡要把名單和 rally 對起來算。
    """

    roster = match_roster(db, match_id)

    if not roster:
        return []

    counts = db.execute(
        select(Rally.up_team, func.count(Rally.id))
        .where(Rally.match_id == match_id)
        .group_by(Rally.up_team)
    ).all()

    up_rallies = {int(team): int(count) for team, count in counts}
    total = sum(up_rallies.values())

    players: list[dict] = []

    for team, members in roster.items():
        as_up = up_rallies.get(team, 0)
        courts = []

        if as_up:
            courts.append("up")

        if total - as_up:
            courts.append("down")

        for member in members:
            players.append(
                {
                    "player_id": member["player_id"],
                    "name": member["name"],
                    "gender": member["gender"],
                    "team": team,
                    "courts": sorted(courts),
                    "rally_count": total,
                }
            )

    players.sort(key=lambda item: (-item["rally_count"], item["name"]))

    return players


def match_discipline(db: Session, match_id: int) -> str | None:
    """從實際出賽的名單推導比賽項目。

    每隊一個人是單打、兩個人是雙打；兩隊性別相同就是男子或女子，不同就是
    混合。這比拿 SMPL 模型的性別來標好，因為混合雙打表達得出來。
    """

    roster = match_roster(db, match_id)

    if not roster:
        return None

    doubles = any(len(members) > 1 for members in roster.values())

    genders = {
        member["gender"]
        for members in roster.values()
        for member in members
        if member["gender"] in ("male", "female")
    }

    if len(genders) == 1:
        gender = next(iter(genders))
    elif len(genders) > 1:
        gender = "mixed" if doubles else "unknown"
    else:
        gender = "unknown"

    return f"{gender}_{'doubles' if doubles else 'singles'}"


def match_game_results(db: Session, match_id: int) -> list[dict]:
    """每一局的最終比分，取自該局最後一球打完之後的分數。"""

    rallies = db.execute(
        select(Rally)
        .where(Rally.match_id == match_id)
        .order_by(Rally.game_index, Rally.start_frame)
    ).scalars().all()

    last_of_game: dict[int, Rally] = {}

    for rally in rallies:
        last_of_game[int(rally.game_index)] = rally

    results = []

    for game_index in sorted(last_of_game):
        rally = last_of_game[game_index]
        scores = {
            int(rally.up_team): int(rally.up_score),
            1 - int(rally.up_team): int(rally.down_score),
        }

        results.append(
            {
                "game_index": game_index,
                "scores": [scores.get(0, 0), scores.get(1, 0)],
                "winner_team": (
                    0 if scores.get(0, 0) > scores.get(1, 0)
                    else 1 if scores.get(1, 0) > scores.get(0, 0)
                    else None
                ),
            }
        )

    return results
