#!/bin/bash
# Double-click this in Finder to launch Freetoshop.
cd "$(dirname "$0")" || exit 1
./start.sh
status=$?
if [[ "$status" -ne 0 ]]; then
  echo
  echo "Launch failed. Press Enter to close."
  read -r
fi
exit "$status"
