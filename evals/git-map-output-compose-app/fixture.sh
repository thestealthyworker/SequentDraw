#!/usr/bin/env bash
# Seeds the run's empty workspace with this case's fixture repository, so
# the prompt's `fixture/compose-app` resolves from the working directory
# and the scanner has a real directory tree to read.
#
# Runs outside the agent's sandbox, before Claude starts, and only when
# the suite is invoked with --scaffold. It copies files that live beside
# this script and nothing else: no network, no installs, no git history,
# and nothing from the fixture is executed.
set -euo pipefail

case_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -R "${case_dir}/fixture" ./fixture
echo "scaffolded: $(find ./fixture -type f | wc -l | tr -d ' ') fixture file(s)"
