use crate::db::DbState;
use crate::models::MigrationReport;
use serde_json::Value;
use std::fs;
use tauri::State;

#[tauri::command]
pub async fn migrate_from_json(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
) -> Result<MigrationReport, String> {
    let pool = state.pool().ok_or("数据库连接不可用".to_string())?;
    let dir = crate::resolve_data_dir(&app);

    let mut report = MigrationReport {
        success_count: 0,
        skip_count: 0,
        error_count: 0,
        errors: Vec::new(),
    };

    let tasks_path = dir.join("tasks.json");
    if tasks_path.exists() {
        if let Ok(content) = fs::read_to_string(&tasks_path) {
            if let Ok(tasks) = serde_json::from_str::<Vec<Value>>(&content) {
                for task in &tasks {
                    let id = task.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    if id.is_empty() {
                        report.error_count += 1;
                        report.errors.push("任务缺少id字段".to_string());
                        continue;
                    }
                    match sqlx::query(
                        r#"INSERT IGNORE INTO tasks (id, title, category, priority, due_date, completed, created_at, completion_hint, completion_method)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
                    )
                    .bind(id)
                    .bind(task.get("title").and_then(|v| v.as_str()).unwrap_or(""))
                    .bind(task.get("category").and_then(|v| v.as_str()).unwrap_or("学习"))
                    .bind(task.get("priority").and_then(|v| v.as_str()).unwrap_or("medium"))
                    .bind(task.get("dueDate").and_then(|v| v.as_str()))
                    .bind(task.get("completed").and_then(|v| v.as_bool()).unwrap_or(false) as i8)
                    .bind(task.get("createdAt").and_then(|v| v.as_str()).unwrap_or(""))
                    .bind(task.get("completionHint").and_then(|v| v.as_str()))
                    .bind(task.get("completionMethod").and_then(|v| v.as_str()))
                    .execute(pool)
                    .await
                    {
                        Ok(result) => {
                            if result.rows_affected() > 0 {
                                report.success_count += 1;
                            } else {
                                report.skip_count += 1;
                            }
                        }
                        Err(e) => {
                            report.error_count += 1;
                            report.errors.push(format!("迁移任务{}失败: {}", id, e));
                        }
                    }
                }
            }
        }
    }

    let rules_path = dir.join("monitor-rules.json");
    if rules_path.exists() {
        if let Ok(content) = fs::read_to_string(&rules_path) {
            if let Ok(rules) = serde_json::from_str::<Vec<Value>>(&content) {
                for rule in &rules {
                    let id = rule.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    if id.is_empty() { continue; }
                    let _ = sqlx::query(
                        r#"INSERT IGNORE INTO monitor_rules (id, pattern, rule_type, is_blacklist, message) VALUES (?, ?, ?, ?, ?)"#,
                    )
                    .bind(id)
                    .bind(rule.get("pattern").and_then(|v| v.as_str()).unwrap_or(""))
                    .bind(rule.get("ruleType").and_then(|v| v.as_str()).unwrap_or("url"))
                    .bind(rule.get("isBlacklist").and_then(|v| v.as_bool()).unwrap_or(true) as i8)
                    .bind(rule.get("message").and_then(|v| v.as_str()).unwrap_or(""))
                    .execute(pool)
                    .await;
                }
            }
        }
    }

    let config_path = dir.join("ai-config.json");
    if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str::<Value>(&content) {
                let _ = sqlx::query(
                    r#"INSERT INTO ai_config (id, provider, endpoint, api_key, model, system_prompt)
                       VALUES (1, ?, ?, ?, ?, ?)
                       ON DUPLICATE KEY UPDATE provider=VALUES(provider), endpoint=VALUES(endpoint), api_key=VALUES(api_key), model=VALUES(model), system_prompt=VALUES(system_prompt)"#,
                )
                .bind(config.get("provider").and_then(|v| v.as_str()).unwrap_or("openai"))
                .bind(config.get("endpoint").and_then(|v| v.as_str()).unwrap_or("https://api.openai.com/v1"))
                .bind(config.get("apiKey").and_then(|v| v.as_str()).unwrap_or(""))
                .bind(config.get("model").and_then(|v| v.as_str()).unwrap_or("gpt-4o-mini"))
                .bind(config.get("systemPrompt").and_then(|v| v.as_str()).unwrap_or(""))
                .execute(pool)
                .await;
            }
        }
    }

    Ok(report)
}
