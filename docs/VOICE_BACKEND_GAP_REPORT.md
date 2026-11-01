# Voice Backend P0 差距审计

审计日期：2026-11-01。结论：**完成可离线验证的独立后端候选；尚不具备 Staging 验收或生产就绪证据。真实 ASR 未调用，Chat Agent 未接通。**

## 1. 仓库、隔离与版本证据

- 指定 SoT：`https://github.com/realchenchenluo/agent`。
- 已执行 `git status`、`git remote -v`、`git branch -avv`、`git log -5 --oneline`，并重新 fetch 全部 origin 分支和相关 PR head。
- 初始目录 `F:\人工智能AI 比赛` 实际属于 `Fintechathon-agent/Fintechathon-agent`，有大量既有修改；本轮未修改、清理、提交或推送该目录。
- 复用已有克隆 `F:\voice-banking-source` 的 Git 对象，保留其 `codex/voice-banking-v1` 分支；另建 `F:\voice-backend-mvp` worktree，从最新 `origin/main` 创建用户指定分支 `feat/voice-backend-mvp`。
- main / 新分支起点：`ced1ccad50319ba69385d7cbbe9c12114c840062`，远端 `ls-remote` 再次核对一致。本地旧 `main` 落后 3 个提交，未以旧 main 为基线；浅克隆的最近日志不足 5 条，不冒充完整历史。
- 目标仓库权限实测 `pull=true, push=false`。可写远端为个人 fork `lixjanus526-art/agent`；只同步本次独立分支，不推送团队正式交付区、不合并 main、不部署。

| 已检查分支 / PR | 本轮核实 SHA | 发现 / 审查范围 |
| --- | --- | --- |
| origin/main | ced1ccad50319ba69385d7cbbe9c12114c840062 | 当前 Core、ReviewService、配置、前端、测试 |
| PR #1，codex/voice-banking-v1 | 5ac8c12daa2b35b6567c48b35ce042b3314d54d2 | 已有浏览器语音 UI 原型，未合并；不重复开发 |
| PR #2，jinyihan77-create:codex/submission-china-domestic-v1 | 9203e3096eca0c31a7ea61cb7990c6a6cb088614 | Chat Worker、会话、前端请求、provider adapter、配置 |
| origin/codex/submission-china-domestic-v1 | 7f76a6bbe6802d0aa113e23b3f4380677d7c25a6 | 同名目标仓库分支，**与 PR #2 SHA 不同**；定点审查 |
| origin/codex/core-memory-p0-20261030 / PR #4 | fe3a4baeb4046d74f43bee807ed5042cf5b6ea43 | 分支及开放 PR 核实 |
| origin/codex/core-risk-auth-readiness-v1 | a8877adb6807f2965548c7a9977148c16794b6d3 | 分支核实 |
| origin/codex/core-risk-p0-integration-20261030 / PR #5 | 4f98bcfbb45e3d8522484f5b446e498abd7b1ed1 | Risk / Chat 相关源码定点检查；未合并 |
| origin/codex/team-api-handoff-20261024 | 050652e87ca7f78cff0c366c407252c9db86c942 | 分支核实，Account Hub 候选 |
| PR #3，panxintian44-lgtm:codex/import-risk-pr37-v1.1 | b15dbc2da0bcb59aa0394d86ad3383e90ffe2925 | PR 元数据核实；未声称完整源码审查 |
| PR #6，panxintian44-lgtm:codex/risk-p0-trusted-handoff-20261031 | d05d83d9e78e8c67f63957283a3ecbc8db3375a2 | PR / 分支核实；未声称完整源码审查 |
| PR #7，codex/ui-demo-p0-20261101 | 54a91f72d37be77b70d4eada0ee838913f69de63 | UI Demo P0 候选核实；未复制该分支成果 |

