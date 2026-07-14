from __future__ import annotations

import argparse
import hashlib
import shutil
import zipfile
from pathlib import Path, PurePosixPath


REQUIRED_FILES = (
    "human_model_files/smpl/SMPL_NEUTRAL.pkl",
    "human_model_files/smpl/SMPL_MALE.pkl",
    "human_model_files/smpl/SMPL_FEMALE.pkl",
    "racket/racket.obj",
    "racket/Racket.mtl",
    "shuttlecock/shuttlecock.obj",
    "shuttlecock/shuttlecock.mtl",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while True:
            chunk = file.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def normalized_member_path(name: str) -> Path | None:
    parts = [
        part
        for part in PurePosixPath(name.replace("\\", "/")).parts
        if part not in {"", ".", "..", "/"}
    ]

    if not parts or "__MACOSX" in parts:
        return None

    if parts[0].lower().startswith("body_models"):
        parts = parts[1:]

    if not parts:
        return None

    return Path(*parts)


def merge_archive(archive_path: Path, output: Path, overwrite: bool) -> tuple[int, int]:
    copied = 0
    skipped = 0
    output_resolved = output.resolve()

    with zipfile.ZipFile(archive_path) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue

            relative = normalized_member_path(member.filename)
            if relative is None:
                continue

            destination = (output / relative).resolve()
            try:
                destination.relative_to(output_resolved)
            except ValueError as exc:
                raise RuntimeError(
                    f"不安全的 ZIP 路徑：{member.filename}"
                ) from exc

            destination.parent.mkdir(parents=True, exist_ok=True)

            with archive.open(member) as source:
                temporary = destination.with_name(destination.name + ".part")
                with temporary.open("wb") as target:
                    shutil.copyfileobj(source, target, length=1024 * 1024)

            if destination.exists():
                same = (
                    destination.stat().st_size == temporary.stat().st_size
                    and sha256_file(destination) == sha256_file(temporary)
                )

                if same:
                    temporary.unlink()
                    skipped += 1
                    continue

                if not overwrite:
                    temporary.unlink()
                    raise RuntimeError(
                        "三個 part 內有不同內容但相同路徑的檔案："
                        f"{relative}"
                    )

            temporary.replace(destination)
            copied += 1

    return copied, skipped


def main() -> int:
    parser = argparse.ArgumentParser(
        description="將分成三個 ZIP 的 body_models 安全合併回 body_models 資料夾。"
    )
    parser.add_argument("parts", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, default=Path("body_models"))
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)

    total_copied = 0
    total_skipped = 0

    for archive_path in args.parts:
        if not archive_path.is_file():
            raise FileNotFoundError(f"找不到：{archive_path}")

        copied, skipped = merge_archive(
            archive_path,
            args.output,
            args.overwrite,
        )
        total_copied += copied
        total_skipped += skipped
        print(
            f"{archive_path.name}: 新增 {copied}，重複且相同 {skipped}"
        )

    missing = [
        relative
        for relative in REQUIRED_FILES
        if not (args.output / relative).is_file()
    ]

    print(f"輸出位置：{args.output.resolve()}")
    print(f"新增檔案：{total_copied}")
    print(f"略過重複：{total_skipped}")

    if missing:
        print("缺少必要檔案：")
        for relative in missing:
            print(f"  - {relative}")
        return 1

    print("body_models 必要檔案檢查通過。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
