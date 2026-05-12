/**
 * 应用目录枚举（由 `public/app_data.txt` 生成）
 * 每项对应原 DSL：`name("repo-id", "gitlab-url")`
 */
export const APPS = {
  fds_batch_new: {
    repoId: "fds-batch-server-new",
    gitlabUrl: "http://gitlab-code.howbuy.pa/tradenew/fds-batch-new",
    category: "大陆清算",
  },
  param_console: {
    repoId: "param-console",
    gitlabUrl: "http://gitlab-code.howbuy.pa/tradenew/param-center-new",
    category: "大陆参数",
  },
  param_server: {
    repoId: "param-server",
    gitlabUrl: "http://gitlab-code.howbuy.pa/tradenew/param-center-new",
    category: "大陆参数",
  },
  fds_console_web: {
    repoId: "fds-console-web",
    gitlabUrl: "http://gitlab-code.howbuy.pa/tradenew/fds-console-new",
    category: "大陆控制台",
  },
  fin_console: {
    repoId: "fin-console-web",
    gitlabUrl: "http://gitlab-code.howbuy.pa/fin/fin-console",
    category: "大陆资金",
  },
  fin_online: {
    repoId: "fin-online-service",
    gitlabUrl: "http://gitlab-code.howbuy.pa/fin/fin-online",
    category: "大陆资金联机",
  },
  hk_fin: {
    repoId: "hk-fin-service",
    gitlabUrl: "http://gitlab-code.howbuy.pa/hk-fin/hk-fin",
    category: "海外资金-后端",
  },
  hk_fin_ui: {
    repoId: "hk-fin-ui",
    gitlabUrl: "http://gitlab-code.howbuy.pa/hk-fin/hk-fin-ui",
    category: "海外资金-前端",
  },
  pay_online: {
    repoId: "pay-online-server",
    gitlabUrl: "http://gitlab-code.howbuy.pa/pay/pay-online",
    category: "支付-线上支付",
  },
  pay_console: {
    repoId: "pay-console-web",
    gitlabUrl: "http://gitlab-code.howbuy.pa/pay/pay-console",
    category: "支付-控制台",
  },
  bank_callback: {
    repoId: "bank-callback-web",
    gitlabUrl: "http://gitlab-code.howbuy.pa/pay/bank-callback",
    category: "支付-银行回调",
  },
  bank_gateway: {
    repoId: "bank-gateway-service",
    gitlabUrl: "http://gitlab-code.howbuy.pa/hk-pay/bank-gateway",
    category: "香港支付-银行网关",
  },
  hk_pay: {
    repoId: "hk-pay-service",
    gitlabUrl: "http://gitlab-code.howbuy.pa/hk-pay/hk-pay",
    category: "香港支付-后端",
  },
  hk_pay_ui: {
    repoId: "hk-pay-ui",
    gitlabUrl: "http://gitlab-code.howbuy.pa/hk-pay/hk-pay-ui",
    category: "香港支付-前端",
  },
  dtms_settle: {
    repoId: "dtms-settle-remote",
    gitlabUrl: "http://gitlab-code.howbuy.pa/DTMS/dtms-settle",
    category: "海外清算-后端",
  },
  dtms_manager_web: {
    repoId: "dtms-manager-web",
    gitlabUrl: "http://gitlab-code.howbuy.pa/DTMS/dtms-manager-web",
    category: "海外交易-前端",
  },
  dtms_manager_remote: {
    repoId: "dtms-manager-remote",
    gitlabUrl: "http://gitlab-code.howbuy.pa/DTMS/dtms-manager-remote",
    category: "海外交易-web",
  },
  dtms_product: {
    repoId: "dtms-product-remote",
    gitlabUrl: "http://gitlab-code.howbuy.pa/DTMS/dtms-product",
    category: "海外参数-后端",
  },
  dtms_product_web: {
    repoId: "dtms-product-web",
    gitlabUrl: "http://gitlab-code.howbuy.pa/DTMS/dtms-product-web",
    category: "海外参数-前端",
  },
  hk_acc_online: {
    repoId: "hk-acc-online",
    gitlabUrl: "http://gitlab-code.howbuy.pa/hk-acc/hk-acc-online",
    category: "海外账户",
  },
  acc_center: {
    repoId: "acc-center",
    gitlabUrl: "http://gitlab-code.howbuy.pa/acc/acc-center",
    category: "大陆账户",
  },
  es_web: {
    repoId: "es-web",
    gitlabUrl: "http://gitlab-code.howbuy.pa/trade-esign/es-web",
    category: "电子签名",
  },
} as const;

/** 应用枚举键，与源文件中的标识符一致 */
export type AppKey = keyof typeof APPS;

export type AppDefinition = (typeof APPS)[AppKey];

/** 所有 `AppKey` 字面量数组（顺序与源文件一致） */
export const APP_KEYS = Object.keys(APPS) as AppKey[];

export function isAppKey(value: string): value is AppKey {
  return Object.prototype.hasOwnProperty.call(APPS, value);
}

export function getApp(key: AppKey): AppDefinition {
  return APPS[key];
}
