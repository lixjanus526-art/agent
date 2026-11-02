# 提交后 UI 稳定性与发布验收（2026-11-02）

## A. 修复与候选来源

- SoT main：`25be827a2363a3274df94819eae1fa166e92883f`；PR #7：`54a91f72d37be77b70d4eada0ee838913f69de63`，OPEN / Draft；PR #1：`5ac8c12daa2b35b6567c48b35ce042b3314d54d2`，OPEN / Draft。均为本轮 GitHub 查询，不沿用旧状态。
- 原目录 `F:/人工智能AI 比赛` 分支 `codex/kosx-landing-glass` 有大量未提交文件，远程是旧 Fintechathon 仓库。本轮没有修改、提交或推送该目录。原 P0 worktree 检查时干净，成果完整。
- 独立发布修复基于最新 main；验证候选基于 PR #7，只叠加相同发布补丁和检查脚本，不合并 main，不修改后端。最终验证 SHA 由候选分支 HEAD 和发布 PR 正文固定。
- `.github/workflows/deploy-standalone-sites.yml`：补齐四个 task 资源及检查脚本的 paths；P0 页面存在时复制完整四件套；改写 task-view.css 为相对路径；上传前验证页面、相对 ES Module 导入与项目子路径。
- `chenchen/scripts/standalone-assets-check.cjs`：递归检查 HTML、JS 与 CSS 的本地资源依赖，缺失或越出 `/agent/` 即失败。
- `chenchen/scripts/standalone-release-test.cjs`：实际运行工作流中的 Bash 原文组装产物，检查触发条件；逐个删除四个 task 资源，确认检查器均拒绝破损产物。Windows 默认使用 Git for Windows Bash，可通过 BASH_EXE 指定。
- 当前 main 尚无 P0 task 模块，条件复制保留现有 main 构建；P0 合入后四件套缺任何一个都会阻止上传。不会静默发布缺资源的 P0 页面。
- 原补丁 `review/ui-demo-p0-standalone-assets.patch` 未直接应用：其内容缺 paths 和上传前路径校验，现已被本次发布 PR 取代，无需再重复应用。

## B. UI Owner 复核

任务状态、服务端审计来源、HTTP 401/403/409/423/503、错误信封、断网/超时、停止等待、重复点击、刷新恢复、跨标签页互斥、SIMULATED task/hash/execution/mode 绑定及不可信身份禁用，复跑原有覆盖，未发现需要额外修改产品代码的新缺陷。未为增加数量重复开发功能。

仍待 UI Owner 完善：同一集成 SHA 的 iOS/Android 真机、Voice 人工冲突解决后的输入与可编辑转写验收、受控 Staging 的完整演示录像。此次没有新增 ASR、录音上传、语音自动提交，也没有恢复浏览器审批/Risk/执行。

## C. 语音兼容与其他 Owner 阻塞

`git merge-tree --write-tree origin/pr-7 origin/pr-1` 只读试合并确认三个内容冲突：

| 文件 | 人工处理原则 |
| --- | --- |
| chenchen/versions/risk-workbench.html | 保留 P0 状态观察区、task CSS、禁用原因；仅增加 Voice 样式和挂载点 |
| chenchen/versions/risk-workbench.js | 保留 TaskClient、幂等/互斥、身份门禁、只读和过期处理；只移入 Voice mount，不接回旧 workflow-actions |
| chenchen/server.js | 静态白名单需同时包含四件套和 Voice 两资源；由 Backend Owner 审核，不整体接受任一侧 |

安全顺序：Sean 审核独立发布 PR并先纳入集成分支；再审核 #7；之后基于 #7 人工解决 #1。此顺序是审核与受控集成建议，不授权直接推 main 或生产发布。#1 的 standalone voice CSS 路径重写、两资源复制及 paths 触发尚不在此次发布补丁范围，必须在语音集成时补齐并重跑依赖图校验；否则校验应阻止破损发布。

Backend/Core：可信本人身份、任务归属、持久化恢复、取消语义与 Node/Worker 一致性；Risk：正式回调和身份签名；Finance：共享账本与版本；Sean：同 SHA Staging、CI 运行及发布证据。上述均不由 UI 编造或越权补齐。

## D. 环境与结果

