/**
 * `system_config.config_key` 约定键名集中定义，避免魔法字符串散落各处。
 * 全局行：`scope = 'global'` 且 `username IS NULL`；用户行：`scope = 'user'` 且 `username` 为登录名。
 */

/** GitLab 实例主机（如 `gitlab.example.com`，不要带协议） */
export const GITLAB_CONFIG_KEY_HOST = "gitlab_host";
/** GitLab Personal Access Token 等；勿写入日志 */
export const GITLAB_CONFIG_KEY_TOKEN = "gitlab_token";

/** QA 平台登录名（`value_json` 可为 JSON 字符串或裸文本） */
export const QA_CONFIG_KEY_USERNAME = "qa_platform_username";
/** QA 平台密码 */
export const QA_CONFIG_KEY_PASSWORD = "qa_platform_password";

/** DevOps 测试环境部署接口完整 URL（POST JSON：`gitBranch`、`serverName`） */
export const DEV_OPS_DEPLOY_URL_CONFIG_KEY = "dev_ops_deploy_url";

/** 测试未通过时同父任务复制开发/测试任务的最大重试次数（全局非负整数， 默认 `3`, 去dbConfig.ts修改DEFAULT_MAX_RETRY_COUNT） */
export const MAX_RETRY_COUNT_CONFIG_KEY = "max_retry_count";
