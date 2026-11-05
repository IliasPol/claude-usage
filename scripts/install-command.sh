#!/bin/sh
# Install a stable wrapper, not a symlink: symlinks break dirname-based launchers.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$HOME/.local/bin"
TARGET="$HOME/.local/bin/claude-usage"
# Quote the installation directory safely for POSIX sh.
QUOTED_ROOT=$(printf '%s' "$ROOT" | sed "s/'/'\\''/g")
printf '#!/bin/sh\nexec '''%s/claude-usage''' "$@"\n' "$QUOTED_ROOT" > "$TARGET"
chmod +x "$TARGET"
printf 'Installed: %s -> %s/claude-usage\n' "$TARGET" "$ROOT"
printf '%s\n' 'Put ~/.local/bin before ~/.asdf/shims in PATH, then run: hash -r'
