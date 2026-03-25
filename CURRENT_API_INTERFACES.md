# Wing-Net Omni 前端已实现后端接口文档

> 基准地址：`http://localhost:5000`  
> 实现位置：`src/services/apiService.ts`  
> 后端已开启 CORS，所有接口均通过 `fetch` 发起请求。

---

## 1. 健康检查

```http
GET /api/health
```

**返回示例**

```json
{
  "status": "OK",
  "message": "Wing-Net Omni Backend Server is running."
}
```

**前端调用方法**：`apiService.checkHealth()`

---

## 2. 发起仿真任务

```http
POST /api/simulate
Content-Type: application/json
```

**请求体核心字段**

| 字段 | 类型 | 说明 |
|------|------|------|
| `operationMode` | `"cooperative"` \| `"non_cooperative"` | 运行模式 |
| `sceneType` | `"urban"` \| `"forest"` \| `"lake"` \| `"open-field"` | 场景类型 |
| `num_drones` | number | 无人机数量 |
| `formation` | `"v_formation"` \| `"line"` \| `"cross"` \| `"triangle"` | 初始阵型 |
| `formation_spacing` | number | 编队间距（米） |
| `difficulty` | `"Easy"` \| `"Moderate"` \| `"Hard"` \| `"Custom"` | 难度 |
| `strategy` | `"static"` \| `"dynamic"` | 路由策略 |
| `start` | string | 起点坐标，如 `"0,0,30"` |
| `target` | string | 终点坐标，如 `"0,600,30"` |
| `map_name` | string（可选） | 后端已导入的地图名 |
| `buildings` | array（可选） | 无地图时直接传建筑盒体 |

**合作模式额外字段**

| 字段 | 说明 |
|------|------|
| `communicationMode` | `"centralized"` \| `"distributed"` \| `"hybrid"` |
| `leaderNodeId` | 领队节点 ID |
| `backupLeaderList` | 备份领队列表，逗号分隔字符串，如 `"2,3,4"` |
| `distributedHopLimit` | 分布式跳数限制：`1` 或 `2` |
| `cooperativeFailureType` | `"node_failure"` \| `"environment_degradation"` \| `"external_interference"` \| `"link_degradation"` |
| `failureTargetId` | 故障目标节点 ID |
| `failureStartTime` | 故障触发时间（秒） |
| `failureDuration` | 故障持续时间（秒） |
| `recoveryPolicy` | `"global_recovery"` \| `"local_recovery"` |
| `recoveryObjective` | `"connectivity"` \| `"delay"` \| `"throughput"` \| `"pdr"` |
| `recoveryCooldown` | 恢复冷却时间（秒） |
| `allowChannelReallocation` | boolean |
| `allowPowerAdjustment` | boolean |
| `allowRateAdjustment` | boolean |
| `allowRelayReselection` | boolean |
| `allowSlotReallocation` | boolean |
| `allowRouteRebuild` | boolean |

**Custom 难度额外字段**

| 字段 | 说明 |
|------|------|
| `pathLossExp` | 路径损耗指数 |
| `rxSens` | 接收灵敏度（dBm） |
| `txPower` | 发射功率（dBm） |
| `nakagamiM` | Nakagami-m 衰落参数 |
| `noiseFigure` | 噪声系数（dB） |
| `macRetries` | MAC 层重传次数 |
| `trafficLoad` | 流量负载 |
| `rtkNoise` | RTK 定位噪声 |
| `rtkDriftMag` | RTK 漂移幅度 |
| `rtkDriftInt` | RTK 漂移间隔 |
| `rtkDriftDur` | RTK 漂移持续时间 |
| `numInterfere` | 干扰源数量 |
| `interfereRate` | 干扰速率 |
| `interfereDuty` | 干扰占空比 |

**非合作打击闭环额外字段**

| 字段 | 说明 |
|------|------|
| `enableNonCooperativeAttack` | 是否启用打击闭环 |
| `attackType` | 当前固定为 `"node_strike"` |
| `manualStrikeTarget` | 手动指定的目标观测节点 ID |
| `attackExecuteTime` | 打击执行时间（秒） |
| `attackEvaluationDuration` | 评估窗口大小（秒） |
| `attackNeighborhoodHop` | 邻域跳数，推荐 `1` |

