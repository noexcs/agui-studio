# BACKLOG — AG-UI Studio 交接任务书

> 给接手的 AI / 开发者：先读这份，再读 `README.md`。
> 所有任务都包含「为什么 / 涉及文件 / 验收标准 / 规模」，完成一个就把该行改成 ✅ 并写明提交号。

## 0. 基本盘（不要破坏）

- 仓库：`noexcs/agui-studio`，主分支 `main`，push 即自动部署 GitHub Pages：
  https://noexcs.github.io/agui-studio/
- 技术栈：React 18 + Vite 5 + TypeScript；`agui-skins` 是 `packages/agui-skins` 下的 workspace 包。
- 命令：
  ```bash
  pnpm install --no-frozen-lockfile
  pnpm test        # vitest，当前 73 个用例，必须全绿
  pnpm build       # 普通构建
  # 静态演示构建（线上就是这个）：
  VITE_STATIC_DEMO=1 VITE_BASE=/agui-studio/ pnpm build
  ```
- 硬约束：
  - 部署跑在 GitHub Actions（Node 22 + pnpm 11 + `pnpm-workspace.yaml` 的 `allowBuilds`），不要退回 Node 20 / pnpm 10 的写法；
  - 静态站点**不能**依赖 pi bridge（`127.0.0.1:5179`）；演示模式必须自包含；
  - 皮肤只通过 `SkinHostProvider` + `useConversation()` 取数据，不许直接解析协议事件；
  - 新增皮肤/控件要同时补测试，保持 `pnpm test` 全绿；
  - 皮肤视觉各自独立，公共层只做契约与注入，不要把某套皮肤的样式塞进公共层。

## 1. P0 — 质量与可发布性（建议优先）

| # | 任务 | 为什么 | 涉及文件 | 验收标准 | 规模 |
|---|---|---|---|---|---|
| P0-1 | CI 增加测试 job | 目前 workflow 只 build+deploy，测试没跑 | `.github/workflows/`（新增 `test.yml` 或在 deploy 前加 step） | push/PR 跑 `pnpm test`，失败阻止部署；状态徽章可加在 README | S |
| P0-2 | 桥接层单测 | `pi-map.mjs` / bridge SSE 零测试，映射错了发现不了 | `server/pi-map.mjs`、`server/bridge.mjs`、`tests/` | 单测覆盖 pi 记录 → AG-UI 事件映射（agent_start/settled、text/thinking/toolcall、tool_execution、get_state）；bridge `/api/run` 用 fixture 后端跑通并断言 SSE 序列 | M |
| P0-3 | SSE 传输单测 | `HttpAgentTransport` 的解析、取消、错误路径没测 | `src/core/transport.ts`、`tests/` | 覆盖 CRLF、多行 data、半帧/粘包、无 `type` 帧丢弃、abort 后不再回调 | M |
| P0-4 | 录制回放端到端 | 现在 fixture 是手写事件流，缺少真实录制链路 | `server/fixtures/pi-run.jsonl`、`tests/fixture.ts` | 用录制 JSONL → mapper → events → `ConversationStore` → 皮肤渲染，断言最终文本/工具/状态 | M |
| P0-5 | npm 包产物 | `agui-skins` exports 指向 TS 源码，不能直接 `npm publish` | `packages/agui-skins/package.json`、新增 `tsup.config.ts` | 构建出 `dist/*.js + *.d.ts`，exports 指向 dist；`npm pack` 后能在独立 Vite 项目 install 使用 | M |
| P0-6 | 覆盖率门槛 | 回归靠人肉 | `vitest.config.ts`、CI | 配置 coverage，设最低阈值（建议 lines 70%），CI 低于阈值失败 | S |

## 2. P1 — 协议完整性

