from fastapi import FastAPI
import psycopg2
from worker import send_welcome_email

app = FastAPI()


@app.post("/signup")
def signup(email: str):
    conn = psycopg2.connect("postgresql://localhost/app")
    send_welcome_email.delay(email)
    return {"ok": True}
