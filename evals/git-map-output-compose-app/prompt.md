---
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Bash]
runs: 2
tags: [git-map]
---

There is a small repository to map in this eval case's own directory, at
fixture/compose-app (use Glob to locate it if that exact relative path
does not resolve from your working directory). Map its architecture: scan
it, build the map from the scan evidence only (cite evidence ids on every
node and edge), check the evidence, then render and publish. Don't ask me
anything: just proceed straight through.
