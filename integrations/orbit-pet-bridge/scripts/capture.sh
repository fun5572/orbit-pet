#!/bin/sh

# Observer-only hook: persist stdin locally, return an empty JSON decision,
# and never block or alter the Codex turn.
umask 077

case "$(uname -s 2>/dev/null)" in
  Darwin)
    event_dir="${ORBIT_PET_EVENT_DIR:-${HOME}/Library/Application Support/com.mochasoft.orbitpet/codex-events}"
    ;;
  *)
    data_root="${XDG_DATA_HOME:-${HOME}/.local/share}"
    event_dir="${ORBIT_PET_EVENT_DIR:-${data_root}/com.mochasoft.orbitpet/codex-events}"
    ;;
esac

if mkdir -p "$event_dir" 2>/dev/null; then
  temp_file="$(mktemp "$event_dir/.event.XXXXXX" 2>/dev/null || true)"
  if [ -n "$temp_file" ]; then
    if cat >"$temp_file"; then
      mv "$temp_file" "$temp_file.json" 2>/dev/null || rm -f "$temp_file"
    else
      rm -f "$temp_file"
    fi
  else
    cat >/dev/null
  fi
  find "$event_dir" -type f -name '*.json' -mtime +7 -delete >/dev/null 2>&1 || true
else
  cat >/dev/null
fi

printf '{}'
exit 0
