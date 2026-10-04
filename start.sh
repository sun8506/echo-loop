#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")" && pwd)"
backend_python="$project_dir/backend/.venv/bin/python"
backend_dir="$project_dir/backend"
backend_pid=""
env_file="$project_dir/.env"
backend_port="${ECHOLOOP_BACKEND_PORT:-43180}"

echo_loop_backend_pids() {
  local proc pid cwd cmd
  for proc in /proc/[0-9]*; do
    pid="${proc##*/}"
    cwd="$(readlink -f "$proc/cwd" 2>/dev/null || true)"
    [[ "$cwd" == "$backend_dir" || "$cwd" == "$project_dir" ]] || continue
    cmd="$(tr '\0' ' ' <"$proc/cmdline" 2>/dev/null || true)"
    if [[ "$cmd" == *uvicorn* && "$cmd" == *main:app* && "$cmd" == *"--port $backend_port"* ]]; then
      printf '%s\n' "$pid"
    fi
  done
}

backend_port_in_use() {
  (exec 3<>/dev/tcp/127.0.0.1/"$backend_port") 2>/dev/null
}

stop_existing_echo_loop_backend() {
  local -a pids remaining
  local pid
  mapfile -t pids < <(echo_loop_backend_pids)
  if [[ "${#pids[@]}" -eq 0 ]]; then
    return 1
  fi

  echo "发现当前项目的旧后端进程：${pids[*]}，正在停止..."
  for pid in "${pids[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done

  for _ in {1..20}; do
    mapfile -t remaining < <(echo_loop_backend_pids)
    if [[ "${#remaining[@]}" -eq 0 ]] && ! backend_port_in_use; then
      echo "旧后端已停止。"
      return 0
    fi
    sleep 0.25
  done

  # Only force-stop processes that still match this project's exact uvicorn
  # command. Never use fuser/pkill on an unresolved port owner.
  mapfile -t remaining < <(echo_loop_backend_pids)
  if [[ "${#remaining[@]}" -gt 0 ]]; then
    echo "旧后端未及时退出，正在强制停止：${remaining[*]}"
    for pid in "${remaining[@]}"; do
      kill -KILL "$pid" 2>/dev/null || true
    done
  fi

  for _ in {1..20}; do
    backend_port_in_use || { echo "旧后端已清理。"; return 0; }
    sleep 0.25
  done
  return 1
}

cleanup() {
  if [[ -n "$backend_pid" ]] && kill -0 "$backend_pid" 2>/dev/null; then
    kill "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ ! -x "$backend_python" ]]; then
  echo "缺少后端环境：backend/.venv"
  echo "请先执行："
  echo "  cd backend"
  echo "  python3 -m venv .venv"
  echo "  .venv/bin/pip install -r requirements.txt"
  exit 1
fi

# Load local service credentials for both the transcription and translation
# backends. Keep them in the environment only; never print their values.
if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
  echo "已加载本地配置：.env"
fi

# Allow .env to override the default after it has been loaded.
backend_port="${ECHOLOOP_BACKEND_PORT:-43180}"

if [[ ! -d "$project_dir/node_modules" ]]; then
  echo "首次运行，正在安装前端依赖..."
  (cd "$project_dir" && npm install)
fi

if backend_port_in_use; then
  if ! stop_existing_echo_loop_backend; then
    echo "$backend_port 端口已被占用，但未确认是当前项目的 Echo Loop 后端。"
    echo "为避免误杀其他程序，启动已停止。请先确认端口占用者："
    echo "  ss -lntp | grep ':$backend_port'"
    exit 1
  fi
fi

if backend_port_in_use; then
  echo "旧后端清理后 $backend_port 端口仍被占用，启动已停止。"
  exit 1
fi

echo "正在启动本地转写服务：http://127.0.0.1:$backend_port"
(
  cd "$project_dir/backend"
  exec .venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port "$backend_port"
) &
backend_pid=$!
echo "后端进程 PID：$backend_pid（监听 0.0.0.0:$backend_port）"

# Importing Torch/WhisperX can make the first backend startup noticeably
# slower, especially after changing CUDA packages. Allow up to 60 seconds.
for _ in {1..120}; do
  if curl --silent --fail "http://127.0.0.1:$backend_port/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$backend_pid" 2>/dev/null; then
    echo "后端启动失败，请检查上方日志。"
    exit 1
  fi
  sleep 0.5
done

if ! curl --silent --fail "http://127.0.0.1:$backend_port/health" >/dev/null 2>&1; then
  echo "后端在 60 秒内未通过健康检查。请确认 $backend_port 端口未被其他程序占用。"
  exit 1
fi

echo "正在启动前端，按 Ctrl+C 同时停止服务。"
cd "$project_dir"
npm run dev
