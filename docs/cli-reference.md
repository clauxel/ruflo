# 脚本与运维参考

当前仓库没有内置 `multica` CLI 的源码，这个文件改为记录本项目自己真正存在的脚本入口、运行命令和配置优先级。

## npm scripts

| 命令 | 作用 |
|------|------|
| `npm run dev` | 启动本地 Node 应用服务 |
| `npm run build` | 执行 TypeScript 构建和 Vite 生产打包 |
| `npm run preview` | 启动 Vite preview |
| `npm run start` | 以 production mode 启动 `server.mjs` |
| `npm run test` | 跑 `test/*.test.mjs` |
| `npm run router:start` | 单独启动 `server-router.mjs` |
| `npm run postgres:setup` | 初始化或准备 PostgreSQL 服务器相关配置 |
| `npm run genericagent:package` | 打包远程工作区模板归档 |

## 直接脚本入口

| 文件 | 作用 |
|------|------|
| `scripts/package-remote-multica-instance.mjs` | 针对已部署工作区生成新的远程模板归档 |
| `scripts/deploy-order-to-real-server.mjs` | 从订单出发触发一次真实 SSH 部署 |
| `scripts/reset-dev-environment.mjs` | 清空开发数据库并尝试回收已追踪实例 |
| `scripts/setup-postgres-server.mjs` | 协助准备 PostgreSQL 运行环境 |

## 配置解析优先级

部署配置文件按以下顺序解析：

1. `GENERICAGENT_CONFIG_PATH`
2. `MULTICA_CONFIG_PATH`
3. `genericagent.config.json`
4. `multica.config.json`

环境文件按以下方式解析：

1. 根据 mode 自动尝试 `.env.development` 或 `.env.production`
2. 再附加 `GENERICAGENT_ENV_PATH`
3. 最后兼容 `MULTICA_ENV_PATH`

## 兼容说明

- `genericagent.config.json` 和 `genericagent` 顶层 section 是新主入口
- `multica.config.json` 和 `multica` 顶层 section 仍然可用
- `MULTICA_*` 环境变量目前仍是主要运行时变量名，避免一次性改坏部署脚本、模板环境和测试
- `genericagent:package` 已经是对外脚本名，但底层实现文件还沿用 legacy 文件名
