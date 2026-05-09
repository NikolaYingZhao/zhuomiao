use sqlx::mysql::{MySqlPool, MySqlPoolOptions};
use std::sync::atomic::{AtomicBool, Ordering};

pub struct DbState {
    pool: Option<MySqlPool>,
    is_file_mode: AtomicBool,
}

impl DbState {
    pub fn file_mode() -> Self {
        Self {
            pool: None,
            is_file_mode: AtomicBool::new(true),
        }
    }

    pub async fn connect(database_url: &str) -> Result<Self, String> {
        let pool = MySqlPoolOptions::new()
            .min_connections(2)
            .max_connections(5)
            .connect(database_url)
            .await
            .map_err(|e| format!("数据库连接失败: {}", e))?;

        Ok(Self {
            pool: Some(pool),
            is_file_mode: AtomicBool::new(false),
        })
    }

    pub fn pool(&self) -> Option<&MySqlPool> {
        if self.is_file_mode.load(Ordering::Relaxed) {
            return None;
        }
        self.pool.as_ref()
    }

    pub fn is_available(&self) -> bool {
        self.pool.is_some() && !self.is_file_mode.load(Ordering::Relaxed)
    }

    pub fn is_file_mode(&self) -> bool {
        self.is_file_mode.load(Ordering::Relaxed)
    }

    pub fn set_file_mode(&self, mode: bool) {
        self.is_file_mode.store(mode, Ordering::Relaxed);
    }
}

pub async fn run_migrations(pool: &MySqlPool) -> Result<(), String> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS tasks (
            id VARCHAR(36) PRIMARY KEY,
            title VARCHAR(100) NOT NULL,
            category VARCHAR(20) NOT NULL DEFAULT '学习',
            priority VARCHAR(10) NOT NULL DEFAULT 'medium',
            due_date VARCHAR(20),
            completed TINYINT(1) NOT NULL DEFAULT 0,
            created_at VARCHAR(30) NOT NULL,
            completion_hint VARCHAR(200),
            completion_method VARCHAR(20),
            INDEX idx_tasks_completed (completed),
            INDEX idx_tasks_category (category)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("创建tasks表失败: {}", e))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS activity_records (
            id VARCHAR(50) PRIMARY KEY,
            timestamp VARCHAR(30) NOT NULL,
            window_title VARCHAR(300) NOT NULL,
            process_name VARCHAR(100) NOT NULL,
            classification VARCHAR(20) NOT NULL DEFAULT 'productive',
            classification_source VARCHAR(20) NOT NULL DEFAULT 'rule_based',
            activity_type VARCHAR(50),
            ai_comment VARCHAR(500),
            task_id VARCHAR(36),
            INDEX idx_activity_timestamp (timestamp),
            INDEX idx_activity_classification (classification)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("创建activity_records表失败: {}", e))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS monitor_rules (
            id VARCHAR(36) PRIMARY KEY,
            pattern VARCHAR(200) NOT NULL,
            rule_type VARCHAR(20) NOT NULL DEFAULT 'url',
            is_blacklist TINYINT(1) NOT NULL DEFAULT 1,
            message VARCHAR(200) NOT NULL DEFAULT ''
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("创建monitor_rules表失败: {}", e))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS ai_config (
            id INT PRIMARY KEY DEFAULT 1,
            provider VARCHAR(50) NOT NULL DEFAULT 'openai',
            endpoint VARCHAR(200) NOT NULL DEFAULT 'https://api.openai.com/v1',
            api_key VARCHAR(200) NOT NULL DEFAULT '',
            model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o-mini',
            system_prompt TEXT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("创建ai_config表失败: {}", e))?;

    Ok(())
}
