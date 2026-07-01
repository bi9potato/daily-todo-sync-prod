from datetime import datetime
from typing import Any

from django.db import transaction
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.authentication import bearer_auth

from .models import ClientLogEntry

router = Router(tags=["diagnostics"])

MAX_BATCH_SIZE = 100
MAX_MESSAGE_LENGTH = 4000
MAX_STACK_LENGTH = 12000


class ClientLogEntryIn(Schema):
    clientId: str
    occurredAt: datetime
    level: str
    source: str = ""
    message: str
    stack: str = ""
    context: dict[str, Any] = {}


class ClientLogBatchIn(Schema):
    sessionId: str
    deviceId: str = ""
    appVersion: str = ""
    buildSha: str = ""
    platform: str = ""
    osVersion: str = ""
    entries: list[ClientLogEntryIn]


class ClientLogBatchOut(Schema):
    accepted: int


def trim(value: str, length: int) -> str:
    return value[:length]


@router.post("/client-logs", response={201: ClientLogBatchOut}, auth=bearer_auth)
@transaction.atomic
def upload_client_logs(request, payload: ClientLogBatchIn):
    if not payload.entries or len(payload.entries) > MAX_BATCH_SIZE:
        raise HttpError(400, f"Provide between 1 and {MAX_BATCH_SIZE} log entries.")

    valid_levels = {choice[0] for choice in ClientLogEntry.Level.choices}
    entries = []
    for entry in payload.entries:
        if entry.level not in valid_levels:
            raise HttpError(400, "A log entry has an invalid level.")
        message = trim(entry.message.strip(), MAX_MESSAGE_LENGTH)
        if not message:
            continue
        entries.append(
            ClientLogEntry(
                user=request.auth,
                client_id=trim(entry.clientId, 80),
                session_id=trim(payload.sessionId, 80),
                device_id=trim(payload.deviceId, 80),
                level=entry.level,
                source=trim(entry.source, 80),
                message=message,
                stack=trim(entry.stack, MAX_STACK_LENGTH),
                context=entry.context if isinstance(entry.context, dict) else {},
                occurred_at=entry.occurredAt,
                app_version=trim(payload.appVersion, 40),
                build_sha=trim(payload.buildSha, 80),
                platform=trim(payload.platform, 32),
                os_version=trim(payload.osVersion, 80),
            )
        )

    ClientLogEntry.objects.bulk_create(entries, ignore_conflicts=True)
    return 201, {"accepted": len(entries)}
