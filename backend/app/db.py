from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from . import config

engine = create_engine(config.DATABASE_URL, connect_args={"check_same_thread": False}
                       if config.DATABASE_URL.startswith("sqlite") else {})


@event.listens_for(engine, "connect")
def _sqlite_fk(dbapi_conn, _):
    if config.DATABASE_URL.startswith("sqlite"):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
