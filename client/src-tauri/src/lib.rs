// 异想天开 桌面端本地工具（Tauri command）
// 前端 Agent Loop 通过 invoke("tool_xxx", {...}) 调用
//
// 两类能力：
//   1) 内置工具（编译进二进制）：read/write/list/shell/grep/glob/edit
//   2) 插件系统（热插拔，免重编译）：~/.yt/plugins/<名>/plugin.json
//      plugin_list 扫描清单、plugin_exec 执行插件脚本
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use serde_json::Value;
use walkdir::WalkDir;

const MAX_OUT: usize = 20000;

fn clip(s: String) -> String {
    if s.len() > MAX_OUT {
        // 按字符安全截断，避免在 UTF-8 多字节边界 panic
        let cut = s.char_indices().map(|(i, _)| i).take_while(|&i| i <= MAX_OUT).last().unwrap_or(0);
        format!("{}\n\n…（内容过大，仅显示前 {} 字节）", &s[..cut], MAX_OUT)
    } else {
        s
    }
}

// ---------------- 内置：探测路径是否存在（排除审批分级用）----------------
#[tauri::command]
fn tool_path_exists(path: String) -> Result<bool, String> {
    if path.trim().is_empty() { return Ok(false); }
    Ok(Path::new(&path).exists())
}

// ---------------- 内置：读文件 ----------------
#[tauri::command]
fn tool_read_file(path: String) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }
    match fs::read_to_string(&path) {
        Ok(content) => Ok(clip(content)),
        Err(e) => Err(format!("读取失败：{}", e)),
    }
}

// ---------------- 内置：写文件 ----------------
#[tauri::command]
fn tool_write_file(path: String, content: String) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }
    let lower = path.to_lowercase();
    if lower.contains("\\windows\\") || lower.contains("/system/") {
        return Err("拒绝写入系统目录".into());
    }
    if let Some(parent) = Path::new(&path).parent() {
        let _ = fs::create_dir_all(parent);
    }
    match fs::write(&path, &content) {
        Ok(_) => Ok(format!("已写入 {} ({} 字节)", path, content.len())),
        Err(e) => Err(format!("写入失败：{}", e)),
    }
}

// ---------------- 内置：精确编辑（字符串替换，免整文件覆盖）----------------
#[tauri::command]
fn tool_edit_file(path: String, old_text: String, new_text: String) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取失败：{}", e))?;
    let count = content.matches(&old_text).count();
    if count == 0 {
        return Err("未找到要替换的文本（old_text 未匹配）".into());
    }
    if count > 1 {
        return Err(format!("old_text 匹配到 {} 处，不唯一，请提供更精确的上下文", count));
    }
    let updated = content.replacen(&old_text, &new_text, 1);
    fs::write(&path, &updated).map_err(|e| format!("写入失败：{}", e))?;
    Ok(format!("已编辑 {}（替换 1 处）", path))
}

// ---------------- 内置：列目录 ----------------
#[tauri::command]
fn tool_list_dir(path: String) -> Result<String, String> {
    let p = if path.trim().is_empty() { ".".to_string() } else { path };
    match fs::read_dir(&p) {
        Ok(entries) => {
            let mut lines = Vec::new();
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                lines.push(if is_dir { format!("[目录] {}", name) } else { format!("      {}", name) });
            }
            if lines.is_empty() { Ok("（空目录）".into()) } else { Ok(lines.join("\n")) }
        }
        Err(e) => Err(format!("读取目录失败：{}", e)),
    }
}

// ---------------- 内置：glob 找文件 ----------------
#[tauri::command]
fn tool_glob(pattern: String, base: Option<String>) -> Result<String, String> {
    let base = base.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| ".".into());
    let full = format!("{}/{}", base.trim_end_matches('/'), pattern);
    let mut hits = Vec::new();
    match glob::glob(&full) {
        Ok(paths) => {
            for p in paths.flatten() {
                hits.push(p.to_string_lossy().to_string());
                if hits.len() >= 500 { break; }
            }
        }
        Err(e) => return Err(format!("glob 模式错误：{}", e)),
    }
    if hits.is_empty() { Ok("（无匹配文件）".into()) } else { Ok(hits.join("\n")) }
}

