# 数据产品运营与归因分析平台

面向数据产品运营、渠道归因、用户行为分析、ROI评估、转化优化与数据应用监控的数据分析工程平台。

这是一个**纯前端**管理平台：React + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 React + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/api/experiment-service.ts  画像生命周期 / 分流命中联动、批次事务与核查
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/views/experiment/ 画像与分流共用的展示组件
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 渠道管理 | `channel` | 渠道配置 | 渠道编号、渠道名称、渠道类型 |
| 投放活动 | `campaign` | 投放活动 | 活动编号、活动名称、关联渠道 |
| 触点追踪 | `touchpoint` | 触点记录 | 触点编号、用户标识、触点类型 |
| 归因分析 | `attribution` | 归因模型 | 模型编号、模型名称、归因算法 |
| ROI评估 | `roi` | ROI报告 | 报告编号、关联活动、投入金额 |
| 转化漏斗 | `conversion` | 转化定义 | 转化编号、转化名称、步骤序列 |
| 用户路径 | `userpath` | 路径模式 | 模式编号、路径名称、节点序列 |
| 留存分析 | `retention` | 留存方案 | 方案编号、方案名称、初始事件 |
| 事件定义 | `eventdef` | 埋点事件 | 事件编号、事件名称、事件类型 |
| 用户画像 | `profile` | 画像定义 | 画像编号、画像名称、统计维度 |
| 热力分析 | `heatmap` | 热力方案 | 方案编号、页面名称、热力类型 |
| 竞品对标 | `benchmark` | 对标方案 | 方案编号、对标对象、对比指标 |
| 数据审计 | `auditcheck` | 审计规则 | 规则编号、审计对象、校验字段 |
| 分流配置 | `abgroup` | 分流方案 | 方案编号、方案名称、分流类型 |
| 可视化配置 | `dataviz` | 图表配置 | 配置编号、图表名称、图表类型 |
| 舆情分析 | `sentiment` | 舆情方案 | 方案编号、监控主题、关键词集合 |
| 生命周期 | `lifecycle` | 生命周期模型 | 模型编号、模型名称、生命周期阶段 |
| 运营预警 | `opsalert` | 预警规则 | 预警编号、监控指标、比较方式 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.tsx`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `data-product-ops:entries` 这一项，或调用 `resetModule(模块)`。

## 用户画像 × 分流命中

画像与分流不是两张独立的表，命中结果必须能解释「谁、按哪个画像版本、为什么命中/未命中」。
这部分逻辑集中在 `frontend/src/api/experiment-service.ts`，数据在
`frontend/src/data/experiment-*`，持久化键为 `data-product-ops:experiment-state`。

- **画像按版本快照管理**。每个版本固化自己的分层人群，分流方案绑定的是版本 id
  （例如 `PROF-0002@v1`），不是会漂移的画像编号。命中批次引用版本 id 与版本标签。
- **历史边界以「作废时间」为准**（`HISTORY_POLICY`）。版本作废后立即退出新命中计算；
  作废时间之前提交的批次冻结保留，之后不会再生成该版本的新批次。
- **重复触发幂等**。命中按「方案 + 画像版本 + 排期窗口 + 目标分层」识别；同一窗口重复提交、
  两个排期入口（定时任务 / 运营后台）同时命中，只会在一次提交里合并计算，已命中的用户
  不会再次计入。一个用户在同一方案中只进入实验人群一次，跨版本更新也不会重复扩大人群。
- **画像更新与命中结果同批提交**。`publishProfile` / `reviseAndPublish` / `voidProfile` /
  `refreshScheme` / 白名单增删都走同一套日志事务：先写提交日志，再写状态，最后标记完成。
  任一步失败都回到上一完整批次；中断遗留的日志会在下次读取时回滚或前滚，并给出可读诊断。
- **口径统一**。列表与详情页的命中人数都来自 `schemeRows` / `getSchemeDetail`，累计人数、
  绑定版本人数、按版本拆分人数三者可对账。
- **页面可解释性**。分流详情提供命中预演：逐条说明用户为何未命中（不在目标层 / 已命中 /
  白名单重复 / 画像已作废等）、来自哪个画像版本，以及该方案当前是否仍有实验资格。
- **空态与异常恢复**。画像或分流为空时展示空态；本地故障演练开关可模拟提交失败、
  写入前中断、写入后中断，页面提供重试与重新读取恢复入口。

演示场景：`ABGR-0002` 绑定的 `PROF-0002@v1` 已作废，历史命中 6 人冻结保留，刷新不会新增；
`ABGR-0003` 绑定已发布的 `PROF-0003@v1`，具实验资格，可正常生成新批次。清掉
`data-product-ops:experiment-state` 即可回到示例数据，页面上的「恢复示例数据」按钮效果相同。

领域：数据工程
子方向：数据分析与数据应用
