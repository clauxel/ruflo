# GenericAgent 项目概述

GenericAgent Launch 是把 GenericAgent 的价值表达、下单开通、交付控制和运营后台落到一个可运行站点里的控制面项目。上游 GenericAgent 仓库强调最小核心、自演化技能树和真实系统控制；这个仓库负责把这些理念包装成一个可以浏览、购买、部署、升级和管理的 hosted workspace 入口。

## 当前仓库负责什么

| 能力 | 说明 |
|------|------|
| **品牌与落地页** | 首页、方案页、对比页、FAQ、法律页、SEO 标签和静态元信息 |
| **订单与开通** | 套餐选择、支付确认、launch order 创建、排队和状态同步 |
| **工作区控制台** | 查看订单、进入 console、升级版本、停止/卸载工作区 |
| **远程部署** | 通过 SSH 和 deployment runtime 将工作区交付到远端节点 |
| **运营支撑** | analytics、支付回调、support 入口、model proxy、管理员操作 |

## GenericAgent 价值如何映射到这个站点

| GenericAgent 特点 | 在当前仓库里的体现 |
|------------------|----------------------|
| Self-evolving skill tree | 全站文案、方案页、对比页、FAQ 和 SEO 都围绕“技能复利”展开 |
| Real system work | 首页和方案页强调浏览器、终端、文件系统、frontends 等真实执行能力 |
| Layered memory | 文案和控制台语境强调持续上下文、部署延续和长期运营记忆 |
| Minimal core + hosted surface | 上游保持轻，当前仓库补齐 launch、checkout、provisioning 和 console 层 |

## 实际技术栈

| 层级 | 技术栈 |
|------|--------|
| 前端 | React 19 + Vite 8 + TypeScript |
| 服务器 | Node.js 单体入口 `server.mjs` |
| API 组织 | `server-lib/api` + 一组 helper/runtime 模块 |
| 数据层 | PostgreSQL，测试场景支持 memory driver |
| 部署层 | SSH 部署、router 协调、模板打包与远程工作区生命周期管理 |

## 目录焦点

| 目录 | 作用 |
|------|------|
| `src/` | 前端页面、内容源、UI 组件、SEO 和客户端逻辑 |
| `server-lib/` | API、数据库、部署运行时、支付、代理、session 等服务端模块 |
| `shared/` | 套餐、模型、渠道等前后端共享目录数据 |
| `scripts/` | 打包远程模板、部署订单、重置开发环境、数据库初始化等脚本 |
| `docs/` | 当前仓库的开发、部署和运维文档 |
| `test/` | 以 Node 测试为主的流程验证和 helper |

## 兼容现状

项目对外已经切到 GenericAgent 品牌，但底层仍保留不少 `MULTICA_*` 环境变量、脚本名和部署字段，用来兼容现有运行链路。这不是遗漏，而是当前阶段有意保留的迁移层。
