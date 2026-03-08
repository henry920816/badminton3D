from app.db import engine
from app.models import Base

def reset():
    print("Dropping all tables...")
    Base.metadata.drop_all(bind=engine)
    print("Creating all tables...")
    Base.metadata.create_all(bind=engine)
    print("Database reset complete. All tables are fresh and empty!")

if __name__ == "__main__":
    reset()