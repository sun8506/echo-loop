# 本地转写服务

媒体只会发送到本机 `127.0.0.1:43180`。服务使用 `faster-whisper`，处理完成后立即删除临时文件。

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 43180
```

首次选择模型时会从 Hugging Face 下载模型并缓存。默认 `tiny` 体积最小；也可以选择 `base` 或 `small`。转写接口必须提供选中范围的 `start` 和 `end`，不会执行全文推理。

网页视频导入默认允许最长 12 小时，并继续保留 500MB 文件大小保护。可在 `.env` 中通过 `ECHOLOOP_MAX_IMPORT_HOURS` 调整；设为 `0` 只关闭时长限制，不关闭大小限制。修改后需要重启本地后端。
