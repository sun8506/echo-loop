#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")" && pwd)"
backend_python="$project_dir/backend/.venv/bin/python"
backend_pid=""

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

if [[ ! -d "$project_dir/node_modules" ]]; then
  echo "首次运行，正在安装前端依赖..."
  (cd "$project_dir" && npm install)
fi

if curl --silent --fail http://127.0.0.1:8000/health >/dev/null 2>&1; then
  echo "后端已在 http://127.0.0.1:8000 运行，将直接复用。"
else
  echo "正在启动本地转写服务：http://127.0.0.1:8000"
  (
    cd "$project_dir/backend"
    exec .venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000
  ) &
  backend_pid=$!
  echo "后端进程 PID：$backend_pid（监听 0.0.0.0:8000）"

  # Importing Torch/WhisperX can make the first backend startup noticeably
  # slower, especially after changing CUDA packages. Allow up to 60 seconds.
  for _ in {1..120}; do
    if curl --silent --fail http://127.0.0.1:8000/health >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$backend_pid" 2>/dev/null; then
      echo "后端启动失败，请检查上方日志。"
      exit 1
    fi
    sleep 0.5
  done

  if ! curl --silent --fail http://127.0.0.1:8000/health >/dev/null 2>&1; then
    echo "后端在 60 秒内未通过健康检查。请确认 8000 端口未被其他程序占用。"
    exit 1
  fi
fi

echo "正在启动前端，按 Ctrl+C 同时停止服务。"
cd "$project_dir"
npm run dev
