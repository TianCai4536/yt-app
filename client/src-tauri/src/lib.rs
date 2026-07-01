// 异想天开 桌面端本地工具（Tauri command）
// 前端 Agent Loop 通过 invoke("tool_xxx", {...}) 调用
use std::fs;
use std::path::Path;
use std::process::Command;

// 读文件
#[tauri::command]
fn tool_read_file(path: String) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }
    match fs::read_to_string(&path) {
        Ok(content) => {
            // 限制返回大小，避免超大文件塞爆上下文
            if content.len() > 20000 {
                Ok(format!("{}\n\n…（文件过大，仅显示前 20000 字符）", &content[..20000]))
            } else {
                Ok(content)
            }
        }
        Err(e) => Err(format!("读取失败：{}", e)),
    }
}

// 写文件
#[tauri::command]
fn tool_write_file(path: String, content: String) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }
    // 拒绝写系统目录
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

// 列目录
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
            if lines.is_empty() {
                Ok("（空目录）".into())
            } else {
                Ok(lines.join("\n"))
            }
        }
        Err(e) => Err(format!("读取目录失败：{}", e)),
    }
}

// 执行 shell 命令（审批已在前端弹窗完成）
#[tauri::command]
fn tool_run_shell(command: String, cwd: Option<String>) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err("命令为空".into());
    }
    let (shell, flag) = if cfg!(target_os = "windows") {
        ("cmd", "/C")
    } else {
        ("sh", "-c")
    };
    let mut cmd = Command::new(shell);
    cmd.arg(flag).arg(&command);
    if let Some(dir) = cwd {
        if !dir.trim().is_empty() {
            cmd.current_dir(dir);
        }
    }
    match cmd.output() {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let mut result = String::new();
            if !stdout.is_empty() {
                result.push_str(&stdout);
            }
            if !stderr.is_empty() {
                result.push_str("\n[stderr]\n");
                result.push_str(&stderr);
            }
            let code = out.status.code().unwrap_or(-1);
            Ok(format!("退出码 {}\n{}", code, result.trim()))
        }
        Err(e) => Err(format!("执行失败：{}", e)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            tool_read_file,
            tool_write_file,
            tool_list_dir,
            tool_run_shell
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
