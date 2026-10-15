# 发布流程（RELEASING）

维护者用的发版手册：怎么把一个版本发出去、怎么核验、坏了怎么办。用户视角的安装与行为见 [README.zh-CN.md](../README.zh-CN.md) / [README.md](../README.md)。

> The README pair documents the plugin in both languages; this runbook is maintainer-facing and is written in Chinese only.

一条约定贯穿全文：**打 tag 就是发布**，认证走 npm trusted publishing（OIDC），任何机器上都不存在长期凭据。

---

## 1. 现状：一次性配置（已完成）

npm 上 `dsh-panellist` 的 Trusted Publisher 条目（包设置 → Trusted publishing）写死了下面这套组合，**任何一项对不上都会让发布失败**：

| 字段 | 值 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `qwq1999` |
| Repository | `dsh-panellist` |
| Workflow filename | `release.yml`（只写文件名，带扩展名，不写路径） |
| Environment name | 留空（workflow 里没有使用 GitHub environment） |
| Allowed actions | `npm stage publish`（默认允许）+ **`npm publish`**（必须显式勾上） |

该条目已被 **0.1.1 的首次成功发布验证并绑定**，不再受「2 天内未完成首次发布即作废」的约束。条目创建后**不可编辑**：要换仓库、换 workflow 文件名，只能删除重建，并在 2 天内完成一次成功发布。

本机一次性：`gh auth login`（推 tag 用）+ 浏览器上登录着该 npm 账号（只在重建条目或走 §6 兜底时需要）。**不需要 npm token，也不要把 token 写进任何文件。**

---

## 2. 常规发版（三步）

```bash
# 1) 改 package.json 的 version（选号见 §3）
# 2) 本地先过门槛（CI 也会跑，先跑省一轮反馈时间）
pnpm check

# 3) 提交并打 tag 推送（tag 与 version 必须一致，workflow 会校验）
git commit -am "chore(release): v0.1.2"
git tag -a v0.1.2 -m "dsh-panellist v0.1.2"
git push origin main v0.1.2
```

tag 推上去后，[`.github/workflows/release.yml`](../.github/workflows/release.yml) 依次做：

1. `pnpm install --frozen-lockfile`（release 构建禁用缓存，产物只来自该提交的 lockfile）
2. 校验 tag 与 `package.json` 的 `version` 一致，不一致直接失败
3. `pnpm check`（类型检查、295 条用例、声明文件、两个 bundle；`lib/` 不入库，这一步同时产出要发布的文件）
4. `npm publish`（OIDC 换短期凭据；provenance 由 npm 自动附着，不用加 `--provenance`）

盯 CI：

```powershell
gh run list --workflow release.yml --limit 3
$id = gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $id
```

失败时 `gh run view $id --log` 看是哪一步；对照 §5。

---

## 3. 版本号怎么定

当前处于 `0.x`：破坏性改动与新增功能都进 minor、纯修复与文档进 patch，即 `0.<minor>.<patch>` 递增。tag 一律是 `v` + 版本号。

`package.json` 的 `version` 是唯一真源，仓库里没有 CHANGELOG 文件。

---

## 4. 发完的核验清单

```powershell
# 直接读 registry 原始 packument：npm view 有 HTTP 缓存，可能滞后几十秒
$p = Invoke-RestMethod https://registry.npmjs.org/dsh-panellist
$p.'dist-tags'                                          # latest 应指向新版本
($p.versions | Get-Member -MemberType NoteProperty).Name # 版本列表

npm view dsh-panellist@0.1.2 dist.attestations --json    # prov. 证明（CI 发布才有）
```

合格标准：

- `dist-tags.latest` = 新版本
- `dist.attestations.provenance.predicateType` = `https://slsa.dev/provenance/v1`
- tarball 文件数与预期一致（当前 46 个，只有 `files` 改动才会变）
- `dist.shasum` 与 CI 日志里的 `npm notice shasum:` 相同

---

