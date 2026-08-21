## Why

Atom detail 以字符串保存，安全 Program 又禁止 `import` 和 `eval`；当前没有注册函数可把 detail 中的标准 JSON 转为可计算值，也无法把计算结果可靠地转回 JSON 字符串。这直接阻断了整 Sheet JSON 在 Atom 内组装并写回 39 张工单。

## What Changes

- 新增内核 Program 函数 `json_parse({"text": ...})`，将严格标准 JSON 字符串解析为 JSON 兼容值。
- 新增内核 Program 函数 `json_stringify({"value": ..., "indent"?: ...})`，将 JSON 兼容值序列化为标准 JSON 字符串。
- 拒绝未知参数、非字符串输入、无效 JSON、非 JSON 值、非有限数值和不受支持的缩进；不开放 `import`、`eval` 或文件访问。
- 在 Program 函数注册表、`function_catalog()` 与 CLI Help 中公开结构化参数、返回值、错误和示例契约。
- 增加真实 Python Program 测试，覆盖 Atom detail 读取、解析、加工、序列化及 Transform 写回闭环。

## Capabilities

### New Capabilities

- `program-json-codec`: 规定沙箱内标准 JSON 的安全解析、序列化和公开注册契约。

### Modified Capabilities

无。

## Impact

- 受影响代码：Python Program worker、安全命名空间、Program 函数注册表和 CLI Help。
- 受影响接口：新增 `json_parse` 与 `json_stringify`；现有 Program 与沙箱禁令保持兼容。
- 无新增外部依赖；使用 Python 标准库中已由可信 worker 引入的 `json` 模块。