| 层级 | 本轮结果与限制 |
| --- | --- |
| LOCAL REAL API | 原 Node 服务启动，虚构数据健康检查、Tools、task/audit 查询、刷新恢复通过；review 未配置模型时失败关闭；非真实金融执行。证据 main-demo.json / main-local-api.json |
| MOCK | 明确标记的状态、异常、回执、并发等测试通过；standalone 浏览器 API 固定 503，不代表后端联调 |
| LOCAL STATIC BUILD | main 兼容构建通过；P0 组合产物 16 个可达文件通过；四资源删除负例通过；旧工作流复现 task-view.css 越出项目路径（baseline-failure.log） |
| 本机回归 | check 通过；Node 测试 323 pass / 0 fail；原浏览器 42 pass / 0 fail；新增 Chrome/Edge × 375/768/1440 三宽度共六场景通过，页面刷新、入口路由、无横向溢出、模块加载及无 pageerror |
| STAGING | UNVERIFIED：未提供绑定候选 SHA 的受控部署，无正式联合验收 |
| PRODUCTION | 只读探测 https://realchenchenluo.github.io/agent/ 与 risk-workbench/ 均 HTTP 200；仍为旧资源引用，不是 #7 上线证明。未部署、未修改权限/Secrets |
| CI | 查询 #7 HEAD 对应 Actions 为 0；本机测试不冒充 GitHub CI。新发布 PR HEAD 的 CI 另见交付说明 |
| 真机 | iOS Safari / Android Chrome 均 UNVERIFIED；大陆网络与真人 ASR 均 UNVERIFIED |

截图已检查 375px standalone 页面，输入、状态说明和禁用原因可见。截图见本目录 chrome/edge-standalone-*.png；浏览器明细区分 LOCAL_REAL_API 与 MOCK。

## E. 复现与同 SHA 设备清单

在候选分支根目录执行以下命令，用于本地打包、路径负例与语法检查，不触发发布：

```powershell
node chenchen/scripts/standalone-release-test.cjs
node chenchen/scripts/check.js
Push-Location chenchen
node --test --test-reporter=tap
node scripts/ui-demo-p0-browser.cjs
node scripts/ui-demo-p0-demo.cjs
Pop-Location
node chenchen/scripts/standalone-browser-check.cjs
git diff --check
git rev-parse HEAD
```

浏览器脚本需要 Playwright；本机设置 NODE_PATH 为已安装模块目录。standalone-browser-check 读取本目录 build.json 中产物路径，先将构建输出保存为该文件。原 P0 浏览器脚本写入旧 artifacts 目录，复跑时将证据另存，勿把旧截图误算作本轮证据。发布小分支仅含发布检查脚本；完整 P0 回归必须在组合候选分支运行。

设备验收先记录集成 SHA、Staging URL、构建/部署 ID、设备/OS/浏览器版本，确认均绑定同一候选 SHA，不能用 PC localhost 作为手机验收地址。逐项记录 PASS/FAIL/UNVERIFIED：

1. 桌面 Chrome/Edge 与真机 Safari/Chrome：打开入口再进入 Risk，刷新/返回，检查 CSS/MJS 全部 200 且 MIME 正确，无空白和横向溢出；375/768/1440、横竖屏、系统大字体和软键盘不遮挡按钮。
2. 输入虚构现金10000、房租4000、意向8000，确认后显式提交；核对服务端 task/request/session/audit 与工具版本；不把页面示例金额当真实资产。
3. 连点、两标签页同时提交：只能一次；请求中刷新/返回/断网/停止等待后不自动重发，未知请求仍提示查询原任务；恢复网络后 GET 查询，不清除未知结果以强行重提。
4. 查询过期、拒绝、未知任务和服务不可用：说明原因且不授予权限；无有效 SIMULATED 回执不得显示执行完成；身份未联合验收时审批/Risk/模拟执行持续禁用。
5. Voice 仅在冲突解决、资源检查通过后：授权录音、取消、超时、文字回退、转写可编辑、必须显式提交；不得自动提交，不新增付费 ASR。检查 HTTPS 下 Web Locks/存储能力缺失时失败关闭。
6. 记录截图、网络请求、后端日志和复现步骤。发现失败返回 UI/对应 Owner，不在手机临时开启执行或改权限。

## F. 交付判断

可以交给 Sean 审核发布补丁；不能宣布已发布或正式联合验收通过。PR #7 保持原 HEAD 与审核范围；独立发布 Draft PR不合并。正式发布仍取决于 Sean 审核、共同 Staging、可信身份/Risk/Finance/审批证据与真机验收。
