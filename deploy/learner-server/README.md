# EchoLoop 学习端服务器部署

服务器提供学习端网页、账户、学习进度、统计、反馈以及已发布学习片段。素材下载、语音识别、DeepL、Sudachi和完整原媒体继续保留在本地制作端。

## 1. 安装目录与用户

```bash
sudo useradd --system --home /var/lib/echoloop --shell /usr/sbin/nologin echoloop
sudo mkdir -p /opt/echoloop/backend /var/lib/echoloop /etc/echoloop
sudo chown -R echoloop:echoloop /var/lib/echoloop
```

将仓库中的 `backend/` 上传到 `/opt/echoloop/backend/`，然后安装最小依赖：

```bash
cd /opt/echoloop/backend
sudo python3 -m venv .venv-learner
sudo .venv-learner/bin/pip install -r requirements-learner.txt
sudo chown -R echoloop:echoloop /opt/echoloop
```

## 2. 配置

```bash
sudo cp deploy/learner-server/learner-server.env.example /etc/echoloop/learner-server.env
sudo chmod 600 /etc/echoloop/learner-server.env
sudoedit /etc/echoloop/learner-server.env
```

必须把示例域名替换成实际的学习端和API域名。数据库目录必须与 systemd 的 `ReadWritePaths` 一致。

## 3. systemd

```bash
sudo cp deploy/learner-server/echoloop-learner.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now echoloop-learner
curl http://127.0.0.1:8010/api/health
```

## 4. Nginx与HTTPS

复制 `nginx.conf.example` 到 Nginx 站点配置，替换 `api.example.com` 后启用。配置中已对登录、注册和普通API分别限流。公网正式使用前必须通过 Certbot 或云负载均衡启用HTTPS。

## 5. 构建学习端

学习端请求地址必须包含 `/api`：

```bash
export VITE_LEARNER_API_BASE=https://api.example.com/api
npm run build
sudo mkdir -p /var/www/echoloop
sudo cp -a dist/. /var/www/echoloop/
sudo chown -R root:root /var/www/echoloop
```

Nginx 使用 SPA fallback 后，浏览器访问 `https://api.example.com/learn` 即可进入学习端；
`/learn/courses` 显示全局公开内容和当前登录邮箱获准使用的内容。私有或已过期内容不会显示。

Android App也必须在打包前设置相同变量。

## 6. 数据备份

SQLite数据库默认位于 `/var/lib/echoloop/learner.db`。备份时使用SQLite在线备份，不要在服务运行时直接复制WAL数据库：

```bash
sudo -u echoloop sqlite3 /var/lib/echoloop/learner.db ".backup '/var/lib/echoloop/learner-backup.db'"
```

至少每日将备份文件复制到另一块磁盘或对象存储，并定期验证恢复。

## 轻量发布

制作端仅向服务器上传当前发布区间的媒体片段、相对时间轴字幕和权限元数据，不上传完整原素材。服务器环境配置 `ECHOLOOP_PUBLICATION_DIR` 与 `ECHOLOOP_PUBLISH_KEY`；本地制作端配置同一把 `ECHOLOOP_PUBLISH_KEY` 和 `ECHOLOOP_PUBLISH_SERVER=https://api.example.com`。发布目录必须位于 systemd 的 `ReadWritePaths` 中，示例已使用 `/var/lib/echoloop/publications`。
