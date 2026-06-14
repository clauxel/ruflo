# 本地开发

## 前置条件

- 已安装 Node.js 和 npm
- 已准备 PostgreSQL，或仅在测试环境使用 memory driver
- 若要验证真实远程部署，需准备 SSH 可达的运行时节点

## 1. 安装依赖

```bash
npm install
```

## 2. 准备部署配置

当前仓库优先读取 `genericagent.config.json`，找不到时回退到 `multica.config.json`。建议从 `genericagent.config.example.json` 开始。

配置文件当前支持两种顶层 section：

- `genericagent`
- `multica`，仅作为 legacy compatibility 入口

## 3. 准备环境变量

`server.mjs` 会按运行模式自动加载环境文件：

- development: `.env.development`
- production: `.env.production`

也可以使用以下变量显式指定：

- `GENERICAGENT_ENV_PATH`
- `MULTICA_ENV_PATH`

至少应确认下面几项存在：

- `MULTICA_POSTGRES_HOST`
- `MULTICA_POSTGRES_DB`
- `MULTICA_POSTGRES_USER`
- `MULTICA_POSTGRES_PASSWORD`
- `MULTICA_TOKEN_SECRET`
- `MULTICA_CONFIG_SECRET`

如果只是本地联调 UI、支付流和控制台流程，可以保留 `MULTICA_ALLOW_SIMULATED_DEPLOYMENT=true`。

## 4. 启动服务

```bash
npm run dev
```

默认访问地址：`http://localhost:5175`

## 5. 基础验证

```bash
npm run build
npm test
```

其他常用动作：

- `npm run router:start` - 单独启动 router 服务
- `npm run genericagent:package <instance-name>` - 打包远程工作区模板
- `node scripts/reset-dev-environment.mjs` - 清空开发环境的数据库记录并回收已追踪实例
