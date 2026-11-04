from typing import Protocol


class AIProvider(Protocol):
    name: str          # "demo" | "anthropic"
    live: bool         # True only when a real model API call is made

    def answer(self, question: str, context: dict) -> dict:
        """Return {"answer": str, "intent": str}. Must only use figures present in `context`."""
        ...

    def extract_invoice_image(self, content: bytes, media_type: str, ingredients: list) -> dict | None:
        """Return {"supplier_name","invoice_date","invoice_number","lines":[...]} or None if unsupported."""
        ...
