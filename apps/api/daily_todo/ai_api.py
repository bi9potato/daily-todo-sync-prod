from datetime import date as date_cls

from django.utils import timezone
from ninja import Router, Schema

from accounts.authentication import bearer_auth
from todos.models import TodoOccurrence
from todos.services import create_task_for_day, ensure_day

router = Router(tags=["ai"])


class AiChatIn(Schema):
    message: str
    date: date_cls | None = None


class AiActionOut(Schema):
    type: str
    label: str
    taskId: str | None = None


class AiChatOut(Schema):
    reply: str
    actions: list[AiActionOut]


def _clean_task_text(message: str) -> str:
    text = message.strip()
    prefixes = [
        "帮我添加",
        "添加",
        "新增",
        "创建",
        "记一下",
        "帮我记一下",
        "todo",
        "任务",
    ]
    for prefix in prefixes:
        if text.lower().startswith(prefix.lower()):
            text = text[len(prefix) :].strip(" ：:，,。.")
            break
    return text[:280]


@router.post("/chat", response=AiChatOut, auth=bearer_auth)
def ai_chat(request, payload: AiChatIn):
    message = payload.message.strip()
    target_date = payload.date or timezone.localdate()
    if not message:
        return {"reply": "你可以直接告诉我想添加、整理或分析什么任务。", "actions": []}

    if any(keyword in message for keyword in ["总结", "分析", "今天干了啥", "复盘"]):
        ensure_day(request.auth, target_date, today=target_date)
        items = TodoOccurrence.objects.select_related("task").filter(
            user=request.auth,
            task_date=target_date,
            deleted_at__isnull=True,
            task__deleted_at__isnull=True,
        )
        done = [item.task.text for item in items if item.status == TodoOccurrence.Status.DONE]
        pending = [item.task.text for item in items if item.status != TodoOccurrence.Status.DONE]
        reply = (
            f"{target_date} 你完成了 {len(done)} 项，还有 {len(pending)} 项待处理。"
            if done or pending
            else f"{target_date} 还没有任务记录。"
        )
        if done:
            reply += " 已完成：" + "、".join(done[:5]) + "。"
        if pending:
            reply += " 待处理：" + "、".join(pending[:5]) + "。"
        return {"reply": reply, "actions": [{"type": "analyze_today", "label": "分析今天"}]}

    if any(keyword in message for keyword in ["添加", "新增", "创建", "记一下", "todo", "任务"]):
        text = _clean_task_text(message)
        if not text:
            return {"reply": "我还不知道任务内容。你可以说：添加 明天早上看护照。", "actions": []}
        occurrence = create_task_for_day(request.auth, target_date, text)
        return {
            "reply": f"已添加到 {target_date}：{occurrence.task.text}",
            "actions": [
                {
                    "type": "create_task",
                    "label": "创建任务",
                    "taskId": str(occurrence.id),
                }
            ],
        }

    return {
        "reply": "我已经收到。当前雏形先支持：添加任务、分析今天。下一步会接入可确认的批量整理和日程规划。",
        "actions": [],
    }