开放 PR 是开发成果证据，不是已合并、已部署或最终验收证据。main 源码执行了包含 `voice/speech/audio/ASR/STT/WebSocket`、`qwen/dashscope/aliyun_bailian`、`chat/intent/tool_call/routing`、`authorization/Risk/approval/audit` 的批量搜索。部分远端分支全量 grep / diff 因部分克隆补取对象长时间不返回而中止，转为读取关键文件；这部分覆盖缺口不能解释为功能不存在。

## 2. 当前架构与已有功能

已读根 README、`chenchen/README.md`、`chenchen/docs/core-agent-architecture.md`、`core-agent-dri-scope.md`、`public-backend-deployment.md` 及相关集成文档。README 含历史入口说明，部署配置与源代码优先；文档中的 10 月真实调用记录不证明 11 月当前部署状态。

```text
main 风控工作台 -> /api/review -> ReviewService -> Model Review
                                         -> Risk / Approval / Simulation（execution_allowed=false）
main 旧聊天演示 -> 固定前端回复
PR #2 Chat 页面 -> /api/local/chats/{id}/turns -> ChatSession / 模型与工具

本轮独立候选：Browser WAV -> Voice Gateway -> VoiceSession -> ASR Provider
                                          -> VoiceQuota       -> 最终文本
最终文本 -> 用户编辑并确认 -> 请求适配器（无网络） -> 待 Chat Owner 接入
```

下表行号为检查时对应 SHA 的源码，不混用 main 与候选分支。

| 功能 | 状态 | 文件、函数及证据 |
| --- | --- | --- |
| Core Worker / 持久化审核 | 已有实现 | main `chenchen/wrangler.toml:2,23` 指向 `deployment/worker.js` / ReviewService；Worker `readJson:67`、ReviewService:234、路由鉴权:483 |
| 默认模型 | 已有实现 | main `chenchen/wrangler.toml:10-11` 为 Workers AI / Llama；根配置同为 Workers AI；不能据此声称 Qwen 已部署 |
| 百炼文本审核 | 部分实现 | main `chenchen/integrations/bailian-provider.js:3,21` 为 qwen3.7-flash 配置与校验；不是 ASR；生产配置/费用准入未验证 |
| 文本模型审核 | 已有实现 | main `chenchen/integrations/model-review.js` 的 SYSTEM_PROMPT:37、runReview:469；审核合同，不是普通 Chat Agent |
| main 旧聊天页面 | 部分实现 | `chenchen/app.js` getAgentReply:77、sendMessage:87-91 固定回复，属于 Mock，不是真实模型聊天 |
| 当前工作台请求 | 已有实现 | `chenchen/versions/risk-workbench.js` workflowRequest:20、提交审核:300、审批/模拟:340-342；请求 `/api/review`，不等于聊天入口 |
| 真实 Chat 源码入口 | 部分实现 | **PR #2** `chenchen/integration/public-chat/worker.mjs` chatRoute:20、Origin/CSRF:50、ChatSession.start:167-170；`review.js` 使用 `/api/local` 和 SSE；main 无此目录 |
| Chat Qwen 候选 | 部分实现 | PR #2 `provider-adapter.mjs` providerSlot:39、百炼模型校验:61-66；支持 qwen3.8-flash 候选。Worker 配置仍默认 Workers AI；不能认定付费通道启用 |
| Chat 公网可达及当前模型 | 无法验证 | 对候选 URL `/health` 的只读请求 HTTP=000 / 连接失败，未取得有效服务响应；未提交聊天或付费请求 |
| 已有语音前端 | 部分实现 | PR #1 BrowserAsrAdapter / TtsAdapter，用户确认后复用 `/api/review`；浏览器原型，未合并，不等于云端 ASR |
| main ASR / 音频入口 / WS | 缺失（已检查 main 范围） | 未找到生产 ASR 实现；`chenchen/experiments/life-planning-v1/intake.js:20-21,107` 只接受最终 speech_transcript，明确 speech_recognition_performed=false |
| Risk / 审批 / 审计 | 已有实现 | main `review-workflow.js:156,180-185` REVIEW_ONLY / 执行阻断，event:112；后续 Owner Bridge / 回调在既有模块，未修改 |
| 金融账户身份隔离 | 部分实现 / 无法验证正式身份 | 现有审核文档明确公开演示编号查询非用户隔离；PR #2 `session.mjs` sessionFor:4-10 为签名匿名浏览器 Cookie，不等于实名认证金融账户 |
| 新 Voice Gateway | 已有实现（离线候选） | `chenchen/voice/voice-gateway.mjs` fetch:5；独立路由和二进制路径，不调用 readJson |
| 新 ASR Adapter | 已有实现（未真实调用） | `asr-provider.mjs` providerConfig:4、transcribe:8；固定百炼 HTTPS endpoint，无成功 Mock 降级 |
| Voice 身份 / 会话 / 分布式额度 | 已有实现（离线候选） | `voice-security.mjs` authenticate:10、checkOrigin:27；`voice-session.mjs` VoiceSession:9；`voice-quota.mjs` VoiceQuota:2。真实 Cloudflare DO 运行尚未验证 |
| Voice 到 Chat 身份桥接 | 缺失 | `voice-chat-adapter.mjs` confirmedChatRequest:3 仅构造请求；对应 [跨模块契约提案](contract-proposals/voice-chat-handoff-v1.md) |