// ---------------- 内置：grep 正则搜索 ----------------
#[tauri::command]
fn tool_grep(pattern: String, path: Option<String>, max_results: Option<usize>) -> Result<String, String> {
    let root = path.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| ".".into());
    let limit = max_results.unwrap_or(200).min(2000);
    let re = regex::Regex::new(&pattern).map_err(|e| format!("正则错误：{}", e))?;
    let mut out = Vec::new();
    let root_path = Path::new(&root);
    let walker: Vec<PathBuf> = if root_path.is_file() {
        vec![root_path.to_path_buf()]
    } else {
        WalkDir::new(&root)
            .max_depth(20)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| e.into_path())
            .collect()
    };
    'outer: for file in walker {
        // 跳过明显的二进制/依赖目录
        let sp = file.to_string_lossy();
        if sp.contains("node_modules") || sp.contains("/.git/") || sp.contains("\\.git\\") || sp.contains("target/") {
            continue;
        }
        if let Ok(content) = fs::read_to_string(&file) {
            for (i, line) in content.lines().enumerate() {
                if re.is_match(line) {
                    let trimmed: String = line.chars().take(300).collect();
                    out.push(format!("{}:{}: {}", file.to_string_lossy(), i + 1, trimmed));
                    if out.len() >= limit { break 'outer; }
                }
            }
        }
    }
    if out.is_empty() { Ok("（无匹配）".into()) } else { Ok(clip(out.join("\n"))) }
}

// ---------------- 内置：执行 shell（审批已在前端完成）----------------
#[tauri::command]
fn tool_run_shell(command: String, cwd: Option<String>) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err("命令为空".into());
    }
    let (shell, flag) = if cfg!(target_os = "windows") { ("cmd", "/C") } else { ("sh", "-c") };
    let mut cmd = Command::new(shell);
    cmd.arg(flag).arg(&command);
    if let Some(dir) = cwd {
        if !dir.trim().is_empty() { cmd.current_dir(dir); }
    }
    match cmd.output() {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let mut result = String::new();
            if !stdout.is_empty() { result.push_str(&stdout); }
            if !stderr.is_empty() { result.push_str("\n[stderr]\n"); result.push_str(&stderr); }
            let code = out.status.code().unwrap_or(-1);
            Ok(clip(format!("退出码 {}\n{}", code, result.trim())))
        }
        Err(e) => Err(format!("执行失败：{}", e)),
    }
}

// ========================================================
//                    插件系统（热插拔）
// ========================================================

// 插件根目录：~/.yt/plugins
fn plugins_dir() -> PathBuf {
    let base = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    Path::new(&base).join(".yt").join("plugins")
}

// 列出所有插件的 manifest（供前端注册为工具）
#[tauri::command]
fn tool_plugin_list() -> Result<String, String> {
    let dir = plugins_dir();
    // 目录不存在则创建，方便用户直接放插件
    let _ = fs::create_dir_all(&dir);
    let mut plugins: Vec<Value> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let manifest = entry.path().join("plugin.json");
            if let Ok(txt) = fs::read_to_string(&manifest) {
                if let Ok(mut v) = serde_json::from_str::<Value>(&txt) {
                    // 附加插件目录，前端不需要但便于调试
                    if let Some(obj) = v.as_object_mut() {
                        obj.insert("_dir".into(), Value::String(entry.path().to_string_lossy().to_string()));
                    }
                    plugins.push(v);
                }
            }
        }
    }
    serde_json::to_string(&Value::Array(plugins)).map_err(|e| e.to_string())
}

