use crate::db::DbState;
use crate::models::{DbAiConfig, DbStatusInfo};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub async fn db_config_get(state: State<'_, DbState>) -> Result<Option<Value>, String> {
    let pool = state.pool().ok_or("数据库连接不可用".to_string())?;
    let row = sqlx::query_as::<_, DbAiConfig>(
        r#"SELECT id, provider, endpoint, api_key, model, system_prompt FROM ai_config WHERE id = 1"#,
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("查询AI配置失败: {}", e))?;

    match row {
        Some(config) => {
            let mut map = serde_json::Map::new();
            map.insert("provider".into(), Value::String(config.provider));
            map.insert("endpoint".into(), Value::String(config.endpoint));
            map.insert("apiKey".into(), Value::String(config.api_key));
            map.insert("model".into(), Value::String(config.model));
            map.insert(
                "systemPrompt".into(),
                Value::String(config.system_prompt.unwrap_or_default()),
            );
            Ok(Some(Value::Object(map)))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn db_config_save(state: State<'_, DbState>, config: Value) -> Result<(), String> {
    let pool = state.pool().ok_or("数据库连接不可用".to_string())?;

    let provider = config.get("provider").and_then(|v| v.as_str()).unwrap_or("openai");
    let endpoint = config.get("endpoint").and_then(|v| v.as_str()).unwrap_or("https://api.openai.com/v1");
    let api_key = config.get("apiKey").and_then(|v| v.as_str()).unwrap_or("");
    let model = config.get("model").and_then(|v| v.as_str()).unwrap_or("gpt-4o-mini");
    let system_prompt = config.get("systemPrompt").and_then(|v| v.as_str()).unwrap_or("");

    sqlx::query(
        r#"INSERT INTO ai_config (id, provider, endpoint, api_key, model, system_prompt)
           VALUES (1, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE provider=VALUES(provider), endpoint=VALUES(endpoint), api_key=VALUES(api_key), model=VALUES(model), system_prompt=VALUES(system_prompt)"#,
    )
    .bind(provider)
    .bind(endpoint)
    .bind(api_key)
    .bind(model)
    .bind(system_prompt)
    .execute(pool)
    .await
    .map_err(|e| format!("保存AI配置失败: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn db_status(state: State<'_, DbState>) -> Result<DbStatusInfo, String> {
    Ok(DbStatusInfo {
        available: state.is_available(),
        mode: if state.is_file_mode() { "file".to_string() } else { "mysql".to_string() },
    })
}

#[tauri::command]
pub async fn db_connect(state: State<'_, DbState>, database_url: String) -> Result<DbStatusInfo, String> {
    let _ = crate::db::DbState::connect(&database_url).await.map_err(|e| e.clone())?;
    state.set_file_mode(false);
    Ok(DbStatusInfo {
        available: true,
        mode: "mysql".to_string(),
    })
}
