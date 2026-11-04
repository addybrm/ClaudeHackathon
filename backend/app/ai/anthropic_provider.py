"""Live Claude provider. Enabled only when ANTHROPIC_API_KEY is set (server-side; never sent to the browser).
Claude receives the deterministic figures as JSON and is instructed to explain them, not invent new ones.

Model: ANTHROPIC_MODEL (default claude-opus-5-5; set claude-sonnet-5-5 to roughly halve AI cost).
Thinking is always on for current models, so max_tokens leaves room for it; effort controls depth.
Server-side refusal fallback ("default" routing) is enabled; a final refusal raises so the API falls
back to the labelled demo advisor instead of showing an empty answer.
"""
import base64
import json

SYSTEM = (
    "You are the MARGIN OS advisor for an independent restaurant in North East England. The user is a busy owner or "
    "manager without accounting training. Use ONLY figures in the provided JSON (GBP); never invent or recalculate "
    "numbers that are not there. If data is missing, say so. Gross margin is profit as a share of selling price; never "
    "confuse it with markup. Forecasts and scenarios are projections: label them as such. Reply in under 200 words: "
    "one or two sentences of diagnosis, then 2-4 numbered, practical actions with the £ impact where the JSON gives it."
)
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class ClaudeRefusal(Exception):
    pass


class AnthropicProvider:
    name = "anthropic"
    live = True

    def __init__(self, api_key: str, model: str):
        import anthropic
        self.client = anthropic.Anthropic(api_key=api_key, timeout=60.0, max_retries=1)
        self.model = model

    def _create(self, **kw):
        msg = self.client.beta.messages.create(
            model=self.model, max_tokens=16000, output_config={"effort": "medium"},
            betas=[FALLBACK_BETA], fallbacks="default", **kw)
        if msg.stop_reason == "refusal":
            raise ClaudeRefusal(getattr(msg.stop_details, "category", None) or "refusal")
        return msg

    @staticmethod
    def _text(msg) -> str:
        return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()

    def answer(self, question: str, context: dict) -> dict:
        msg = self._create(system=SYSTEM, messages=[{"role": "user", "content":
                           f"<restaurant_data>\n{json.dumps(context, default=str)}\n</restaurant_data>\n\nQuestion: {question}"}])
        return {"intent": "llm", "answer": self._text(msg)}

    def extract_invoice_image(self, content: bytes, media_type: str, ingredients: list) -> dict | None:
        names = ", ".join(f"{i.name} ({i.unit})" for i in ingredients)
        prompt = ("Extract this supplier invoice as JSON only, no prose: {\"supplier_name\": str|null, \"invoice_date\": "
                  "\"YYYY-MM-DD\"|null, \"invoice_number\": str|null, \"lines\": [{\"description\": str, \"quantity\": number, "
                  "\"unit\": str, \"unit_price\": number, \"line_total\": number}]}. Use null for anything unreadable; do not "
                  f"guess. Known ingredients for naming: {names}.")
        msg = self._create(messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media_type,
                                         "data": base64.standard_b64encode(content).decode()}},
            {"type": "text", "text": prompt}]}])
        text = self._text(msg)
        try:
            return json.loads(text[text.index("{"): text.rindex("}") + 1])
        except ValueError:
            return None
