from datetime import date
from pydantic import BaseModel, Field, field_validator, model_validator

ID = r"^[a-z0-9_]{2,40}$"


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=160)
    password: str = Field(..., min_length=1, max_length=200)


class AdvisorRequest(BaseModel):
    question: str | None = Field(None, max_length=1000)
    message: str | None = Field(None, max_length=1000)  # alias accepted for the v1 frontend
    start: date | None = None
    end: date | None = None
    location_id: int | None = None

    @model_validator(mode="after")
    def _q(self):
        q = (self.question or self.message or "").strip()
        if len(q) < 3:
            raise ValueError("question must be at least 3 characters")
        self.question = q
        return self


class RecipeLineIn(BaseModel):
    ingredient_id: str
    quantity: float = Field(..., gt=0, le=100)


class DishIn(BaseModel):
    id: str | None = Field(None, pattern=ID)
    name: str = Field(..., min_length=2, max_length=120)
    category: str = Field("Mains", min_length=2, max_length=40)
    selling_price: float = Field(..., gt=0, le=1000)
    recipe: list[RecipeLineIn] = Field(..., min_length=1, max_length=40)

    @field_validator("recipe")
    @classmethod
    def _unique(cls, v):
        ids = [l.ingredient_id for l in v]
        if len(ids) != len(set(ids)):
            raise ValueError("each ingredient may appear only once in a recipe")
        return v


class InvoiceLineIn(BaseModel):
    ingredient_id: str
    quantity: float = Field(..., gt=0, lt=100000)
    unit: str | None = Field(None, max_length=10)
    unit_price: float = Field(..., gt=0, lt=10000)
    line_total: float | None = Field(None, ge=0)
    description: str | None = Field(None, max_length=200)


class InvoiceConfirm(BaseModel):
    supplier_id: int | None = None
    supplier_name: str | None = Field(None, max_length=120)
    supplier: str | None = Field(None, max_length=120)  # v1 alias
    location_id: int | None = None
    invoice_number: str | None = Field(None, max_length=60)
    invoice_date: date | None = None
    source: str = Field("manual", pattern=r"^(manual|csv|pdf|image)$")
    lines: list[InvoiceLineIn] = Field(..., min_length=1, max_length=200)

    @model_validator(mode="after")
    def _defaults(self):
        self.supplier_name = self.supplier_name or self.supplier
        self.invoice_date = self.invoice_date or date.today()
        return self


class WasteIn(BaseModel):
    ingredient_id: str
    quantity: float = Field(..., gt=0, le=10000)
    unit: str | None = Field(None, max_length=10)
    reason: str = Field(..., pattern=r"^(expired|spoiled|overproduction|prep_error|returned|other)$")
    recorded_on: date | None = None
    location_id: int = 1


class SimulationIn(BaseModel):
    ingredient_price_changes_pct: dict[str, float] = Field(default_factory=dict)
    menu_prices: dict[str, float] = Field(default_factory=dict)
    volume_changes_pct: dict[str, float] = Field(default_factory=dict)
    basis_weeks: int = Field(4, ge=1, le=12)
    location_id: int | None = None

    @model_validator(mode="after")
    def _ranges(self):
        for k, v in {**self.ingredient_price_changes_pct, **self.volume_changes_pct}.items():
            if not -90 <= v <= 500:
                raise ValueError(f"{k}: percentage change must be between -90 and 500")
        for k, v in self.menu_prices.items():
            if not 0 < v <= 1000:
                raise ValueError(f"{k}: menu price must be between 0 and 1000")
        return self