// 执行指定插件：把 args 以 JSON 经 stdin + 环境变量 YT_ARGS 传入，捕获 stdout
#[tauri::command]
fn tool_plugin_exec(name: String, args: Value) -> Result<String, String> {
    let dir = plugins_dir().join(&name);
    let manifest_path = dir.join("plugin.json");
    let txt = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("找不到插件 {}：{}", name, e))?;
    let manifest: Value = serde_json::from_str(&txt).map_err(|e| format!("插件清单解析失败：{}", e))?;

    let command = manifest.get("command")
        .and_then(|c| c.as_str())
        .ok_or_else(|| "插件缺少 command 字段".to_string())?;

    let args_json = serde_json::to_string(&args).unwrap_or_else(|_| "{}".into());

    let (shell, flag) = if cfg!(target_os = "windows") { ("cmd", "/C") } else { ("sh", "-c") };
    let mut cmd = Command::new(shell);
    cmd.arg(flag).arg(command)
        .current_dir(&dir)
        .env("YT_ARGS", &args_json)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("插件启动失败：{}", e))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(args_json.as_bytes());
    }
    let out = child.wait_with_output().map_err(|e| format!("插件执行失败：{}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let mut result = String::new();
    if !stdout.is_empty() { result.push_str(&stdout); }
    if !stderr.is_empty() { result.push_str("\n[stderr]\n"); result.push_str(&stderr); }
    if result.trim().is_empty() {
        result = format!("（插件无输出，退出码 {}）", out.status.code().unwrap_or(-1));
    }
    Ok(clip(result.trim().to_string()))
}

// 返回插件根目录路径（供前端提示/写插件用）
#[tauri::command]
fn tool_plugin_dir() -> Result<String, String> {
    Ok(plugins_dir().to_string_lossy().to_string())
}

// ========================================================
//                    数据目录（~/.yt/data/）
// ========================================================

// YT 根目录：~/.yt (保留以兼容已有 plugins/skills/memory)
fn yt_root() -> PathBuf {
    let base = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    Path::new(&base).join(".yt")
}

// Agent 会话存储目录：~/.yt/sessions/agent/
fn agent_sessions_dir() -> PathBuf {
    let d = yt_root().join("sessions").join("agent");
    let _ = fs::create_dir_all(&d);
    d
}

// ---------------- Agent 会话：列表 ----------------
// 返回按 updated_at 降序的 [{id,title,updated_at,message_count}]
#[tauri::command]
fn agent_session_list() -> Result<String, String> {
    let dir = agent_sessions_dir();
    let mut items: Vec<Value> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
            let txt = match fs::read_to_string(&p) { Ok(t) => t, Err(_) => continue };
            let v: Value = match serde_json::from_str(&txt) { Ok(v) => v, Err(_) => continue };
            let id = p.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            let title = v.get("title").and_then(|s| s.as_str()).unwrap_or("新会话").to_string();
            let updated_at = v.get("updated_at").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let count = v.get("messages").and_then(|a| a.as_array()).map(|a| a.len()).unwrap_or(0);
            items.push(serde_json::json!({
                "id": id,
                "title": title,
                "updated_at": updated_at,
                "message_count": count,
            }));
        }
    }
    // 按 updated_at 降序
    items.sort_by(|a, b| {
        let av = a.get("updated_at").and_then(|s| s.as_str()).unwrap_or("");
        let bv = b.get("updated_at").and_then(|s| s.as_str()).unwrap_or("");
        bv.cmp(av)
    });
    serde_json::to_string(&Value::Array(items)).map_err(|e| e.to_string())
}

// ---------------- Agent 会话：读 ----------------
#[tauri::command]
fn agent_session_load(id: String) -> Result<String, String> {
    if id.trim().is_empty() { return Err("id 为空".into()); }
    let path = agent_sessions_dir().join(format!("{}.json", sanitize_id(&id)));
    fs::read_to_string(&path).map_err(|e| format!("会话不存在：{}", e))
}

// ---------------- Agent 会话：写（新建/更新）----------------
#[tauri::command]
fn agent_session_save(id: String, data: String) -> Result<String, String> {
    if id.trim().is_empty() { return Err("id 为空".into()); }
    // 验证 JSON 合法
    let _: Value = serde_json::from_str(&data).map_err(|e| format!("JSON 格式错：{}", e))?;
    let path = agent_sessions_dir().join(format!("{}.json", sanitize_id(&id)));
    fs::write(&path, data).map_err(|e| format!("写入失败：{}", e))?;
    Ok(path.to_string_lossy().to_string())
}

// ---------------- Agent 会话：删 ----------------
#[tauri::command]
fn agent_session_delete(id: String) -> Result<String, String> {
    if id.trim().is_empty() { return Err("id 为空".into()); }
    let path = agent_sessions_dir().join(format!("{}.json", sanitize_id(&id)));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("删除失败：{}", e))?;
    }
    Ok("ok".into())
}

// 处理 id，防止目录穿越
fn sanitize_id(id: &str) -> String {
    id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            tool_path_exists,
            tool_read_file,
            tool_write_file,
            tool_edit_file,
            tool_list_dir,
            tool_glob,
            tool_grep,
            tool_run_shell,
            tool_plugin_list,
            tool_plugin_exec,
            tool_plugin_dir,
            agent_session_list,
            agent_session_load,
            agent_session_save,
            agent_session_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
