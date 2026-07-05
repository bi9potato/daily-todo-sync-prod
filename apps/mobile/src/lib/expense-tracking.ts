import { NativeModules, Platform } from "react-native";

export type MoneyNature =
  | "purchase_expense"
  | "earned_income"
  | "refund"
  | "internal_transfer"
  | "personal_transfer"
  | "credit_repayment"
  | "wallet_topup_withdrawal"
  | "loan_principal"
  | "investment_principal"
  | "cash_withdrawal_deposit"
  | "fee_interest"
  | "reversal_failed"
  | "unknown_money_flow";

export type ExpenseCategory =
  | "food_dining"
  | "groceries"
  | "transport"
  | "shopping_general"
  | "clothing_beauty"
  | "digital_appliances"
  | "home_household"
  | "housing"
  | "utilities_communications"
  | "health_medical"
  | "education"
  | "entertainment"
  | "travel_lodging"
  | "personal_services"
  | "family_children_pets"
  | "gifts_social"
  | "insurance_tax_fee"
  | "business_reimbursable"
  | "charity"
  | "other_expense";

export type IncomeCategory =
  | "salary"
  | "bonus_commission"
  | "business_freelance"
  | "investment_interest"
  | "rental"
  | "gifts_red_packets"
  | "reimbursement"
  | "other_income";

export type TransactionCategory = ExpenseCategory | IncomeCategory;

export type ExpenseHealth = {
  notificationAccessGranted: boolean;
  notificationListenerConnected: boolean;
  accessibilityAccessGranted: boolean;
  accessibilityServiceConnected: boolean;
  appNotificationsEnabled: boolean;
  ignoringBatteryOptimizations: boolean;
  lastNotificationEventAt: number | null;
  lastAccessibilityEventAt: number | null;
  androidSdk: number;
  androidRelease: string;
  enabledSourceCount: number;
  pendingCandidateCount: number;
};

export type ExpenseTransaction = {
  id: string;
  occurredAt: number;
  detectedAt: number;
  amountMinor: number;
  currency: string;
  moneyNature: MoneyNature;
  category: TransactionCategory | null;
  merchant: string | null;
  account: string | null;
  reviewState: string;
  confidenceLevel: string;
  confidenceReasons: string[];
  excludedFromTotals: boolean;
  originalTransactionId: string | null;
  sourceSummary: string;
};

export type ExpenseCandidate = {
  id: string;
  occurredAt: number;
  detectedAt: number;
  amountMinor: number | null;
  currency: string;
  moneyNature: MoneyNature;
  category: TransactionCategory | null;
  merchant: string | null;
  confidenceLevel: string;
  confidenceReasons: string[];
  sourcePackage: string;
  sourceKind: "notification" | "accessibility";
};

export type ExpenseDaySummary = {
  expenseMinor: number;
  incomeMinor: number;
  refundMinor: number;
  excludedMinor: number;
  transactionCount: number;
};

export type ExpenseDayData = {
  transactions: ExpenseTransaction[];
  summary: ExpenseDaySummary;
};

export type InstalledExpenseApp = {
  packageName: string;
  label: string;
  versionName: string | null;
  versionCode: number;
  signingCertSha256: string | null;
};

export type ExpenseSource = InstalledExpenseApp & {
  enabled: boolean;
  diagnosticCaptureEnabled: boolean;
  validationState:
    | "unvalidated"
    | "version_changed"
    | "signature_changed"
    | "validated";
  validatedTemplateVersion: string | null;
  unknownTemplateCount: number;
  lastEventAt: number | null;
  lastParsedAt: number | null;
};

type ExpenseTrackingNativeModule = {
  getHealth(): Promise<ExpenseHealth>;
  getTransactions(dayKey: string): Promise<ExpenseDayData>;
  getPendingCandidates(): Promise<ExpenseCandidate[]>;
  addManualTransaction(
    amountMinor: number,
    occurredAt: number,
    moneyNature: MoneyNature,
    category: TransactionCategory | null,
    merchant: string | null,
  ): Promise<ExpenseTransaction>;
  confirmCandidate(
    candidateId: string,
    moneyNature: MoneyNature | null,
    category: TransactionCategory | null,
  ): Promise<ExpenseTransaction>;
  ignoreCandidate(candidateId: string): Promise<void>;
  deleteTransaction(transactionId: string): Promise<void>;
  getInstalledApps(): Promise<InstalledExpenseApp[]>;
  getSources(): Promise<ExpenseSource[]>;
  setSourceConfig(
    packageName: string,
    enabled: boolean,
    diagnosticCaptureEnabled: boolean,
  ): Promise<ExpenseSource>;
  openNotificationAccessSettings(): Promise<void>;
  openAccessibilitySettings(): Promise<void>;
  openAppNotificationSettings(): Promise<void>;
  openBatteryOptimizationSettings(): Promise<void>;
};

