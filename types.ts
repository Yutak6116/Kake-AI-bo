export type WalletType = "bank" | "other" | "card";

export interface Wallet {
  id: string;
  userId?: string;
  name: string;
  order?: number;
  type: WalletType;
  initialBalance: number;
  color?: string;
  // For credit cards
  closingDay?: number;
  paymentDay?: number;
  initialPaymentAmount?: number;
  withdrawalWalletId?: string; // 引き落とし口座のID
  actualPaymentDates?: Record<string, string>; // { "2026-05": "2026-05-27" }
}

export interface Category {
  id: string;
  userId?: string;
  name: string;
  order?: number;
  type: "income" | "expense";
  color?: string;
}

export type TransactionType = "income" | "expense" | "transfer" | "withdrawal";

export interface Transaction {
  id: string;
  userId: string;
  date: string; // ISO format
  createdAt?: string; // 登録日時 (ISO format)
  amount: number;
  type: TransactionType;
  fromWalletId?: string; // used for expense and transfer
  toWalletId?: string; // used for income and transfer
  categoryId?: string;
  paymentMonth?: string; // クレカ利用分の支払月 (YYYY-MM)
  creditPaymentDate?: string; // legacy: クレカの引き落とし日 (ISO format)
  actualPaymentDate?: string; // 実際の引落日 (ISO format)
  isAutoCreated?: boolean;
  isReimbursement?: boolean; // 立替申請フラグ
  isReimbursed?: boolean; // 立替済みフラグ
  importSource?: "paypay" | "credit-card";
  importFingerprint?: string;
  importExternalId?: string;
  importedAt?: string;
  description: string; // "内容"
  note: string; // "備考"
}
