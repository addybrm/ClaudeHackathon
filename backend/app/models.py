"""SQLAlchemy models. Money is stored as Numeric(12,4) and handled as Decimal."""
from datetime import date, datetime, timezone
from decimal import Decimal
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base

Money = Numeric(12, 4)


class Restaurant(Base):
    __tablename__ = "restaurants"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    currency: Mapped[str] = mapped_column(String(3), default="GBP")
    region: Mapped[str] = mapped_column(String(120))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=True)


class Location(Base):
    __tablename__ = "locations"
    id: Mapped[int] = mapped_column(primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id"))
    name: Mapped[str] = mapped_column(String(120))
    city: Mapped[str] = mapped_column(String(80))


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(160), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20))  # owner | manager | kitchen | finance
    password_hash: Mapped[str] = mapped_column(String(300))


class Supplier(Base):
    __tablename__ = "suppliers"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    category: Mapped[str] = mapped_column(String(60), default="General")
    contact_email: Mapped[str | None] = mapped_column(String(160), nullable=True)


class Ingredient(Base):
    __tablename__ = "ingredients"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    unit: Mapped[str] = mapped_column(String(10))  # kg | l | each | portion
    category: Mapped[str] = mapped_column(String(40))
    primary_supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"), nullable=True)


class PriceRecord(Base):
    """Every observed unit price for an ingredient from a supplier (invoice line or quote)."""
    __tablename__ = "price_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    ingredient_id: Mapped[str] = mapped_column(ForeignKey("ingredients.id"), index=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"))
    observed_on: Mapped[date] = mapped_column(Date, index=True)
    unit_price: Mapped[Decimal] = mapped_column(Money)
    source: Mapped[str] = mapped_column(String(20))  # invoice | quote
    invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id"), nullable=True)


class Dish(Base):
    __tablename__ = "dishes"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(40))
    selling_price: Mapped[Decimal] = mapped_column(Money)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    recipe: Mapped[list["RecipeLine"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class RecipeLine(Base):
    __tablename__ = "recipe_lines"
    __table_args__ = (UniqueConstraint("dish_id", "ingredient_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    dish_id: Mapped[str] = mapped_column(ForeignKey("dishes.id"))
    ingredient_id: Mapped[str] = mapped_column(ForeignKey("ingredients.id"))
    quantity: Mapped[Decimal] = mapped_column(Money)  # in the ingredient's unit


class Sale(Base):
    """Units sold of a dish at a location during the week starting `week_start` (Monday)."""
    __tablename__ = "sales"
    id: Mapped[int] = mapped_column(primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), index=True)
    dish_id: Mapped[str] = mapped_column(ForeignKey("dishes.id"), index=True)
    week_start: Mapped[date] = mapped_column(Date, index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Money)


class Invoice(Base):
    __tablename__ = "invoices"
    id: Mapped[int] = mapped_column(primary_key=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"))
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"))
    invoice_number: Mapped[str | None] = mapped_column(String(60), nullable=True)
    invoice_date: Mapped[date] = mapped_column(Date, index=True)
    source: Mapped[str] = mapped_column(String(20), default="seed")  # seed | manual | csv | pdf | image
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    lines: Mapped[list["InvoiceLine"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), index=True)
    ingredient_id: Mapped[str] = mapped_column(ForeignKey("ingredients.id"))
    quantity: Mapped[Decimal] = mapped_column(Money)    # in the ingredient's unit
    unit_price: Mapped[Decimal] = mapped_column(Money)  # per ingredient unit
    line_total: Mapped[Decimal] = mapped_column(Money)


class WasteRecord(Base):
    __tablename__ = "waste_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"))
    ingredient_id: Mapped[str] = mapped_column(ForeignKey("ingredients.id"))
    recorded_on: Mapped[date] = mapped_column(Date, index=True)
    quantity: Mapped[Decimal] = mapped_column(Money)
    unit: Mapped[str] = mapped_column(String(10))
    reason: Mapped[str] = mapped_column(String(30))  # expired | spoiled | overproduction | prep_error | returned
    unit_cost: Mapped[Decimal] = mapped_column(Money)  # price in effect on the date
    cost: Mapped[Decimal] = mapped_column(Money)
    recorded_by: Mapped[str | None] = mapped_column(String(160), nullable=True)
