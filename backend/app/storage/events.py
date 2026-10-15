"""Event sink interface and adapters (ARCHITECTURE.md section 11).

Today: LoggingEventSink (logs events as JSON to stdout).
Credits-ready: BigQueryEventSink for BigQuery analytics.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Mapping, Protocol

log = logging.getLogger("unstuck.events")


class EventSink(Protocol):
    def emit(self, event_name: str, payload: Mapping[str, Any]) -> None:
        """Emit an analytics / audit event."""
        ...


class LoggingEventSink:
    def emit(self, event_name: str, payload: Mapping[str, Any]) -> None:
        # Never log sensitive data; payloads are pre-sanitized
        log.info(json.dumps({"event": event_name, **payload}))


_default_event_sink: EventSink = LoggingEventSink()


def get_event_sink() -> EventSink:
    return _default_event_sink
