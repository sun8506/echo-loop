# EchoLoop

面向精听与 Shadowing 的音视频语言学习工具原型。

## 功能

- 导入本地音频或视频并完整播放
- 使用 Web Audio API 读取真实音轨并绘制完整波形
- 根据静音停顿自动切分音频（不使用 AI）
- 单片段循环、连续多片段循环与变速播放
- 手动添加最短 1 秒的时间片段
- Shadowing 跟读录音和回放
- 使用 IndexedDB 自动保存媒体、波形、片段、字幕和当前学习位置
- 页面重新打开时自动恢复最近一次学习项目

当前版本的波形和静音切分完全在浏览器处理。原文生成可选择本机 `faster-whisper` 的 `tiny`、`base` 或 `small` 模型；媒体只提交到本机服务，临时文件在处理完成后立即删除。

也可以在导入前选择 `NVIDIA 云端 · Large V3`，由 NVIDIA 托管的 Whisper Large V3
生成原文和自然语句片段。先在 NVIDIA API Catalog 创建 API Key，然后在启动 EchoLoop
的同一终端设置环境变量（不要把密钥写入前端或提交到 Git）：

```bash
export NVIDIA_API_KEY="nvapi-你的密钥"
./start.sh
```

Windows PowerShell：

```powershell
$env:NVIDIA_API_KEY = "nvapi-你的密钥"
bash .\start.sh
```

云端模式会把导入媒体的音轨转换为 16 kHz 单声道，并分块发送给 NVIDIA；返回的词级
时间戳会在本地重新组合为片段。媒体和学习记录仍保存在本机 IndexedDB，后端临时音频
会在请求结束后删除。未配置 `NVIDIA_API_KEY` 时，接口会明确提示配置密钥。

导入前可将切分方式切换为 `WhisperX · 自然语句`。该方式会分析完整音频，使用
WhisperX 的语音识别和强制对齐结果按自然语句生成片段，并同时填入原文；选中片段
后的局部重新解析仍使用 `tiny`、`base` 或 `small`。WhisperX 使用独立的现有 Python
环境，默认自动查找 `T:\projects\temp\.venv\Scripts\python.exe`、
`T:\projects\temp\venv\Scripts\python.exe` 或 `T:\projects\temp\python.exe`。
如果实际位置不同，启动后端前设置：

```powershell
$env:ECHOLOOP_WHISPERX_PYTHON = "T:\projects\temp\.venv\Scripts\python.exe"
$env:ECHOLOOP_WHISPERX_MODEL = "tiny"
```

如模型放在自定义缓存目录，还可设置 `ECHOLOOP_WHISPERX_MODEL_DIR`。该路径只以
离线模式读取；缺少 ASR 或对齐模型时会报告错误，不会自动下载。

## 启动

一键启动前端和本地转写服务：

```bash
./start.sh
```

按 `Ctrl+C` 会同时停止脚本启动的服务。

```bash
npm install
npm run dev
```

另开一个终端启动本地转写服务：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

首次点击“解析选中片段”会下载所选模型，建议先使用默认的 `tiny`。每次必须选择 1–5 个连续片段。浏览器会先从已解码音轨生成选区 WAV，只把这段小文件交给 Whisper，不上传或解码完整媒体；特殊格式无法在浏览器解码时才使用兼容模式。

项目数据保存在浏览器本机的 IndexedDB 中，不需要手动保存。浏览器会根据存储配额决定可用空间；清除网站数据会同时删除本地项目。

## 构建

```bash
npm run build
```

## 桌面应用（Tauri 2）

开发模式会自动启动前端和已打包的本地转写服务：

```bash
./scripts/build-sidecar.sh
npm run desktop:dev
```

生成 Linux 安装包：

```bash
./scripts/build-sidecar.sh
npm run desktop:build
```

安装包输出在 `src-tauri/target/release/bundle/`。桌面版把 FastAPI、faster-whisper
和依赖封装为本机 sidecar；Whisper 模型仍在首次解析时下载并保存在本机缓存中。
Windows 和 macOS 安装包需要分别在对应系统执行构建。

### Windows 构建

在 Windows PowerShell 中安装 Node.js LTS、Rust MSVC、Visual Studio C++ Build
Tools（勾选“使用 C++ 的桌面开发”）和 WebView2。然后在项目目录执行：

```powershell
npm install
py -3.12 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt pyinstaller
npm run desktop:build:windows
```

生成的 NSIS 安装程序位于
`src-tauri\target\release\bundle\nsis\EchoLoop_0.1.0_x64-setup.exe`。
