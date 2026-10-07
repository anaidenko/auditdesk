#!/usr/bin/env bash
#
# Run this tree's Auditdesk as a detached background server, so a Claude Code session can start
# and stop it, and Andrii can look at it from any terminal (`pnpm app …` wraps this script).
# `pnpm dev` stays the classic foreground server.
#
# The server runs in its own process group and survives the session that started it; its state
# is per tree: logs/dev-server.log and logs/dev-server.pid. The port comes from .dev-port
# (default 3000) and the server binds 127.0.0.1 only (design § 12).
#
# Usage:
#   dev-server.sh start [--prod] [--wait]   next dev, or with --prod a build and next start;
#                                            idempotent: reports a server already up
#   dev-server.sh stop [--all] [--force]    the whole process group; refuses while a job runs
#                                            (stopping marks it interrupted) unless --force;
#                                            --all sweeps every worktree
#   dev-server.sh restart [--prod] [--wait]
#   dev-server.sh status [--all]            pid and an HTTP probe: up / busy / down
#   dev-server.sh wait [TIMEOUT]            poll until the server answers (default 180 s)
#   dev-server.sh logs [N]                  the last N log lines (default 80)
#   dev-server.sh logs -f                   follow (for a terminal, not for Claude)

set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
cd "$ROOT"

port_of() {  # <root>
    p="$(cat "$1/.dev-port" 2>/dev/null || echo 3000)"
    case "$p" in '' | *[!0-9]*) p=3000 ;; esac
    echo "$p"
}
PORT="$(port_of "$ROOT")"
LOG="$ROOT/logs/dev-server.log"
PID_FILE="$ROOT/logs/dev-server.pid"

pid_alive() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }

# curl exit 0 = serving; 28 (timeout) = up but busy compiling; anything else = not listening.
# NO_PROXY bypasses a sandbox proxy, which would otherwise fail loopback probes.
probe_port() { NO_PROXY='' no_proxy='' curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:$1/"; }

state_line() {  # <name> <root> <port>
    pe=0
    probe_port "$3" || pe=$?
    pf="$2/logs/dev-server.pid"
    if [ -f "$pf" ] && kill -0 "$(cat "$pf")" 2>/dev/null; then ps="pid $(cat "$pf") alive"; else ps="no live pid"; fi
    case "$pe" in
        0) echo "$1port $3  ✓ up ($ps)"; return 0 ;;
        28) echo "$1port $3  ✓ up, busy compiling ($ps)"; return 0 ;;
        *) echo "$1port $3  ✗ down ($ps)"; return 1 ;;
    esac
}
do_status() { state_line "" "$ROOT" "$PORT"; }

each_worktree() {  # <callback root port>
    while IFS= read -r line; do
        case "$line" in
            "worktree "*)
                wt="${line#worktree }"
                "$1" "$wt" "$(port_of "$wt")"
                ;;
        esac
    done < <(git worktree list --porcelain)
}
status_one() { state_line "[$(basename "$1")] " "$1" "$2" || true; }

