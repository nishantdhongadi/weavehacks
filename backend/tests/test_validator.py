"""
Tests for the Validator agent — the most critical component for the demo.

Run without OpenAI key (logic tests):  pytest tests/ -m "not live"
Run with OpenAI key (full real tests):  pytest tests/ -m live
"""
import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from memory.schemas import ConflictReport


# ── Shared mock factory ────────────────────────────────────────────────────────

def _mock_openai_response(payload: dict):
    """Build a fake OpenAI chat completion response."""
    msg = MagicMock()
    msg.content = json.dumps(payload)
    choice = MagicMock()
    choice.message = msg
    resp = MagicMock()
    resp.choices = [choice]
    return resp


# ── Unit tests (no API key required) ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_detects_contradiction_unit():
    """Validator correctly parses a high-confidence contradiction response."""
    from agents.immune.validator import check_for_contradiction

    payload = {
        "has_contradiction": True,
        "conflicting_memory_content": "The API key is static and never changes.",
        "explanation": "New memory says key rotates daily; existing says it never changes.",
        "confidence": 0.95,
    }
    candidates = [{"id": "mem-b", "content": "The API key is static and never changes.", "trust_score": 1.0}]

    mock_openai = MagicMock()
    mock_openai.chat.completions.create = AsyncMock(return_value=_mock_openai_response(payload))
    with patch("agents.immune.validator._get_client", return_value=mock_openai):
        result = await check_for_contradiction("mem-a", "The API key rotates every 24 hours.", candidates)

    assert result is not None
    assert isinstance(result, ConflictReport)
    assert result.memory_a_id == "mem-a"
    assert result.memory_b_id == "mem-b"
    assert result.confidence == 0.95


@pytest.mark.asyncio
async def test_no_contradiction_unit():
    """Validator correctly handles a no-contradiction response."""
    from agents.immune.validator import check_for_contradiction

    payload = {
        "has_contradiction": False,
        "conflicting_memory_content": None,
        "explanation": None,
        "confidence": 0.1,
    }
    candidates = [{"id": "mem-b", "content": "The deployment runs on AWS us-east-1.", "trust_score": 1.0}]

    mock_openai = MagicMock()
    mock_openai.chat.completions.create = AsyncMock(return_value=_mock_openai_response(payload))
    with patch("agents.immune.validator._get_client", return_value=mock_openai):
        result = await check_for_contradiction("mem-a", "The API key rotates every 24 hours.", candidates)

    assert result is None


@pytest.mark.asyncio
async def test_low_confidence_filtered_unit():
    """Contradictions below the 0.7 confidence threshold are filtered."""
    from agents.immune.validator import check_for_contradiction

    payload = {
        "has_contradiction": True,
        "conflicting_memory_content": "The service sometimes needs maintenance.",
        "explanation": "Minor overlap.",
        "confidence": 0.45,  # below threshold
    }
    candidates = [{"id": "mem-b", "content": "The service sometimes needs maintenance.", "trust_score": 1.0}]

    mock_openai = MagicMock()
    mock_openai.chat.completions.create = AsyncMock(return_value=_mock_openai_response(payload))
    with patch("agents.immune.validator._get_client", return_value=mock_openai):
        result = await check_for_contradiction("mem-a", "The service may occasionally restart.", candidates)

    assert result is None


@pytest.mark.asyncio
async def test_empty_candidates_returns_none_unit():
    """No LLM call is made when there are no candidates."""
    from agents.immune.validator import check_for_contradiction

    mock_openai = MagicMock()
    mock_openai.chat.completions.create = AsyncMock()
    with patch("agents.immune.validator._get_client", return_value=mock_openai):
        result = await check_for_contradiction("mem-a", "The sky is blue.", [])
        mock_openai.chat.completions.create.assert_not_called()

    assert result is None


# ── Integration tests (require OPENAI_API_KEY) ─────────────────────────────────

CLEAR_CONTRADICTION_CASES = [
    (
        "The API key rotates every 24 hours.",
        [{"id": "mem-b", "content": "The API key is static and never changes.", "trust_score": 1.0}],
    ),
    (
        "The database is PostgreSQL.",
        [{"id": "mem-b", "content": "The database is MySQL, not PostgreSQL.", "trust_score": 1.0}],
    ),
    (
        "The office is located in San Francisco.",
        [{"id": "mem-b", "content": "The office is located in New York City.", "trust_score": 1.0}],
    ),
]

COMPATIBLE_CASES = [
    (
        "The API key rotates every 24 hours.",
        [{"id": "mem-b", "content": "The deployment runs on AWS us-east-1.", "trust_score": 1.0}],
    ),
    (
        "Redis is used for caching.",
        [{"id": "mem-b", "content": "PostgreSQL is used for persistent storage.", "trust_score": 1.0}],
    ),
]


@pytest.mark.live
@pytest.mark.asyncio
@pytest.mark.parametrize("new_content,candidates", CLEAR_CONTRADICTION_CASES)
async def test_detects_contradiction_live(new_content, candidates):
    """Real LLM call — run when OPENAI_API_KEY is available."""
    from agents.immune.validator import check_for_contradiction
    result = await check_for_contradiction("mem-a", new_content, candidates)
    assert result is not None, f"Expected contradiction for: '{new_content}'"
    assert result.confidence >= 0.7


@pytest.mark.live
@pytest.mark.asyncio
@pytest.mark.parametrize("new_content,candidates", COMPATIBLE_CASES)
async def test_no_false_positive_live(new_content, candidates):
    """Real LLM call — compatible memories must not fire."""
    from agents.immune.validator import check_for_contradiction
    result = await check_for_contradiction("mem-a", new_content, candidates)
    assert result is None, f"False positive for: '{new_content}'"
