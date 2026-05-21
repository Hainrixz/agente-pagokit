# SQLAlchemy — DB Adapter

Schema and Alembic migration patterns for SQLAlchemy 2.x. Same 5 tables as Prisma/Drizzle.

## Schema model

Append to `app/models.py` (or wherever the user's existing models live; read first):

```python
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB
from uuid import uuid4

from .database import Base  # the user's existing declarative base

# ---- PagoKit tables ----

class PagokitCustomer(Base):
    __tablename__ = "pagokit_customers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    provider: Mapped[str] = mapped_column(String, nullable=False)
    provider_customer_id: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    payments = relationship("PagokitPayment", back_populates="customer")
    subscriptions = relationship("PagokitSubscription", back_populates="customer")

    __table_args__ = (
        UniqueConstraint("provider", "provider_customer_id", name="pagokit_customers_provider_id_unique"),
        Index("pagokit_customers_provider_email_idx", "provider", "email"),
    )

class PagokitPayment(Base):
    __tablename__ = "pagokit_payments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    provider: Mapped[str] = mapped_column(String, nullable=False)
    provider_payment_id: Mapped[str] = mapped_column(String, nullable=False)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    customer_id: Mapped[str | None] = mapped_column(String, ForeignKey("pagokit_customers.id"), nullable=True)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    customer = relationship("PagokitCustomer", back_populates="payments")

    __table_args__ = (
        UniqueConstraint("provider", "provider_payment_id", name="pagokit_payments_provider_id_unique"),
        Index("pagokit_payments_provider_status_idx", "provider", "status"),
    )

class PagokitSubscription(Base):
    __tablename__ = "pagokit_subscriptions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    provider: Mapped[str] = mapped_column(String, nullable=False)
    provider_subscription_id: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    customer_id: Mapped[str] = mapped_column(String, ForeignKey("pagokit_customers.id"), nullable=False)
    plan_id: Mapped[str | None] = mapped_column(String, nullable=True)
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    customer = relationship("PagokitCustomer", back_populates="subscriptions")

    __table_args__ = (
        UniqueConstraint("provider", "provider_subscription_id", name="pagokit_subs_provider_id_unique"),
    )

class PagokitIdempotencyKey(Base):
    __tablename__ = "pagokit_idempotency_keys"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    request_hash: Mapped[str] = mapped_column(String, nullable=False)
    response: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("pagokit_idempotency_keys_expires_idx", "expires_at"),
    )

class PagokitWebhookEventProcessed(Base):
    __tablename__ = "pagokit_webhook_events_processed"

    event_id: Mapped[str] = mapped_column(String, primary_key=True)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("pagokit_webhook_events_provider_received_idx", "provider", "received_at"),
        Index("pagokit_webhook_events_expires_idx", "expires_at"),
    )
```

## Session / database export (`app/database.py`)

PagoKit-generated routes import `db` (a SQLAlchemy session) and the `Base` declarative class. If they don't already exist, generate:

```python
# app/database.py
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.environ["DATABASE_URL"]

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

In FastAPI routes use `Depends(get_db)`:

```python
from fastapi import Depends
from sqlalchemy.orm import Session
from app.database import get_db

@app.post("/api/checkout")
async def checkout(payload: dict, db: Session = Depends(get_db)):
    # ...
```

## Alembic migration

```bash
# Generate the migration
alembic revision --autogenerate -m "pagokit_init"

# Review the generated file in alembic/versions/<id>_pagokit_init.py, then:
alembic upgrade head
```

Always review the autogenerated file before applying — alembic occasionally misses index ordering or default values.

## Query patterns

### Persist an idempotency key with FastAPI

```python
from uuid import uuid4
from hashlib import sha256
from datetime import datetime, timedelta
import json
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

def checkout_with_idempotency(db: Session, payload: dict) -> dict:
    key = str(uuid4())  # Rule 4
    request_hash = sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    expires_at = datetime.utcnow() + timedelta(hours=24)

    row = PagokitIdempotencyKey(
        key=key,
        request_hash=request_hash,
        expires_at=expires_at,
    )
    try:
        db.add(row)
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.get(PagokitIdempotencyKey, key)
        if existing and existing.response:
            return existing.response
        raise

    # Call provider with `key` as the Idempotency-Key header
    result = provider.create(payload, idempotency_key=key)

    row.response = result
    db.commit()
    return result
```

### Webhook event dedup

```python
def dedup_webhook_event(db: Session, event_id: str, provider: str, event_type: str) -> bool:
    row = PagokitWebhookEventProcessed(
        event_id=event_id,
        provider=provider,
        event_type=event_type,
        expires_at=datetime.utcnow() + timedelta(days=7),
    )
    try:
        db.add(row)
        db.commit()
    except IntegrityError:
        db.rollback()
        return True  # already processed
    return False
```

## Anti-patterns

- ❌ Skipping `timezone=True` on `DateTime` → silent UTC ↔ local mismatch bugs.
- ❌ Using `Column(Integer, primary_key=True)` with `autoincrement` for `event_id` — that's the provider's ID.
- ❌ Forgetting `db.rollback()` after IntegrityError → session left in invalid state.
- ❌ Storing card details, CVV, or full PAN. Only provider tokens. (Rule 12)
