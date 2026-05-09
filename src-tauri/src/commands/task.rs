use crate::db::DbState;
use crate::models::{DbTask, TaskInput, TaskPatch};
use tauri::State;

#[tauri::command]
pub async fn db_task_create(state: State<'_, DbState>, task: TaskInput) -> Result<DbTask, String> {
    let pool = state.pool().ok_or("数据库连接不可用".to_string())?;
    sqlx::query_as::<_, DbTask>(
        r#"INSERT INTO tasks (id, title, category, priority, due_date, completed, created_at, completion_hint, completion_method)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING id, title, category, priority, due_date, completed, created_at, completion_hint, completion_method"#,
    )
    .bind(&task.id)
    .bind(&task.title)
    .bind(&task.category)
    .bind(&task.priority)
    .bind(&task.due_date)
    .bind(task.completed)
    .bind(&task.created_at)
    .bind(&task.completion_hint)
    .bind(&task.completion_method)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("创建任务失败: {}", e))
}

#[tauri::command]
pub async fn db_task_remove(state: State<'_, DbState>, id: String) -> Result<(), String> {
    let pool = state.pool().ok_or("数据库连接不可用".to_string())?;
    sqlx::query("DELETE FROM tasks WHERE id = ?")
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|e| format!("删除任务失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn db_task_update(state: State<'_, DbState>, id: String, patch: TaskPatch) -> Result<DbTask, String> {
    let pool = state.pool().ok_or("数据库连接不可用".to_string())?;

    let mut sets = Vec::new();

    if patch.title.is_some() { sets.push("title = ?"); }
    if patch.category.is_some() { sets.push("category = ?"); }
    if patch.priority.is_some() { sets.push("priority = ?"); }
    if patch.due_date.is_some() { sets.push("due_date = ?"); }
    if patch.completed.is_some() { sets.push("completed = ?"); }
    if patch.completion_hint.is_some() { sets.push("completion_hint = ?"); }
    if patch.completion_method.is_some() { sets.push("completion_method = ?"); }

    if sets.is_empty() {
        return Err("没有需要更新的字段".to_string());
    }

    let sql = format!(
        "UPDATE tasks SET {} WHERE id = ?",
        sets.join(", ")
    );

    let mut query = sqlx::query(&sql);

    if let Some(v) = &patch.title { query = query.bind(v); }
    if let Some(v) = &patch.category { query = query.bind(v); }
    if let Some(v) = &patch.priority { query = query.bind(v); }
    if let Some(v) = &patch.due_date {
        match v {
            Some(d) => query = query.bind(d),
            None => query = query.bind(Option::<String>::None),
        }
    }
    if let Some(v) = patch.completed { query = query.bind(v); }
    if let Some(v) = &patch.completion_hint { query = query.bind(v); }
    if let Some(v) = &patch.completion_method {
        match v {
            Some(m) => query = query.bind(m),
            None => query = query.bind(Option::<String>::None),
        }
    }
    query = query.bind(&id);

    query.execute(pool).await.map_err(|e| format!("更新任务失败: {}", e))?;

    sqlx::query_as::<_, DbTask>(
        r#"SELECT id, title, category, priority, due_date, completed, created_at, completion_hint, completion_method FROM tasks WHERE id = ?"#,
    )
    .bind(&id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("查询更新后任务失败: {}", e))
}

#[tauri::command]
pub async fn db_task_list(state: State<'_, DbState>) -> Result<Vec<DbTask>, String> {
    let pool = state.pool().ok_or("数据库连接不可用".to_string())?;
    sqlx::query_as::<_, DbTask>(
        r#"SELECT id, title, category, priority, due_date, completed, created_at, completion_hint, completion_method FROM tasks ORDER BY created_at DESC"#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("查询任务列表失败: {}", e))
}

#[tauri::command]
pub async fn db_task_clear_completed(state: State<'_, DbState>) -> Result<u64, String> {
    let pool = state.pool().ok_or("数据库连接不可用".to_string())?;
    let result = sqlx::query("DELETE FROM tasks WHERE completed = 1")
        .execute(pool)
        .await
        .map_err(|e| format!("清除已完成任务失败: {}", e))?;
    Ok(result.rows_affected())
}

#[tauri::command]
pub async fn db_task_toggle(state: State<'_, DbState>, id: String, completed: bool, completion_method: Option<String>) -> Result<DbTask, String> {
    let pool = state.pool().ok_or("数据库连接不可用".to_string())?;
    sqlx::query("UPDATE tasks SET completed = ?, completion_method = ? WHERE id = ?")
        .bind(completed)
        .bind(&completion_method)
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|e| format!("切换任务状态失败: {}", e))?;

    sqlx::query_as::<_, DbTask>(
        r#"SELECT id, title, category, priority, due_date, completed, created_at, completion_hint, completion_method FROM tasks WHERE id = ?"#,
    )
    .bind(&id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("查询任务失败: {}", e))
}
