use crate::db::DbState;
use crate::models::DbMonitorRule;
use tauri::State;

#[tauri::command]
pub async fn db_rule_list(state: State<'_, DbState>) -> Result<Vec<DbMonitorRule>, String> {
    let pool = state.check_pool()?;
    sqlx::query_as::<_, DbMonitorRule>(
        r#"SELECT id, pattern, rule_type, is_blacklist, message FROM monitor_rules"#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("查询监控规则失败: {}", e))
}

#[tauri::command]
pub async fn db_rule_save(state: State<'_, DbState>, rules: Vec<DbMonitorRule>) -> Result<(), String> {
    let pool = state.check_pool()?;
    sqlx::query("DELETE FROM monitor_rules")
        .execute(&pool)
        .await
        .map_err(|e| format!("清除旧规则失败: {}", e))?;

    for rule in &rules {
        sqlx::query(
            r#"INSERT INTO monitor_rules (id, pattern, rule_type, is_blacklist, message) VALUES (?, ?, ?, ?, ?)"#,
        )
        .bind(&rule.id)
        .bind(&rule.pattern)
        .bind(&rule.rule_type)
        .bind(rule.is_blacklist)
        .bind(&rule.message)
        .execute(&pool)
        .await
        .map_err(|e| format!("插入规则失败: {}", e))?;
    }
    Ok(())
}