## 3. 方案选择与官方核对

选择**短音频二进制上传 + 服务端 HTTPS ASR**。Cloudflare Workers 能接入 WebSocket，但长连接还需两端会话、背压、断连与供应商实时协议验证；本轮没有已有可复用的后端实时 ASR，也没有凭证进行真实互通。因此没有实现或宣称 WebSocket 服务。

本轮按[百炼录音文件识别 API](https://help.aliyun.com/zh/model-studio/recording-file-recognition-qwen)核实 `qwen3-asr-flash` 的 OpenAI compatible HTTP 接口、Bearer 鉴权和 `input_audio.data` data URI；关闭 streaming，读取最终文本。北京与新加坡使用各自 endpoint / 对应地域 Key，禁止用户传入 endpoint 或跳转地址。

[官方模型概览](https://help.aliyun.com/zh/model-studio/asr-model)已列出更新的 Qwen Audio 系列；本轮固定 API 文档仍有示例的 qwen3 模型，不将“文档存在”当成账户已开通。正式配额、模型可用地域、人民币费用、限速与数据处理政策必须由百炼账户 Owner 在控制台再次核准，本轮未获取这类账户证据。

本项目自定更严格的输入限制：16 kHz / 单声道 / PCM16 WAV，实际时长 0.1–60 秒，最大 1,920,100 字节；不接受 WebM、MP3、JSON 或公网音频 URL。浏览器 MediaRecorder 常产 WebM/MP4，前端需提供 WAV 编码，不能直接改 MIME 冒充 WAV。音频 RIFF 大小、fmt/data chunk、采样率、字节率、位深、尾部完整性均校验。

Cloudflare 依据：[Workers WebSocket](https://developers.cloudflare.com/workers/runtime-apis/websockets/)、[Durable Object 状态](https://developers.cloudflare.com/durable-objects/examples/durable-object-in-memory-state/)。静态打包成功并不证明边缘运行兼容或账户开通。

## 4. 安全审计与本轮隔离措施

| 项目 | 历史事实 / 本轮措施 | 剩余边界 |
| --- | --- | --- |
| Key 缺失 | main `cloudflare/worker.js:121` / `chenchen/deployment/worker.js:200` 在 Workers AI 模式下 CORE_AGENT_API_KEY 为空时放行 | 历史回归已复现；提供**未应用**的独立修复补丁 `docs/patches/core-missing-key-fail-closed.patch`，没有悄然改变原接口；Core Owner 需独立审核应用 |
| 新 Voice 认证 | 缺少签发 Secret / issuer 返回 503；缺少 token 返回 401；只接受 HS256、受限 aud/scope、REVIEW_ONLY 和最长 5 分钟 token | 可信身份签发器尚未接通；签发前必须在服务端校验 sub/account 的真实访问权，不可由浏览器自填 |
| Session 隔离 | subject + account 计算 owner digest，DO 名再绑定 session；所有读/写/取消均由网关注入身份，外部 internal header 被丢弃 | 仅知 session_id 不能读取；认证方的 token 吊销、账户关系变更仍需 Owner 策略，当前最长残余有效期 5 分钟 |
| CORS | 新路由精确 origin 白名单，禁止 `*`，HTTPS（localhost 开发例外），预检限制方法/header | CORS 不是认证；无 Origin 的服务端调用仍必须携带合法 token。历史配置 `CORS_ORIGINS="*"` 保留并报告 |
| 分布式限制 | 单独 VoiceQuota DO transaction，跨会话共享持久化预算；每 subject/account 每分钟最多 6 次创建/ASR准入合计；单分钟最多 1000 个 owner | 测试为内存存储替身，不能替代 Cloudflare 多实例实测；读取/错误鉴权的边缘流量治理尚需账户 WAF 配合 |
| 供应商预算 | 每次调用前预留向上取整音频秒数；UTC 每日及累计上限默认 0，配置缺失拒绝；未知结果不退额、不重试 | 是音频使用量硬边界，**不是人民币账单保证**；无自动充值。实际计费、平台限额与紧急停用由账户 Owner 管理 |
| 重复提交 | 每会话只接受一份音频，request_id + 音频 hash + language 绑定；相同输入返回缓存，冲突 409；调用前持久化 PROCESSING | 重启/保存失败后未知结果拒绝再次调用；新建会话属于新请求，仍受预算约束；没有金融执行入口 |
| 时限 / 取消 | 上传 10 秒、供应商全程 25 秒；AbortController、DELETE 取消、最大 60 秒音频、会话 5 分钟 TTL / alarm | Worker 客户端信号传播与 DO alarm 为本地逻辑测试，需真实运行环境验证 |
| 数据与日志 | 原始音频只驻请求内存，finally 清空自有字节数组，不写对象存储/数据库；只临时保存最终文本/摘要/状态；取消清文本，过期删除记录；不记录正文/Key/上游错误原文 | 不能宣称清除供应商或平台的所有备份；供应商留存和跨境政策未核准。转写文本也是敏感数据，需 UI 告知临时留存与供应商处理 |
| 审批 / 权限 | 所有 Voice 响应强制 REVIEW_ONLY、execution_allowed=false、requires_user_confirmation=true；模块无交易工具或金融服务绑定 | 用户勾选 confirmed 只表示文本发送确认，绝非资金批准或权限证明；现有 Risk / Approval / Audit 不变 |
| 审计衔接 | 新会话保留 request_id / session_id / 状态 / hash，错误脱敏 | 没有把临时 Voice 记录伪装成正式金融 Audit Log；正式 task_id/run_id/audit_id/handoff_id 关联需 Chat/Core Owner 合同确认 |

历史补丁的验证包括原漏洞复现、内存中修正函数的缺 Key/错误 Key/正确 Key 三类断言，以及 `git apply --check`。**这不表示历史线上漏洞已经修复。** 相关生产代码和既有测试断言均未改动。

## 5. 金融能力接入范围

| 用户需求 | 本轮实际行为 | 下游依赖 |
| --- | --- | --- |
| 消费分析 | 只产生可编辑最终文本 | 已授权账单数据和真实 Chat 工具接入未验证 |
| 投资组合查询 | 只产生文本；PR #2 有持仓/工具链候选 | Chat Owner 合并/版本准入和账户授权 |
| 理财知识问答 | 只产生文本 | 已有 Chat 模型路由；本轮未真实问答 |
| 任务查询 | 只产生文本 | Core Owner 的账户级查询接口与映射 |
| 风控记录查询 | 只产生文本 | Risk Owner 的已授权只读记录接口 |
| “转账两千元”等高风险指令 | 可转写，但没有执行或自动聊天调用；离线测试确认只调用 ASR URL | 已有受控审批链路；不得把语音确认升级成批准 |

没有另起意图识别 LLM，没有构造伪造账户分析，也没有宣称六项金融业务已打通。转写层与金融意图识别是两个边界：最终文本经确认后才可复用 Chat 现有 routing；资金动作继续受原网关阻断。

## 6. 验证结果与覆盖缺口

环境：Windows / PowerShell，Node v24.22.1。命令均在独立 worktree；不依赖客户数据。

| 检查 | 实际结果 |
| --- | --- |
| `cd chenchen; node scripts/check.js` | 通过，原仓库 JavaScript 检查通过 |
| `cd chenchen; node --test` | **306 项：305 通过、0 失败、1 跳过** |
| `node --test chenchen/tests/voice*test.mjs` | **22 项：21 通过、0 失败、1 跳过**；包括 19 项新语音离线行为测试 + 2 项历史漏洞/补丁测试 |
| 新模块语法 / ESM 静态打包 | `node --check`；esbuild 0.28.2 bundle 通过，保留 node:buffer 平台内置导入 |
| Cloudflare `wrangler deploy --dry-run`（没有发布） | **失败 / 环境阻塞**：缓存 Wrangler 4.151.1 缺少 @cloudflare/workerd-windows-64；独立临时工具目录安装又遇网络超时和 pnpm 链接错误 |
| Cloudflare 本地 DO / HTTP 集成 | **未测试**：缺少上述运行组件，不能以 Node 内存替身冒充 Miniflare/Cloudflare 验收 |
| `git apply --check` 历史补丁 | 通过；补丁保持未应用 |
| `git diff --check` | 通过 |
| 真实百炼 ASR | **未测试 / 显式跳过**：未提供 Secret、已批准预算及合成录音，不发生付费调用 |
| Chat / Risk 真实联调 | **未测试**：跨 Worker 身份、CSRF、路由准入尚未确认 |
| Chrome / Edge / 手机真实麦克风 | **未测试**：本轮后端任务，无物理设备/浏览器验收证据 |
| 独立 lint / build 脚本 | package.json 没有对应脚本，不能宣称执行过；改用现有 check、全量 test 与新增 ESM 打包 |

错误音频、无麦克风产生空文件、无权限、过期/伪造 token、跨账户、CORS、并发重复、上传/ASR 超时、连接中断、取消、TTL、额度耗尽、存储失败、REVIEW_ONLY 不能升级及 ASR 不伪造成功均有离线自动化断言。真实服务测试独立文件和显式开关，默认跳过。证据摘要见 [测试记录](evidence/voice-backend-tests.txt)。

## 7. 尚未完成的 P0 与负责人

| P0 | 下一步负责人 | 验收要求 |
| --- | --- | --- |
| 正式身份签发 / Chat 会话映射 | Identity + Chat Owner | 服务端签发、账户授权、跨账户拒绝、CSRF、token 吊销策略；不得给浏览器签发 Secret |
| 供应商开通 / 地域 / 预算 / 数据政策 | 百炼账户 Owner + Security | Secret 注入、模型可用性、限额、合规留存政策，用非客户合成音频取得真实回包 |
| Cloudflare 运行与 Staging 准入 | Cloudflare 账户 Owner + Backend | 补齐 workerd，在隔离环境验证真实 DO、取消、TTL、并发和故障；发布前需用户确认 |
| Chat Adapter 实际接入 | Chat + Core + Risk Owner | 确认契约和既有路由；关联真实审计 ID，保持 REVIEW_ONLY；六类任务逐项验收 |
| WAV 采集及前端交互 | UI Owner | 复用现有聊天框，编辑后人工发送；中文/英文、60秒上限、拒绝授权回退、设备测试 |
| 历史 fail-open 补丁应用 | Core + Security Owner | 独立审核补丁，补充现有接口的配置迁移回归后另行应用；当前生产状态未知 |

下一阶段按身份、运行环境与供应商、Chat 联调的依赖顺序推进。没有以上证据前，状态保持 **离线候选 / 原型**。