const nativeModule = NativeModules.ExpenseTracking as
  | ExpenseTrackingNativeModule
  | undefined;

function requireNativeModule() {
  if (Platform.OS !== "android" || !nativeModule) {
    throw new Error("每日收支记录仅在 Android 原生构建中可用。");
  }
  return nativeModule;
}

export function isExpenseTrackingAvailable() {
  return Platform.OS === "android" && Boolean(nativeModule);
}

export const expenseTracking = {
  getHealth: () => requireNativeModule().getHealth(),
  getTransactions: (dayKey: string) =>
    requireNativeModule().getTransactions(dayKey),
  getPendingCandidates: () => requireNativeModule().getPendingCandidates(),
  addManualTransaction: (
    amountMinor: number,
    occurredAt: number,
    moneyNature: MoneyNature,
    category: TransactionCategory | null,
    merchant: string | null,
  ) =>
    requireNativeModule().addManualTransaction(
      amountMinor,
      occurredAt,
      moneyNature,
      category,
      merchant,
    ),
  confirmCandidate: (
    candidateId: string,
    moneyNature: MoneyNature | null,
    category: TransactionCategory | null,
  ) =>
    requireNativeModule().confirmCandidate(
      candidateId,
      moneyNature,
      category,
    ),
  ignoreCandidate: (candidateId: string) =>
    requireNativeModule().ignoreCandidate(candidateId),
  deleteTransaction: (transactionId: string) =>
    requireNativeModule().deleteTransaction(transactionId),
  getInstalledApps: () => requireNativeModule().getInstalledApps(),
  getSources: () => requireNativeModule().getSources(),
  setSourceConfig: (
    packageName: string,
    enabled: boolean,
    diagnosticCaptureEnabled: boolean,
  ) =>
    requireNativeModule().setSourceConfig(
      packageName,
      enabled,
      diagnosticCaptureEnabled,
    ),
  openNotificationAccessSettings: () =>
    requireNativeModule().openNotificationAccessSettings(),
  openAccessibilitySettings: () =>
    requireNativeModule().openAccessibilitySettings(),
  openAppNotificationSettings: () =>
    requireNativeModule().openAppNotificationSettings(),
  openBatteryOptimizationSettings: () =>
    requireNativeModule().openBatteryOptimizationSettings(),
};

export const moneyNatureLabels: Record<MoneyNature, string> = {
  purchase_expense: "消费支出",
  earned_income: "实际收入",
  refund: "退款",
  internal_transfer: "本人互转",
  personal_transfer: "个人转账",
  credit_repayment: "信用还款",
  wallet_topup_withdrawal: "充值/提现",
  loan_principal: "借款本金",
  investment_principal: "投资本金",
  cash_withdrawal_deposit: "存取现金",
  fee_interest: "手续费/利息",
  reversal_failed: "失败/冲正",
  unknown_money_flow: "待判断资金流",
};

export const expenseCategoryLabels: Record<ExpenseCategory, string> = {
  food_dining: "餐饮",
  groceries: "买菜商超",
  transport: "交通出行",
  shopping_general: "综合购物",
  clothing_beauty: "服饰美妆",
  digital_appliances: "数码家电",
  home_household: "家居日用",
  housing: "住房",
  utilities_communications: "水电燃气通讯",
  health_medical: "医疗健康",
  education: "教育",
  entertainment: "休闲娱乐",
  travel_lodging: "旅行住宿",
  personal_services: "个人服务",
  family_children_pets: "家庭儿童宠物",
  gifts_social: "人情赠礼",
  insurance_tax_fee: "保险税费",
  business_reimbursable: "商务可报销",
  charity: "公益捐赠",
  other_expense: "其他支出",
};

export const incomeCategoryLabels: Record<IncomeCategory, string> = {
  salary: "工资",
  bonus_commission: "奖金提成",
  business_freelance: "经营/兼职",
  investment_interest: "投资收益/利息",
  rental: "租金收入",
  gifts_red_packets: "赠与/红包",
  reimbursement: "报销款",
  other_income: "其他收入",
};

export function categoryLabel(category: TransactionCategory | null) {
  if (!category) return "未分类";
  return (
    expenseCategoryLabels[category as ExpenseCategory] ??
    incomeCategoryLabels[category as IncomeCategory] ??
    category
  );
}

export function formatCny(amountMinor: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(amountMinor / 100);
}
