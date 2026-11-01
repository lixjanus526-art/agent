# Voice 到 Chat 的最小接口契约提案

状态：**待 Chat / Identity / Core / Risk Owner 确认；没有部署，没有修改既有共享接口。** 本轮授权范围内新增独立 Voice API；本提案用于跨模块接入，不代表已有 Owner 批准。

## Voice 边界

独立网关只返回 `voice-transcription.v1`，不产生金融执行授权；浏览器必须显示最终文本，允许编辑，用户明确确认后才允许继续。网关不接受任何转账/执行路由。

可信身份服务需在校验真实登录与账户访问关系后，服务端签发最长 300 秒的 HS256 JWT：`iss`、`aud=voice-gateway`、`sub`、`account_id`、`jti`、`iat`、`exp`、`scope=voice:transcribe`、`capability=REVIEW_ONLY`。签发密钥只存在可信后端与 Voice Gateway。匿名 Chat Cookie 不能直接作为金融账户凭证。

## Chat 侧候选契约

依据 PR #2 的 `9203e3096eca0c31a7ea61cb7990c6a6cb088614` 源码：

```text
POST /api/local/chats/{chat_id}/turns
Content-Type: application/json
Origin: <Chat PUBLIC_ORIGIN>
Cookie: <existing authenticated or demo session>
X-CSRF-Token: <existing CSRF token>
```

```json
{"request_id":"chat-request-0001","text":"用户编辑并确认后的文字"}
```

只构造既有字段，不把 Voice envelope、capability、approval 或客户端账户号塞进 Chat 请求。文本上限 2000 字符，request_id / chat_id 使用 8–100 位字母、数字、下划线或连字符；此处是现有允许范围内的更严格子集。

`chenchen/voice/voice-chat-adapter.mjs` 只返回 path/method/body，不发网络请求；不是金融授权判定器。后端仍须检查自己收到的登录、会话、CSRF、文本与工具权限，不能信任浏览器 `confirmed=true`。

Owner 需确认既有响应中的 conversation/turn ID 和 SSE 订阅方式；Voice 不另建响应封装或意图分类器。对“转账两千元”、交易与配置修改复用既有高风险路径，禁止直接执行。没有数据时返回现有明确的未联通/需补充状态。

## 待确认项

1. 真实 Chat Worker 的版本、主机、账户 Owner 和 Staging 地址；PR 分支不等于部署。
2. Chat Cookie owner 与正式 subject/account 的服务端映射，以及 Voice token 签发入口；不允许前端自报账户身份。
3. 保持现有请求 schema 时如何在服务端关联 voice session/request 与 task/run/audit/handoff；本轮不私自新增共享字段。
4. 发送失败或结果未知时保留 request_id 并先查状态；不能自动换编号重放可能有副作用的金融操作。
5. 先用合成身份、合成账户与受控语句联调；生产发布、真实客户资料与资金操作不在本轮范围。
