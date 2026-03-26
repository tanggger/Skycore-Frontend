# 前端数据呈现实施步骤

本文档说明如何基于：

- [FRONTEND_FIELD_REFERENCE.md](/home/tzx/Wing-Net-Omni-Frontend/project_docs/FRONTEND_FIELD_REFERENCE.md)
- [FRONTEND_API_INTEGRATION_GUIDE.md](/home/tzx/Wing-Net-Omni-Frontend/project_docs/FRONTEND_API_INTEGRATION_GUIDE.md)
- [FRONTEND_HANDOFF_CHECKLIST.md](/home/tzx/Wing-Net-Omni-Frontend/project_docs/FRONTEND_HANDOFF_CHECKLIST.md)

把后端输出逐步呈现到前端页面中。

本文档关注：

- 实施顺序
- 每一步前端该做什么
- 每一步要消费哪些后端数据
- 哪些字段要在适配层统一
- 哪些位置必须严格报错，不能伪对接

## 1. 总体原则

前端接入顺序应固定为：

1. 接口可达
2. 结果结构正确
3. 适配层字段统一
4. store 装载
5. 页面展示
6. 图表与表格深化
7. 缺失字段校验与错误提示

禁止做法：

- 后端缺字段时用 mock 值补齐
- 后端缺数组时画假图
- 用旧字段名直接散落在组件里兼容

推荐做法：

- 所有字段别名在“前端适配层”统一转换
- 所有组件只消费统一后的字段名
- 所有页面只消费 store，不直接处理原始接口 JSON

## 2. 实施分层

建议把前端接入分成 4 层：

### 2.1 接口层

职责：

- 请求后端接口
- 处理 HTTP 错误
- 处理任务轮询
- 对返回结构做最小合法性校验

输入：

- `POST /api/simulate`
- `GET /api/results/<task_id>/frontend`
- `GET /api/results/<task_id>/manifest`
- `GET /api/maps`
- `GET /api/map_data/<map_name>`

输出：

- 原始后端数据对象

### 2.2 适配层

职责：

- 把后端规范字段统一转换成前端内部字段
- 处理历史字段别名
- 做空值标准化
- 做数值单位确认

这一层是关键，所有历史兼容都应放在这里。

当前至少需要处理的映射：

- `latestActionType = latestRecoveryAction`
- `interference = interference_dBm`
- `nodeId = observedNodeId`
- `score = keyNodeScore`

### 2.3 状态层

职责：

- 把 `meta / manifest / shared / cooperative / non_cooperative` 装入全局 store
- 维持当前任务状态
- 提供当前模式、当前页面、当前数据可用性判断

输出：

- 顶栏组件数据
- 左侧参数回显数据
- 右侧图表与列表数据
- 3D 沙盘回放数据

### 2.4 展示层

职责：

- 将 store 中已经规范化的数据渲染到页面
- 不再关心字段别名和原始后端文件名

## 3. 开发顺序

## 3.1 第一步：打通最小联调链路

目标：

- 能提交仿真
- 能轮询到 `/frontend`
- 能把结果装入 store
- 能在页面上显示“这是哪一种任务”

前端要做：

- 调 `POST /api/simulate`
- 轮询 `GET /api/results/<task_id>/frontend`
- 成功后读取：
  - `meta`
  - `manifest`
- 更新任务状态：
  - `IDLE`
  - `RUNNING`
  - `SUCCESS`
  - `FAILED`

最先要显示的内容：

- 任务 ID
- `operationMode`
- `sceneType`
- `difficulty`
- `communicationMode`
- `formation`

最先要做的错误处理：

- 接口不可达
- `data` 缺失
- `meta` 缺失
- `manifest` 缺失
- `meta.operationMode` 与当前任务不一致

## 3.2 第二步：实现前端适配层

目标：

- 让所有组件都只消费统一字段

前端要做：

- 新建一个统一适配函数，例如：
  - `normalizeFrontendResponse(data)`

该函数负责：

- 处理字段别名
- 处理对象默认结构
- 处理 `null`
- 处理数值字段类型转换

最少要标准化的对象：

- `meta`
- `manifest`
- `shared.positions`
- `shared.resource_detailed`
- `cooperative.dashboard_snapshot`
- `cooperative.failure_timeline`
- `cooperative.recovery_timeline`
- `non_cooperative.observation_inference.key_node_candidates`
- `non_cooperative.attack.plan`
- `non_cooperative.attack.summary`

适配层输出要求：

- 所有数组一定为数组
- 所有对象一定为对象
- 所有组件使用的字段名固定
- 不允许组件里写 “如果是旧字段名就再试一次”

## 3.3 第三步：先做顶部状态条

目标：

- 让用户一进页面就知道当前任务处于什么模式、什么场景、有没有数据

数据来源：

- `meta`
- `manifest`
- `cooperative.dashboard_snapshot`
- `non_cooperative.attack.plan`

合作模式显示：

