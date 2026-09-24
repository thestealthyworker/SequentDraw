#!/usr/bin/env bash
# Seeds the run's empty workspace with the map this case's prompt names, so
# `fixture/map.json` resolves from the working directory.
#
# Runs outside the agent's sandbox, before Claude starts, and only when the
# suite is invoked with --scaffold. It copies one file that lives beside this
# script and nothing else: no network, no installs, nothing is executed.
set -euo pipefail

case_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p ./fixture
cp "${case_dir}/fixture/map.json" ./fixture/map.json
echo "scaffolded: fixture/map.json"
