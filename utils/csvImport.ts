import type { Transaction, Wallet } from "../types";
import { getCardPaymentMonth } from "./cardPayments";

export type CsvImportSource = "paypay" | "credit-card";
export type CsvSourceSelection = "auto" | CsvImportSource;
export type CsvEncoding =
  | "utf-8"
  | "utf-16le"
  | "utf-16be"
  | "shift_jis";

export interface CsvDocumentRow {
  rowNumber: number;
  values: string[];
}

export interface CsvDocument {
  headers: string[];
  rows: CsvDocumentRow[];
  delimiter: string;
  detectedSource: CsvImportSource;
  headerRowNumber: number;
  format: "standard" | "smbc-vpass";
}

export interface CsvColumnMapping {
  date?: number;
  description?: number;
  amount?: number;
  outgoingAmount?: number;
  incomingAmount?: number;
  transactionKind?: number;
  note?: number;
  externalId?: number;
  paymentMonth?: number;
}

export interface CsvImportDraft {
  localId: string;
  csvRowNumber: number;
  date: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  description: string;
  note: string;
  fromWalletId?: string;
  toWalletId?: string;
  categoryId?: string;
  paymentMonth?: string;
  importSource: CsvImportSource;
  importFingerprint: string;
  importExternalId?: string;
  warnings: string[];
}

export interface CsvImportIssue {
  rowNumber?: number;
  message: string;
}

