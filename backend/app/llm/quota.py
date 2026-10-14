"""In-process rate limiter so free-tier limits are respected (ARCHITECTURE.md section 8).

Daily per-user and global counters will live in Firestore (Day 1); this is the per-minute bucket.
"""

from __future__ import annotations

import asyncio
import time
from typing import Callable


class TokenBucket:
    def __init__(self, per_minute: int, *, clock: Callable[[], float] = time.monotonic):
        if per_minute <= 0:
            raise ValueError("per_minute must be positive")
        self.capacity = float(per_minute)
        self.rate = per_minute / 60.0
        self._tokens = float(per_minute)
        self._clock = clock
        self._last = clock()

    def _refill(self) -> None:
        now = self._clock()
        self._tokens = min(self.capacity, self._tokens + (now - self._last) * self.rate)
        self._last = now

    def try_take(self) -> bool:
        self._refill()
        if self._tokens >= 1.0:
            self._tokens -= 1.0
            return True
        return False

    def seconds_until_available(self) -> float:
        self._refill()
        if self._tokens >= 1.0:
            return 0.0
        return (1.0 - self._tokens) / self.rate

    async def acquire(self, *, max_wait: float) -> bool:
        """Wait up to max_wait seconds for a token. Returns False if it would take longer."""
        wait = self.seconds_until_available()
        if wait > max_wait:
            return False
        if wait > 0:
            await asyncio.sleep(wait)
        return self.try_take()
