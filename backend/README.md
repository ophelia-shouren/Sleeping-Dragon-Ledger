# 眠龙记账在线聊天后端

在 Cloudflare Worker 的构建设置中，生产分支为 `cloudflare-ledger-backend`，根目录为 `backend`，构建命令留空，部署命令为 `npx wrangler deploy`。

首次部署后，在此目录运行 `npx wrangler d1 migrations apply sleeping-dragon-ledger-online --remote` 初始化数据库。通过 Cloudflare 的 Worker Secrets 设置 `CHAT_KEY_ENCRYPTION`，其值为 32 字节随机数据的 64 位小写十六进制编码。密钥只保存在 Worker Secrets 中。

访问 Worker 的 `/health` 检查数据库和密钥是否就绪。现有会话还需单独迁移并验证，之后再切换前端地址。