interface BuildImportOptions {
  source: CsvImportSource;
  wallet: Wallet;
  categoryId?: string;
  incomeCategoryId?: string;
  defaultPaymentMonth?: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_DATA_ROWS = 10_000;
const MAX_COLUMNS = 100;
const MAX_CELL_LENGTH = 10_000;

const normalizeHeader = (value: string) =>
  value
    .replace(/^\uFEFF/, "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s'"`]/g, "")
    .replace(/[()（）\[\]［］{}【】<>「」『』]/g, "")
    .replace(/[¥￥]/g, "")
    .replace(/[：:・]/g, "")
    .replace(/円$/, "");

const HEADER_ALIASES = {
  date: [
    "取引日",
    "取引日時",
    "利用日",
    "ご利用日",
    "利用年月日",
    "ご利用年月日",
    "利用日付",
    "ご利用日付",
    "利用日時",
    "日付",
    "売上日",
    "購入日",
    "date",
    "transaction date",
    "purchase date",
    "use date",
  ],
  description: [
    "取引先",
    "利用店名・商品名",
    "ご利用店名・商品名",
    "利用店名",
    "ご利用店名",
    "利用先",
    "ご利用先",
    "加盟店名",
    "摘要",
    "ご利用内容",
    "内容",
    "明細",
    "商品名",
    "description",
    "merchant",
    "store",
  ],
  amount: [
    "利用金額",
    "ご利用金額",
    "利用額",
    "支払金額",
    "お支払金額",
    "請求額",
    "ご請求額",
    "金額",
    "amount",
    "billing amount",
  ],
  outgoingAmount: [
    "出金金額（円）",
    "出金金額",
    "支出金額",
    "出金額",
    "debit amount",
    "debit",
    "withdrawal",
  ],
  incomingAmount: [
    "入金金額（円）",
    "入金金額",
    "収入金額",
    "入金額",
    "返金額",
    "credit amount",
    "credit",
    "deposit",
  ],
  transactionKind: [
    "取引内容",
    "取引種別",
    "明細種別",
    "種別",
    "transaction type",
    "type",
  ],
  note: ["備考", "メモ", "注記", "note", "remarks", "remark"],
  externalId: [
    "取引番号",
    "利用番号",
    "承認番号",
    "オーソリ番号",
    "transaction id",
    "reference id",
  ],
  paymentMonth: [
    "支払月",
    "お支払月",
    "請求月",
    "引落月",
    "payment month",
    "billing month",
  ],
} satisfies Record<keyof CsvColumnMapping, string[]>;

const normalizedAliases = Object.fromEntries(
  Object.entries(HEADER_ALIASES).map(([key, values]) => [
    key,
    values.map(normalizeHeader),
  ]),
) as Record<keyof CsvColumnMapping, string[]>;

const findHeaderIndex = (
  headers: string[],
  key: keyof CsvColumnMapping,
) => {
  const normalized = headers.map(normalizeHeader);
  const aliases = normalizedAliases[key];

  for (const alias of aliases) {
    const exact = normalized.findIndex((header) => header === alias);
    if (exact >= 0) return exact;
  }

  for (const alias of aliases) {
    if (alias.length < 4) continue;
    const partial = normalized.findIndex(
      (header) =>
        header.includes(alias) || (header.length >= 4 && alias.includes(header)),
    );
    if (partial >= 0) return partial;
  }

  return undefined;
};

const countDelimiters = (text: string) => {
  const candidates = [",", "\t", ";"];
  const counts = new Map<string, number[]>(
    candidates.map((candidate) => [candidate, []]),
  );
  const current = new Map<string, number>(
    candidates.map((candidate) => [candidate, 0]),
  );
  let inQuotes = false;
  let records = 0;

  for (let index = 0; index < text.length && records < 30; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (inQuotes) continue;

    if (char === "\r" || char === "\n") {
      candidates.forEach((candidate) => {
        counts.get(candidate)!.push(current.get(candidate)!);
        current.set(candidate, 0);
      });
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      records += 1;
      continue;
    }

    if (current.has(char)) current.set(char, current.get(char)! + 1);
  }

  if (records === 0 || [...current.values()].some((count) => count > 0)) {
    candidates.forEach((candidate) =>
      counts.get(candidate)!.push(current.get(candidate)!),
    );
  }

  return counts;
};

const detectDelimiter = (text: string) => {
  const counts = countDelimiters(text);
  let best = ",";
  let bestScore = -1;

  counts.forEach((rowCounts, delimiter) => {
    const positive = rowCounts.filter((count) => count > 0);
    if (positive.length === 0) return;
    const frequency = new Map<number, number>();
    positive.forEach((count) =>
      frequency.set(count, (frequency.get(count) || 0) + 1),
    );
    const consistency = Math.max(...frequency.values());
    const maxColumns = Math.max(...positive) + 1;
    const score = consistency * 1000 + positive.length * 100 + maxColumns;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  });

  return best;
};

const parseDelimitedText = (text: string, delimiter: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let quotedCell = false;

  const pushCell = () => {
    if (cell.length > MAX_CELL_LENGTH) {
      throw new Error("CSVのセルが長すぎます。");
    }
    row.push(cell);
    cell = "";
    quotedCell = false;
  };

  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell.length === 0) {
      inQuotes = true;
      quotedCell = true;
      continue;
    }
    if (char === delimiter) {
      pushCell();
      continue;
    }
    if (char === "\r" || char === "\n") {
      pushRow();
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      continue;
    }

    if (quotedCell && char.trim() !== "") {
      throw new Error("引用符の後に不正な文字があります。");
    }
    cell += char;
  }

  if (inQuotes) throw new Error("CSVの引用符が閉じられていません。");
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
};

const getHeaderScore = (headers: string[]) => {
  const date = findHeaderIndex(headers, "date") !== undefined;
  const amount = findHeaderIndex(headers, "amount") !== undefined;
  const outgoing = findHeaderIndex(headers, "outgoingAmount") !== undefined;
  const incoming = findHeaderIndex(headers, "incomingAmount") !== undefined;
  const description = findHeaderIndex(headers, "description") !== undefined;
  const kind = findHeaderIndex(headers, "transactionKind") !== undefined;
  const external = findHeaderIndex(headers, "externalId") !== undefined;
  return (
    (date ? 5 : 0) +
    (amount || outgoing || incoming ? 5 : 0) +
    (description ? 2 : 0) +
    (kind ? 1 : 0) +
    (external ? 1 : 0) +
    (outgoing && incoming ? 3 : 0)
  );
};

const isPayPayHeaders = (headers: string[]) => {
  const outgoing = findHeaderIndex(headers, "outgoingAmount") !== undefined;
  const incoming = findHeaderIndex(headers, "incomingAmount") !== undefined;
  const transactionKind =
    findHeaderIndex(headers, "transactionKind") !== undefined;
  const externalId = findHeaderIndex(headers, "externalId") !== undefined;
  return outgoing && incoming && (transactionKind || externalId);
};

const stripBom = (text: string) => text.replace(/^\uFEFF/, "");

const isSmbcVpassDetailRow = (values: string[]) => {
  if (values.length < 6 || values.length > MAX_COLUMNS) return false;
  const normalized = values.map((value) => value.normalize("NFKC").trim());
  if (!/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(normalized[0])) return false;
  if (!normalized[1]) return false;
  const billedAmount = normalized[5]
    .replace(/^[¥￥$]\s*/, "")
    .replace(/[,，\s]/g, "")
    .replace(/円$/, "");
  return /^(?:[+\-−ー▲△]?\d+(?:\.0+)?|\(\d+(?:\.0+)?\))$/.test(
    billedAmount,
  );
};

const looksLikeSmbcVpassDateRow = (values: string[]) =>
  /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(
    (values[0] || "").normalize("NFKC").trim(),
  );

export const readCsvFile = async (
  file: File,
  forcedEncoding?: CsvEncoding,
): Promise<{ text: string; encoding: CsvEncoding }> => {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("CSVファイルは10MB以下にしてください。");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let encoding = forcedEncoding;

  if (!encoding) {
    if (
      bytes.length >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf
    ) {
      encoding = "utf-8";
    } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      encoding = "utf-16le";
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      encoding = "utf-16be";
    } else {
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return { text: stripBom(text), encoding: "utf-8" };
      } catch {
        encoding = "shift_jis";
      }
    }
  }

  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  return { text: stripBom(text), encoding };
};

export const parseCsvDocument = (
  input: string,
  selection: CsvSourceSelection = "auto",
): CsvDocument => {
  const text = stripBom(input);
  if (!text.trim()) throw new Error("CSVが空です。");

  const delimiter = detectDelimiter(text);
  const matrix = parseDelimitedText(text, delimiter);
  if (matrix.length < 2) throw new Error("CSVに明細がありません。");

  let headerIndex = -1;
  let bestScore = -1;
  const searchLimit = Math.min(matrix.length, 20);
  for (let index = 0; index < searchLimit; index += 1) {
    const score = getHeaderScore(matrix[index]);
    if (score > bestScore) {
      headerIndex = index;
      bestScore = score;
    }
  }

  const indexedRows = matrix.map((values, index) => ({
    rowNumber: index + 1,
    values,
  }));
  const hasSmbcDetailRow = indexedRows.some((row) =>
    isSmbcVpassDetailRow(row.values),
  );
  const bestNonDateHeaderScore = indexedRows
    .slice(0, searchLimit)
    .filter((row) => !looksLikeSmbcVpassDateRow(row.values))
    .reduce(
      (highest, row) => Math.max(highest, getHeaderScore(row.values)),
      0,
    );

  if (
    selection !== "paypay" &&
    hasSmbcDetailRow &&
    bestNonDateHeaderScore < 10
  ) {
    const smbcRows = indexedRows
      .filter((row) => looksLikeSmbcVpassDateRow(row.values))
      .map((row) => ({
        rowNumber: row.rowNumber,
        values: [
          ...Array.from({ length: 6 }, (_, column) =>
            (row.values[column] || "").trim(),
          ),
          row.values
            .slice(6)
            .map((value) => value.trim())
            .filter(Boolean)
            .join(" / "),
        ],
      }));
    if (smbcRows.length > MAX_DATA_ROWS) {
      throw new Error(
        `CSVの明細は${MAX_DATA_ROWS.toLocaleString()}件以下にしてください。`,
      );
    }
    return {
      headers: [
        "利用日",
        "利用店名",
        "利用金額",
        "支払区分",
        "支払回数",
        "請求金額",
        "備考",
      ],
      rows: smbcRows,
      delimiter,
      detectedSource: "credit-card",
      headerRowNumber: 0,
      format: "smbc-vpass",
    };
  }

  if (headerIndex < 0 || bestScore < 5) {
    let mostColumns = 0;
    for (let index = 0; index < searchLimit; index += 1) {
      const populatedColumns = matrix[index].filter(
        (value) => value.trim() !== "",
      ).length;
      if (populatedColumns > mostColumns) {
        mostColumns = populatedColumns;
        headerIndex = index;
      }
    }
    if (headerIndex < 0 || mostColumns < 2) {
      throw new Error("CSVの見出しを判定できませんでした。");
    }
  }

  const headers = matrix[headerIndex].map((header) => header.trim());
  if (headers.length > MAX_COLUMNS) {
    throw new Error(`CSVの列数は${MAX_COLUMNS}列以下にしてください。`);
  }

  const rawDataRows = matrix.slice(headerIndex + 1);
  const invalidColumnIndex = rawDataRows.findIndex(
    (values) =>
      values.length > headers.length &&
      values.slice(headers.length).some((value) => value.trim() !== ""),
  );
  if (invalidColumnIndex >= 0) {
    throw new Error(
      `${headerIndex + invalidColumnIndex + 2}行目の列数が見出しより多いため、引用符を確認してください。`,
    );
  }

  const dataRows = rawDataRows
    .map((values, index) => ({
      rowNumber: headerIndex + index + 2,
      values: Array.from({ length: headers.length }, (_, column) =>
        (values[column] || "").trim(),
      ),
    }))
    .filter((row) => row.values.some((value) => value !== ""));

  if (dataRows.length > MAX_DATA_ROWS) {
    throw new Error(`CSVの明細は${MAX_DATA_ROWS.toLocaleString()}件以下にしてください。`);
  }
  if (dataRows.length === 0) throw new Error("CSVに明細がありません。");

  const detectedSource: CsvImportSource =
    selection === "auto"
      ? isPayPayHeaders(headers)
        ? "paypay"
        : "credit-card"
      : selection;

  return {
    headers,
    rows: dataRows,
    delimiter,
    detectedSource,
    headerRowNumber: headerIndex + 1,
    format: "standard",
  };
};

export const detectCsvColumnMapping = (
  document: CsvDocument,
): CsvColumnMapping => {
  // Vpassの請求確定CSVは見出しがなく、利用金額（3列目）と
  // 当月の請求金額（6列目）が分割・リボ払いで異なることがある。
  // 家計簿のカード引落額とCSV末尾の合計を一致させるため、6列目を使う。
  if (document.format === "smbc-vpass") {
    return {
      date: 0,
      description: 1,
      amount: 5,
      note: 6,
    };
  }

  const mapping: CsvColumnMapping = {};
  (Object.keys(HEADER_ALIASES) as Array<keyof CsvColumnMapping>).forEach(
    (key) => {
      const index = findHeaderIndex(document.headers, key);
      if (index !== undefined) mapping[key] = index;
    },
  );

  if (
    document.detectedSource === "paypay" &&
    (mapping.outgoingAmount !== undefined ||
      mapping.incomingAmount !== undefined)
  ) {
    delete mapping.amount;
  }

  return mapping;
};

const parseDateValue = (input: string) => {
  const value = input.normalize("NFKC").trim();
  const match =
    /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:[ T　(（].*)?$/.exec(
      value,
    ) ||
    /^(\d{4})年(\d{1,2})月(\d{1,2})日?(?:[ T　(（].*)?$/.exec(value) ||
    /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2200) return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
};

const parseAmountValue = (input: string) => {
  let value = input.normalize("NFKC").trim();
  if (!value) return null;
  if (/^[\-−ー―–—]+$/.test(value)) return null;

  let isNegative = false;
  if (/^\(.*\)$/.test(value)) {
    isNegative = true;
    value = value.slice(1, -1);
  }
  value = value.replace(/^[¥￥$]\s*/, "");

  if (/^[\-−ー▲△]/.test(value)) {
    if (isNegative) return Number.NaN;
    isNegative = true;
    value = value.slice(1);
  } else if (/[\-−]$/.test(value)) {
    if (isNegative) return Number.NaN;
    isNegative = true;
    value = value.slice(0, -1);
  } else if (/^\+/.test(value)) {
    value = value.slice(1);
  }

  value = value
    .replace(/[¥￥,$,，\s]/g, "")
    .replace(/円$/g, "");

  if (!/^\d+(?:\.0+)?$/.test(value)) return Number.NaN;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return Number.NaN;
  return isNegative ? -amount : amount;
};

const parsePaymentMonth = (input: string) => {
  const value = input.normalize("NFKC").trim();
  if (!value) return null;
  const match =
    /^(\d{4})[\/.\-](\d{1,2})(?:月)?$/.exec(value) ||
    /^(\d{4})年(\d{1,2})月?$/.exec(value) ||
    /^(\d{4})(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12) {
    return undefined;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
};

const hashString = (value: string) => {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193);
    hashB = Math.imul(hashB ^ code, 0x85ebca6b);
  }
  return `${(hashA >>> 0).toString(36)}${(hashB >>> 0).toString(36)}`;
};

const getValue = (row: CsvDocumentRow, index?: number) =>
  index === undefined ? "" : row.values[index]?.trim() || "";

const isPlaceholderValue = (value: string) =>
  !value || /^[\-−ー―–—]+$/.test(value.normalize("NFKC").trim());

const findExactHeaderValue = (
  document: CsvDocument,
  row: CsvDocumentRow,
  aliases: string[],
) => {
  const normalized = document.headers.map(normalizeHeader);
  const index = aliases
    .map(normalizeHeader)
    .map((alias) => normalized.findIndex((header) => header === alias))
    .find((candidate) => candidate !== -1);
  return index === undefined ? "" : getValue(row, index);
};

const buildNote = (
  document: CsvDocument,
  row: CsvDocumentRow,
  mapping: CsvColumnMapping,
  description: string,
) => {
  const parts: string[] = [];
  const mappedNote = getValue(row, mapping.note);
  const kind = getValue(row, mapping.transactionKind);
  if (!isPlaceholderValue(mappedNote)) parts.push(mappedNote);
  if (
    !isPlaceholderValue(kind) &&
    kind !== description &&
    kind !== mappedNote
  ) {
    parts.push(`取引内容: ${kind}`);
  }

  if (document.detectedSource === "paypay") {
    const payPayFields: Array<[string, string[]]> = [
      ["取引方法", ["取引方法"]],
      ["支払い区分", ["支払い区分"]],
      ["利用者", ["利用者"]],
      ["海外出金金額", ["海外出金金額"]],
      ["通貨", ["通貨"]],
      ["利用国", ["利用国"]],
    ];
    payPayFields.forEach(([label, aliases]) => {
      const value = findExactHeaderValue(document, row, aliases);
      if (!isPlaceholderValue(value)) parts.push(`${label}: ${value}`);
    });
  }

  if (document.format === "smbc-vpass") {
    const usedAmount = getValue(row, 2);
    const billedAmount = getValue(row, 5);
    if (
      !isPlaceholderValue(usedAmount) &&
      !isPlaceholderValue(billedAmount) &&
      usedAmount !== billedAmount
    ) {
      parts.push(`利用金額: ${usedAmount}`);
    }
  }

  return [...new Set(parts)].join(" / ");
};

const getWarnings = (
  document: CsvDocument,
  row: CsvDocumentRow,
  mapping: CsvColumnMapping,
  wallet: Wallet,
) => {
  if (document.detectedSource !== "paypay") return [];
  const warnings: string[] = [];
  const kind = getValue(row, mapping.transactionKind).normalize("NFKC");
  const method = findExactHeaderValue(document, row, ["取引方法"]).normalize(
    "NFKC",
  );

  if (/チャージ|送る|受け取る|銀行.*出金|投資/.test(kind)) {
    warnings.push(
      "資金移動にあたる可能性があります。必要に応じて種別と財布を編集してください。",
    );
  }
  if (/カード|クレジット/.test(method) && wallet.type !== "card") {
    warnings.push(
      "カード利用の可能性があります。登録先のカードを確認してください。",
    );
  }
  return warnings;
};

export const buildImportDrafts = (
  document: CsvDocument,
  mapping: CsvColumnMapping,
  options: BuildImportOptions,
): { drafts: CsvImportDraft[]; issues: CsvImportIssue[] } => {
  const drafts: CsvImportDraft[] = [];
  const issues: CsvImportIssue[] = [];
  const occurrences = new Map<string, number>();

  if (mapping.date === undefined) {
    issues.push({ message: "日付の列を割り当ててください。" });
    return { drafts, issues };
  }
  const hasDirectionalAmounts =
    mapping.outgoingAmount !== undefined || mapping.incomingAmount !== undefined;
  if (!hasDirectionalAmounts && mapping.amount === undefined) {
    issues.push({
      message: "単一金額、または出金・入金の列を割り当ててください。",
    });
    return { drafts, issues };
  }

  document.rows.forEach((row) => {
    const date = parseDateValue(getValue(row, mapping.date));
    if (!date) {
      issues.push({ rowNumber: row.rowNumber, message: "日付を解釈できません。" });
      return;
    }

    let type: "expense" | "income";
    let amount: number;
    let signedAmount: number;

    if (hasDirectionalAmounts) {
      const outgoingIndex =
        mapping.outgoingAmount ??
        (mapping.incomingAmount !== undefined ? mapping.amount : undefined);
      const incomingIndex =
        mapping.incomingAmount ??
        (mapping.outgoingAmount !== undefined ? mapping.amount : undefined);
      const outgoingRaw = getValue(row, outgoingIndex);
      const incomingRaw = getValue(row, incomingIndex);
      const outgoing = outgoingRaw ? parseAmountValue(outgoingRaw) : null;
      const incoming = incomingRaw ? parseAmountValue(incomingRaw) : null;

      if (
        (outgoing !== null && !Number.isFinite(outgoing)) ||
        (incoming !== null && !Number.isFinite(incoming))
      ) {
        issues.push({ rowNumber: row.rowNumber, message: "金額を解釈できません。" });
        return;
      }

      const outgoingAmount = Math.abs(outgoing || 0);
      const incomingAmount = Math.abs(incoming || 0);
      if (outgoingAmount > 0 && incomingAmount > 0) {
        issues.push({
          rowNumber: row.rowNumber,
          message: "出金と入金の両方に金額があります。",
        });
        return;
      }
      if (outgoingAmount === 0 && incomingAmount === 0) {
        issues.push({ rowNumber: row.rowNumber, message: "金額がありません。" });
        return;
      }

      type = outgoingAmount > 0 ? "expense" : "income";
      amount = outgoingAmount || incomingAmount;
      signedAmount = type === "expense" ? amount : -amount;
    } else {
      const parsedAmount = parseAmountValue(getValue(row, mapping.amount));
      if (parsedAmount === null || !Number.isFinite(parsedAmount)) {
        issues.push({ rowNumber: row.rowNumber, message: "金額を解釈できません。" });
        return;
      }
      if (parsedAmount === 0) {
        issues.push({ rowNumber: row.rowNumber, message: "金額が0円です。" });
        return;
      }

      type = parsedAmount < 0 ? "income" : "expense";
      amount = Math.abs(parsedAmount);
      signedAmount = parsedAmount;
    }

    const transactionKind = getValue(row, mapping.transactionKind);
    const description =
      getValue(row, mapping.description) ||
      transactionKind ||
      `${options.source === "paypay" ? "PayPay" : "カード"}明細`;
    const externalId = getValue(row, mapping.externalId).slice(0, 200);
    const note = buildNote(document, row, mapping, description);
    const warnings = getWarnings(document, row, mapping, options.wallet);

    let paymentMonth: string | undefined;
    if (options.wallet.type === "card") {
      const rawPaymentMonth = getValue(row, mapping.paymentMonth);
      const parsedPaymentMonth = parsePaymentMonth(rawPaymentMonth);
      const defaultPaymentMonth =
        document.format === "smbc-vpass"
          ? parsePaymentMonth(options.defaultPaymentMonth || "")
          : null;
      if (rawPaymentMonth && parsedPaymentMonth === undefined) {
        issues.push({
          rowNumber: row.rowNumber,
          message: "支払月を解釈できません。",
        });
        return;
      }
      if (parsedPaymentMonth) {
        paymentMonth = parsedPaymentMonth;
      } else if (defaultPaymentMonth) {
        paymentMonth = defaultPaymentMonth;
      } else {
        paymentMonth = getCardPaymentMonth(options.wallet, {
          id: "",
          userId: "",
          date,
          amount,
          type,
          ...(type === "expense"
            ? { fromWalletId: options.wallet.id }
            : { toWalletId: options.wallet.id }),
          description,
          note,
        } as Transaction);
      }
    }

    const rawSignature = row.values
      .map((value) => value.normalize("NFKC").trim())
      .join("\u001f");
    // PayPayでは、1つの取引番号を支払い・付随明細など複数行が共有する。
    // 取引番号だけでは正当な別明細を重複扱いするため、意味情報と元行も含める。
    const fingerprintBase = externalId
      ? `${options.source}|${options.wallet.id}|external|${externalId}|${date}|${signedAmount}|${description
          .normalize("NFKC")
          .trim()}|${rawSignature}`
      : `${options.source}|${options.wallet.id}|${date}|${signedAmount}|${description
          .normalize("NFKC")
          .trim()}|${rawSignature}`;
    const occurrence = (occurrences.get(fingerprintBase) || 0) + 1;
    occurrences.set(fingerprintBase, occurrence);
    const importFingerprint = externalId
      ? `csv:${options.source}:${hashString(fingerprintBase)}`
      : `csv:${options.source}:${hashString(fingerprintBase)}:${occurrence}`;

    drafts.push({
      localId: `${importFingerprint}:${row.rowNumber}`,
      csvRowNumber: row.rowNumber,
      date,
      amount,
      type,
      description: description.slice(0, 500),
      note: note.slice(0, 1000),
      ...(type === "expense"
        ? {
            fromWalletId: options.wallet.id,
            ...(options.categoryId ? { categoryId: options.categoryId } : {}),
          }
        : {
            toWalletId: options.wallet.id,
            ...(options.incomeCategoryId
              ? { categoryId: options.incomeCategoryId }
              : {}),
          }),
      ...(paymentMonth ? { paymentMonth } : {}),
      importSource: options.source,
      importFingerprint,
      ...(externalId ? { importExternalId: externalId } : {}),
      warnings,
    });
  });

  return { drafts, issues };
};
