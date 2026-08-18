import { Transaction, Wallet } from "../types";

export const formatDateLocal = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const formatMonthKey = (date: Date | string) => {
  const value = typeof date === "string" ? new Date(date) : date;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

export const formatMonthLabel = (monthKey: string) => {
  const [year, month] = monthKey.split("-");
  return `${year}年${Number(month)}月`;
};

const createDateWithClampedDay = (
  year: number,
  monthIndex: number,
  requestedDay: number,
) => {
  const normalizedMonth = new Date(year, monthIndex, 1);
  const lastDay = new Date(
    normalizedMonth.getFullYear(),
    normalizedMonth.getMonth() + 1,
    0,
  ).getDate();
  const day = Math.min(Math.max(Math.trunc(requestedDay) || 1, 1), lastDay);
  return new Date(
    normalizedMonth.getFullYear(),
    normalizedMonth.getMonth(),
    day,
  );
};

export const calcCreditPaymentDate = (
  transactionDateStr: string,
  closingDay: number,
  paymentDay: number,
) => {
  const d = new Date(transactionDateStr);
  let closingYear = d.getFullYear();
  let closingMonth = d.getMonth();
  if (d.getDate() > closingDay) closingMonth += 1;
  return formatDateLocal(
    createDateWithClampedDay(closingYear, closingMonth + 1, paymentDay),
  );
};

export const getScheduledPaymentDateForMonth = (
  card: Wallet,
  paymentMonthKey: string,
) => {
  const [year, month] = paymentMonthKey.split("-").map(Number);
  return formatDateLocal(
    createDateWithClampedDay(year, month - 1, card.paymentDay || 26),
  );
};

export const getCardPaymentMonth = (card: Wallet, tx: Transaction) => {
  if (tx.paymentMonth) return tx.paymentMonth;
  if (tx.creditPaymentDate) return formatMonthKey(tx.creditPaymentDate);
  return formatMonthKey(
    calcCreditPaymentDate(tx.date, card.closingDay || 31, card.paymentDay || 26),
  );
};

export const getCardPaymentDate = (card: Wallet, tx: Transaction) => {
  const paymentMonth = getCardPaymentMonth(card, tx);
  return (
    card.actualPaymentDates?.[paymentMonth] ||
    getScheduledPaymentDateForMonth(card, paymentMonth)
  );
};

export const getActualPaymentDateForMonth = (
  card: Wallet,
  paymentMonthKey: string,
) => {
  return (
    card.actualPaymentDates?.[paymentMonthKey] ||
    getScheduledPaymentDateForMonth(card, paymentMonthKey)
  );
};

export const getUpcomingCardPaymentDates = (
  card: Wallet,
  referenceDate: Date = new Date(),
) => {
  const paymentDay = card.paymentDay || 26;
  const current = createDateWithClampedDay(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    paymentDay,
  );
  const next = createDateWithClampedDay(
    current.getFullYear(),
    current.getMonth() + 1,
    paymentDay,
  );

  return { current, next };
};

export const getCardPaymentAmountForMonth = (
  card: Wallet,
  transactions: Transaction[],
  paymentMonthKey: string,
) => {
  return transactions
    .reduce((acc, tx) => {
      if (tx.type === "withdrawal") return acc;

      const isRefund =
        tx.type === "income" &&
        tx.toWalletId === card.id &&
        Boolean(tx.paymentMonth) &&
        tx.paymentMonth === paymentMonthKey;
      if (isRefund) return acc - tx.amount;

      if (tx.fromWalletId !== card.id) return acc;
      if (getCardPaymentMonth(card, tx) !== paymentMonthKey) return acc;
      return acc + tx.amount;
    }, 0);
};

export const getUpcomingCardPayments = (
  card: Wallet,
  transactions: Transaction[],
  referenceDate: Date = new Date(),
) => {
  const { current, next } = getUpcomingCardPaymentDates(card, referenceDate);

  const payments = [current, next].map((paymentDate) => ({
    date: paymentDate,
    amount: getCardPaymentAmountForMonth(
      card,
      transactions,
      formatMonthKey(paymentDate),
    ),
    label: (() => {
      const actual = getActualPaymentDateForMonth(card, formatMonthKey(paymentDate));
      const actualDate = new Date(actual);
      return `${actualDate.getMonth() + 1}/${actualDate.getDate()} 支払い`;
    })(),
  }));

  return payments;
};