**返回示例**

```json
{
  "message": "Simulation triggered successfully",
  "task_id": "a1b2c3d4",
  "status": "RUNNING"
}
```

**前端调用方法**：`apiService.startSimulation(config)`

---

## 3. 轮询仿真结果（主接口）

```http
GET /api/results/<task_id>/frontend
```

**轮询策略**：首次提交后等 2 秒，之后每 3 秒轮询一次。

**响应状态**：`RUNNING` / `SUCCESS` / `FAILED`

**响应结构（SUCCESS 时）**

```json
{
  "status": "SUCCESS",
  "data": {
    "meta": { "taskId", "operationMode", "sceneType", "difficulty", "communicationMode", "formation" },
    "shared": {
      "environment_summary": {},
      "positions": [],
      "transmissions": [],
      "topology_links": [],
      "topology_evolution": [],
      "topology_detailed": [],
      "resource_detailed": [],
      "qos": [],
      "flow_summary": []
    },
    "cooperative": {
      "mode_summary": {},
      "dashboard_snapshot": {},
      "failure_timeline": { "events": [] },
      "recovery_timeline": { "actions": [] },
      "metrics_timeseries": { "samples": [] }
    },
    "non_cooperative": {
      "observation_inference": {
        "observed_signal_events": [],
        "observed_comm_windows": [],
        "observed_link_evidence": [],
        "inferred_topology_edges": [],
        "inferred_graph_nodes": [],
        "key_node_candidates": []
      },
      "attack": {
        "recommendations": [],
        "plan": {},
        "events": [],
        "target_binding": [],
        "effect_metrics": [],
        "summary": {}
      }
    },
    "manifest": {}
  }
}
```

**前端调用方法**：`apiService.pollFrontendResults(taskId)`

---

## 4. 获取 Manifest

```http
GET /api/results/<task_id>/manifest
```

用于判断当前任务的模式、场景和可用数据集。

**前端调用方法**：`apiService.pollManifest(taskId)`

---

## 5. 兼容旧版结果接口

```http
GET /api/results/<task_id>
```

保留用于兼容旧前端和调试。前端在新接口不可用时自动 fallback。

**前端调用方法**：`apiService.pollLegacyResults(taskId)`

---

## 6. 上传 GeoJSON 地图文件

```http
POST /api/upload_geojson
Content-Type: multipart/form-data
```

**表单字段**

| 字段 | 说明 |
|------|------|
| `file` | `.geojson` 文件 |
| `map_name` | 地图名称 |

**返回**：解析后的建筑数据（`GeoJsonMapData`），包含 `map_width`、`map_height`、`buildings[]`。

**前端调用方法**：`apiService.uploadGeoJsonMap(file, mapName)`  
**UI 入口**：场景编辑器（`ScenarioEditor.vue`）→ GeoJSON 地图上传

---

## 7. 拉取已有地图数据

```http
GET /api/map_data/<map_name>
```

用于加载后端已导入的地图，在 3D 沙盘中渲染建筑图层。

**前端调用方法**：`apiService.fetchGeoJsonMapData(mapName)`

---

## 8. 获取地图列表

```http
GET /api/maps
```

**返回示例**

```json
{
  "status": "SUCCESS",
  "maps": ["map_test", "map_city_a"]
}
```

**前端调用方法**：`apiService.fetchMaps()`  
**UI 入口**：场景编辑器（`ScenarioEditor.vue`）→ 从服务器选择地图

---

## 完整工作流

```
1. checkHealth()                  → 确认后端在线
2. startSimulation(config)        → 提交仿真，获得 task_id
3. 等待 2s
4. pollFrontendResults(task_id)   → 每 3s 轮询（优先）
   └── fallback: pollLegacyResults(task_id)
5. 解析 data.meta.operationMode  → 路由到合作/非合作工作区
6. 渲染帧数据（positions）、展示分析面板
```

> **离线 Mock 模式**：当后端不可达时，前端自动 fallback 到本地 Mock 数据，保证界面可正常演示。
