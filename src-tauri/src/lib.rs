mod db;
mod models;
mod commands;

use commands::{task, activity, rule, config, migration};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{Manager, menu::{Menu, MenuItem}, tray::TrayIconBuilder};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActiveWindow {
    title: String,
    process_name: String,
    process_id: u32,
}

#[tauri::command]
fn get_active_window() -> Result<ActiveWindow, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
        };
        use windows::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
            PROCESS_QUERY_LIMITED_INFORMATION,
        };

        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd == HWND::default() {
                return Err("No foreground window".into());
            }

            let mut title_buf = [0u16; 512];
            let title_len = GetWindowTextW(hwnd, &mut title_buf);
            let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);

            let mut process_id: u32 = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut process_id));

            let process_name = if process_id != 0 {
                match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) {
                    Ok(process_handle) => {
                        let mut name_buf = [0u16; 512];
                        let mut name_len = name_buf.len() as u32;
                        if QueryFullProcessImageNameW(process_handle, PROCESS_NAME_FORMAT(0), windows::core::PWSTR(name_buf.as_mut_ptr()), &mut name_len).is_ok() {
                            let name = String::from_utf16_lossy(&name_buf[..name_len as usize]);
                            name.rsplit('\\').next().unwrap_or(&name).to_string()
                        } else {
                            String::from("unknown")
                        }
                    }
                    Err(_) => String::from("unknown"),
                }
            } else {
                String::from("unknown")
            };

            Ok(ActiveWindow {
                title,
                process_name,
                process_id,
            })
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(ActiveWindow {
            title: String::new(),
            process_name: String::new(),
            process_id: 0,
        })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppDataDir {
    path: String,
    is_default: bool,
}

fn get_config_file_path(app: &tauri::AppHandle) -> PathBuf {
    let app_dir = app.path().app_data_dir().expect("no app data dir");
    app_dir.join("zhuomiao-config.json")
}

fn get_configured_data_dir(app: &tauri::AppHandle) -> Option<String> {
    let config_path = get_config_file_path(app);
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(dir) = config.get("dataDir").and_then(|v| v.as_str()) {
                    if !dir.is_empty() {
                        return Some(dir.to_string());
                    }
                }
            }
        }
    }
    None
}

fn resolve_data_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Some(custom_dir) = get_configured_data_dir(app) {
        let path = PathBuf::from(&custom_dir);
        if path.exists() || fs::create_dir_all(&path).is_ok() {
            return path;
        }
    }
    let app_dir = app.path().app_data_dir().expect("no app data dir");
    let _ = fs::create_dir_all(&app_dir);
    app_dir
}

#[tauri::command]
fn get_data_dir(app: tauri::AppHandle) -> Result<AppDataDir, String> {
    let default_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let default_str = default_dir.to_string_lossy().to_string();
    match get_configured_data_dir(&app) {
        Some(custom) => Ok(AppDataDir {
            path: custom,
            is_default: false,
        }),
        None => Ok(AppDataDir {
            path: default_str,
            is_default: true,
        }),
    }
}

#[tauri::command]
fn set_data_dir(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    let path = PathBuf::from(&dir);
    fs::create_dir_all(&path).map_err(|e| format!("无法创建目录: {}", e))?;

    let config_path = get_config_file_path(&app);
    let config_dir = config_path.parent().expect("no parent");
    fs::create_dir_all(config_dir).map_err(|e| format!("无法创建配置目录: {}", e))?;

    let mut config = if config_path.exists() {
        let content = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str::<serde_json::Value>(&content).unwrap_or(serde_json::Value::Object(Default::default()))
    } else {
        serde_json::Value::Object(Default::default())
    };

    if let Some(obj) = config.as_object_mut() {
        obj.insert("dataDir".to_string(), serde_json::Value::String(dir));
    }

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&config_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_app_data(app: tauri::AppHandle, key: String, data: serde_json::Value) -> Result<(), String> {
    let dir = resolve_data_dir(&app);
    let file_path = dir.join(format!("{}.json", key));
    let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&file_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_app_data(app: tauri::AppHandle, key: String) -> Result<Option<serde_json::Value>, String> {
    let dir = resolve_data_dir(&app);
    let file_path = dir.join(format!("{}.json", key));
    if !file_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(value))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();

    let db_state = match std::env::var("DATABASE_URL") {
        Ok(url) => {
            match tauri::async_runtime::block_on(async {
                let state = db::DbState::connect(&url).await?;
                if let Some(pool) = state.pool() {
                    db::run_migrations(&pool).await?;
                }
                Ok::<db::DbState, String>(state)
            }) {
                Ok(state) => state,
                Err(e) => {
                    eprintln!("数据库连接失败，降级为本地文件存储模式: {}", e);
                    db::DbState::file_mode()
                }
            }
        }
        Err(_) => {
            eprintln!("未配置DATABASE_URL，使用本地文件存储模式");
            db::DbState::file_mode()
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(db_state)
        .invoke_handler(tauri::generate_handler![
            get_active_window,
            get_data_dir,
            set_data_dir,
            save_app_data,
            load_app_data,
            task::db_task_create,
            task::db_task_remove,
            task::db_task_update,
            task::db_task_list,
            task::db_task_clear_completed,
            task::db_task_toggle,
            activity::db_activity_create,
            activity::db_activity_list,
            activity::db_activity_calibrate,
            rule::db_rule_list,
            rule::db_rule_save,
            config::db_config_get,
            config::db_config_save,
            config::db_status,
            config::db_connect,
            migration::migrate_from_json,
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "显示桌喵", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "彻底退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("桌喵 - 桌面宠物精灵")
                .icon(app.default_window_icon().cloned().expect("no default window icon"))
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("pet") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, _event| {
                    let app = tray.app_handle();
                    if let Some(w) = app.get_webview_window("pet") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
