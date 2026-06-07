"""
W&B Weave Evaluation for the contradiction-detection engine.

This is the "Best Use of Weave" piece: instead of only auto-tracing calls, we run
a real Weave Evaluation with a Scorer over a labelled dataset of contradicting and
compatible memory pairs. It produces a Weave eval dashboard (accuracy, per-row
scores, latency, token cost) that proves the detector's reliability with receipts.

Run (needs OPENAI_API_KEY):
    cd backend && source .venv/bin/activate && python weave_eval.py
"""
import asyncio
import weave
from weave import Evaluation

from weave_utils import init_weave
from swarms.immune.validator import check_for_contradiction

# Labelled dataset: each row is a new memory + existing candidates + ground truth.
DATASET = [
    {
        "new_content": "The API key rotates every 24 hours.",
        "candidates": [{"id": "mem-b", "content": "The API key is static and never changes.", "trust_score": 1.0}],
        "expected": True,
    },
    {
        "new_content": "The database is PostgreSQL.",
        "candidates": [{"id": "mem-b", "content": "The database is MySQL, not PostgreSQL.", "trust_score": 1.0}],
        "expected": True,
    },
    {
        "new_content": "The office is located in San Francisco.",
        "candidates": [{"id": "mem-b", "content": "The office is located in New York City.", "trust_score": 1.0}],
        "expected": True,
    },
    {
        "new_content": "The API key rotates every 24 hours.",
        "candidates": [{"id": "mem-b", "content": "The deployment runs on AWS us-east-1.", "trust_score": 1.0}],
        "expected": False,
    },
    {
        "new_content": "Redis is used for caching.",
        "candidates": [{"id": "mem-b", "content": "PostgreSQL is used for persistent storage.", "trust_score": 1.0}],
        "expected": False,
    },
]


@weave.op()
async def detector(new_content: str, candidates: list) -> dict:
    """The model under evaluation: run the real contradiction detector."""
    report = await check_for_contradiction("mem-a", new_content, candidates)
    return {
        "flagged": report is not None,
        "confidence": report.confidence if report else 0.0,
    }


@weave.op()
def contradiction_scorer(expected: bool, output: dict) -> dict:
    """Score a single prediction against ground truth."""
    flagged = output["flagged"]
    return {
        "correct": flagged == expected,
        "true_positive": expected and flagged,
        "false_positive": (not expected) and flagged,
        "false_negative": expected and (not flagged),
    }


async def main():
    init_weave()
    evaluation = Evaluation(
        dataset=DATASET,
        scorers=[contradiction_scorer],
        name="contradiction-detection",
    )
    summary = await evaluation.evaluate(detector)
    print("\n=== Weave Evaluation summary ===")
    print(summary)
    print("\nView the full eval dashboard in your Weave project.")


if __name__ == "__main__":
    asyncio.run(main())