- `sceneType`
- `difficulty`
- `communicationMode`
- `phase`
- `leaderNodeId`
- `isLeaderAlive`
- `failureTargetId`
- `recoveryStatus`

非合作模式显示：

- `sceneType`
- `difficulty`
- `attackType`
- `recommendedObservedNodeId`
- `confirmedObservedNodeId`
- `executedObservedNodeId`
- `executedEntityNodeId`
- `targetBindingStatus`

校验规则：

- 合作模式下缺 `dashboard_snapshot`，直接报错
- 非合作打击模式下缺 `attack.plan`，直接报错

## 3.4 第四步：做合作模式基础面板

目标：

- 先把合作模式最核心的信息完整显示出来

数据来源：

- `shared.environment_summary`
- `cooperative.mode_summary`
- `cooperative.dashboard_snapshot`
- `cooperative.failure_timeline.events`
- `cooperative.recovery_timeline.actions`
- `cooperative.metrics_timeseries.samples`

建议实现顺序：

1. 模式摘要卡
2. 环境摘要卡
3. 恢复总览卡
4. 故障时间线
5. 恢复动作时间线
6. 全局指标曲线

模式摘要卡展示：

- `communicationMode`
- `leaderNodeId`
- `backupLeaderList`
- `distributedHopLimit`
- `failureType`
- `failureTargetId`
- `failureStartTime`
- `failureDuration`
- `recoveryPolicy`
- `recoveryObjective`
- `recoveryCooldown`
- `actionFlags`

环境摘要卡展示：

- `effectiveModelSummary`
- `environmentSource`
- `geometryInputMode`
- `carrierFrequencyGHz`
- `channelBandwidthMHz`
- `polarizationMode`
- `pathLossExponent`
- `interferenceFactor`
- `connectivityRangeFactor`

恢复总览卡展示：

- `phase`
- `isLeaderAlive`
- `failureActive`
- `responseTimeSec`
- `recoveryTimeSec`
- `stabilizationTimeSec`
- `latestRecoveryAction`
- `recoveryStatus`

时间线展示：

- 故障时间线用 `failure_timeline.events`
- 恢复时间线用 `recovery_timeline.actions`

图表第一批：

- `connectivity`
- `pdr`
- `throughputMbps`
- `delayMs`
- `p99DelayMs`

图表第二批：

- `failureNeighborhoodPdr`
- `failureNeighborhoodThroughputMbps`
- `failureNeighborhoodDelayMs`
- `failureTargetPdr`
- `failureTargetThroughputMbps`
- `failureTargetDelayMs`

特殊规则：

- `leaderNodeId` 和 `isLeaderAlive` 用状态条或阶梯图
- `responseTimeSec / recoveryTimeSec / stabilizationTimeSec` 为 `null` 时必须显示 `—`

## 3.5 第五步：做非合作模式基础面板

目标：

- 先把“观测 -> 推断 -> 推荐 -> 打击 -> 效果评估”完整链路展示出来

数据来源：

- `shared.environment_summary`
- `non_cooperative.observation_inference.observed_signal_events`
- `non_cooperative.observation_inference.observed_comm_windows`
- `non_cooperative.observation_inference.observed_link_evidence`
- `non_cooperative.observation_inference.inferred_topology_edges`
- `non_cooperative.observation_inference.inferred_graph_nodes`
- `non_cooperative.observation_inference.key_node_candidates`
- `non_cooperative.attack.recommendations`
- `non_cooperative.attack.plan`
- `non_cooperative.attack.events`
- `non_cooperative.attack.target_binding`
- `non_cooperative.attack.effect_metrics`
- `non_cooperative.attack.summary`

建议实现顺序：

1. 观测质量概览
2. 推断边列表
3. 关键节点 Top-N
4. 推荐目标卡
5. 打击计划卡
6. 打击事件时间线
7. 打击效果图
8. 摘要评估卡

观测质量概览：

- `observed_signal_events.length`
- `observed_link_evidence.length`
- `inferred_topology_edges.length`

推断边列表第一批显示：

- `srcObservedNodeId`
- `dstObservedNodeId`
- `edgeProbability`
- `edgeConfidence`
- `directionalityScore`
- `dominantDirection`
- `edgeDynamicState`
- `edgeStage`

关键节点 Top-N：

- `observedNodeId`
- `rank`
- `keyNodeScore`
- `keyNodeMethod`

推荐目标卡：

- `recommendedObservedNodeId`
- `recommendedScore`
- `recommendationReason`
- `inferenceMethod`

推荐分解第二批：

- `structureScore`
- `evidenceSupportScore`
- `causalSupportScore`
- `directionalInfluenceScore`
- `temporalStabilityScore`
- `localBridgeScore`
- `postRemovalDamageScore`
- `twoHopReachabilityScore`
- `interClusterBridgeScore`
- `localCutRiskScore`
- `neighborRedundancyPenalty`

打击计划卡：

