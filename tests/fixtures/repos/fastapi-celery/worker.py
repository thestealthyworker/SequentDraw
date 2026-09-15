from celery import Celery

app = Celery("worker", broker="redis://redis:6379/0")


@app.task
def send_welcome_email(email: str):
    print(f"sending welcome email to {email}")
