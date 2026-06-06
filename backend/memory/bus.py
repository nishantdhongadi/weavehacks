import asyncio
from .redis_client import get_redis, MEMORY_STREAM, IMMUNE_STREAM, CONSUMER_GROUP


async def consume_memory_events(consumer_name: str = "validator-1"):
    """Async generator yielding memory write events for the immune swarm to process."""
    r = await get_redis()
    while True:
        try:
            messages = await r.xreadgroup(
                groupname=CONSUMER_GROUP,
                consumername=consumer_name,
                streams={MEMORY_STREAM: ">"},
                count=10,
                block=1000,
            )
            if not messages:
                await asyncio.sleep(0.1)
                continue
            for stream_name, entries in messages:
                for msg_id, fields in entries:
                    decoded = {
                        k.decode() if isinstance(k, bytes) else k:
                        v.decode() if isinstance(v, bytes) else v
                        for k, v in fields.items()
                    }
                    yield msg_id, decoded
                    await r.xack(MEMORY_STREAM, CONSUMER_GROUP, msg_id)
        except Exception as e:
            print(f"[bus] consume error: {e}")
            await asyncio.sleep(1)


async def publish_quarantine_proposal(proposal_dict: dict):
    r = await get_redis()
    await r.xadd(IMMUNE_STREAM, proposal_dict)