| # | 任务 | 说明 | 验收标准 | 规模 |
|---|---|---|---|---|
| P1-1 | STEP 事件 UI | `STEP_STARTED/FINISHED` 目前只进事件日志 | 至少 Aurora inspector + Classic 详情展示步骤时间线；协议测试覆盖 | S |
| P1-2 | RAW / metadata 可视化 | `RAW` 与事件 `metadata` 只进日志 | Aurora 事件检查器可展开 raw payload；Classic 运行详情显示 metadata | S |
| P1-3 | CUSTOM 渲染插槽 | 只认 `suggestions` / `usage` | `SkinDefinition` 增加可选 `renderCustom`（或 skin 内注册表）；未知 CUSTOM 不静默丢 | M |
| P1-4 | capabilities 来自 agent | 目前 store 里是静态声明 | bridge/agent 下发 capabilities 时覆盖 `store.capabilities`；皮肤同步更新 | M |
| P1-5 | 多实例/多语言同页 | i18n 字典是模块单例，provider 目前「钉住」当前语言 | 改为 React Context 字典（不破坏现有 73 测试）；两个不同 `lang` 的 Host 同页并存 | M |
| P1-6 | 边界 schema 校验 | 畸形事件靠手写映射容错 | 引入 zod（或 ajv），在 transport/adapter 边界校验；非法事件转为 `RUN_ERROR` 而不是半应用 | M |
| P1-7 | fuzz / 不变量 | 顺序错乱、重复事件只覆盖了少量 | 随机事件序列不崩；不变量断言（无孤儿 tool、无 NaN、状态机合法迁移） | S |

## 3. P2 — 产品与体验

| # | 任务 | 说明 | 验收标准 | 规模 |
|---|---|---|---|---|
| P2-1 | 更多自定义项 | 当前：主题色/文字动画/密度/预设 | 增加圆角、字号、动效速度；每套皮肤可声明支持项（`SkinTuning` 扩展 + `tuning.css` 映射）；导出/导入 tuning JSON | M |
| P2-2 | 无障碍审计 | 面板/审批/键盘导航 | axe 扫描 5 皮肤无严重问题；自定义主题色时检测文字对比度并提示；`prefers-reduced-motion` 全覆盖 | M |
| P2-3 | 移动端 | 目前桌面优先，面板有简单媒体查询 | ≤430px 下 5 套皮肤可用，自定义面板不遮挡输入框；截图验证 | M |
| P2-4 | 长会话性能 | 消息全量渲染 | 引入虚拟列表（或分段渲染），1000 条消息滚动 60fps；流式时不掉帧 | L |
| P2-5 | 演示场景扩充 | 现有一个 mock run | 增加：并行审批、工具失败、子 agent、非 PLAN activity、断线重连（MESSAGES_SNAPSHOT）各一个场景，首页可切换 | M |
| P2-6 | Storybook + 视觉回归 | 皮肤视觉靠肉眼截图 | 每套皮肤至少 1 个 story + Playwright 截图对比（5 皮肤 × zh/en） | M |

## 4. P3 — 可选扩展

- 新皮肤：IDE/文件树风、仪表盘风、移动聊天风；遵循 `SkinDefinition` 契约即可；
- 自定义域名 / 用户站点子域名部署（当前是项目子路径）；
- pi 的 HITL：pi 目前 one-shot、无 resume，若上游支持可打通真实审批；
- 多线程/会话管理（现在对话是演示数据，`threadId` 固定）；
- 协议矩阵文档：`docs/protocol-matrix.md`，把 30 个事件映射到代码位置与测试用例。

## 5. 已知问题（接手时注意）

1. **过期/拒绝文案**：expired 中断在皮肤里显示为「已拒绝」，语义可再细化；
2. **审批按钮**已支持按 `entry.id` 定位（多中断可跳着点），但「编辑参数」仍作用于最老的一张 pending；
3. **i18n 单例**：`t()` 依赖模块级当前语言，多 Host 不同语言同页会串（P1-5）；
4. **静态模式**：`?backend=pi` 在线上无效果（演示模式强制 mock），本地才有 pi；
5. **pi 模式**为手动发送（不自动首条消息），mock 模式自动播放；
6. **headless 截图**里 CSS 动画会停在首帧（`--virtual-time-budget` 冻结），不是 bug；
7. **截图目录**只提交了 `shots/contact-sheet.png`，其余已被 gitignore。

## 6. 交接完成定义

- [ ] `pnpm test` 全绿，且 CI 有测试 job（P0-1）
- [ ] `pnpm build` 与静态构建均通过
- [ ] 新增/修改行为有对应测试
- [ ] README 与 `docs/BACKLOG.md` 同步更新
- [ ] push 后 Pages 部署成功（Actions run 绿色）
