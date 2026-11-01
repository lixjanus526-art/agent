# Voice Backend MVP 实施说明与本地验收

日期：2026-11-01。分支：`feat/voice-backend-mvp`；main 起点：`ced1ccad50319ba69385d7cbbe9c12114c840062`。实现提交以该分支 Git HEAD 为准，交付消息提供完整 SHA。

**当前等级：离线可验证后端候选 / 原型。真实 ASR 未成功调用、Chat 未联通、Cloudflare 本地运行未验收；不能称为 Staging 可用或生产就绪。** 未修改现有金融 API / Risk Bridge / ReviewService / UI / 原测试断言，未部署、未合并、未处理真实客户金融数据。

## 1. 变更文件

| 文件 | 用途 |
| --- | --- |
| `chenchen/voice/voice-gateway.mjs` | 独立 HTTP 路由、CORS、身份注入、二进制请求转发 |
| `chenchen/voice/voice-security.mjs` | 短期 JWT 校验、owner digest、Origin 白名单；签名函数供可信签发端/测试使用，无公开签发接口 |
| `chenchen/voice/voice-contract.mjs` / `.d.ts` | 响应类型、错误、输入校验、WAV 解析、上传流限制 |
| `chenchen/voice/asr-provider.mjs` | 百炼短音频 HTTPS Adapter，可替换的供应商边界 |
| `chenchen/voice/voice-session.mjs` | 独立会话 DO、去重、取消、5分钟 TTL、暂存结果 |
| `chenchen/voice/voice-quota.mjs` | 独立全局 DO，持久化分钟限流及每日/累计音频秒数预算 |
| `chenchen/voice/voice-chat-adapter.mjs` | 最终文本经明确确认后，构造已有 Chat 请求；不调用网络或工具 |
| `chenchen/voice/offline-fixtures.mjs` | 仅测试使用的合成 WAV / 身份 / 内存 DO 替身；生产入口不导入它 |
| `chenchen/wrangler.voice.example.toml` | 独立候选配置；ASR 默认关闭、预算默认0、公开路由默认关闭 |
| `chenchen/tests/voice-backend.test.mjs` | 离线行为与安全测试，供应商严格使用测试替身 |
| `chenchen/tests/voice-backend-live.test.mjs` | 独立真实供应商测试，默认跳过，不使用 Mock |
| `chenchen/tests/voice-legacy-auth-patch.test.mjs` | 旧认证问题复现与独立补丁逻辑验证 |
| `docs/patches/core-missing-key-fail-closed.patch` | **未应用**的旧接口认证补丁，待 Core Owner 独立审核 |
| `docs/contract-proposals/voice-chat-handoff-v1.md` | 跨模块身份与 Chat 接入提案，待 Owner 确认 |
| `docs/VOICE_BACKEND_GAP_REPORT.md` / 本文 / `docs/evidence/voice-backend-tests.txt` | 审计、验收、结果记录 |

所有文件均为新增；原部署配置不动，旧 UI 成果保留在原分支。

## 2. 新增 API 契约

网关只有以下路由，**没有 Chat、转账、交易、审批或配置修改接口**：

| 方法与路径 | 输入 | 输出 |
| --- | --- | --- |
| `POST /api/voice/sessions` | Bearer token；不带 body | 201，READY / session_id / expires_at |
| `POST /api/voice/sessions/{session_id}/audio` | Bearer token；`Content-Type: audio/wav`；`X-Audio-Consent: true`；`X-Request-ID`；可选 `X-Voice-Language: zh-CN` 或 en-US；body 为 WAV 二进制 | 200 最终转写；失败返回明确 HTTP 状态 / error |
| `GET /api/voice/sessions/{session_id}` | 同一授权 subject/account 的有效 Bearer token | 当前状态或已保存结果；GET 200 仍必须检查 error / is_final |
| `DELETE /api/voice/sessions/{session_id}` | 同一授权 subject/account 的有效 Bearer token | 停止进行中的 ASR（尽力取消）并清除结果；状态 CANCELLED |
| `OPTIONS` 同上 | 白名单 Origin 和受支持的方法/header | 204；无任何业务处理 |

不允许 URL query；服务端不读取客户端声称的 duration、user_id、account_id、capability。Origin 必须精确匹配配置。API token 是可信后端签发的短期身份凭证，绝非供应商 API Key。

示例仅展示响应形状，不是本轮真实 ASR 回包：

```json
{
  "contract_version": "voice-transcription.v1",
  "transcript": "查询我的任务",
  "is_final": true,
  "session_id": "voice-example-0001",
  "request_id": "request-example-0001",
  "provider": "aliyun_bailian",
  "language": "zh-CN",
  "duration_ms": 1000,
  "error": null,
  "capability": "REVIEW_ONLY",
  "execution_allowed": false,
  "requires_user_confirmation": true,
  "status": "TRANSCRIBED"
}
```

