from dataclasses import dataclass
from datetime import date
from fastapi import Depends, Query
from sqlalchemy.orm import Session
from ..auth import Principal, require
from ..db import get_db
from ..services.analytics import Period, Snapshot


@dataclass
class Ctx:
    snap: Snapshot
    period: Period
    user: Principal


def analysis_ctx(start: date | None = Query(None, description="Period start (YYYY-MM-DD). Default: 27 days before end."),
                 end: date | None = Query(None, description="Period end (YYYY-MM-DD). Default: last day with sales data."),
                 location_id: int | None = Query(None, description="Omit for all locations"),
                 db: Session = Depends(get_db), user: Principal = Depends(require("read"))) -> Ctx:
    snap = Snapshot(db, location_id)
    return Ctx(snap, snap.period(start, end), user)
