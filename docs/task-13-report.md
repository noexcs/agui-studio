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

（待补）
