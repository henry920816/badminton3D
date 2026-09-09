from sqlalchemy import MetaData

from app.db import engine
from app.models import Base


def reset():
    # 用反射讀資料庫「實際上」有哪些表，而不是只看目前的 model。
    # 這個專案沒有 migration，拿掉一個 model 之後那張表仍然留在資料庫裡，
    # 若只依 Base.metadata 去刪，殘留表上的外鍵會擋住被它參照的表。
    existing = MetaData()
    existing.reflect(bind=engine)

    print(f"Dropping {len(existing.tables)} tables...")
    existing.drop_all(bind=engine)

    print("Creating all tables...")
    Base.metadata.create_all(bind=engine)

    print("Database reset complete. All tables are fresh and empty!")


if __name__ == "__main__":
    reset()
