from flask import Flask, request
from redis import Redis
import json

app = Flask(__name__)
store = Redis(host="redis", db=0, socket_timeout=5)


@app.route("/vote", methods=["POST"])
def vote():
    choice = request.form["choice"]
    store.rpush("votes", json.dumps({"choice": choice}))
    return "ok"
