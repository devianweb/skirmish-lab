#!/usr/bin/env bash
# Runs a node script with the optional local libasound / emoji font workaround (see README).
cd "$(dirname "$0")"
[ -d libs ] && export LD_LIBRARY_PATH="$PWD/libs/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
[ -f fonts.conf ] && export FONTCONFIG_FILE="$PWD/fonts.conf"
node "$@"
