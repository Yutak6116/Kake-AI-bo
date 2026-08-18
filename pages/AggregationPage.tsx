import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  subscribeWallets,
  subscribeTransactions,
  subscribeCategories,
  deleteTransaction,
  updateTransaction,
} from "../services/db";
import { Wallet, Transaction, Category } from "../types";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";
import TransactionModal from "../components/TransactionModal";
import {
  formatDateLocal,
  getUpcomingCardPayments,
} from "../utils/cardPayments";

type AggView = "balance" | "wallet" | "expense" | "income";

const getTransactionCreatedAtTime = (tx: Transaction) =>
  tx.createdAt ? new Date(tx.createdAt).getTime() : 0;

const parseDateLocal = (dateStr: string) => {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const EditIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-4 h-4"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
    />
  </svg>
);

const TrashIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-4 h-4"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
    />
  </svg>
);

const AggregationPage: React.FC = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<AggView>("balance");
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  const getInitialDates = () => {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return {
      firstDay: formatDateLocal(first),
      lastDay: formatDateLocal(last),
    };
  };

  const { firstDay, lastDay } = getInitialDates();
  const todayStr = formatDateLocal(new Date());

  const [startDate, setStartDate] = useState(firstDay);
  const [endDate, setEndDate] = useState(lastDay);
  const [selectedBalanceDate, setSelectedBalanceDate] = useState(todayStr);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [selectedWalletId, setSelectedWalletId] = useState<string>("");
  const [searchText, setSearchText] = useState("");
  const [reimbursementFilter, setReimbursementFilter] = useState<string>(""); // "": all, "pending": 立替申請(未立替済み), "done": 立替済み, "no": 立替以外

  useEffect(() => {
    const unsubscribeWallets = subscribeWallets(setWallets);
    const unsubscribeTransactions = subscribeTransactions(setTransactions);
    const unsubscribeCategories = subscribeCategories(setCategories);

    return () => {
      unsubscribeWallets();
      unsubscribeTransactions();
      unsubscribeCategories();
    };
  }, []);

  useEffect(() => {
    if (view === "expense") {
      const cat = categories.find((c) => c.id === selectedCategoryId);
      if (cat && cat.type !== "expense") setSelectedCategoryId("");
    } else if (view === "income") {
      const cat = categories.find((c) => c.id === selectedCategoryId);
      if (cat && cat.type !== "income") setSelectedCategoryId("");
    }
  }, [view, categories, selectedCategoryId]);

  const handleUpdateTx = async (payload: any) => {
    if (!editingTx) return;
    try {
      await updateTransaction(editingTx.id, payload);
      setEditingTx(null);
      alert("更新しました");
    } catch (e) {
      console.error(e);
      alert("更新に失敗しました");
    }
  };

  const handleDeleteTx = async (id: string) => {
    if (window.confirm("この履歴を削除しますか？")) {
      try {
        await deleteTransaction(id);
      } catch (e) {
        console.error(e);
        alert("削除に失敗しました");
      }
    }
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const dateInRange =
        (!startDate || tx.date >= startDate) &&
        (!endDate || tx.date <= endDate);
      const categoryMatches =
        !selectedCategoryId || tx.categoryId === selectedCategoryId;
      const normalizedSearchText = searchText.trim().toLowerCase();
      const searchMatches =
        !normalizedSearchText ||
        tx.description.toLowerCase().includes(normalizedSearchText) ||
        tx.note.toLowerCase().includes(normalizedSearchText);
      const walletMatches =
        !selectedWalletId ||
        (view === "expense" && tx.fromWalletId === selectedWalletId) ||
        (view === "income" && tx.toWalletId === selectedWalletId);

      if (view === "expense" || view === "income") {
        const reimbursementMatches =
          !reimbursementFilter ||
          (reimbursementFilter === "pending" && tx.isReimbursement && !tx.isReimbursed) ||
          (reimbursementFilter === "done" && tx.isReimbursement && tx.isReimbursed) ||
          (reimbursementFilter === "no" && !tx.isReimbursement);
        return (
          tx.type === view &&
          dateInRange &&
          categoryMatches &&
          searchMatches &&
          walletMatches &&
          reimbursementMatches
        );
      }
      return dateInRange && categoryMatches && searchMatches;
    });
  }, [
    transactions,
    view,
    startDate,
    endDate,
    selectedCategoryId,
    searchText,
    selectedWalletId,
    reimbursementFilter,
  ]);

  const balancePageWalletBalances = wallets.map((w) => {
    let balance = Number(w.initialBalance);
    transactions.forEach((tx) => {
      if (tx.date > selectedBalanceDate) return;
      if (tx.fromWalletId === w.id) balance -= tx.amount;
      if (tx.toWalletId === w.id) balance += tx.amount;
    });
    return { ...w, currentBalance: balance };
  });

  const latestWalletBalances = wallets.map((w) => {
    let balance = Number(w.initialBalance);
    transactions.forEach((tx) => {
      if (tx.fromWalletId === w.id) balance -= tx.amount;
      if (tx.toWalletId === w.id) balance += tx.amount;
    });
    return { ...w, currentBalance: balance };
  });

  const balancePageAssetWallets = balancePageWalletBalances.filter(
    (w) => w.type !== "card",
  );

  const latestAssetWallets = latestWalletBalances.filter((w) => w.type !== "card");

  const balancePageCardWallets = balancePageWalletBalances.filter(
    (w) => w.type === "card",
  );

  const latestCardWallets = latestWalletBalances.filter((w) => w.type === "card");

  const totalAssetBalance = balancePageAssetWallets.reduce(
    (acc, curr) => acc + curr.currentBalance,
    0,
  );

  const getCardPayments = (
    cards: typeof latestCardWallets,
    referenceDate: Date,
  ) => {
    return cards.map((card) => {
      const paymentDay = card.paymentDay || 26;
      // 引き落とし口座名を取得
      const withdrawalAccount = wallets.find(
        (w) => w.id === card.withdrawalWalletId,
      );

      return {
        id: card.id,
        name: card.name,
        color: card.color,
        paymentDay,
        withdrawalAccountName: withdrawalAccount?.name || "未設定",
        payments: getUpcomingCardPayments(
          card,
          transactions,
          referenceDate,
        ),
      };
    });
  };

  const balancePageCardPayments = getCardPayments(
    balancePageCardWallets,
    parseDateLocal(selectedBalanceDate),
  );
  const walletPageCardPayments = getCardPayments(latestCardWallets, new Date());

  const getCategoryData = (type: "expense" | "income") => {
    const data: Record<string, { value: number; color: string }> = {};
    filteredTransactions
      .filter((tx) => tx.type === type)
      .forEach((tx) => {
        const cat = categories.find((c) => c.id === tx.categoryId);
        const name = cat ? cat.name : "その他";
        const color = cat?.color || "#cbd5e1";
        if (!data[name]) data[name] = { value: 0, color };
        data[name].value += tx.amount;
      });

    return Object.entries(data)
      .map(([name, { value, color }]) => ({ name, value, color }))
      .sort((a, b) => b.value - a.value);
  };

  const DEFAULT_COLORS = [
    "#8884d8",
    "#82ca9d",
    "#ffc658",
    "#ff8042",
    "#0088fe",
    "#00c49f",
  ];

  const renderTransactionTable = (type: "expense" | "income" | "all") => {
    const txList =
      type === "all"
        ? transactions.filter((tx) => {
            const dateInRange =
              (!startDate || tx.date >= startDate) &&
              (!endDate || tx.date <= endDate);
            const categoryMatches =
              !selectedCategoryId || tx.categoryId === selectedCategoryId;
            const normalizedSearchText = searchText.trim().toLowerCase();
            const searchMatches =
              !normalizedSearchText ||
              tx.description.toLowerCase().includes(normalizedSearchText) ||
              tx.note.toLowerCase().includes(normalizedSearchText);
            return dateInRange && categoryMatches && searchMatches;
          })
        : filteredTransactions;

    const sortedTxs = [...txList].sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return getTransactionCreatedAtTime(b) - getTransactionCreatedAtTime(a);
    });

    const getTitle = () => {
      if (type === "expense") return "支出履歴";
      if (type === "income") return "収入履歴";
      return "全取引履歴";
    };

    return (
      <div className="mt-12 space-y-4">
        <h4 className="font-bold border-b border-gray-200 pb-2 flex justify-between items-center">
          <span>{getTitle()}</span>
          <span className="text-xs font-normal text-gray-400">
            {sortedTxs.length} 件
          </span>
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-2 py-2 text-left text-gray-500 font-medium">
                  日付
                </th>
                <th className="px-2 py-2 text-left text-gray-500 font-medium">
                  内容・詳細
                </th>
                <th className="px-2 py-2 text-right text-gray-500 font-medium">
                  金額
                </th>
                <th className="px-2 py-2 text-center text-gray-500 font-medium w-16">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedTxs.map((tx) => {
                const cat = categories.find((c) => c.id === tx.categoryId);
                const fromW = wallets.find((w) => w.id === tx.fromWalletId);
                const toW = wallets.find((w) => w.id === tx.toWalletId);
                return (
                  <tr
                    key={tx.id}
                    className="hover:bg-gray-50 transition-colors group"
                  >
                    <td className="px-2 py-4 whitespace-nowrap">
                      <div className="text-gray-500 text-[10px]">{tx.date}</div>
                      <span
                        className={`inline-block px-1 py-0.5 rounded text-[8px] font-bold mt-1 ${
                          tx.type === "income"
                            ? "bg-green-100 text-green-800"
                            : tx.type === "expense"
                              ? "bg-red-100 text-red-800"
                              : tx.type === "transfer"
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {tx.type === "income"
                          ? "収入"
                          : tx.type === "expense"
                            ? "支出"
                            : tx.type === "transfer"
                              ? "移動"
                              : "引落"}
                      </span>
                    </td>
                    <td className="px-2 py-4">
                      <div className="flex items-center space-x-1 mb-1">
                        {tx.type !== "transfer" && cat?.color && (
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: cat.color }}
                          />
                        )}
                        <div className="text-[10px] text-gray-400 font-bold uppercase truncate max-w-[120px]">
                          {tx.type === "transfer"
                            ? "資金移動"
                            : tx.type === "withdrawal"
                              ? "口座引落"
                            : cat?.name || "未設定"}
                        </div>
                      </div>
                      <div className="font-medium text-gray-800 mb-1">
                        {tx.description || "内容なし"}
                      </div>
                      <div className="text-[9px] text-gray-500 bg-gray-100 inline-block px-1 rounded">
                        {tx.type === "transfer" ? (
                          <span className="flex items-center">
                            {fromW?.name || "?"} <span className="mx-1">→</span>{" "}
                            {toW?.name || "?"}
                          </span>
                        ) : tx.type === "withdrawal" ? (
                          <span className="flex items-center">
                            {fromW?.name || "?"} <span className="mx-1">→</span>{" "}
                            {toW?.name || "?"}
                          </span>
                        ) : tx.type === "expense" ? (
                          <span>支払財布: {fromW?.name || "?"}</span>
                        ) : (
                          <span>入金財布: {toW?.name || "?"}</span>
                        )}
                      </div>
                    </td>
                    <td
                      className={`px-2 py-4 text-right font-bold font-mono whitespace-nowrap ${
                        tx.type === "expense"
                          ? "text-red-600"
                          : tx.type === "income"
                            ? "text-green-600"
                            : tx.type === "withdrawal"
                              ? "text-red-600"
                              : "text-gray-600"
                      }`}
                    >
                      {tx.type === "expense"
                        ? "-"
                        : tx.type === "income"
                          ? "+"
                          : tx.type === "withdrawal"
                            ? "-"
                          : ""}
                      ¥{tx.amount.toLocaleString()}
                    </td>
                    <td className="px-2 py-4 text-center">
                      <div className="flex justify-center space-x-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        {tx.type !== "withdrawal" && (
                          <button
                            onClick={() => setEditingTx(tx)}
                            className="p-1 hover:bg-blue-100 rounded text-blue-600"
                            title="編集"
                            aria-label={`${tx.description || "取引"}を編集`}
                          >
                            <EditIcon />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteTx(tx.id)}
                          className="p-1 hover:bg-red-100 rounded text-red-600"
                          title="削除"
                          aria-label={`${tx.description || "取引"}を削除`}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedTxs.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-2 py-8 text-center text-gray-400 italic"
                  >
                    該当する取引履歴はありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const setThisMonth = () => {
    const { firstDay, lastDay } = getInitialDates();
    setStartDate(firstDay);
    setEndDate(lastDay);
  };

  const setLastMonth = () => {
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last = new Date(today.getFullYear(), today.getMonth(), 0);
    setStartDate(formatDateLocal(first));
    setEndDate(formatDateLocal(last));
  };

  const setAllTime = () => {
    setStartDate("");
    setEndDate("");
  };

  const renderFilter = () => {
    const filterCategories =
      view === "expense"
        ? categories.filter((c) => c.type === "expense")
        : view === "income"
          ? categories.filter((c) => c.type === "income")
          : categories;

    return (
      <div className="sketch-border p-4 bg-gray-50 mb-8 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">
            絞り込み
          </span>
          <div className="flex space-x-2">
            <button
              onClick={setLastMonth}
              className="text-[10px] bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-100 transition"
            >
              先月
            </button>
            <button
              onClick={setThisMonth}
              className="text-[10px] bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-100 transition"
            >
              今月
            </button>
            <button
              onClick={setAllTime}
              className="text-[10px] bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-100 transition"
            >
              全期間
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <label className="text-[10px] font-bold text-gray-400 min-w-[40px]">
              期間
            </label>
            <div className="flex flex-1 items-center space-x-1">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-500"
              />
              <span className="text-gray-400 text-xs">〜</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {(view === "expense" || view === "income") && (
            <div className="flex items-center space-x-2">
              <label className="text-[10px] font-bold text-gray-400 min-w-[40px]">
                カテゴリ
              </label>
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-500 bg-white"
              >
                <option value="">すべてのカテゴリー</option>
                {filterCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center space-x-2">
            <label className="text-[10px] font-bold text-gray-400 min-w-[40px]">
              検索
            </label>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="内容・備考を含む"
              className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-500"
            />
          </div>

          {(view === "expense" || view === "income") && (
            <div className="flex items-center space-x-2">
              <label className="text-[10px] font-bold text-gray-400 min-w-[40px]">
                財布
              </label>
              <select
                value={selectedWalletId}
                onChange={(e) => setSelectedWalletId(e.target.value)}
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-500 bg-white"
              >
                <option value="">すべての財布</option>
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {view === "expense" && (
            <div className="flex items-center space-x-2">
              <label className="text-[10px] font-bold text-gray-400 min-w-[40px]">
                立替
              </label>
              <select
                value={reimbursementFilter}
                onChange={(e) => setReimbursementFilter(e.target.value)}
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-500 bg-white"
              >
                <option value="">すべて</option>
                <option value="pending">立替申請（未立替済み）</option>
                <option value="done">立替済み</option>
                <option value="no">立替以外</option>
              </select>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderTabs = () => (
    <div className="flex justify-center space-x-2 mb-8">
      {(["balance", "wallet", "expense", "income"] as AggView[]).map((tab) => (
        <button
          key={tab}
          onClick={() => setView(tab)}
          className={`px-4 py-1 sketch-border transition ${
            view === tab ? "bg-gray-300" : "bg-white hover:bg-gray-50"
          }`}
        >
          {tab === "balance"
            ? "残高"
            : tab === "wallet"
              ? "財布"
              : tab === "expense"
                ? "支出"
                : "収入"}
        </button>
      ))}
    </div>
  );

  return (
    <div className="w-full">
      {renderTabs()}

      {view === "balance" && (
        <div className="space-y-6">
          <div className="sketch-border p-6 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
              <div>
                <span className="text-xl text-gray-500 font-medium">
                  総資産残高
                </span>
                <p className="text-[10px] mt-1 text-gray-400 uppercase">
                  指定日終了時点
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase whitespace-nowrap">
                  基準日
                </label>
                <input
                  type="date"
                  value={selectedBalanceDate}
                  onChange={(e) => setSelectedBalanceDate(e.target.value)}
                  className="text-xs border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-between items-center pt-4">
              <span className="text-sm text-gray-500 font-medium">
                {selectedBalanceDate}
              </span>
              <span className="text-3xl font-bold text-green-700">
                ¥{totalAssetBalance.toLocaleString()}
              </span>
            </div>
            <div className="space-y-3 pt-4">
              {balancePageAssetWallets.map((w) => (
                <div
                  key={w.id}
                  className="flex justify-between items-center group"
                >
                  <div className="flex items-center space-x-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: w.color || "#333" }}
                    />
                    <span className="text-gray-600">
                      {w.name}
                      <span className="ml-2 text-[9px] text-gray-400 uppercase">
                        ({w.type === "bank" ? "口座" : "財布"})
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center space-x-4">
                    <span className="font-medium">
                      ¥{w.currentBalance.toLocaleString()}
                    </span>
                    <button
                      onClick={() => navigate(`/wallet/${w.id}`)}
                      className="text-blue-500 text-xs opacity-0 group-hover:opacity-100 underline transition"
                    >
                      詳細
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="sketch-border p-6 bg-white shadow-sm border-red-200">
            <h3 className="text-lg font-bold mb-4 flex items-center">
              <span className="mr-2">💳</span> クレジットカード支払い予定
            </h3>
            <div className="space-y-6">
              {balancePageCardPayments.map((card) => (
                <div
                  key={card.id}
                  className="bg-gray-50 rounded-lg p-4 border border-gray-100"
                >
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center space-x-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: card.color || "#333" }}
                      />
                      <div className="flex flex-col">
                        <span className="font-bold text-gray-700">
                          {card.name}
                        </span>
                        <span className="text-[9px] text-blue-500 font-bold uppercase">
                          引落先: {card.withdrawalAccountName}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] bg-gray-200 px-2 py-0.5 rounded text-gray-600">
                      毎月 {card.paymentDay}日払
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {card.payments.map((p, idx) => (
                      <div
                        key={idx}
                        className={`${
                          idx === 0 ? "border-r border-gray-200 pr-2" : "pl-2"
                        }`}
                      >
                        <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">
                          {p.label}
                        </p>
                        <p
                          className={`text-lg font-mono font-bold ${
                            idx === 0 ? "text-red-600" : "text-gray-500"
                          }`}
                        >
                          ¥{p.amount.toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {balancePageCardPayments.length === 0 && (
                <p className="text-gray-400 text-sm italic text-center py-4">
                  クレジットカードが登録されていません
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {(view === "expense" || view === "income") && (
        <div className="space-y-8 animate-in fade-in duration-300">
          {renderFilter()}

          <div className="text-center">
            <h3 className="text-2xl font-bold mb-2">
              {view === "expense" ? "支出合計" : "収入合計"}: ¥
              {getCategoryData(view as any)
                .reduce((a, b) => a + b.value, 0)
                .toLocaleString()}
            </h3>
          </div>

          {getCategoryData(view as any).length > 0 ? (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={getCategoryData(view as any)}
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={120}
                      paddingAngle={0}
                      dataKey="value"
                      startAngle={90}
                      endAngle={-270}
                    >
                      {getCategoryData(view as any).map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            entry.color ||
                            DEFAULT_COLORS[index % DEFAULT_COLORS.length]
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: "8px",
                        border: "2px solid #333",
                      }}
                      formatter={(value: number, name: string) => [
                        `¥${value.toLocaleString()}`,
                        name,
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-4">
                <h4 className="text-lg font-semibold border-b pb-2">内訳</h4>
                {getCategoryData(view as any).map((item, idx) => (
                  <div key={idx} className="flex items-center space-x-4">
                    <div className="flex-1">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="flex items-center space-x-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="font-medium text-gray-700">
                            {item.name}
                          </span>
                        </span>
                        <span className="font-mono font-bold">
                          ¥{item.value.toLocaleString()}
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                        <div
                          className="h-full transition-all duration-500"
                          style={{
                            width: `${
                              (item.value /
                                Math.max(
                                  1,
                                  getCategoryData(view as any).reduce(
                                    (a, b) => a + b.value,
                                    0,
                                  ),
                                )) *
                              100
                            }%`,
                            backgroundColor: item.color,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-center text-gray-400 italic py-8">
              データがありません
            </p>
          )}

          {renderTransactionTable(view as "expense" | "income")}
        </div>
      )}

      {view === "wallet" && (
        <div className="space-y-8 animate-in fade-in duration-300">
          <div>
            <h3 className="text-sm font-bold text-gray-400 mb-4 uppercase tracking-widest">
              資産 (口座・現金など)
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {latestAssetWallets.map((w) => (
                <div
                  key={w.id}
                  onClick={() => navigate(`/wallet/${w.id}`)}
                  className="sketch-border p-4 bg-white cursor-pointer hover:shadow-md transition-all active:scale-95"
                  style={{ borderLeft: `6px solid ${w.color || "#333"}` }}
                >
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-gray-700 truncate">
                      {w.name}
                    </h4>
                  </div>
                  <p className="text-xl mt-2 font-mono text-green-700">
                    ¥{w.currentBalance.toLocaleString()}
                  </p>
                </div>
              ))}
              {latestAssetWallets.length === 0 && (
                <p className="col-span-2 text-gray-400 text-sm text-center py-4">
                  資産口座がありません
                </p>
              )}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold text-gray-400 mb-4 uppercase tracking-widest">
              クレジットカード
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {latestCardWallets.map((w) => {
                const paymentInfo = walletPageCardPayments.find(
                  (card) => card.id === w.id,
                );
                const currentPayment = paymentInfo?.payments[0];
                const nextPayment = paymentInfo?.payments[1];

                return (
                  <div
                    key={w.id}
                    onClick={() => navigate(`/wallet/${w.id}`)}
                    className="sketch-border p-4 bg-white cursor-pointer hover:shadow-md transition-all active:scale-95 border-red-200"
                    style={{ borderLeft: `6px solid ${w.color || "#ef4444"}` }}
                  >
                    <h4 className="font-bold text-gray-700 truncate">{w.name}</h4>
                    <div className="mt-3 space-y-3">
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold uppercase">
                          今月支払い
                        </p>
                        <p className="text-lg mt-1 font-mono text-red-600">
                          ¥{(currentPayment?.amount || 0).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 font-bold uppercase">
                          来月支払い
                        </p>
                        <p className="text-base mt-1 font-mono text-gray-600">
                          ¥{(nextPayment?.amount || 0).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
              {latestCardWallets.length === 0 && (
                <p className="col-span-2 text-gray-400 text-sm text-center py-4">
                  クレジットカードがありません
                </p>
              )}
            </div>
          </div>

          <div className="pt-4">
            {renderFilter()}
            {renderTransactionTable("all")}
          </div>
        </div>
      )}

      {editingTx && editingTx.type !== "withdrawal" && (
        <TransactionModal
          type={editingTx.type}
          transaction={editingTx}
          wallets={wallets}
          categories={categories}
          onClose={() => setEditingTx(null)}
          onSave={handleUpdateTx}
        />
      )}
    </div>
  );
};

export default AggregationPage;
