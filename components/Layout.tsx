import React, { useEffect, useRef, useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import {
  addTransaction,
  deleteTransaction,
  subscribeTransactions,
  subscribeWallets,
  updateTransaction,
} from "../services/db";
import { Transaction, Wallet } from "../types";
import {
  formatDateLocal,
  formatMonthKey,
  formatMonthLabel,
  getActualPaymentDateForMonth,
  getCardPaymentAmountForMonth,
  getCardPaymentMonth,
} from "../utils/cardPayments";

const Layout: React.FC = () => {
  const navigate = useNavigate();
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const processingKeysRef = useRef<Set<string>>(new Set());

  const handleLogout = async () => {
    try {
      await auth.signOut();
      navigate("/");
    } catch (error) {
      console.error("Logout failed", error);
      alert("ログアウトに失敗しました");
    }
  };

  const activeStyle = "bg-gray-200 sketch-border text-black px-4 py-1";
  const inactiveStyle =
    "bg-white sketch-border text-gray-600 px-4 py-1 hover:bg-gray-100 transition";

  useEffect(() => {
    const unsubscribeWallets = subscribeWallets(setWallets);
    const unsubscribeTransactions = subscribeTransactions(setTransactions);

    return () => {
      unsubscribeWallets();
      unsubscribeTransactions();
    };
  }, []);

  useEffect(() => {
    const reconcile = async () => {
      const cardWallets = wallets.filter((wallet) => wallet.type === "card");
      if (cardWallets.length === 0) return;

      const cardWalletMap = new Map<string, Wallet>(
        cardWallets.map((wallet) => [wallet.id, wallet]),
      );

      const migrationTargets = transactions.filter((tx) => {
        if (tx.paymentMonth) return false;
        if (!tx.fromWalletId) return false;
        return cardWalletMap.has(tx.fromWalletId);
      });

      const legacyWithdrawalTargets = transactions.filter((tx) => {
        if (tx.type !== "withdrawal") return false;
        if (tx.paymentMonth) return false;
        if (!tx.toWalletId) return false;
        return cardWalletMap.has(tx.toWalletId);
      });

      await Promise.all(
        migrationTargets.map(async (tx) => {
          const key = `migrate:${tx.id}`;
          if (processingKeysRef.current.has(key)) return;
          const card = cardWalletMap.get(tx.fromWalletId!);
          if (!card) return;

          processingKeysRef.current.add(key);
          try {
            await updateTransaction(tx.id, {
              paymentMonth: getCardPaymentMonth(card, tx),
            });
          } finally {
            processingKeysRef.current.delete(key);
          }
        }),
      );

      await Promise.all(
        legacyWithdrawalTargets.map(async (tx) => {
          const key = `migrate-withdrawal:${tx.id}`;
          if (processingKeysRef.current.has(key)) return;

          processingKeysRef.current.add(key);
          try {
            await updateTransaction(tx.id, {
              paymentMonth: formatMonthKey(tx.actualPaymentDate || tx.date),
            });
          } finally {
            processingKeysRef.current.delete(key);
          }
        }),
      );

      const today = formatDateLocal(new Date());

      await Promise.all(
        cardWallets.map(async (card) => {
          if (!card.withdrawalWalletId) return;

          const cardUsageTransactions = transactions.filter(
            (tx) =>
              (tx.fromWalletId === card.id && tx.type !== "withdrawal") ||
              (tx.type === "income" &&
                tx.toWalletId === card.id &&
                Boolean(tx.paymentMonth)),
          );
          const existingWithdrawals = transactions.filter(
            (tx) => tx.type === "withdrawal" && tx.toWalletId === card.id,
          );

          const paymentMonths = [
            ...new Set<string>(
              [
                ...cardUsageTransactions.map((tx) => getCardPaymentMonth(card, tx)),
                ...existingWithdrawals.map(
                  (tx) =>
                    tx.paymentMonth ||
                    formatMonthKey(tx.actualPaymentDate || tx.date),
                ),
              ],
            ),
          ];

          await Promise.all(
            paymentMonths.map(async (paymentMonth) => {
              const actualPaymentDate = getActualPaymentDateForMonth(card, paymentMonth);
              const amount = getCardPaymentAmountForMonth(
                card,
                transactions,
                paymentMonth,
              );
              const relatedWithdrawals = existingWithdrawals
                .filter(
                  (tx) =>
                    (tx.paymentMonth ||
                      formatMonthKey(tx.actualPaymentDate || tx.date)) ===
                    paymentMonth,
                )
                .sort((a, b) => {
                  const createdA = a.createdAt || "";
                  const createdB = b.createdAt || "";
                  if (createdA !== createdB) {
                    return createdA.localeCompare(createdB);
                  }
                  return a.id.localeCompare(b.id);
                });
              const primaryWithdrawal = relatedWithdrawals[0];

              if (amount <= 0) {
                if (relatedWithdrawals.length === 0) return;

                const cleanupKey = `withdrawal-cleanup:${card.id}:${paymentMonth}`;
                if (processingKeysRef.current.has(cleanupKey)) return;

                processingKeysRef.current.add(cleanupKey);
                try {
                  await Promise.all(
                    relatedWithdrawals.map((tx) => deleteTransaction(tx.id)),
                  );
                } finally {
                  processingKeysRef.current.delete(cleanupKey);
                }
                return;
              }

              const payload: Omit<Transaction, "id" | "userId"> = {
                date: actualPaymentDate,
                actualPaymentDate,
                paymentMonth,
                type: "withdrawal" as const,
                amount,
                fromWalletId: card.withdrawalWalletId,
                toWalletId: card.id,
                description: `${formatMonthLabel(paymentMonth)} ${card.name} 引落`,
                note: "",
                isAutoCreated: true,
              };

              const key = `withdrawal:${card.id}:${paymentMonth}`;
              if (processingKeysRef.current.has(key)) return;

              processingKeysRef.current.add(key);
              try {
                if (primaryWithdrawal) {
                  const needsUpdate =
                    primaryWithdrawal.date !== payload.date ||
                    primaryWithdrawal.actualPaymentDate !==
                      payload.actualPaymentDate ||
                    primaryWithdrawal.amount !== payload.amount ||
                    primaryWithdrawal.fromWalletId !== payload.fromWalletId ||
                    primaryWithdrawal.description !== payload.description ||
                    primaryWithdrawal.paymentMonth !== payload.paymentMonth;

                  if (needsUpdate) {
                    await updateTransaction(primaryWithdrawal.id, payload);
                  }

                  if (relatedWithdrawals.length > 1) {
                    await Promise.all(
                      relatedWithdrawals
                        .slice(1)
                        .map((tx) => deleteTransaction(tx.id)),
                    );
                  }
                  return;
                }

                if (actualPaymentDate > today) return;

                await addTransaction(payload);
              } finally {
                processingKeysRef.current.delete(key);
              }
            }),
          );
        }),
      );
    };

    void reconcile();
    const intervalId = window.setInterval(() => {
      void reconcile();
    }, 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, [wallets, transactions]);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center py-8 px-4">
      <div className="w-full max-w-2xl bg-white shadow-lg rounded-xl overflow-hidden min-h-[600px] flex flex-col">
        {/* Navigation Tabs */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex justify-center space-x-4 mb-4">
            <NavLink
              to="/registration"
              className={({ isActive }) =>
                isActive ? activeStyle : inactiveStyle
              }
            >
              収支登録
            </NavLink>
            <NavLink
              to="/aggregation"
              className={({ isActive }) =>
                isActive ? activeStyle : inactiveStyle
              }
            >
              集計
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                isActive ? activeStyle : inactiveStyle
              }
            >
              設定
            </NavLink>
            <button
              onClick={handleLogout}
              className={`${inactiveStyle} text-red-500 hover:bg-red-50 hover:text-red-600`}
            >
              ログアウト
            </button>
          </div>
          <hr className="border-gray-300" />
        </div>

        {/* Page Content */}
        <div className="flex-1 p-6">
          <Outlet />
        </div>

        {/* Footer info */}
        <div className="p-4 bg-gray-50 flex justify-between items-center text-xs text-gray-400">
          <span>Kake-AI-bo v1.0</span>
          <span>手書き風家計簿</span>
        </div>
      </div>
    </div>
  );
};

export default Layout;
