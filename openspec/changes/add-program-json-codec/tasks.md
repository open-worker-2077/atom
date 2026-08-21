## 1. JSON 编解码内核

- [x] 1.1 增加真实 Program 失败测试，覆盖对象/数组/标量解析、紧凑与缩进序列化、中文、非法 JSON、非有限数值和非 JSON 值
- [x] 1.2 在可信 Program 标准库实现严格 json_parse/json_stringify 与递归 JSON 值校验
- [x] 1.3 将两个函数绑定到受限 worker 命名空间，并验证 import/eval/模块对象仍不可用

## 2. Atom detail 闭环

- [x] 2.1 增加 Program 从 source detail 解析、加工、序列化并通过 Transform 写入 target detail 的端到端失败测试
- [x] 2.2 使闭环通过现有 Program 效果、Graph 校验、修订检查和中央事务提交，失败时不发布部分效果

## 3. 注册与帮助

- [x] 3.1 增加 function_catalog、公共注册表和 CLI Help 的参数/结果/错误契约失败测试
- [x] 3.2 注册 json_parse/json_stringify 为内核 Program 函数并补齐结构化契约与 Help 示例

## 4. 验证与部署

- [x] 4.1 运行定向 codec/sandbox/registry/Program/interaction 测试及 OpenSpec 严格校验
- [x] 4.2 与 Transform-runtime 修复一并重启 4784，并在 test 域完成 JSON detail 往返与 exact read-back
- [x] 4.3 回执 ESG 来源任务
- [x] 4.4 提交可回滚改动并推送远端，不纳入用户原有 AGENTS.md 改动

## 5. 独立审查收敛

- [x] 5.1 增加指数溢出、非法 worker 传输值和捕获 codec 异常后不得发布既有效果的失败测试
- [x] 5.2 对 parse 结果递归校验有限数值，并对 worker 输出与 Node 协议解析实施双重失败保护
- [x] 5.3 增加不可清除的 codec 失败状态，公开 program-evaluation 失败边界与不发布效果契约
- [x] 5.4 重跑完整测试、OpenSpec 严格校验与 test 域上线探针
