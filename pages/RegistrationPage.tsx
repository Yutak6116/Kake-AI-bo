import React, { useState, useEffect } from "react";
import {
  subscribeWallets,
  subscribeCategories,
  subscribeTransactions,
  addTransaction,
} from "../services/db";
import { Wallet, Category, Transaction, TransactionType } from "../types";
import TransactionModal from "../components/TransactionModal";
import CsvImportModal from "../components/CsvImportModal";

const RegistrationPage: React.FC = () => {
  const [modalType, setModalType] = useState<TransactionType | null>(null);
  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    const unsubscribeWallets = subscribeWallets(setWallets);
    const unsubscribeCategories = subscribeCategories(setCategories);
    const unsubscribeTransactions = subscribeTransactions(setTransactions);

    return () => {
      unsubscribeWallets();
      unsubscribeCategories();
      unsubscribeTransactions();
    };
  }, []);

  const handleSave = async (payload: any) => {
    try {
      await addTransaction(payload);
      setModalType(null);
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました。");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-10 w-full max-w-sm mx-auto">
      <button
        onClick={() => setModalType("expense")}
        className="w-full h-24 bg-indigo-100 hover:bg-indigo-200 sketch-border flex items-center justify-center text-2xl font-bold text-indigo-800 transition-colors shadow-sm active:translate-y-0.5"
      >
        支出
      </button>
      <button
        onClick={() => setModalType("income")}
        className="w-full h-24 bg-green-100 hover:bg-green-200 sketch-border flex items-center justify-center text-2xl font-bold text-green-800 transition-colors shadow-sm active:translate-y-0.5"
      >
        収入
      </button>
      <button
        onClick={() => setModalType("transfer")}
        className="w-full h-24 bg-yellow-100 hover:bg-yellow-200 sketch-border flex items-center justify-center text-2xl font-bold text-yellow-800 transition-colors shadow-sm active:translate-y-0.5"
      >
        移動
      </button>
      <button
        onClick={() => setIsCsvImportOpen(true)}
        className="w-full h-24 bg-purple-100 hover:bg-purple-200 sketch-border flex flex-col items-center justify-center text-purple-800 transition-colors shadow-sm active:translate-y-0.5"
      >
        <span className="text-2xl font-bold">CSV取り込み</span>
        <span className="mt-1 text-xs font-medium">
          PayPay・クレジットカード
        </span>
      </button>

      {modalType && (
        <TransactionModal
          type={modalType}
          wallets={wallets}
          categories={categories}
          onClose={() => setModalType(null)}
          onSave={handleSave}
        />
      )}

      {isCsvImportOpen && (
        <CsvImportModal
          wallets={wallets}
          categories={categories}
          existingTransactions={transactions}
          onClose={() => setIsCsvImportOpen(false)}
          onImported={(count, skippedCount) => {
            setIsCsvImportOpen(false);
            alert(
              skippedCount > 0
                ? `${count}件の明細を登録しました。登録済みの${skippedCount}件はスキップしました。`
                : `${count}件の明細を登録しました。`,
            );
          }}
        />
      )}
    </div>
  );
};

export default RegistrationPage;
