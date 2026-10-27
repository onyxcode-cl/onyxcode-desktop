#!/bin/bash
# Uso: lanzar.sh <lazunox|opencode2|codex> <fase> <tareas> <repeticiones> [extra...]
# Un contenedor por motor: 2 CPU / 3 GB, red interna que solo llega al proxy, HOME vacío, sin clave real.
set -u
E=$1; F=$2; TAREAS=$3; REPS=$4; shift 4
B=$HOME/Documents/lzx-bench-bin
W="$HOME/Documents/App OpenCode/.claude/worktrees/ola7-banco"
case $E in
  lazunox) BIN=$B/final2; PRE=lz; EXE=opencode;;
  opencode2) BIN=$B/terceros/opencode-2.2.0/bin; PRE=oc2; EXE=opencode;;
  codex) BIN=$B/terceros/codex/bin; PRE=cx; EXE=codex;;
esac
OUT=$B/cmp/$F/$E; mkdir -p "$OUT"
docker rm -f lzx-cmp-$E-$F >/dev/null 2>&1
docker run --rm --name lzx-cmp-$E-$F --cpus=2 --memory=3g --network lzx-cmp-net --cap-drop=ALL --security-opt no-new-privileges \
  -e BENCH_EN_CONTENEDOR=1 -v "$W":/app:ro -v "$BIN":/motor:ro -v "$OUT":/out -v "$HOME/Documents/App OpenCode/node_modules/typescript":/ts:ro -w /app node:22-bookworm \
  node scripts/engine-bench/run.mjs --motor /motor/$EXE --adaptador $E --proxy-url http://proxy:8080/v1 --prefijo $PRE \
  --modelo opencode-go/deepseek-v4.1-flash --tareas "$TAREAS" --repeticiones $REPS --typescript /ts \
  --guardar-corridas /out/corridas --salida /out/bench.json "$@" > "$OUT/log.txt" 2>&1
echo "fin $E rc=$?" >> "$OUT/log.txt"