# Listeners on <port> whose working directory is inside <root>: a foreign process that merely
# holds the port, or another tree's server, is never touched.
port_listeners() {  # <root> <port>
    for lp in $(lsof -ti "tcp:$2" -sTCP:LISTEN 2>/dev/null); do
        lcwd="$(lsof -a -p "$lp" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
        case "$lcwd" in "$1" | "$1"/*) echo "$lp" ;; esac
    done
}

# Jobs in progress, read from the tree's own database; stopping the server interrupts them.
running_jobs() {  # <root>
    url="$(sed -n 's/^DATABASE_URL=//p' "$1/.env.local" 2>/dev/null | tr -d '"')"
    [ -n "$url" ] || { echo 0; return; }
    user="$(echo "$url" | sed -E 's#^[a-z]+://([^:@/]+).*#\1#')"
    db="$(echo "$url" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
    (cd "$1" && docker compose exec -T db psql -U "$user" -d "$db" -Atc \
        "select count(*) from \"Job\" where status = 'running'" 2>/dev/null) || echo 0
}

stop_one() {  # <root> <port> — exit 0 if something was stopped
    hit=0
    pid=""
    pf="$1/logs/dev-server.pid"
    if [ -f "$pf" ]; then
        pid="$(cat "$pf")"
        # The whole group, and only if it is still ours: a pid file can outlive a reboot.
        if kill -0 -- -"$pid" 2>/dev/null && pgrep -g "$pid" -l 2>/dev/null | grep -qiE 'node|pnpm|next|bash'; then
            kill -- -"$pid" 2>/dev/null || true
            hit=1
            echo "[$(basename "$1")] sent TERM to process group $pid"
        else
            pid=""
        fi
        rm -f "$pf"
    fi
    leftover="$(port_listeners "$1" "$2")"
    if [ -n "$leftover" ]; then
        echo "$leftover" | xargs kill 2>/dev/null || true
        hit=1
        echo "[$(basename "$1")] stopped leftover listener(s) on port $2: $(echo "$leftover" | tr '\n' ' ')"
    fi
    # Wait (about 10 s at most) for the group to die and the port to free, so a restart does not
    # meet the dying server.
    if [ "$hit" -eq 1 ]; then
        w=0
        while [ "$w" -lt 20 ]; do
            alive=0
            [ -n "$pid" ] && kill -0 -- -"$pid" 2>/dev/null && alive=1
            [ -n "$(port_listeners "$1" "$2")" ] && alive=1
            [ "$alive" -eq 0 ] && break
            sleep 0.5
            w=$((w + 1))
        done
    fi
    [ "$hit" -eq 1 ]
}

guard_jobs() {  # <root>
    [ "$FORCE" -eq 1 ] && return 0
    n="$(running_jobs "$1")"
    if [ "${n:-0}" != "0" ]; then
        echo "[$(basename "$1")] $n job(s) running: stopping now marks them interrupted. Wait, or pass --force." >&2
        return 1
    fi
}

STOPPED_ANY=0
stop_all_cb() {
    if guard_jobs "$1"; then stop_one "$1" "$2" && STOPPED_ANY=1 || true; fi
}

do_start() {
    if do_status >/dev/null 2>&1; then
        echo "Already running:"
        do_status || true
        return 0
    fi
    if pid_alive; then
        echo "Process $(cat "$PID_FILE") is alive but port $PORT does not answer yet (still compiling?). See: $0 logs"
        return 0
    fi
    for lp in $(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null); do
        echo "Port $PORT is held by pid $lp, which is not this tree's server: free it or set .dev-port." >&2
        exit 1
    done
    [ -f .env.local ] || { echo "No .env.local in $ROOT: the app has no database URL here." >&2; exit 1; }
    if [ -L node_modules ]; then
        echo "node_modules is a link (scripts/worktree.sh): Turbopack refuses one that points outside the tree. Run the server from the main tree." >&2
        exit 1
    fi

    mkdir -p logs
    [ -f "$LOG" ] && mv -f "$LOG" "${LOG%.log}.prev.log"
    echo "Starting PostgreSQL (pnpm db:up)…"
    pnpm db:up >"$LOG" 2>&1 || { echo "db:up FAILED:" >&2; tail -20 "$LOG" >&2; exit 1; }
    if [ "$PROD" -eq 1 ]; then
        echo "Building (pnpm build)…"
        pnpm build >>"$LOG" 2>&1 || { echo "build FAILED:" >&2; tail -30 "$LOG" >&2; exit 1; }
        server="exec pnpm exec next start -H 127.0.0.1 -p \"\$DEV_PORT\""
    else
        server="exec pnpm exec next dev -H 127.0.0.1 -p \"\$DEV_PORT\""
    fi

    # set -m gives the job its own process group (PGID = leader pid), so stop reaches every
    # child; nohup and disown detach it from this shell and its terminal.
    set -m
    DEV_PORT="$PORT" nohup bash -c "$server" >>"$LOG" 2>&1 </dev/null &
    pid=$!
    set +m
    disown "$pid" 2>/dev/null || true
    echo "$pid" >"$PID_FILE"
    echo "Started (pid $pid, $([ "$PROD" -eq 1 ] && echo "next start" || echo "next dev")) on http://127.0.0.1:$PORT"
    echo "Wait for it: $0 wait    Logs: $0 logs"
}

do_wait() {
    timeout="${1:-180}"
    elapsed=0
    while [ "$elapsed" -lt "$timeout" ]; do
        if probe_port "$PORT"; then
            echo "READY: up on port $PORT after ${elapsed}s"
            return 0
        fi
        if [ -f "$PID_FILE" ] && ! pid_alive; then
            echo "FAILED: the server exited after ${elapsed}s"
            tail -30 "$LOG"
            return 1
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    echo "TIMEOUT: port $PORT did not answer within ${timeout}s"
    [ -f "$LOG" ] && tail -80 "$LOG"
    return 1
}

do_stop() {
    guard_jobs "$ROOT" || exit 1
    stop_one "$ROOT" "$PORT" || echo "Nothing to stop (port $PORT is free)."
}

CMD="${1:-}"
WAIT=0
PROD=0
ALL=0
FORCE=0
for a in "${@:2}"; do
    case "$a" in
        --wait | -w) WAIT=1 ;;
        --prod | -p) PROD=1 ;;
        --all | -a) ALL=1 ;;
        --force | -f) FORCE=1 ;;
    esac
done

case "$CMD" in
    start)
        do_start
        if [ "$WAIT" -eq 1 ]; then do_wait; fi
        ;;
    stop)
        if [ "$ALL" -eq 1 ]; then
            each_worktree stop_all_cb
            [ "$STOPPED_ANY" -eq 0 ] && echo "No server stopped in any worktree."
            true
        else
            do_stop
        fi
        ;;
    restart)
        do_stop
        do_start
        if [ "$WAIT" -eq 1 ]; then do_wait; fi
        ;;
    status)
        if [ "$ALL" -eq 1 ]; then each_worktree status_one; else do_status; fi
        ;;
    wait)
        t="${2:-180}"
        case "$t" in '' | *[!0-9]*)
            echo "Invalid timeout: '$t' (seconds expected)" >&2
            exit 2
            ;;
        esac
        do_wait "$t"
        ;;
    logs)
        if [ "${2:-}" = "-f" ]; then
            pid_alive || echo "⚠ the server is NOT running: this is the log of an earlier run" >&2
            exec tail -F "$LOG"
        else
            tail -n "${2:-80}" "$LOG"
            pid_alive || echo "⚠ the server is NOT running: the above is the log of an earlier run" >&2
        fi
        ;;
    *)
        cat >&2 <<EOF
Usage: $0 <command>

  start [--prod] [--wait]     start detached: next dev, or with --prod a build and next start
  stop [--all] [--force]      stop the whole process group; refuses while a job runs unless --force;
                                --all sweeps every worktree
  restart [--prod] [--wait]   stop, then start
  status [--all]              pid and an HTTP probe; --all shows every worktree
  wait [TIMEOUT]              poll until the server answers (default 180 s)
  logs [N] | logs -f          the last N log lines (default 80), or follow them

Port: $PORT (.dev-port; default 3000). Log: logs/dev-server.log
EOF
        exit 2
        ;;
esac
