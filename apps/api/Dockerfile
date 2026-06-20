FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip

COPY apps/api /app
RUN pip install --no-cache-dir .

RUN python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["gunicorn", "daily_todo.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2"]
