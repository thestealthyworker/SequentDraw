#!/usr/bin/env bash
# Seeds the run's empty workspace with the map this case's prompt names, so
# `examples/medusa-return-flow.json` resolves from the working directory.
#
# Runs outside the agent's sandbox, before Claude starts, and only when the
# suite is invoked with --scaffold. It copies one file from this repository
# and nothing else: no network, no installs, nothing from the fixture is
# executed.
#
# The copy is the repository's real examples/medusa-return-flow.json rather
# than a duplicate committed beside this case, so the file the prompt points
# at and the file the workspace gets can never drift apart.
set -euo pipefail

case_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${case_dir}/../.." && pwd)"

mkdir -p ./examples
cp "${repo_root}/examples/medusa-return-flow.json" ./examples/medusa-return-flow.json
echo "scaffolded: examples/medusa-return-flow.json"