## 5. 常见失败与处理

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| CI 在 “The tag and package.json must agree” 失败 | tag 与 `package.json` 的 `version` 不一致 | 删掉重打 tag，或补一次版本提交 |
| `npm publish` 报 404 / 403，且日志提到 trusted publisher / id-token | npm 条目字段与 workflow 不符，或条目已作废 | 核对 §1 表格；必要时删掉条目重建，并尽快发出一个版本 |
| `cannot publish over the previously published versions` | 版本号已存在 | 提高版本号；已发布版本不可覆盖 |
| 本地 `npm publish` 报 `Two-factor authentication ... required` | 本机手动发布且缺 2FA/otp | 走 §6 的兜底路径 |
| `npm view` 仍显示旧版本 | npm 客户端缓存 | 用 §4 的 registry 原始接口确认 |
| CI 警告 `Node.js 20 is deprecated … pnpm/action-setup@v4` | 该 action 自身仍以 Node 20 为目标 | 目前无害；要清掉就升级 action 或改用 `corepack enable && pnpm install --frozen-lockfile` |
| 条目创建后 2 天内没发成功 | 条目自动作废 | 删除后重建，并在 2 天内完成首次发布 |

---

## 6. 手动兜底（OIDC 走不通时）

**首选 staged publishing**：0.1.0 就是这么发出去的，全程不需要 token。

```powershell
npm stage publish          # 只入队，不公开；新包会先出现 0.0.0-stage 占位版本
npm stage list             # 记下 stage id；status 从 validating 变 staged 后才可批准
# 然后到 npmjs.com 的 Staged Packages 里点 Approve（会要求 2FA）
```

- `npm stage approve <id> --otp=<6位>` 只在账号有 **TOTP（验证器 app）** 时可用。若 2FA 用的是**安全密钥**，approve 会改走浏览器认证：命令会打印一个 `https://www.npmjs.com/auth/cli/...` 链接，复制到浏览器完成即可（`--otp` 在这种账号上没有可填的数字）。
- 队列里不要的 stage 用 `npm stage reject <id>` 丢掉；该版本从未公开，不影响已发布版本。
- 手动发布同样需要账号开启 2FA —— registry 的规则是「2FA 或带 bypass 标记的 granular token」，而后者正在被 npm 逐步收紧，所以别把它当长期方案。

---

## 7. 撤回与善后

- 已发布版本**不能覆盖**，只能发新版本修。
- 72 小时内可以 `npm unpublish dsh-panellist@<v>`，但会打断已安装的用户；除非是安全问题，别用。
- 想劝退某个版本用 `npm deprecate dsh-panellist@<v> "<原因>"`：不影响安装，只在安装时提示。

---

## 8. 与市场收录的关系

- `awesome-dsh-plugin` 里的条目（`data/plugins/qwq1999__dsh-panellist.yml`）不需要跟着版本更新；npm 下载量靠 `package.json` 的 `repository` 字段自动关联，条目里没有 npm 相关字段。
- 只有新增条目或改描述/分类时才需要去那个仓库提 PR，`dsh-market` 从同一份数据同步。

---

## 9. 已发布版本记录

| 版本 | 发布方式 | 备注 |
| --- | --- | --- |
| `0.0.0-stage` | npm 自动 | 用 staged publishing 新建包时 npm 放的公开占位版本 |
| `0.1.0` | 手动 `npm stage publish` + 浏览器 2FA 批准 | OIDC 配置之前的一次性路径 |
| `0.1.1` | CI / OIDC（tag `v0.1.1`） | 首次验证 trusted publisher，附带 SLSA provenance |
| `0.1.2` | CI / OIDC（tag `v0.1.2`） | README 精简版（1133 → 117 行）随包发布 |

---

## 10. 相关文件

- [`.github/workflows/release.yml`](../.github/workflows/release.yml) —— 发版 workflow
- [`package.json`](../package.json) —— `version`（唯一真源）、`files`（发布内容）、`publishConfig`
- [README.zh-CN.md](../README.zh-CN.md) §6「发布（维护者）」—— 本文的摘要
