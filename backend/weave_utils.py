import os
import weave
from dotenv import load_dotenv

load_dotenv()

_initialized = False


def init_weave():
    """Initialize Weave tracing. Call once at app startup before any @weave.op functions run.

    Project string format:
      - If WANDB_ENTITY is set: "{WANDB_ENTITY}/memory-immune-system"
      - Otherwise: "memory-immune-system"  (uses the logged-in user's default entity)
    """
    global _initialized
    if not _initialized:
        entity = os.getenv("WANDB_ENTITY", "").strip()
        project = "memory-immune-system"
        project_str = f"{entity}/{project}" if entity else project
        weave.init(project_str)
        _initialized = True


def get_wandb_api():
    import wandb
    return wandb.Api()