- `recommendedObservedNodeId`
- `confirmedObservedNodeId`
- `attackExecuteTime`
- `targetBindingStatus`
- `strikeExecuteTime`
- `executedObservedNodeId`
- `executedEntityNodeId`
- `targetNeighborhoodSize`

打击事件时间线：

- `eventTime`
- `attackType`
- `executedObservedNodeId`
- `targetBindingStatus`
- `isTrueTargetHit`
- `targetMismatchType`
- `nodeRemoved`

效果图第一批：

- `connectivityRatio`
- `pdr`
- `throughputMbps`
- `delayMs`

摘要评估卡：

- `summary.finalMetrics.global`
- `summary.finalMetrics.target_neighborhood`
- `summary.recoverySummary`

特殊规则：

- `target_neighborhood` 是冻结评估范围，不是实时邻域
- `mismatchType`、`targetMismatchType` 为空时显示 `—`

## 3.6 第六步：实现 3D 沙盘和回放

目标：

- 把共享回放数据从“有接口”变成“真正可看”

数据来源：

- `shared.positions`
- `shared.transmissions`
- `shared.topology_links`
- `shared.resource_detailed`
- `shared.topology_evolution`
- `shared.qos`

建议实现顺序：

1. 节点位置回放
2. 拓扑连线变化
3. 传输闪烁
4. 节点资源染色
5. 单节点详情

节点基础信息：

- `nodeId`
- `x`
- `y`
- `z`
- `node_type`
- `speed`

节点资源信息：

- `channel`
- `tx_power`
- `data_rate`
- `neighbors`
- `interference_dBm`
- `worst_sinr_dB`

在适配层中建议转换为页面统一口径：

- `power`
- `rate`
- `interference`
- `sinr`

QoS 回放第一批：

- 每时刻全网平均 `pdr`
- 每时刻全网平均 `delay`
- 每时刻全网平均 `throughput`

注意：

- `shared.positions` 中可能已经被 API 合并了一部分资源字段
- 若资源字段在 `positions` 中缺失，应回退到 `resource_detailed`

## 3.7 第七步：实现 manifest 驱动的数据完备性检查

目标：

- 页面不是“进去了才发现没数据”
- 而是在展示前就知道哪些模块可用、哪些模块缺失

需要做的事情：

- 进入工作区前先检查 `manifest`
- 根据 `sharedDatasets / cooperativeDatasets / nonCooperativeDatasets / nonCooperativeAttackDatasets`
  判断哪些卡片可以展示

推荐规则：

- 缺核心数据：直接报错并阻止进入页面
- 缺次级数据：允许进入页面，但卡片显示“数据未生成”

合作模式核心数据：

- `environment_summary`
- `mode_summary`
- `dashboard_snapshot`
- `metrics_timeseries`

非合作模式核心数据：

- `inferred_topology_edges`
- `key_node_candidates`
- `recommendations`
- `plan`
- `effect_metrics`
- `summary`

## 3.8 第八步：统一错误与空态呈现

必须区分 3 种情况：

1. 接口失败
2. 数据结构错误
3. 数据为空但结构合法

推荐提示文案：

- 接口失败：
  - `后端接口不可达，请检查服务是否启动`
- 数据结构错误：
  - `后端返回结构不完整，缺少字段：...`
- 数据为空：
  - `该模块数据尚未生成`

空态显示规则：

- 数值字段为空：显示 `—`
- 时间字段为空：显示 `—`
- 数组为空：显示空态卡片，不画假图
- 对象为空：显示模块未生成，不用默认值伪装

## 4. 页面落地顺序建议

建议按下面顺序推进，避免来回返工：

1. 任务提交与轮询
2. 适配层统一字段
3. store 统一装载
4. 顶部状态条
5. 合作模式基础卡片
6. 合作模式曲线与时间线
7. 非合作模式基础卡片
8. 非合作模式打击闭环
9. 3D 沙盘回放
10. manifest 驱动的缺失检查
11. 导出表和调试表

## 5. 开发完成判定

以下条件都满足时，才算“前端数据呈现接入完成”：

- 所有组件只消费适配后的统一字段
- 缺字段时前端能明确报出具体路径
- 页面不再使用 mock 数据或伪图表
- 合作模式可以完整显示：
  - 模式摘要
  - 环境摘要
  - 恢复总览
  - 故障时间线
  - 恢复时间线
  - 核心指标曲线
- 非合作模式可以完整显示：
  - 观测概览
  - 推断边
  - 关键节点
  - 推荐目标
  - 打击计划
  - 打击事件
  - 打击效果图
  - 摘要评估
- 3D 沙盘能回放：
  - 位置
  - 链路
  - 传输
  - 节点资源

## 6. 与字段字典的关系

本文档回答的是：

- 应该先做什么
- 每一步怎么把后端数据接到页面
- 哪些数据先做，哪些数据后做

字段细节仍以：

- [FRONTEND_FIELD_REFERENCE.md](/home/tzx/Wing-Net-Omni-Frontend/project_docs/FRONTEND_FIELD_REFERENCE.md)

为唯一准绳。
