"""LLM 호출 통합 클라이언트.

provider 선택: 'gemini' | 'openai' | 'anthropic'
모든 provider는 동일한 `generate(prompt) -> GenerationResult` 인터페이스를 노출.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Literal

logger = logging.getLogger(__name__)

Provider = Literal["gemini", "openai", "anthropic"]

DEFAULT_MODELS: dict[Provider, str] = {
    "gemini": "gemini-2.5-flash",
    "openai": "gpt-4o",
    "anthropic": "claude-sonnet-4-5",
}


@dataclass
class GenerationResult:
    text: str
    provider: Provider
    model: str
    duration_ms: int
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class LLMClient:
    """provider-agnostic LLM 호출. 직접 SDK 의존성을 lazy import."""

    def __init__(
        self,
        provider: Provider = "gemini",
        model: str | None = None,
        temperature: float = 0.5,
        max_output_tokens: int = 8000,
    ):
        self.provider = provider
        self.model = model or DEFAULT_MODELS[provider]
        self.temperature = temperature
        self.max_output_tokens = max_output_tokens

    def generate(self, prompt: str) -> GenerationResult:
        t0 = time.time()
        if self.provider == "gemini":
            text, pt, ct = self._call_gemini(prompt)
        elif self.provider == "openai":
            text, pt, ct = self._call_openai(prompt)
        elif self.provider == "anthropic":
            text, pt, ct = self._call_anthropic(prompt)
        else:
            raise ValueError(f"지원하지 않는 provider: {self.provider}")

        return GenerationResult(
            text=text,
            provider=self.provider,
            model=self.model,
            duration_ms=int((time.time() - t0) * 1000),
            prompt_tokens=pt,
            completion_tokens=ct,
        )

    def _call_gemini(self, prompt: str) -> tuple[str, int | None, int | None]:
        import google.generativeai as genai
        key = os.getenv("GEMINI_API_KEY")
        if not key:
            raise RuntimeError("GEMINI_API_KEY 환경변수가 비어있습니다.")
        genai.configure(api_key=key)
        model = genai.GenerativeModel(self.model)
        resp = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                temperature=self.temperature,
                max_output_tokens=self.max_output_tokens,
                response_mime_type="application/json",
            ),
        )
        # google-generativeai는 usage_metadata 로 토큰 수 제공
        usage = getattr(resp, "usage_metadata", None)
        pt = getattr(usage, "prompt_token_count", None) if usage else None
        ct = getattr(usage, "candidates_token_count", None) if usage else None
        return resp.text or "", pt, ct

    def _call_openai(self, prompt: str) -> tuple[str, int | None, int | None]:
        from openai import OpenAI
        key = os.getenv("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("OPENAI_API_KEY 환경변수가 비어있습니다.")
        client = OpenAI(api_key=key)
        resp = client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=self.temperature,
            max_tokens=self.max_output_tokens,
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content or ""
        usage = resp.usage
        return content, usage.prompt_tokens if usage else None, usage.completion_tokens if usage else None

    def _call_anthropic(self, prompt: str) -> tuple[str, int | None, int | None]:
        import anthropic
        key = os.getenv("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY 환경변수가 비어있습니다.")
        client = anthropic.Anthropic(api_key=key)
        resp = client.messages.create(
            model=self.model,
            max_tokens=self.max_output_tokens,
            temperature=self.temperature,
            messages=[{"role": "user", "content": prompt}],
        )
        # Anthropic 응답은 content 배열 — 첫 번째 텍스트 블록 사용
        text = ""
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                text += block.text
        usage = resp.usage
        return text, usage.input_tokens if usage else None, usage.output_tokens if usage else None
