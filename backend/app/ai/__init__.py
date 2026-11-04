"""AI provider abstraction (Module G).

get_provider() returns the live Anthropic provider only when ANTHROPIC_API_KEY is configured;
otherwise the deterministic DemoProvider. Responses always carry `provider` and `live_ai`
so the UI can label them honestly. A Claude Pro/Max subscription is not an API key.
"""
from .. import config
from .base import AIProvider
from .demo import DemoProvider


def get_provider() -> AIProvider:
    if config.ANTHROPIC_API_KEY:
        from .anthropic_provider import AnthropicProvider
        return AnthropicProvider(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL)
    return DemoProvider()
