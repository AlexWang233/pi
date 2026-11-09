#!/usr/bin/env bash
# Archive the entire stopped thread directory, holding the same cooperative owner lock as systemd.
set -euo pipefail
umask 077
if [[ $# -ne 2 ]]; then
  echo 'Usage: bash backup.sh DATA_DIRECTORY ARCHIVE.tar.gz' >&2
  exit 2
fi
data=$(realpath -e -- "$1")
archive=$(realpath -m -- "$2")
case "$archive" in
  "$data"|"$data"/*) echo 'Archive must be outside the data directory' >&2; exit 2 ;;
esac
if [[ $(systemctl show pi-collab.service --property=LoadState --value) != loaded ]]; then
  echo 'Install and inspect the service before using this backup procedure' >&2
  exit 1
fi
if systemctl is-active --quiet pi-collab.service; then
  echo 'Stop pi-collab.service and verify old writers are gone before backup' >&2
  exit 1
fi
exec 9>"$data/owner.lock"
if ! flock --nonblock 9; then
  echo 'Another cooperating owner or backup holds this store' >&2
  exit 1
fi
# Never overwrite an existing archive. A failed tar leaves a partial file for operator inspection.
set -o noclobber
tar --create --gzip --file=- --directory="$data" --exclude='./owner.lock' . > "$archive"
echo "Stopped-store archive written: $archive"
