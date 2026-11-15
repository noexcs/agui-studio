# Task 13 — Tailwind 迁移报告

## Phase 2a（aurora / paper / terminal / brutalist）

### 残余行数

| Skin | 迁移前 CSS | 迁移后残余 CSS | 占比 |
| --- | ---: | ---: | ---: |
| aurora | 808 | 164 | 20.3% |
| paper | 784 | 178 | 22.7% |
| terminal | 803 | 221 | 27.5% |
| brutalist | 787 | 135 | 17.2% |

残余内容统一为 utilities 无法表达的部分：tokens、keyframes、data-URI 纹理、生成元素排版（`.prose` / `.pap-md` / `.term-md` / `.bru-md`）、滚动条、focus ring、reduced-motion 兜底、accent-guard 变量块。元素样式全部迁到 TSX 的 utilities（arbitrary var shorthand，皮肤作用域变量仍是唯一事实源）。

### 碰撞发现（aurora / paper）

- **条件态同属性碰撞**：原 CSS 靠源序决出胜者的「基类 + 状态修饰」一律改成互斥全量分支。aurora：`RUN_PILL` / `CAP` / `TOOL_BOX` / `TOOL_ICON` / `TOOL_PILL` / `PLAN_*` / `CAT` / `FDOT` / `TAB_*` / `BTN_KIND` / `INTERRUPT_*` / `FOLD_FLAG`；paper：`PAP_STATUS` / slip `open-signed-expired`（label 与 signed-line 颜色随分支）/ plan li 与 plan-box 边框色 / fold-head failure mark+meta。基态字符串不保留这些属性，hover 变体归属所属分支。
- **同名死规则以计算值为准**：paper 文件尾部的 "small legibility fixes" 覆盖了前面的同 specificity 规则，迁移时直接落为计算值（`.pap-column` 664px、`.pap-slip-title` 右内边距 150px、`.pap-plan-box` 10px/600/green）；aurora 的 `.icon` / `.sprite` / `.toast` / sidebar / usage 等无 JSX 站点、无测试锚点的规则确认死代码后删除。
- **v4 全边 border-style utility 的副作用**：`border-dashed` / `border-dotted` 会启用 UA 默认 `medium` 宽度，导致未设置宽度的其余三边出现 3px 边框。受影响的是 `.pap-note`（三边突增 dotted 3px）与 aurora `.tool-result` 分隔线；改为逐边任意属性 `[border-top-style:dashed]` / `[border-bottom-style:dotted]` 后实测 `.pap-note-body` 回到原 261px。
- **rotate 共享常量陷阱**：折叠 chevron 的 `rotate-90` 保持三元表达式，不放进共享常量再在调用点追加 `rotate-0`（同属性无条件 utility 的排序由 Tailwind 决定，方向会反）。
- **reduced-motion 通配符越界**：paper 原文件的全局 `*` 兜底会漏出皮肤作用域，已按 Phase 1 workbench 的先例收窄到 `.skin-paper`。

### 截图

`shots-task13-p2a/`（本地证据，gitignored）：aurora folded/expanded/paused/done（zh/en）+ focus；paper folded/paused/done + focus；terminal folded/expanded/paused/focus；brutalist folded（base/tw）/expanded/paused/focus。Phase 2a 评审补拍 paper focus 与 brutalist base 机位已入库。

## Phase 2b（classic / particle / dash / bubble）

### 残余行数

| Skin | 迁移前 CSS | 迁移后残余 CSS | 占比 |
| --- | ---: | ---: | ---: |
| classic | 772 | 146 | 18.9% |
| particle | 275 | 69 | 25.1% |
| dash | 329 | 95 | 28.9% |
| bubble | 358 | 133 | 37.2% |

四套皮肤的 `tailwind/skin-<id>.css` 入口与本批 commit 一起落地；`build-tailwind.mjs` 的 entry 列表、`verify-package.mjs` 的 migratedSkins 自动同步，dist 选择器行数：classic 457、particle 508、dash 521、bubble 491。

### 碰撞发现

