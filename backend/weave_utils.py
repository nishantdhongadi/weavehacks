import os
import weave
from dotenv import load_dotenv

load_dotenv()

_initialized = False


def init_weave():
    global _initialized
    if not _initialized:
        weave.init("weavehacks/memory-immune-system")
        _initialized = True


def get_client():
    import wandb
    return wandb.Api()
