import numpy as np
from pathlib import Path


CAMERA_DIR = Path("cameras")


def load_camera(cam_id: int):
    intrinsic_path = CAMERA_DIR / f"Cam_{cam_id}_intrinsic.npy"
    extrinsic_path = CAMERA_DIR / f"Cam_{cam_id}_extrinsic.npy"

    if not intrinsic_path.exists():
        raise FileNotFoundError(f"找不到 intrinsic 檔案: {intrinsic_path}")

    if not extrinsic_path.exists():
        raise FileNotFoundError(f"找不到 extrinsic 檔案: {extrinsic_path}")

    intrinsic = np.load(intrinsic_path)
    extrinsic = np.load(extrinsic_path)

    return intrinsic, extrinsic


def print_camera(cam_id: int):
    intrinsic, extrinsic = load_camera(cam_id)

    print(f"========== Cam_{cam_id} ==========")

    print("\n[Intrinsic]")
    print("shape:", intrinsic.shape)
    print("dtype:", intrinsic.dtype)
    print(intrinsic)

    print("\n[Extrinsic]")
    print("shape:", extrinsic.shape)
    print("dtype:", extrinsic.dtype)
    print(extrinsic)

    if intrinsic.shape == (9,):
        fx, fy, cx, cy, k1, k2, p1, p2, k3 = intrinsic

        print("\n[Intrinsic 拆解]")
        print("fx:", fx)
        print("fy:", fy)
        print("cx:", cx)
        print("cy:", cy)
        print("k1:", k1)
        print("k2:", k2)
        print("p1:", p1)
        print("p2:", p2)
        print("k3:", k3)

        K = np.array([
            [fx, 0, cx],
            [0, fy, cy],
            [0, 0, 1],
        ])

        print("\n[Camera Matrix K]")
        print(K)

    if extrinsic.shape == (3, 4):
        R = extrinsic[:, :3]
        t = extrinsic[:, 3]

        print("\n[Rotation R]")
        print(R)

        print("\n[Translation t]")
        print(t)


def print_all_cameras():
    for cam_id in range(10):
        print_camera(cam_id)
        print("\n" + "=" * 50 + "\n")


if __name__ == "__main__":
    # 只看單一相機
    print_camera(0)

    # 如果要全部看，改成這行
    # print_all_cameras()