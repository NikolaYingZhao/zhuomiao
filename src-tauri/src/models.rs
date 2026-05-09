use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbTask {
    pub id: String,
    pub title: String,
    pub category: String,
    pub priority: String,
    pub due_date: Option<String>,
    pub completed: bool,
    pub created_at: String,
    pub completion_hint: Option<String>,
    pub completion_method: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub id: String,
    pub title: String,
    pub category: String,
    pub priority: String,
    pub due_date: Option<String>,
    pub completed: bool,
    pub created_at: String,
    pub completion_hint: Option<String>,
    pub completion_method: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    pub title: Option<String>,
    pub category: Option<String>,
    pub priority: Option<String>,
    pub due_date: Option<Option<String>>,
    pub completed: Option<bool>,
    pub completion_hint: Option<String>,
    pub completion_method: Option<Option<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbActivityRecord {
    pub id: String,
    pub timestamp: String,
    pub window_title: String,
    pub process_name: String,
    pub classification: String,
    pub classification_source: String,
    pub activity_type: Option<String>,
    pub ai_comment: Option<String>,
    pub task_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityInput {
    pub id: String,
    pub timestamp: String,
    pub window_title: String,
    pub process_name: String,
    pub classification: String,
    pub classification_source: String,
    pub activity_type: Option<String>,
    pub ai_comment: Option<String>,
    pub task_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbMonitorRule {
    pub id: String,
    pub pattern: String,
    pub rule_type: String,
    pub is_blacklist: bool,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbAiConfig {
    pub id: i32,
    pub provider: String,
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub system_prompt: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStatusInfo {
    pub available: bool,
    pub mode: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub success_count: u32,
    pub skip_count: u32,
    pub error_count: u32,
    pub errors: Vec<String>,
}