失败时 transcript=null / is_final=false / error={code,message}；message 为固定的脱敏中文提示。早期鉴权/音频校验失败时 session_id / request_id / language / duration_ms 可为 null，不能凭空补值。后续金融服务未接入时由 UI 明示未联通，不以临时转写成功冒充业务成功。

常用错误：401 缺失/无效/过期 token；403 权限/来源/同意不足；404 会话不存在或不属于当前身份；409 已取消/幂等冲突/上次结果未知；410 会话过期；413 大小/时长超限；415 格式错误；429 频率/预算限制；499 已取消或断开；502 供应商失败；503 配置/存储不可用；504 识别超时；408 上传超时。HTTP 499 为本项目约定，前端必须识别为未完成。

同一会话只接受一份录音：重复同 request_id、同音频、同 language 返回原结果；更改任一项返回409。调用前记录 PROCESSING；进程中断后不自动再次调用。GET 可能返回 OUTCOME_UNKNOWN，这不代表成功；客户端必须先显示不确定状态，不能自动换 request_id 继续执行任何金融动作。

## 3. 身份、授权与处理同意

JWT：HS256，最长5分钟，`iss`=可信签发者，`aud=voice-gateway`，`sub/account_id/jti` 为受限标识，`scope=voice:transcribe`、`capability=REVIEW_ONLY`，包含 iat/exp，可选 nbf。服务端签发前必须核对账户关系。本轮没有向匿名用户提供签发接口，也不从 Cookie 自动推断正式账户。

客户端明确点击录音后获取权限；提交前说明本次音频会由所选地域的百炼服务处理、转写文本短期缓存5分钟，并取得同意后设置 `X-Audio-Consent:true`。该 header 是当前 API 的同意声明，不能作为金融批准、真实登录或法务审计证明。浏览器授权、语音转写同意和资金操作批准彼此独立。

用户可以编辑转写；默认不自动发送、不朗读。只有最终成功且用户确认后的文字可以进入 `confirmedChatRequest`。该函数不产生执行权限，不可替代 Chat 服务的身份、CSRF、Risk 与权限检查。

## 4. 环境变量与绑定

只列名称与用途，不包含任何真实密钥值。所有 Secret 必须由后端/账户 Owner 注入；不得提交 Git、写入前端或日志。

| 类型 | 名称 | 要求 |
| --- | --- | --- |
| Secret | `VOICE_AUTH_SECRET` | 至少32字符的高熵服务端签名密钥，与可信身份签发端安全共享；不与旧 Core Key 共用 |
| Secret | `DASHSCOPE_API_KEY` | 所选地域的百炼 Key；只用于服务端请求 |
| Config | `VOICE_TOKEN_ISSUER` | 可信身份服务固定名称 |
| Config | `VOICE_ALLOWED_ORIGINS` | 逗号分隔精确 Origin，禁止通配符；开发配置仅 localhost |
| Config | `VOICE_ASR_ENABLED` | 必须显式 true 才能调用；示例默认 false |
| Config | `VOICE_ASR_MODEL` | 当前 Adapter 仅支持 qwen3-asr-flash |
| Config | `VOICE_ASR_REGION` | cn-beijing 或 ap-southeast-1，Key/数据地域须匹配 |
| Config | `VOICE_DAILY_AUDIO_SECONDS` | UTC 每日允许的音频秒数正整数；默认0拒绝 |
| Config | `VOICE_TOTAL_AUDIO_SECONDS` | 累计允许的音频秒数正整数；默认0拒绝；不会每天重置 |
| Binding | `VOICE_SESSIONS` | 独立 VoiceSession SQLite DO namespace |
| Binding | `VOICE_QUOTA` | 独立 VoiceQuota SQLite DO namespace |

每日/累计额度从请求前预留，按秒向上取整；失败或结果未知不自动退额，避免重试漏计。不是金融账户余额，也不保证人民币消费金额。暂停可设置 VOICE_ASR_ENABLED=false；既有 token 不因删除本地 UI 自动失效，需要由身份 Owner 设计紧急吊销/轮换策略。

原始音频不持久化。最终文本、请求摘要和状态短期保存在 DO，供幂等/状态读取；取消删除文本，TTL到期 alarm 删除会话。供应商和平台备份的留存不在代码所能证明的范围内，需账户 Owner 完成政策审查。

## 5. 可复现本地验收

### A. 不需要凭证、不会付费的离线验收

用途：核对新增安全行为；供应商与 DO 在该套件中使用替身，不能认定是真实 ASR 或边缘运行。进入独立 checkout 根目录执行：

```powershell
node --test chenchen/tests/voice*test.mjs
```

预期22项：21通过，1项带 LIVE ASR 标识的测试跳过。成功用例供应商替身返回“转账两千元”，断言请求只到 ASR URL，execution_allowed=false，未经确认的 Chat 请求被拒绝；不会发出真实转账。

用途：运行既有检查和全量测试，确认原金融业务未发生回归：

