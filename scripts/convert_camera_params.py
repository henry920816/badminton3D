import argparse
import json
from pathlib import Path

import numpy as np


def load_camera_params(input_dir: Path, image_width: int, image_height: int):
    cameras = {}

    for intrinsic_path in sorted(input_dir.glob("Cam_*_intrinsic.npy")):
        cam_name = intrinsic_path.stem.replace("_intrinsic", "")
        cam_index = cam_name.replace("Cam_", "")
        cam_id = f"cam{cam_index}"

        extrinsic_path = input_dir / f"{cam_name}_extrinsic.npy"

        if not extrinsic_path.exists():
            print(f"Skip {cam_name}: missing {extrinsic_path.name}")
            continue

        intrinsic = np.load(intrinsic_path).astype(float)
        extrinsic = np.load(extrinsic_path).astype(float)

        if intrinsic.shape != (9,):
            raise ValueError(f"{intrinsic_path} shape should be (9,), got {intrinsic.shape}")

        if extrinsic.shape != (3, 4):
            raise ValueError(f"{extrinsic_path} shape should be (3, 4), got {extrinsic.shape}")

        cameras[cam_id] = {
            "id": cam_id,
            "label": f"Cam {cam_index}",
            "imageWidth": image_width,
            "imageHeight": image_height,
            "uOffset": 0,
            "vOffset": 0,
            "intrinsic": intrinsic.tolist(),
            "extrinsic": extrinsic.tolist(),
        }

    return cameras


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        default="cameras",
        help="Folder containing Cam_0_intrinsic.npy / Cam_0_extrinsic.npy ...",
    )
    parser.add_argument(
        "--output",
        default="frontend/src/assets/camera_params.json",
        help="Output JSON path",
    )
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1200)

    args = parser.parse_args()

    input_dir = Path(args.input)
    output_path = Path(args.output)

    if not input_dir.exists():
        raise FileNotFoundError(f"Input folder not found: {input_dir}")

    cameras = load_camera_params(input_dir, args.width, args.height)

    if not cameras:
        raise RuntimeError(f"No camera params found in {input_dir}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "coordinateMode": "raw",
        "useLensDistortion": True,
        "courtWorldTransform": {
            "xOffset": 0,
            "zOffset": 0,
            "rotateDeg": 0,
            "xScale": 1,
            "zScale": 1,
            "yOffset": 0,
        },
        "cameras": cameras,
    }

    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Exported {len(cameras)} cameras to {output_path}")


if __name__ == "__main__":
    main()