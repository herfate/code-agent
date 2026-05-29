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

/** Claude Agent SDK Bearer Token（写入 `~/.claude.json` 的 `env.ANTHROPIC_AUTH_TOKEN`）；勿写入日志 */
export const ANTHROPIC_CONFIG_KEY_API_KEY = "anthropic_api_key";

/** OpenAI 兼容 API Key（`openAiUtil.chat`）；勿写入日志 */
export const OPENAI_CONFIG_KEY_API_KEY = "openai_api_key";
/** OpenAI 兼容 API Base URL（如 `https://api.openai.com/v1`） */
export const OPENAI_CONFIG_KEY_BASE_URL = "openai_base_url";
/** OpenAI 兼容模型名 */
export const OPENAI_CONFIG_KEY_MODEL = "openai_model";

/** Confluence Server 站点根 URL（如 `https://wiki.example.com/wiki`；勿带 `/rest/api`） */
export const CONFLUENCE_CONFIG_KEY_BASE_URL = "confluence_base_url";
/** Confluence 登录用户名（Basic Auth） */
export const CONFLUENCE_CONFIG_KEY_USERNAME = "confluence_username";
/** Confluence 登录密码（Basic Auth）；勿写入日志 */
export const CONFLUENCE_CONFIG_KEY_PASSWORD = "confluence_password";
