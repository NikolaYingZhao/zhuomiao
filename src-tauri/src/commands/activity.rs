use crate::db::DbState;
use crate::models::{DbActivityRecord, ActivityInput};
use tauri::State;

#[tauri::command]
pub async fn db_activity_create(state: State<'_, DbState>, record: ActivityInput) -> Result<(), String> {
    let pool = state.check_pool()?;
    sqlx::query(
        r#"INSERT INTO activity_records (id, timestamp, window_title, process_name, classification, classification_source, activity_type, ai_comment, task_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&record.id)
    .bind(&record.timestamp)
    .bind(&record.window_title)
    .bind(&record.process_name)
    .bind(&record.classification)
    .bind(&record.classification_source)
    .bind(&record.activity_type)
    .bind(&record.ai_comment)
    .bind(&record.task_id)
    .execute(&pool)
    .await
    .map_err(|e| format!("创建活动记录失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn db_activity_list(state: State<'_, DbState>) -> Result<Vec<DbActivityRecord>, String> {
    let pool = state.check_pool()?;
    sqlx::query_as::<_, DbActivityRecord>(
        r#"SELECT id, timestamp, window_title, process_name, classification, classification_source, activity_type, ai_comment, task_id FROM activity_records ORDER BY timestamp DESC"#,
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("查询活动记录失败: {}", e))
}

#[tauri::command]
pub async fn db_activity_calibrate(state: State<'_, DbState>, id: String, classification: String) -> Result<(), String> {
    let pool = state.check_pool()?;
    sqlx::query("UPDATE activity_records SET classification = ?, classification_source = 'manual' WHERE id = ?")
        .bind(&classification)
        .bind(&id)
        .execute(&pool)
        .await
        .map_err(|e| format!("校准活动记录失败: {}", e))?;
    Ok(())
}
