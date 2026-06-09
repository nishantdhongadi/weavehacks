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

    Non-fatal: logs a warning if Weave is unreachable so the server still starts.
    """
    global _initialized
    if not _initialized:
        entity = os.getenv("WANDB_ENTITY", "").strip()
        project = "memory-immune-system"
        project_str = f"{entity}/{project}" if entity else project
        try:
            weave.init(project_str)
            _initialized = True
            print(f"[weave] initialized — project: {project_str}")
        except Exception as e:
            print(f"[weave] WARNING: could not connect to W&B ({e}). "
                  "Tracing disabled but server will continue.")


def get_wandb_api():
    import wandb
    return wandb.Api()
