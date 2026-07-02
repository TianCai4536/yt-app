# 异想天开桌面版 · 本地插件开发指南

> 让 Agent「像人一样」自我扩展：写个插件文件丢进目录，点「重载插件」，Agent 立刻获得新能力，**无需重新编译或更新软件**。

## 一、插件放哪

插件根目录（首次启动自动创建）：

- **Windows**：`C:\Users\<你的用户名>\.yt\plugins\`
- **macOS/Linux**：`~/.yt/plugins/`

每个插件是一个**独立子目录**，里面必须有一个 `plugin.json`：

```
~/.yt/plugins/
  ├─ hello/
  │    ├─ plugin.json     # 插件声明（必需）
  │    └─ run.py          # 实际执行的脚本
  └─ http_request/
       ├─ plugin.json
       └─ run.py
```

## 二、plugin.json 格式

```json
{
  "name": "hello",
  "description": "打个招呼，返回传入的 name 字段",
  "dangerous": false,
  "command": "python run.py",
  "parameters": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "要打招呼的名字" }
    },
    "required": ["name"]
  }
}
```

| 字段 | 说明 |
|---|---|
| `name` | 工具名（Agent 看到的函数名），须唯一，用小写字母/下划线 |
| `description` | 工具描述，写清楚「什么时候该用它」，模型据此决定是否调用 |
| `dangerous` | 是否高危。`true` 时每次执行前会弹窗让用户审批（涉及写入/删除/网络提交等建议设 true）|
| `command` | 启动命令，相对插件目录执行。如 `python run.py`、`node run.js`、`./run.sh` |
| `parameters` | JSON Schema，声明入参。Agent 按此结构生成参数 |

## 三、插件怎么拿到参数、怎么返回结果

调用时，桌面端会把参数（JSON）用**两种方式**同时传给你的脚本，任选其一读取：

1. **标准输入 stdin**：一整行 JSON
2. **环境变量 `YT_ARGS`**：同样的 JSON 字符串

脚本把结果**打印到 stdout**（标准输出），就是返回给 Agent 的内容。stderr 会作为 `[stderr]` 附加。

### Python 示例（run.py）

```python
import os, json, sys

# 读参数（两种来源都行）
raw = os.environ.get("YT_ARGS") or sys.stdin.read() or "{}"
args = json.loads(raw)

name = args.get("name", "世界")
print(f"你好，{name}！这是来自本地插件的问候。")
```

### Node 示例（run.js）

```js
const raw = process.env.YT_ARGS || require("fs").readFileSync(0, "utf8") || "{}";
const args = JSON.parse(raw);
console.log(`你好，${args.name || "世界"}！`);
```

## 四、用起来

1. 在 `~/.yt/plugins/` 下建目录、放 `plugin.json` + 脚本
2. 回到桌面版 **Agent 模式**，点输入框上方的 **「↻ 重载插件」**
3. 插件会显示为 `🧩 N 个插件`，Agent 就能自动调用了

> 妙用：你可以直接让 Agent「帮我在插件目录写一个 XXX 插件」——它用 write_file 写好 plugin.json 和脚本，你点重载，它下一句就能用上自己刚写的插件。这就是「自我扩展」。

## 五、安全须知

- 插件以**当前用户权限**执行，能力等同于你手动跑脚本。只放你信任的插件。
- 涉及写文件、删除、联网提交的插件请把 `dangerous` 设为 `true`，保留人工审批闸门。
- 桌面端已内置目录：写系统目录（Windows\、/system/）会被 Rust 层拒绝。

## 六、内置示例插件

本目录 `examples/` 下提供了 3 个可直接用的示例，拷到 `~/.yt/plugins/` 即可：

- `http_request/`：结构化 HTTP 请求（GET/POST，自定义 header/body）
- `hash/`：算文本或文件的 md5 / sha256
- `sysinfo/`：查看本机系统信息（OS/CPU/内存/磁盘）