- **classic**：左侧导航整块（`.cl-nav*` / logo / new / search / thread / usage / meter / user）无 JSX 站点也无测试锚点，确认死代码后删除；`.skin-classic .mono` 的 0.92em 在源序上压过 `.cl-tool-time` 等语义类的 font-size，保持 unlayered 以复现原计算值，仅 `.cl-run-end .mono` 的 10px 级联覆盖留残余；accent-guard 测试锚定的 `.cl-btn--primary` / `.cl-sources a` / `.cl-link` 颜色规则保留为最小残余（其余属性走 utilities）。
- **particle**：`ToolResult` 用的是共享 aurora 变体，粒子皮肤靠 unlayered `.pt-tool .tool-result*` 覆盖重绘，整块原样保留，避免把共享变体再拆一份；按钮上的 `font: inherit` 简写展开成 family/line-height/weight 三条 longhand（preflight 关闭时 UA 按钮默认值会漏进来）；`[open]` details 的摘要圆角与 chevron 旋转用 `open:` 任意变体，`::-webkit-details-marker` 留残余；feed 的 `data-kind` 缩进改为 JS 侧 kind 集合判断。
- **dash**：KPI value 的 `:not(.mono)` 17px/14px 分裂必须按元素分支写（同一无条件 utility 会互相排序覆盖）；工具卡左侧 2px 状态色改成逐边 border 颜色（`border-t/r/b` + 分支 `border-l`），避免与基态 `border-color` 抢同一个 longhand；`.ds-kv { margin: 0 }` 在源序上晚于 `.ds-approval-details { margin-top: 8px }`，实测审批明细的 margin-top 计算值为 0，迁移按 0 落值；textarea 的 `:focus-visible` 覆盖（composer 取消环、edit 用 1.5px）必须留在 unlayered CSS 才能压过皮肤级 2px 环。
- **bubble**：气泡/卡片尾巴全部是 `::after` 伪元素，保留残余（含 approval/error 的尾巴配色与折叠组成员隐藏尾巴）；in/out 气泡的圆角按四个角分别写分支，避免非对称尾巴角与 `rounded-[18px]` 简写相撞；`bb-details > div` 一开始照搬 `border-dashed`，截图立即暴露其余三边 3px 虚线框（UA medium width），改为 `border-b` + `[border-bottom-style:dashed]` + `border-b-(--bb-line)` 后与基线一致；typing 气泡原本在 `.bb-bubble` 内层再覆盖 padding，迁移时改为自带完整 padding/radius 的独立常量，避免同属性 utility 碰撞；fold 卡片的 9px 纵内边距单独成串，不与默认卡片 10px 打架。
- **跨皮肤**：reduced-motion 的全局 `*` 兜底在 particle/dash/bubble 原文件同样越界，全部收窄到各自 `.skin-*` 作用域；四个新入口的 `@source` 都覆盖皮肤 TSX + `shared/**` + `host.tsx` + `utils.ts`，dist 均出现 `@layer utilities` 且无 `@media layer(...)`。

### Phase 2a 评审遗留 Minor

- **aurora send disabled 悬停位移**：v4 的 translate/scale 是独立属性，`disabled:transform-none` 清不掉 `hover:-translate-y-px` / `hover:scale-[1.03]`；补 `disabled:translate-none disabled:scale-100`。实测 disabled 悬停计算值为 `translate: none; scale: 1; transform: none`。
- **aurora textarea 焦点环**：`outline-none` 作为 utilities 层规则压过 `@layer base` 的皮肤焦点环（层优先于 specificity）。把 opt-out 移进 base 的 `.skin-aurora textarea { outline: none }`，焦点规则按 0,2,0 胜过 0,1,1，恢复原计算行为；composer/edit 两处 `outline-none` utility 移除。
- **paper reduced-motion 死选择器**：迁移后状态修饰类消失，`.pap-status--running::before` 不再命中。渲染时恢复 `pap-status--<status>` 修饰类，测试锚点与 reduced-motion 选择器重新生效。
- **交付边界与防御**：新增 4 条 per-skin tailwind 入口后，README 的「未迁移皮肤」段落按实际情况重写（Phase 2b 收尾后改为「迁移完成、九套皮肤」）；`verify-package.mjs` 增加「源码已写 utilities 但缺 per-skin 入口」防御断言，并临时移除 aurora 入口实测退出码 1；`skins` 必需文件列表补到 9 套。

### 截图（本地证据，gitignored）

`shots-task13-p2b/`：classic / particle / dash / bubble 各 6 机位（folded en/zh、expanded、paused、done、focus）× base/tw。base 端为迁移前源码（端口 4351），tw 端为当前 worktree（4350）；按放宽口径肉眼核对（非像素对照），四套皮肤的 folded/paused/done 机位与基线一致，bubble paused 的虚线框问题在这一步被抓出并修复。`shots-task13-p2a/` 补入 paper focus 与 brutalist base 机位。

### 验证（各跑一次）

- `pnpm test`：41 文件 / **572 用例全部通过**（与 Phase 2a 基线相同，只增不减）；
- `pnpm typecheck`：通过；
- `pnpm build`（vite）：通过；
- 静态构建：`pnpm preview` 服务 dist，`/` 与 `assets/index-*.js` 均 200；
- `pnpm --filter agui-skins build`（tsup + build-tailwind）：9 条皮肤入口全部产出 `@layer utilities`；
- `node scripts/verify-package.mjs`：9 套皮肤 JS + d.ts + CSS 齐全，CSS 未被 JS import，tarball 完整，缺失入口断言通过。