```powershell
Push-Location chenchen
node scripts/check.js
node --test
Pop-Location
```

本轮实测306项：305通过、0失败、1跳过。Node >=22；本机 Node v24.22.1。仓库未定义独立 lint/build 脚本，npm 不在本机 PATH，以上直接执行其等价 Node 入口。

用途：检查新增 ESM 语法和未应用补丁能否匹配当前 main。此命令不会应用补丁：

```powershell
Get-ChildItem chenchen/voice -Filter *.mjs | ForEach-Object { node --check $_.FullName }
git apply --check docs/patches/core-missing-key-fail-closed.patch
git diff --check
```

### B. Cloudflare 本地运行验收（本轮环境阻塞，尚未通过）

先由 Backend / Cloudflare Owner 安装可用 Wrangler 及其 Windows workerd 组件。本轮缓存 Wrangler 4.151.1 因缺组件启动失败，补装受网络超时和 pnpm 链接错误阻塞。esbuild静态 bundle 已通过，不能据此声称 Worker 实测。

用途：只在本机启动独立候选，配置默认拒绝认证/ASR。不会部署到 Cloudflare：

```powershell
npx wrangler dev --local --config chenchen/wrangler.voice.example.toml --port 8787
```

用途：在另一终端验证未配置身份服务时拒绝请求（预期503，VOICE_AUTH_NOT_CONFIGURED）：

```powershell
curl.exe -i -X POST http://localhost:8787/api/voice/sessions
```

正向 HTTP 流程须由身份 Owner 在本地受控测试环境配置 `chenchen/.dev.vars`（已被 Git 忽略）中的实验签名 Secret、issuer、白名单和有限预算，签发合成账户 token；不用客户资料，ASR保持关闭可先验证创建/查询/跨用户拒绝/取消。有效 token + 已配置预算下创建会话预期201，跨用户读404，合法 WAV 上传预期503 ASR_NOT_CONFIGURED。随后才进入获批的供应商测试。不得把测试签发器暴露为公网登录。

### C. 真实供应商验收（本轮未执行）

先由账户 Owner 完成地域/模型准入、Secret、有限费用授权和音频处理政策；准备自有合成语句的 WAV，符合16k单声道PCM16及60秒限制，明确预期文本。该单测直接检查 Provider，不覆盖浏览器/身份/DO/Chat，需另行完成完整网关集成验收。

用途：在已安全注入 DASHSCOPE_API_KEY、VOICE_ASR_MODEL、VOICE_ASR_REGION 的临时终端中，显式开启一次真实供应商测试。此步骤可能产生费用，不能由默认测试自动触发：

```powershell
$env:VOICE_LIVE_TEST = '1'
$env:VOICE_LIVE_BUDGET_APPROVED = 'true'
$env:VOICE_LIVE_WAV = 'C:\approved-synthetic-audio\voice.wav'
$env:VOICE_LIVE_EXPECTED_TEXT = '查询我的任务'
node --test chenchen/tests/voice-backend-live.test.mjs
Remove-Item Env:VOICE_LIVE_TEST, Env:VOICE_LIVE_BUDGET_APPROVED, Env:VOICE_LIVE_WAV, Env:VOICE_LIVE_EXPECTED_TEXT
```

预期真实服务返回包含已知合成语句的文本；测试不输出音频、文本、Key。若失败不得改用 Mock 声称通过，也不自动重试收费请求。随后记录供应商响应状态、区域、模型和脱敏 request/session 关联，再由 Owner 联调 Gateway。

### D. 金融与设备验收（待团队配合）

按 [接口提案](contract-proposals/voice-chat-handoff-v1.md) 接通既有 Chat session/CSRF，确认“编辑后发送”只调用原 `/turns`。依次验收消费、持仓、知识、任务、风控记录；没有授权或真实数据时明确未联通。对“转账两千元”、交易和修改配置验证不执行、不提升 REVIEW_ONLY，且现有 Risk / Approval / Audit 继续负责。

在 Chrome、Edge、Android 常见浏览器和 iOS 实测授权、拒绝、无设备、重录、重复点击、停止/取消、离页、弱网与上传超时。需要 WAV 编码适配；不能将 MediaRecorder 的 WebM/MP4 原样上传。本轮后端离线测试没有替代上述物理设备验收。

## 6. 发布和协作边界

- 当前仅同步个人 fork 的独立工作分支；目标仓库当前账户没有 push 权限。完整提交 SHA、远端核验结果在交付消息中提供。
- 不合并 main，不向 Fintechathon 团队正式交付区自动发布，不修改现有 Cloudflare 服务/Secret/路由，不进行生产部署。
- UI 旧 PR、Chat PR、Risk PR 均保持原状态；未以修改既有测试断言掩盖失败。
- 正式共享接口、身份映射、金融审计关联和历史认证补丁应用须对应 Owner 审核；阻塞项与责任分工详见 [P0审计报告](VOICE_BACKEND_GAP_REPORT.md)。
