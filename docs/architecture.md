# GenericAgent Launch 技术架构

> 当前仓库是一个 GenericAgent hosted workspace 的控制面应用，不是上游核心 agent runtime 的源码镜像。

## 总体拓扑

```text
浏览器
  -> React/Vite SPA (`src/`)
  -> Node.js server (`server.mjs`)
  -> server-lib/api + helpers
  -> PostgreSQL / memory driver
  -> deployment runtime / router / remote workspace host
```

## 前端层

前端以 `src/App.tsx` 为主入口，围绕以下模块组织：

- `src/content/`：品牌文案、方案页、FAQ、法律页、目录数据
- `src/components/`：品牌标识、复用 UI 片段
- `src/lib/`：SEO、格式化、analytics、路由辅助
- `src/styles.css`：全站主题、布局和状态样式

前端负责营销展示、套餐选择、checkout 引导、控制台视图、用户状态管理和 client-side SEO 同步。

## 服务端层

`server.mjs` 是单体入口，负责：

- 环境变量加载和运行模式判定
- 数据库初始化与 schema 保证
- API 路由装配
- 支付回调、订单状态推进和部署队列
- console session、proxy 和 server-side metadata fallback

配套模块主要在 `server-lib/`：

| 模块 | 作用 |
|------|------|
| `api/` | 组织 auth、orders、admin、webhook、model proxy 等路由 |
| `app-database.mjs` | PostgreSQL 连接、memory driver、基础表初始化 |
| `deployment-config.mjs` | 读取 `genericagent.config.json` / `multica.config.json` 并标准化 |
| `deployment-runtime.mjs` | 真实部署、升级、停止、卸载的核心 SSH/runtime 逻辑 |
| `payment-helpers.mjs` | Creem / PayPal 辅助逻辑 |
| `session-helpers.mjs` | 登录态、guest token、console session 辅助 |
| `model-proxy-helpers.mjs` | 代理 token、来源地址校验、上游模型地址处理 |

## 数据层

应用数据库由 `createAppDatabase` 创建，正式环境走 PostgreSQL，测试可切到 memory driver。当前控制面自身维护的核心表包括：

- `users`
- `sessions`
- `orders`
- `deployments`
- `agent_instances`
- `analytics_*`
- `creem_products`

这套数据库承载的是 launch / commerce / operations 真相源，而不是远端工作区内部的运行态业务数据。

## 部署数据流

```text
用户创建 launch order
  -> 支付完成或确认回调
  -> queuePaidOrder / createDeploymentForOrder
  -> deployment runtime 选择 automatic 或 manual 流程
  -> 通过 SSH 写入远端 workspace、配置 .env、启动服务
  -> 回写 console_url / public_endpoint / status 到 deployments 和 agent_instances
```

控制面随后还提供升级、停止、卸载、console 直达等后续生命周期操作。

## 配置流

当前配置加载规则如下：

1. 优先读取 `GENERICAGENT_CONFIG_PATH`
2. 兼容读取 `MULTICA_CONFIG_PATH`
3. 若项目根目录存在 `genericagent.config.json`，优先使用它
4. 否则回退到 `multica.config.json`

同样，环境文件优先支持 `GENERICAGENT_ENV_PATH`，同时保留 `MULTICA_ENV_PATH`。

## 兼容边界

当前仓库已经切到 GenericAgent 品牌，但底层仍保留以下 legacy 约定：

- 大量 `MULTICA_*` 环境变量名
- 旧脚本文件名，比如 `package-remote-multica-instance.mjs`
- 运行时和模板的一些内部目录/字段命名

这是有意保留的迁移层，用来保障现有部署链路、模板环境和测试不被一次性改断。

## 验证方式

- `npm run build`：验证 TypeScript + Vite 构建
- `npm test`：跑 Node 测试，覆盖部署和分析等主要流程
- 品牌/残留检查：全文搜索 `Multica`、`aigeamy`、旧域名或 legacy 文案残留
make dev              # 一键启动（自动创建 env、安装依赖、初始化 DB、启动全部服务）
make setup            # 首次：创建 DB、迁移
make start            # 启动后端 + 前端
make stop             # 停止当前 checkout 的进程
make db-down          # 停止共享 PostgreSQL 容器

pnpm dev:web          # Next.js 开发服务器（端口 3000）
pnpm dev:desktop      # Electron 开发（HMR）
pnpm build            # 构建所有前端
pnpm typecheck        # TypeScript 检查
pnpm lint             # ESLint
pnpm test             # TS 单元测试（Vitest）

make server           # 仅运行 Go server（端口 8080）
make daemon           # 运行本地 daemon
make build            # 构建 server + CLI 二进制到 server/bin/
make test             # Go 测试
make sqlc             # 编辑 SQL 后重新生成 sqlc 代码
make migrate-up       # 运行数据库迁移
make migrate-down     # 回滚迁移

make check            # 全量检查：typecheck + TS 测试 + Go 测试 + E2E
```

---

## Commit 规范

```
feat(web): ...
fix(cli): ...
refactor(daemon): ...
test(cli): ...
docs: ...
chore(scope): ...
```

使用按逻辑意图分组的原子 commit。PR 应包含简短描述、关联 Issue/PR 编号、UI 截图，以及迁移/环境变量/CLI 变更说明。
