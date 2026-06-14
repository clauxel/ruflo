# 配置与部署

## 推荐入口

新的推荐部署配置文件名是 `genericagent.config.json`。如果该文件不存在，系统仍会兼容 `multica.config.json`。

推荐从 `genericagent.config.example.json` 开始。

## 配置文件结构

```json
{
	"deployment": {
		"provider": "ssh",
		"targetServer": "genericagent-runtime-1",
		"consoleBaseUrl": "https://console.genericagent.local",
		"publicBaseUrl": "https://genericagent.local"
	},
	"genericagent": {
		"sourceType": "archive",
		"archivePath": "/data/multica/templates/multica-template.tar.gz",
		"repoUrl": "https://github.com/multica/multica.git",
		"repoRef": "main"
	}
}
```

## 字段说明

### `deployment`

- `provider`: `mock` 或 `ssh`
- `targetServer`: 对外展示的目标节点名
- `consoleBaseUrl`: 控制台基础地址
- `publicBaseUrl`: 工作区公开访问地址基础前缀
- `consolePortBase` / `consolePortRange`: console 端口分配范围
- `mockRootDir`: mock 部署时的本地根目录

### `genericagent` / `multica`

- `sourceType`: `archive` 或 `git`
- `archivePath` / `archiveUrl`: 模板归档来源
- `repoUrl` / `repoRef`: 使用 git 模式时的仓库与分支
- `baseDir`, `servicePrefix`, `runtimeUserPrefix`: 远端部署目录和 systemd 命名相关前缀
- `installCommand`, `buildCommand`, `startCommand`: 部署后执行的命令
- `tokenEnvName`, `modelEnvName`, `channelEnvName`, `planEnvName`: 注入到远端实例的运行时环境变量名

## 为什么内部还有 `multica` 路径和变量名

当前仓库已经切换成 GenericAgent 品牌，但部署 runtime、模板环境、测试和部分远端脚本仍依赖 `MULTICA_*` 命名和既有目录约定。现阶段推荐的做法是：

1. 先切文件名、文档、品牌文案和对外 base URL。
2. 保留内部 `MULTICA_*` 变量名作为兼容层。
3. 只有在完整回归远端部署链路后，再迁移 `baseDir`、`servicePrefix` 等更深层命名。

## 环境文件

- development 默认读取 `.env.development`
- production 默认读取 `.env.production`
- 可显式指定 `GENERICAGENT_ENV_PATH`
- 旧变量 `MULTICA_ENV_PATH` 仍可使用

## 常见部署动作

```bash
npm run build
npm run start
npm run genericagent:package <instance-name>
node scripts/deploy-order-to-real-server.mjs
```

## 真实部署前建议

- 确认 PostgreSQL 连接和迁移能正常执行
- 确认 SSH 凭据、目标机目录权限和 router 配置已准备好
- 在正式域名未确定前，不要把 example 中的 `*.local` 地址直接用于生产
