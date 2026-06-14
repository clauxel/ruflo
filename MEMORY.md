# MEMORY

## Dev 隧道排查

- `multica` 的 dev router 服务实际部署在 `116`，本机 `127.0.0.1:19281` 只是 SSH 本地转发入口。
- 如果 `npm run dev:tunnel:up` 或 `scripts/dev-tunnel-up.sh` 创建隧道失败，先不要只盯脚本本身。
- 优先检查本机代理服务是否影响了 SSH 链路，尤其是 ClashX Pro 这类带 `TUN` / `fake-ip` 的代理。
- 本次真实排查中，隧道失败的直接原因更像是代理服务的节点选择问题；将 ClashX Pro 节点从美国切到香港后，`ssh -o BatchMode=yes openclawlaunch_prod_116 'echo ok'` 和 `npm run dev:tunnel:up` 都恢复正常。
- 当前默认使用方式不是 `launchd` 常驻，而是直接运行 `scripts/deploy-development.sh`：
  - 脚本启动时自动拉起 dev tunnel
  - 脚本退出时自动停止 dev tunnel
  - 这条启动/停止链路已经做过一次真实本机验证
- 遇到类似现象时，优先做这两个最小验证：
  - `ssh -o BatchMode=yes openclawlaunch_prod_116 'echo ok'`
  - `npm run dev:tunnel:status`
