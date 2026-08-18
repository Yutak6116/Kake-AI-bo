import React, { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import {
  subscribeWallets,
  subscribeTransactions,
  subscribeCategories,
  deleteTransaction,
  updateTransaction,
  updateWallet,
} from "../services/db";
import { Wallet, Transaction, Category } from "../types";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import TransactionModal from "../components/TransactionModal";
import {
  formatDateLocal,
  getActualPaymentDateForMonth,
  getCardPaymentMonth,
  formatMonthKey,
  formatMonthLabel,
  getCardPaymentAmountForMonth,
  getCardPaymentDate,
  getScheduledPaymentDateForMonth,
  getUpcomingCardPaymentDates,
} from "../utils/cardPayments";

type WalletChartPoint = {
  date: string;
  displayDate: string;
  balance: number;
};

const getTransactionCreatedAtTime = (tx: Transaction) =>
  tx.createdAt ? new Date(tx.createdAt).getTime() : 0;

const getCardUsageDelta = (cardId: string, tx: Transaction) =>
  tx.type === "income" && tx.toWalletId === cardId && tx.paymentMonth
    ? -tx.amount
    : tx.amount;

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

// type PeriodOption = { label: string; days: number };
// const PERIODS: PeriodOption[] = [
//   { label: "1週間", days: 7 },
//   { label: "1ヶ月", days: 30 },
//   { label: "3ヶ月", days: 90 },
//   { label: "半年", days: 180 },
//   { label: "1年", days: 365 },
// ];

const WalletDetailsPage: React.FC = () => {
  const { walletId } = useParams<{ walletId: string }>();
  const [allWallets, setAllWallets] = useState<Wallet[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
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
  const currentMonth = formatMonthKey(new Date());

  const [startDate, setStartDate] = useState(firstDay);
  const [endDate, setEndDate] = useState(lastDay);
  const [selectedPaymentMonth, setSelectedPaymentMonth] =
    useState(currentMonth);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [searchText, setSearchText] = useState("");
  const [actualPaymentDateInput, setActualPaymentDateInput] = useState("");

  useEffect(() => {
    const unsubscribeWallets = subscribeWallets((wallets) => {
      setAllWallets(wallets);
      setWallet(wallets.find((x) => x.id === walletId) || null);
    });
    const unsubscribeTransactions = subscribeTransactions((allTransactions) => {
      setTransactions(
        allTransactions.filter(
          (tx) => tx.fromWalletId === walletId || tx.toWalletId === walletId,
        ),
      );
    });
    const unsubscribeCategories = subscribeCategories(setCategories);

    return () => {
      unsubscribeWallets();
      unsubscribeTransactions();
      unsubscribeCategories();
    };
  }, [walletId]);

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

  useEffect(() => {
    if (!wallet || wallet.type !== "card") return;
    setActualPaymentDateInput(
      getActualPaymentDateForMonth(wallet, selectedPaymentMonth),
    );
  }, [wallet, selectedPaymentMonth]);

  const handleSaveActualPaymentDate = async () => {
    if (!wallet || wallet.type !== "card" || !actualPaymentDateInput) return;
    try {
      await updateWallet(wallet.id, {
        actualPaymentDates: {
          ...(wallet.actualPaymentDates || {}),
          [selectedPaymentMonth]: actualPaymentDateInput,
        },
      });
      alert("実引落日を更新しました");
    } catch (e) {
      console.error(e);
      alert("実引落日の更新に失敗しました");
    }
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const categoryMatches =
        !selectedCategoryId || tx.categoryId === selectedCategoryId;
      const normalizedSearchText = searchText.trim().toLowerCase();
      const searchMatches =
        !normalizedSearchText ||
        tx.description.toLowerCase().includes(normalizedSearchText) ||
        tx.note.toLowerCase().includes(normalizedSearchText);
      if (!categoryMatches) return false;
      if (!searchMatches) return false;

      if (wallet?.type === "card") {
        const isRefund =
          tx.type === "income" &&
          tx.toWalletId === wallet.id &&
          Boolean(tx.paymentMonth);
        if (tx.fromWalletId !== wallet.id && !isRefund) return false;
        const paymentMonth = isRefund
          ? tx.paymentMonth
          : getCardPaymentMonth(wallet, tx);
        return paymentMonth === selectedPaymentMonth;
      }

      const dateInRange =
        (!startDate || tx.date >= startDate) &&
        (!endDate || tx.date <= endDate);
      return dateInRange;
    });
  }, [
    transactions,
    startDate,
    endDate,
    selectedCategoryId,
    searchText,
    wallet,
    selectedPaymentMonth,
  ]);

  const sortedFilteredTransactions = useMemo<Transaction[]>(() => {
    return [...filteredTransactions].sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return getTransactionCreatedAtTime(b) - getTransactionCreatedAtTime(a);
    });
  }, [filteredTransactions]);

  const transactionMetrics = useMemo<Record<string, number>>(() => {
    if (!wallet) return {};

    if (wallet.type === "card") {
      const sortedTransactions = filteredTransactions
        .map((tx, index) => ({ tx, index }))
        .sort((a, b) => {
          const dateDiff =
            new Date(a.tx.date).getTime() - new Date(b.tx.date).getTime();
          if (dateDiff !== 0) return dateDiff;
          const createdAtDiff =
            getTransactionCreatedAtTime(a.tx) - getTransactionCreatedAtTime(b.tx);
          if (createdAtDiff !== 0) return createdAtDiff;
          return a.index - b.index;
        });

      let runningUsage = 0;

      return sortedTransactions.reduce<Record<string, number>>((acc, { tx }) => {
        runningUsage += getCardUsageDelta(wallet.id, tx);
        acc[tx.id] = runningUsage;
        return acc;
      }, {});
    }

    const sortedTransactions = transactions
      .map((tx, index) => ({ tx, index }))
      .sort((a, b) => {
        const dateDiff =
          new Date(a.tx.date).getTime() - new Date(b.tx.date).getTime();
        if (dateDiff !== 0) return dateDiff;
        const createdAtDiff =
          getTransactionCreatedAtTime(a.tx) - getTransactionCreatedAtTime(b.tx);
        if (createdAtDiff !== 0) return createdAtDiff;
        return a.index - b.index;
      });

    let runningBalance = Number(wallet.initialBalance);

    return sortedTransactions.reduce<Record<string, number>>((acc, { tx }) => {
      if (tx.fromWalletId === wallet.id) runningBalance -= tx.amount;
      if (tx.toWalletId === wallet.id) runningBalance += tx.amount;
      acc[tx.id] = runningBalance;
      return acc;
    }, {});
  }, [wallet, transactions, filteredTransactions]);

  const { chartData, currentAmount } = useMemo(() => {
    if (!wallet) return { chartData: [], currentAmount: 0 };

    if (wallet.type === "card") {
      const paymentAmount = getCardPaymentAmountForMonth(
        wallet,
        transactions,
        selectedPaymentMonth,
      );

      if (filteredTransactions.length === 0) {
        return { chartData: [], currentAmount: paymentAmount };
      }

      const sortedTransactions = [...filteredTransactions].sort((a, b) => {
        const dateDiff =
          new Date(a.date).getTime() - new Date(b.date).getTime();
        if (dateDiff !== 0) return dateDiff;
        return getTransactionCreatedAtTime(a) - getTransactionCreatedAtTime(b);
      });

      const start = new Date(sortedTransactions[0].date);
      const end = new Date(sortedTransactions[sortedTransactions.length - 1].date);
      const data: WalletChartPoint[] = [];
      let runningUsage = 0;
      const curr = new Date(start);
      let loops = 0;

      while (curr <= end && loops < 3660) {
        const currentDateStr = formatDateLocal(curr);

        sortedTransactions.forEach((tx) => {
          if (tx.date === currentDateStr) {
            runningUsage += getCardUsageDelta(wallet.id, tx);
          }
        });

        const daysDiff =
          (end.getTime() - start.getTime()) / (1000 * 3600 * 24);

        data.push({
          date: currentDateStr,
          displayDate:
            daysDiff > 180
              ? `${curr.getMonth() + 1}月`
              : `${curr.getMonth() + 1}/${curr.getDate()}`,
          balance: runningUsage,
        });

        curr.setDate(curr.getDate() + 1);
        loops++;
      }

      return { chartData: data, currentAmount: paymentAmount };
    }

    // Calculate total current balance (regardless of filter)
    const totalBalance = transactions.reduce((acc, tx) => {
      if (tx.fromWalletId === wallet.id) return acc - tx.amount;
      if (tx.toWalletId === wallet.id) return acc + tx.amount;
      return acc;
    }, Number(wallet.initialBalance));

    // If no date range, maybe show last 30 days? Or all time?
    // If all time (empty start/end), we need to find min/max date from transactions.
    let start = new Date();
    let end = new Date();

    if (startDate) {
      start = new Date(startDate);
    } else {
      // Default / All time start: find earliest tx or today
      if (transactions.length > 0) {
        const earliest = transactions.reduce(
          (min, tx) => (tx.date < min ? tx.date : min),
          transactions[0].date,
        );
        start = new Date(earliest);
      } else {
        start = new Date();
        start.setDate(start.getDate() - 30);
      }
    }

    if (endDate) {
      end = new Date(endDate);
    } else {
      end = new Date(); // Today
    }

    // Ensure start <= end
    if (start > end) {
      const temp = start;
      start = end;
      end = temp;
    }

    // Normalized strings
    const startStr = formatDateLocal(start);
    const endStr = formatDateLocal(end);

    // Calculate starting balance before the start date
    let balanceAtStart = Number(wallet.initialBalance);
    transactions.forEach((tx) => {
      if (tx.date < startStr) {
        if (tx.fromWalletId === wallet.id) balanceAtStart -= tx.amount;
        if (tx.toWalletId === wallet.id) balanceAtStart += tx.amount;
      }
    });

    // Build chart data day by day
    const data: WalletChartPoint[] = [];
    let runningBalance = balanceAtStart;

    // Iterate from start to end
    const curr = new Date(start);
    // Safety break to avoid infinite loop if dates are weird
    let loops = 0;
    while (curr <= end && loops < 3660) {
      // Max 10 years
      const currentDateStr = formatDateLocal(curr);

      // Add all transactions for this specific day
      // Note: Chart should probably NOT be filtered by category if it shows "Balance"?
      // Usually "Balance History" implies actual wallet balance.
      // If I filter by category "Food", showing "Balance" is weird.
      // But the user asked for "Filtering" on the "History List".
      // They might expect the chart to update too?
      // If I filter "Food", the "Balance" line would only go down?
      // That's usually "Spending History", not "Balance History".
      // Let's keep the chart showing ACTUAL balance for the period, unaffected by Category filter.
      // BUT affected by Date filter.
      transactions.forEach((tx) => {
        if (tx.date === currentDateStr) {
          if (tx.fromWalletId === wallet.id) runningBalance -= tx.amount;
          if (tx.toWalletId === wallet.id) runningBalance += tx.amount;
        }
      });

      const daysDiff = (end.getTime() - start.getTime()) / (1000 * 3600 * 24);

      data.push({
        date: currentDateStr,
        displayDate:
          daysDiff > 180
            ? `${curr.getMonth() + 1}月`
            : `${curr.getMonth() + 1}/${curr.getDate()}`,
        balance: runningBalance,
      });

      curr.setDate(curr.getDate() + 1);
      loops++;
    }

    return { chartData: data, currentAmount: totalBalance };
  }, [wallet, transactions, startDate, endDate, filteredTransactions]);

  if (!wallet)
    return (
      <div className="flex justify-center items-center h-64 text-gray-400">
        読み込み中...
      </div>
    );

  // Determine label intervals for chart to prevent crowding
  // Determine label intervals for chart to prevent crowding
  const getXAxisInterval = () => {
    // If we have data, we can estimate days
    if (chartData.length <= 7) return 0;
    if (chartData.length <= 30) return 6;
    if (chartData.length <= 90) return 14;
    if (chartData.length <= 180) return 29;
    return 60;
  };

  const isCardWallet = wallet.type === "card";
  const cardPaymentDates = isCardWallet
    ? getUpcomingCardPaymentDates(wallet)
    : null;
  const summaryLabel = isCardWallet
    ? `${formatMonthLabel(selectedPaymentMonth)} の支払予定額`
    : "現在の残高";
  const chartTitle = isCardWallet ? "使用額推移" : "残高推移";
  const chartMetricLabel = isCardWallet ? "使用額" : "残高";
  const chartCaption = isCardWallet
    ? "Daily Cumulative Usage"
    : "Daily Final Balance";
  const metricColumnLabel = isCardWallet ? "累計使用額" : "取引後残高";
  const scheduledPaymentDate =
    isCardWallet && wallet.type === "card"
      ? getScheduledPaymentDateForMonth(wallet, selectedPaymentMonth)
      : "";

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-10">
      <div className="flex items-center space-x-2 text-sm text-gray-500">
        <Link to="/aggregation" className="hover:underline">
          集計
        </Link>
        <span>&gt;</span>
        <span className="flex items-center space-x-1">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: wallet.color }}
          />
          <span>{wallet.name}</span>
        </span>
      </div>

      <div className="text-center">
        <h2 className="text-3xl font-bold tracking-tight">{wallet.name}</h2>
        <p className="text-xl mt-2 text-gray-600 font-mono">
          {summaryLabel}: ¥{currentAmount.toLocaleString()}
        </p>
      </div>

      <div className="space-y-4">
        {/* Period Selector */}
        {/* Filter UI */}
        <div className="sketch-border p-4 bg-gray-50 mb-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">
              {isCardWallet ? "支払い月で絞り込み" : "絞り込み"}
            </span>
            <div className="flex space-x-2">
              <button
                onClick={
                  isCardWallet
                    ? () =>
                        setSelectedPaymentMonth(
                          formatMonthKey(cardPaymentDates?.current || new Date()),
                        )
                    : setLastMonth
                }
                className="text-[10px] bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-100 transition"
              >
                {isCardWallet ? "今月支払い" : "先月"}
              </button>
              <button
                onClick={
                  isCardWallet
                    ? () =>
                        setSelectedPaymentMonth(
                          formatMonthKey(cardPaymentDates?.next || new Date()),
                        )
                    : setThisMonth
                }
                className="text-[10px] bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-100 transition"
              >
                {isCardWallet ? "来月支払い" : "今月"}
              </button>
              {!isCardWallet && (
                <button
                  onClick={setAllTime}
                  className="text-[10px] bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-100 transition"
                >
                  全期間
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {isCardWallet ? (
              <div className="flex items-center space-x-2">
                <label className="text-[10px] font-bold text-gray-400 min-w-[40px]">
                  支払い月
                </label>
                <input
                  type="month"
                  value={selectedPaymentMonth}
                  onChange={(e) => setSelectedPaymentMonth(e.target.value)}
                  className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-500"
                />
              </div>
            ) : (
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
            )}

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
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

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

            {isCardWallet && (
              <div className="flex items-center space-x-2">
                <label className="text-[10px] font-bold text-gray-400 min-w-[40px]">
                  実引落日
                </label>
                <div className="flex flex-1 items-center space-x-2">
                  <input
                    type="date"
                    value={actualPaymentDateInput}
                    onChange={(e) => setActualPaymentDateInput(e.target.value)}
                    className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleSaveActualPaymentDate}
                    className="text-[10px] bg-white border border-gray-300 px-2 py-1 rounded hover:bg-gray-100 transition whitespace-nowrap"
                  >
                    更新
                  </button>
                </div>
              </div>
            )}

            {isCardWallet && (
              <div className="text-[10px] text-gray-400">
                予定日: {scheduledPaymentDate}
              </div>
            )}
          </div>
        </div>

        <div className="h-80 sketch-border p-4 bg-white shadow-sm">
          <h4 className="text-sm font-bold text-gray-400 mb-4 flex justify-between items-center">
            <span>{chartTitle}</span>
            <span className="text-[10px] bg-gray-100 px-2 py-0.5 rounded text-gray-500 uppercase">
              {chartCaption}
            </span>
          </h4>
          <div className="h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#f0f0f0"
                />
                <XAxis
                  dataKey="displayDate"
                  tick={{ fontSize: 9, fill: "#9ca3af" }}
                  interval={getXAxisInterval()}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis hide domain={["auto", "auto"]} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    border: "2px solid #333",
                    fontSize: "12px",
                  }}
                  formatter={(value: number) => [
                    `¥${value.toLocaleString()}`,
                    chartMetricLabel,
                  ]}
                  labelFormatter={(label, payload) => {
                    const item = payload[0]?.payload;
                    return item ? `日付: ${item.date}` : label;
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="balance"
                  stroke={wallet.color || "#333"}
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
                  animationDuration={800}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="font-bold border-b border-gray-200 pb-2 flex justify-between items-center">
          <span>履歴一覧</span>
          <span className="text-xs font-normal text-gray-400">
            {filteredTransactions.length} 件
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
                <th className="px-2 py-2 text-right text-gray-500 font-medium">
                  {metricColumnLabel}
                </th>
                <th className="px-2 py-2 text-center text-gray-500 font-medium w-16">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedFilteredTransactions.map((tx) => {
                const isOut = tx.fromWalletId === wallet.id;
                const cat = categories.find((c) => c.id === tx.categoryId);
                const otherWalletId = isOut ? tx.toWalletId : tx.fromWalletId;
                const otherWallet = allWallets.find(
                  (w) => w.id === otherWalletId,
                );
                const paymentDate = isCardWallet
                  ? getCardPaymentDate(wallet, tx)
                  : "";
                const metricValue = transactionMetrics[tx.id];
                const hasMetricValue = metricValue !== undefined;
                return (
                  <tr
                    key={tx.id}
                    className="hover:bg-gray-50 transition-colors group"
                  >
                    <td className="px-2 py-4 whitespace-nowrap">
                      <div className="text-gray-500 text-[10px]">{tx.date}</div>
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold mt-1 ${
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
                        {isCardWallet && tx.type === "transfer" ? (
                          <span>
                            → {otherWallet?.name || "不明"} / 支払日: {paymentDate}
                          </span>
                        ) : isCardWallet ? (
                          <span>支払日: {paymentDate}</span>
                        ) : tx.type === "withdrawal" ? (
                          <span>
                            引落先: {otherWallet?.name || "不明"}
                          </span>
                        ) : tx.type === "transfer" ? (
                          <span>
                            {isOut
                              ? `→ ${otherWallet?.name || "不明"}`
                              : `← ${otherWallet?.name || "不明"}`}
                          </span>
                        ) : (
                          <span>
                            {isOut
                              ? `支払財布: ${wallet.name}`
                              : `入金財布: ${wallet.name}`}
                          </span>
                        )}
                      </div>
                    </td>
                    <td
                      className={`px-2 py-4 text-right font-bold font-mono whitespace-nowrap ${
                        isOut ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {isOut ? "-" : "+"}¥{tx.amount.toLocaleString()}
                    </td>
                    <td
                      className={`px-2 py-4 text-right font-mono whitespace-nowrap ${
                        hasMetricValue && !isCardWallet && metricValue < 0
                          ? "text-red-600"
                          : "text-gray-700"
                      }`}
                    >
                      {hasMetricValue
                        ? `¥${metricValue.toLocaleString()}`
                        : "-"}
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

              {filteredTransactions.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-2 py-8 text-center text-gray-400 italic"
                  >
                    取引履歴がありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingTx && editingTx.type !== "withdrawal" && (
        <TransactionModal
          type={editingTx.type}
          transaction={editingTx}
          wallets={allWallets}
          categories={categories}
          onClose={() => setEditingTx(null)}
          onSave={handleUpdateTx}
        />
      )}
    </div>
  );
};

export default WalletDetailsPage;
