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

/** Code Review 未通过时同父任务下最多执行的 Code Review 任务数（全局非负整数，默认 `2`，见 dbConfig.ts） */
export const MAX_CODE_REVIEW_RUN_COUNT_CONFIG_KEY = "max_code_review_run_count";

/** Claude Agent SDK Bearer Token（写入工作区 `.claude/settings.json` 的 `env.ANTHROPIC_AUTH_TOKEN`）；勿写入日志 */
export const ANTHROPIC_CONFIG_KEY_API_KEY = "anthropic_api_key";

/** TAPD API Token（用户级，用于 MCP TAPD 接口认证）；勿写入日志 */
export const TAPD_CONFIG_KEY_TOKEN = "tapd_token";
/** TAPD 项目 workspace_id（全局或用户级；TAPD API 的 workspace_id 参数） */
export const TAPD_CONFIG_KEY_WORKSPACE_ID = "tapd_workspace_id";

/** OpenAI 兼容 API Key（`openAiUtil.chat`）；勿写入日志 */
export const OPENAI_CONFIG_KEY_API_KEY = "openai_api_key";
/** OpenAI 兼容 API Base URL（如 `https://api.openai.com/v1`） */
export const OPENAI_CONFIG_KEY_BASE_URL = "openai_base_url";
/** OpenAI 兼容模型名 */
export const OPENAI_CONFIG_KEY_MODEL = "openai_model";

/** 多模态（Vision）兼容 API Key（`multimodalUtil.chat`）；与 OPENAI_* 独立；勿写入日志 */
export const MULTIMODAL_CONFIG_KEY_API_KEY = "multimodal_api_key";
/** 多模态兼容 API Base URL */
export const MULTIMODAL_CONFIG_KEY_BASE_URL = "multimodal_base_url";
/** 多模态兼容模型名（需支持 image_url） */
export const MULTIMODAL_CONFIG_KEY_MODEL = "multimodal_model";

/** Confluence Server 站点根 URL（如 `https://wiki.example.com/wiki`；勿带 `/rest/api`） */
export const CONFLUENCE_CONFIG_KEY_BASE_URL = "confluence_base_url";

/** Claude Agent SDK 启用的 skill 名称列表（JSON 字符串数组；用户级覆盖全局） */
export const CLAUDE_ENABLED_SKILLS_CONFIG_KEY = "claude_enabled_skills";
/** Confluence 登录用户名（Basic Auth） */
export const CONFLUENCE_CONFIG_KEY_USERNAME = "confluence_username";
/** Confluence 登录密码（Basic Auth）；勿写入日志 */
export const CONFLUENCE_CONFIG_KEY_PASSWORD = "confluence_password";
