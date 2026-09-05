import React, { useEffect, useMemo, useRef, useState } from "react";
import { addTransactions } from "../services/db";
import { Category, Transaction, TransactionType, Wallet } from "../types";
import {
  buildImportDrafts,
  CsvColumnMapping,
  CsvDocument,
  CsvEncoding,
  CsvImportDraft,
  CsvImportIssue,
  CsvImportSource,
  CsvSourceSelection,
  detectCsvColumnMapping,
  parseCsvDocument,
  readCsvFile,
} from "../utils/csvImport";

interface CsvImportModalProps {
  wallets: Wallet[];
  categories: Category[];
  existingTransactions: Transaction[];
  onClose: () => void;
  onImported: (count: number, skippedCount: number) => void;
}

type EditableTransactionType = Exclude<TransactionType, "withdrawal">;
type ForcedEncoding = CsvEncoding | "";
type MappingKey = Extract<keyof CsvColumnMapping, string>;

interface DraftEditForm {
  localId: string;
  date: string;
  amount: string;
  type: EditableTransactionType;
  description: string;
  note: string;
  fromWalletId: string;
  toWalletId: string;
  categoryId: string;
  paymentMonth: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const PREVIEW_PAGE_SIZE = 100;

const SOURCE_OPTIONS: Array<{
  value: CsvSourceSelection;
  label: string;
}> = [
  { value: "auto", label: "自動判定" },
  { value: "paypay", label: "PayPay" },
  { value: "credit-card", label: "クレジットカード" },
];

const ENCODING_OPTIONS: Array<{ value: ForcedEncoding; label: string }> = [
  { value: "", label: "自動判定" },
  { value: "utf-8", label: "UTF-8" },
  { value: "shift_jis", label: "Shift_JIS" },
  { value: "utf-16le", label: "UTF-16 LE" },
  { value: "utf-16be", label: "UTF-16 BE" },
];

const MAPPING_FIELDS: Array<{ key: MappingKey; label: string }> = [
  { key: "date", label: "日付" },
  { key: "description", label: "内容" },
  { key: "amount", label: "単一金額" },
  { key: "outgoingAmount", label: "出金" },
  { key: "incomingAmount", label: "入金" },
  { key: "transactionKind", label: "取引内容・種別" },
  { key: "note", label: "備考" },
  { key: "externalId", label: "取引番号" },
  { key: "paymentMonth", label: "支払月" },
];

const SOURCE_LABELS: Record<CsvImportSource, string> = {
  paypay: "PayPay",
  "credit-card": "クレジットカード",
};

const ENCODING_LABELS: Record<CsvEncoding, string> = {
  "utf-8": "UTF-8",
  shift_jis: "Shift_JIS",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
};

const TYPE_LABELS: Record<EditableTransactionType, string> = {
  expense: "支出",
  income: "収入",
  transfer: "移動",
};

const TYPE_BADGE_CLASSES: Record<EditableTransactionType, string> = {
  expense: "bg-red-100 text-red-800",
  income: "bg-green-100 text-green-800",
  transfer: "bg-yellow-100 text-yellow-800",
};

const isValidDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return (
    date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day)
  );
};

const formatCurrency = (amount: number) =>
  `¥${amount.toLocaleString("ja-JP")}`;

const normalizeSearchText = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("ja-JP");

const getPaymentMonthFromFileName = (fileName: string) => {
  const normalized = fileName.normalize("NFKC");
  const match = /(?:^|\D)((?:19|20)\d{2})[-_]?((?:0[1-9]|1[0-2]))(?:\D|$)/.exec(
    normalized,
  );
  return match ? `${match[1]}-${match[2]}` : undefined;
};

const getDraftValidationErrors = (
  draft: CsvImportDraft,
  wallets: Wallet[],
  categories: Category[],
) => {
  const errors: string[] = [];
  const fromWallet = wallets.find((wallet) => wallet.id === draft.fromWalletId);
  const toWallet = wallets.find((wallet) => wallet.id === draft.toWalletId);

  if (!isValidDate(draft.date)) errors.push("日付が不正です");
  if (!Number.isSafeInteger(draft.amount) || draft.amount <= 0) {
    errors.push("金額は1円以上の整数で入力してください");
  }
  if (!draft.description.trim()) errors.push("内容を入力してください");

  if (draft.type === "expense") {
    if (!fromWallet) errors.push("支払元の財布を選択してください");
    if (
      draft.categoryId &&
      !categories.some(
        (category) =>
          category.id === draft.categoryId && category.type === "expense",
      )
    ) {
      errors.push("支出カテゴリーを選択してください");
    }
    if (
      fromWallet?.type === "card" &&
      !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(draft.paymentMonth || "")
    ) {
      errors.push("カード支出の支払月を入力してください");
    }
  }

  if (draft.type === "income") {
    if (!toWallet) errors.push("入金先の財布を選択してください");
    if (
      draft.categoryId &&
      !categories.some(
        (category) =>
          category.id === draft.categoryId && category.type === "income",
      )
    ) {
      errors.push("収入カテゴリーを選択してください");
    }
    if (
      toWallet?.type === "card" &&
      !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(draft.paymentMonth || "")
    ) {
      errors.push("カード返金の支払月を入力してください");
    }
  }

  if (draft.type === "transfer") {
    if (!fromWallet) errors.push("移動元の財布を選択してください");
    if (!toWallet) errors.push("移動先の財布を選択してください");
    if (fromWallet && toWallet && fromWallet.id === toWallet.id) {
      errors.push("移動元と移動先には別の財布を選択してください");
    }
  }

  return errors;
};

const draftToPayload = (
  draft: CsvImportDraft,
  wallets: Wallet[],
): Omit<Transaction, "id" | "userId"> => {
  const payload: Omit<Transaction, "id" | "userId"> = {
    date: draft.date,
    amount: draft.amount,
    type: draft.type,
    description: draft.description.trim(),
    note: draft.note.trim(),
    importSource: draft.importSource,
    importFingerprint: draft.importFingerprint,
  };

  if (draft.importExternalId) {
    payload.importExternalId = draft.importExternalId;
  }

  if (draft.type === "expense") {
    payload.fromWalletId = draft.fromWalletId!;
    if (draft.categoryId) payload.categoryId = draft.categoryId;
    const wallet = wallets.find((item) => item.id === draft.fromWalletId);
    if (wallet?.type === "card" && draft.paymentMonth) {
      payload.paymentMonth = draft.paymentMonth;
    }
  } else if (draft.type === "income") {
    payload.toWalletId = draft.toWalletId!;
    if (draft.categoryId) payload.categoryId = draft.categoryId;
    const wallet = wallets.find((item) => item.id === draft.toWalletId);
    if (wallet?.type === "card" && draft.paymentMonth) {
      payload.paymentMonth = draft.paymentMonth;
    }
  } else {
    payload.fromWalletId = draft.fromWalletId!;
    payload.toWalletId = draft.toWalletId!;
  }

  return payload;
};

const CsvImportModal: React.FC<CsvImportModalProps> = ({
  wallets,
  categories,
  existingTransactions,
  onClose,
  onImported,
}) => {
  const [sourceSelection, setSourceSelection] =
    useState<CsvSourceSelection>("auto");
  const [forcedEncoding, setForcedEncoding] = useState<ForcedEncoding>("");
  const [detectedEncoding, setDetectedEncoding] =
    useState<CsvEncoding | null>(null);
  const [targetWalletId, setTargetWalletId] = useState("");
  const [defaultCategoryId, setDefaultCategoryId] = useState("");
  const [defaultIncomeCategoryId, setDefaultIncomeCategoryId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [decodedText, setDecodedText] = useState("");
  const [document, setDocument] = useState<CsvDocument | null>(null);
  const [mapping, setMapping] = useState<CsvColumnMapping | null>(null);
  const [drafts, setDrafts] = useState<CsvImportDraft[]>([]);
  const [issues, setIssues] = useState<CsvImportIssue[]>([]);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [previewPage, setPreviewPage] = useState(0);
  const [editingDraft, setEditingDraft] = useState<DraftEditForm | null>(null);
  const [editErrorVisible, setEditErrorVisible] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);
  const editDialogRef = useRef<HTMLDivElement>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);

  const effectiveSource =
    sourceSelection === "auto"
      ? document?.detectedSource ?? null
      : sourceSelection;

  const selectableWallets = useMemo(() => {
    if (effectiveSource === "credit-card") {
      return wallets.filter((wallet) => wallet.type === "card");
    }
    if (effectiveSource === "paypay") {
      return wallets.filter((wallet) => wallet.type !== "card");
    }
    return wallets;
  }, [effectiveSource, wallets]);

  const expenseCategories = useMemo(
    () => categories.filter((category) => category.type === "expense"),
    [categories],
  );
  const incomeCategories = useMemo(
    () => categories.filter((category) => category.type === "income"),
    [categories],
  );
  const walletNameById = useMemo(
    () => new Map(wallets.map((wallet) => [wallet.id, wallet.name])),
    [wallets],
  );
  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const existingFingerprints = useMemo(
    () =>
      new Set(
        existingTransactions
          .map((transaction) => transaction.importFingerprint)
          .filter((fingerprint): fingerprint is string => Boolean(fingerprint)),
      ),
    [existingTransactions],
  );

  useEffect(() => {
    if (
      selectableWallets.some((wallet) => wallet.id === targetWalletId)
    ) {
      return;
    }
    setTargetWalletId(selectableWallets[0]?.id || "");
  }, [selectableWallets, targetWalletId]);

  useEffect(() => {
    if (!document || !mapping) {
      setDrafts([]);
      setIssues([]);
      setSelectedIds(new Set());
      return;
    }

    const wallet = selectableWallets.find(
      (item) => item.id === targetWalletId,
    );
    if (!wallet) {
      setDrafts([]);
      setSelectedIds(new Set());
      return;
    }

    try {
      const result = buildImportDrafts(document, mapping, {
        source: document.detectedSource,
        wallet,
        ...(defaultCategoryId ? { categoryId: defaultCategoryId } : {}),
        ...(defaultIncomeCategoryId
          ? { incomeCategoryId: defaultIncomeCategoryId }
          : {}),
        ...(selectedFile && document.format === "smbc-vpass"
          ? {
              defaultPaymentMonth: getPaymentMonthFromFileName(
                selectedFile.name,
              ),
            }
          : {}),
      });
      setDrafts(result.drafts);
      setIssues(result.issues);
      setDeletedIds(new Set());
      setSelectedIds(new Set());
      setPreviewPage(0);
      setEditingDraft(null);
      setErrorMessage("");
    } catch {
      setDrafts([]);
      setIssues([]);
      setSelectedIds(new Set());
      setErrorMessage(
        "プレビューを作成できませんでした。列の割り当てを確認してください。",
      );
    }
  }, [
    defaultCategoryId,
    defaultIncomeCategoryId,
    document,
    mapping,
    selectedFile,
    selectableWallets,
    targetWalletId,
  ]);

  const parseDecodedText = (
    text: string,
    selection: CsvSourceSelection,
  ) => {
    const nextDocument = parseCsvDocument(text, selection);
    const nextMapping = detectCsvColumnMapping(nextDocument);
    setDocument(nextDocument);
    setMapping(nextMapping);
    setDeletedIds(new Set());
    setSelectedIds(new Set());
    setEditingDraft(null);
    setErrorMessage("");
  };

  const loadFile = async (
    file: File,
    encoding: ForcedEncoding = forcedEncoding,
    selection: CsvSourceSelection = sourceSelection,
  ) => {
    if (file.size > MAX_FILE_SIZE) {
      setErrorMessage("CSVファイルは10MB以下にしてください。");
      setSelectedFile(null);
      setDecodedText("");
      setDocument(null);
      setMapping(null);
      setSelectedIds(new Set());
      setSearchQuery("");
      return;
    }

    setIsReading(true);
    setErrorMessage("");
    try {
      const decodeAndParse = async (targetEncoding?: CsvEncoding) => {
        const result = await readCsvFile(file, targetEncoding);
        const nextDocument = parseCsvDocument(result.text, selection);
        return {
          result,
          nextDocument,
          nextMapping: detectCsvColumnMapping(nextDocument),
        };
      };

      let loaded;
      try {
        loaded = await decodeAndParse(encoding || undefined);
      } catch (initialError) {
        if (!encoding) throw initialError;
        loaded = await decodeAndParse();
        setForcedEncoding("");
      }

      const { result, nextDocument, nextMapping } = loaded;
      setSelectedFile(file);
      setDecodedText(result.text);
      setDetectedEncoding(result.encoding);
      setDocument(nextDocument);
      setMapping(nextMapping);
      setDeletedIds(new Set());
      setSelectedIds(new Set());
      setSearchQuery("");
      setEditingDraft(null);
    } catch (error) {
      setSelectedFile(file);
      setDecodedText("");
      setDetectedEncoding(null);
      setDocument(null);
      setMapping(null);
      setDrafts([]);
      setIssues([]);
      setSelectedIds(new Set());
      setSearchQuery("");
      const detail =
        error instanceof Error &&
        error.message &&
        !/encoded data|encoding/i.test(error.message)
          ? ` ${error.message}`
          : "";
      setErrorMessage(
        `CSVを読み込めませんでした。文字コード、ファイル形式、列見出しを確認してください。${detail}`,
      );
    } finally {
      setIsReading(false);
    }
  };

  const handleSourceChange = (selection: CsvSourceSelection) => {
    setSourceSelection(selection);
    if (!decodedText) return;
    try {
      parseDecodedText(decodedText, selection);
    } catch {
      setDocument(null);
      setMapping(null);
      setDrafts([]);
      setIssues([]);
      setErrorMessage(
        "指定した取込元として解析できませんでした。CSVの形式を確認してください。",
      );
    }
  };

  const handleEncodingChange = (encoding: ForcedEncoding) => {
    setForcedEncoding(encoding);
    if (selectedFile) void loadFile(selectedFile, encoding, sourceSelection);
  };

  const handleMappingChange = (key: MappingKey, value: string) => {
    if (!mapping) return;
    const nextMapping: CsvColumnMapping = { ...mapping };
    if (value === "") {
      delete nextMapping[key];
    } else {
      nextMapping[key] = Number(value);
    }
    setMapping(nextMapping);
  };

  const duplicateReasons = useMemo(() => {
    const reasons = new Map<string, "existing" | "file">();
    const seen = new Set(existingFingerprints);

    drafts.forEach((draft) => {
      if (deletedIds.has(draft.localId)) return;
      const fingerprints = [
        draft.importFingerprint,
        ...(draft.importFingerprintAliases || []),
      ];
      if (fingerprints.some((fingerprint) => seen.has(fingerprint))) {
        reasons.set(
          draft.localId,
          fingerprints.some((fingerprint) =>
            existingFingerprints.has(fingerprint),
          )
            ? "existing"
            : "file",
        );
        return;
      }
      fingerprints.forEach((fingerprint) => seen.add(fingerprint));
    });

    return reasons;
  }, [deletedIds, drafts, existingFingerprints]);

  const validationErrors = useMemo(() => {
    const errors = new Map<string, string[]>();
    drafts.forEach((draft) => {
      const rowErrors = getDraftValidationErrors(draft, wallets, categories);
      if (rowErrors.length > 0) errors.set(draft.localId, rowErrors);
    });
    return errors;
  }, [categories, drafts, wallets]);

  const importableDrafts = useMemo(
    () =>
      drafts.filter(
        (draft) =>
          !deletedIds.has(draft.localId) &&
          !duplicateReasons.has(draft.localId) &&
          !validationErrors.has(draft.localId),
      ),
    [deletedIds, drafts, duplicateReasons, validationErrors],
  );

  const activeDrafts = useMemo(
    () => drafts.filter((draft) => !deletedIds.has(draft.localId)),
    [deletedIds, drafts],
  );
  const searchTerms = useMemo(
    () =>
      normalizeSearchText(searchQuery)
        .trim()
        .split(/\s+/)
        .filter(Boolean),
    [searchQuery],
  );
  const filteredDrafts = useMemo(() => {
    if (searchTerms.length === 0) return activeDrafts;

    return activeDrafts.filter((draft) => {
      const duplicateReason = duplicateReasons.get(draft.localId);
      const rowErrors = validationErrors.get(draft.localId) || [];
      const status = duplicateReason
        ? duplicateReason === "existing"
          ? "登録済み 重複"
          : "ファイル内重複 重複"
        : rowErrors.length > 0
          ? rowErrors.join(" ")
          : draft.warnings.length > 0
            ? draft.warnings.join(" ")
            : "登録対象";
      const searchableText = normalizeSearchText(
        [
          draft.csvRowNumber,
          draft.date,
          TYPE_LABELS[draft.type],
          draft.description,
          draft.note,
          draft.amount,
          formatCurrency(draft.amount),
          draft.fromWalletId
            ? walletNameById.get(draft.fromWalletId)
            : undefined,
          draft.toWalletId
            ? walletNameById.get(draft.toWalletId)
            : undefined,
          draft.categoryId
            ? categoryNameById.get(draft.categoryId)
            : undefined,
          draft.paymentMonth,
          draft.importExternalId,
          status,
        ]
          .filter((value) => value !== undefined && value !== null)
          .join(" "),
      );
      return searchTerms.every((term) => searchableText.includes(term));
    });
  }, [
    activeDrafts,
    categoryNameById,
    duplicateReasons,
    searchTerms,
    validationErrors,
    walletNameById,
  ]);
  const previewPageCount = Math.max(
    1,
    Math.ceil(filteredDrafts.length / PREVIEW_PAGE_SIZE),
  );
  const safePreviewPage = Math.min(previewPage, previewPageCount - 1);
  const visibleDrafts = useMemo(
    () =>
      filteredDrafts.slice(
        safePreviewPage * PREVIEW_PAGE_SIZE,
        (safePreviewPage + 1) * PREVIEW_PAGE_SIZE,
      ),
    [filteredDrafts, safePreviewPage],
  );

  const selectedActiveIds = useMemo(() => {
    const activeIds = new Set(activeDrafts.map((draft) => draft.localId));
    return [...selectedIds].filter((localId) => activeIds.has(localId));
  }, [activeDrafts, selectedIds]);
  const allVisibleSelected =
    visibleDrafts.length > 0 &&
    visibleDrafts.every((draft) => selectedIds.has(draft.localId));
  const someVisibleSelected = visibleDrafts.some((draft) =>
    selectedIds.has(draft.localId),
  );

  useEffect(() => {
    if (!selectAllCheckboxRef.current) return;
    selectAllCheckboxRef.current.indeterminate =
      someVisibleSelected && !allVisibleSelected;
  }, [allVisibleSelected, someVisibleSelected]);

  useEffect(() => {
    const activeIds = new Set(activeDrafts.map((draft) => draft.localId));
    setSelectedIds((current) => {
      const next = new Set(
        [...current].filter((localId) => activeIds.has(localId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [activeDrafts]);

  useEffect(() => {
    setPreviewPage((current) => Math.min(current, previewPageCount - 1));
  }, [previewPageCount]);

  const summary = useMemo(() => {
    const expenseTotal = importableDrafts
      .filter((draft) => draft.type === "expense")
      .reduce((total, draft) => total + draft.amount, 0);
    const incomeTotal = importableDrafts
      .filter((draft) => draft.type === "income")
      .reduce((total, draft) => total + draft.amount, 0);
    const skippedDraftIds = new Set<string>(deletedIds);
    duplicateReasons.forEach((_, localId) => skippedDraftIds.add(localId));
    validationErrors.forEach((_, localId) => skippedDraftIds.add(localId));
    const activeInvalidCount = [...validationErrors.keys()].filter(
      (localId) =>
        !deletedIds.has(localId) && !duplicateReasons.has(localId),
    ).length;
    return {
      activeCount: drafts.length - deletedIds.size,
      duplicateCount: duplicateReasons.size,
      invalidCount: activeInvalidCount,
      expenseTotal,
      incomeTotal,
      skippedCount: issues.length + skippedDraftIds.size,
    };
  }, [
    deletedIds,
    drafts,
    duplicateReasons,
    importableDrafts,
    issues,
    validationErrors,
  ]);

  const toggleDraftSelection = (localId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(localId)) {
        next.delete(localId);
      } else {
        next.add(localId);
      }
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleDrafts.forEach((draft) => next.delete(draft.localId));
      } else {
        visibleDrafts.forEach((draft) => next.add(draft.localId));
      }
      return next;
    });
  };

  const deleteDraft = (localId: string) => {
    setDeletedIds((current) => new Set(current).add(localId));
    setSelectedIds((current) => {
      if (!current.has(localId)) return current;
      const next = new Set(current);
      next.delete(localId);
      return next;
    });
  };

  const deleteSelectedDrafts = () => {
    if (selectedActiveIds.length === 0) return;
    setDeletedIds((current) => {
      const next = new Set(current);
      selectedActiveIds.forEach((localId) => next.add(localId));
      return next;
    });
    setSelectedIds(new Set());
    setEditingDraft(null);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setPreviewPage(0);
    setSelectedIds(new Set());
  };

  const closeEdit = () => {
    setEditingDraft(null);
    window.requestAnimationFrame(() => editTriggerRef.current?.focus());
  };

  const beginEdit = (
    draft: CsvImportDraft,
    trigger: HTMLButtonElement,
  ) => {
    editTriggerRef.current = trigger;
    setEditingDraft({
      localId: draft.localId,
      date: draft.date,
      amount: String(draft.amount),
      type: draft.type,
      description: draft.description,
      note: draft.note,
      fromWalletId: draft.fromWalletId || "",
      toWalletId: draft.toWalletId || "",
      categoryId: draft.categoryId || "",
      paymentMonth: draft.paymentMonth || "",
    });
    setEditErrorVisible(false);
  };

  useEffect(() => {
    if (!editingDraft) return;
    window.requestAnimationFrame(() => editDialogRef.current?.focus());
  }, [editingDraft?.localId]);

  const handleEditDialogKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key === "Escape" && !isImporting) {
      event.preventDefault();
      closeEdit();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = editDialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      (globalThis.document.activeElement === first ||
        globalThis.document.activeElement === dialog)
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (globalThis.document.activeElement === last ||
        globalThis.document.activeElement === dialog)
    ) {
      event.preventDefault();
      first.focus();
    }
  };

  const editCandidate = useMemo(() => {
    if (!editingDraft) return null;
    const original = drafts.find(
      (draft) => draft.localId === editingDraft.localId,
    );
    if (!original) return null;

    const next: CsvImportDraft = {
      ...original,
      date: editingDraft.date,
      amount: Number(editingDraft.amount),
      type: editingDraft.type,
      description: editingDraft.description,
      note: editingDraft.note,
    };

    delete next.fromWalletId;
    delete next.toWalletId;
    delete next.categoryId;
    delete next.paymentMonth;

    if (editingDraft.type === "expense") {
      if (editingDraft.fromWalletId) {
        next.fromWalletId = editingDraft.fromWalletId;
      }
      if (editingDraft.categoryId) next.categoryId = editingDraft.categoryId;
      const wallet = wallets.find(
        (item) => item.id === editingDraft.fromWalletId,
      );
      if (wallet?.type === "card" && editingDraft.paymentMonth) {
        next.paymentMonth = editingDraft.paymentMonth;
      }
    } else if (editingDraft.type === "income") {
      if (editingDraft.toWalletId) next.toWalletId = editingDraft.toWalletId;
      if (editingDraft.categoryId) next.categoryId = editingDraft.categoryId;
      const wallet = wallets.find(
        (item) => item.id === editingDraft.toWalletId,
      );
      if (wallet?.type === "card" && editingDraft.paymentMonth) {
        next.paymentMonth = editingDraft.paymentMonth;
      }
    } else {
      if (editingDraft.fromWalletId) {
        next.fromWalletId = editingDraft.fromWalletId;
      }
      if (editingDraft.toWalletId) next.toWalletId = editingDraft.toWalletId;
    }

    return next;
  }, [drafts, editingDraft, wallets]);

  const editValidationErrors = useMemo(
    () =>
      editCandidate
        ? getDraftValidationErrors(editCandidate, wallets, categories)
        : [],
    [categories, editCandidate, wallets],
  );

  const saveEdit = () => {
    setEditErrorVisible(true);
    if (isImporting || !editCandidate || editValidationErrors.length > 0) {
      return;
    }
    setDrafts((current) =>
      current.map((draft) =>
        draft.localId === editCandidate.localId ? editCandidate : draft,
      ),
    );
    setSelectedIds((current) => {
      if (!current.has(editCandidate.localId)) return current;
      const next = new Set(current);
      next.delete(editCandidate.localId);
      return next;
    });
    closeEdit();
  };

  const handleImport = async () => {
    if (editingDraft || isImporting || importableDrafts.length === 0) return;
    setIsImporting(true);
    setErrorMessage("");
    try {
      const payloads = importableDrafts.map((draft) =>
        draftToPayload(draft, wallets),
      );
      const count = await addTransactions(payloads);
      onImported(count, payloads.length - count);
    } catch {
      setErrorMessage(
        "登録に失敗しました。通信状況を確認してください。途中まで登録された可能性があるため、再試行前に履歴を確認してください。",
      );
    } finally {
      setIsImporting(false);
    }
  };

  const editingFromWallet = editingDraft
    ? wallets.find((wallet) => wallet.id === editingDraft.fromWalletId)
    : undefined;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50 p-2 sm:p-4">
      <div
        className="mx-auto my-2 w-full max-w-[1440px] sketch-border bg-white p-4 shadow-xl sm:my-6 sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="csv-import-title"
        aria-hidden={editingDraft ? true : undefined}
        inert={editingDraft ? true : undefined}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 pb-4">
          <div>
            <h2 id="csv-import-title" className="text-2xl font-bold">
              CSV取り込み
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              内容を確認・編集してから、まとめて家計簿へ登録します。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isImporting}
            className="rounded border-2 border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            閉じる
          </button>
        </div>

        <section className="mt-5 grid gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700">
            取込元
            <select
              value={sourceSelection}
              onChange={(event) =>
                handleSourceChange(event.target.value as CsvSourceSelection)
              }
              disabled={isReading || isImporting}
              className="mt-1 w-full rounded border-2 border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700">
            対象の財布・カード
            <select
              value={targetWalletId}
              onChange={(event) => setTargetWalletId(event.target.value)}
              disabled={isReading || isImporting || selectableWallets.length === 0}
              className="mt-1 w-full rounded border-2 border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="">選択してください</option>
              {selectableWallets.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.name}
                  {wallet.type === "card" ? "（クレカ）" : ""}
                </option>
              ))}
            </select>
            {selectableWallets.length === 0 && (
              <span className="mt-1 block text-xs text-red-600">
                対象にできる財布がありません。設定画面で追加してください。
              </span>
            )}
          </label>

          <label className="block text-sm font-medium text-gray-700">
            初期の支出カテゴリー
            <select
              value={defaultCategoryId}
              onChange={(event) => setDefaultCategoryId(event.target.value)}
              disabled={isReading || isImporting}
              className="mt-1 w-full rounded border-2 border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="">未設定</option>
              {expenseCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700">
            初期の収入カテゴリー
            <select
              value={defaultIncomeCategoryId}
              onChange={(event) =>
                setDefaultIncomeCategoryId(event.target.value)
              }
              disabled={isReading || isImporting}
              className="mt-1 w-full rounded border-2 border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="">未設定</option>
              {incomeCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700">
            文字コード
            <select
              value={forcedEncoding}
              onChange={(event) =>
                handleEncodingChange(event.target.value as ForcedEncoding)
              }
              disabled={isReading || isImporting}
              className="mt-1 w-full rounded border-2 border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              {ENCODING_OPTIONS.map((option) => (
                <option key={option.value || "auto"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700 md:col-span-2">
            CSVファイル（10MBまで）
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={isReading || isImporting}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadFile(file);
              }}
              className="mt-1 block w-full rounded border-2 border-dashed border-gray-300 bg-white px-3 py-3 text-sm file:mr-4 file:rounded file:border-0 file:bg-blue-100 file:px-4 file:py-2 file:font-bold file:text-blue-800 hover:file:bg-blue-200 disabled:opacity-50"
            />
          </label>
        </section>

        {isReading && (
          <p className="mt-4 rounded bg-blue-50 p-3 text-sm text-blue-700">
            CSVを読み込んでいます…
          </p>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {errorMessage}
          </div>
        )}

        {document && mapping && (
          <>
            <section className="mt-5 rounded-lg border border-gray-200 p-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <span>
                  <span className="text-gray-500">ファイル:</span>{" "}
                  <strong>{selectedFile?.name}</strong>
                </span>
                <span>
                  <span className="text-gray-500">文字コード:</span>{" "}
                  <strong>
                    {detectedEncoding
                      ? ENCODING_LABELS[detectedEncoding]
                      : "不明"}
                  </strong>
                </span>
                <span>
                  <span className="text-gray-500">判定:</span>{" "}
                  <strong>{SOURCE_LABELS[document.detectedSource]}</strong>
                </span>
                <span>
                  <span className="text-gray-500">見出し行:</span>{" "}
                  <strong>
                    {document.headerRowNumber > 0
                      ? `${document.headerRowNumber}行目`
                      : "なし（Vpass形式として自動判定）"}
                  </strong>
                </span>
              </div>
              <div className="mt-3 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                {document.headers.map((header, index) => (
                  <span
                    key={`${index}-${header}`}
                    className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
                  >
                    {index + 1}. {header || "（空の見出し）"}
                  </span>
                ))}
              </div>
            </section>

            <details className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
              <summary className="cursor-pointer font-bold">
                列の割り当てを確認・変更
              </summary>
              <p className="mt-2 text-xs text-gray-500">
                単一金額、または出金・入金の列を割り当ててください。変更するとプレビューを自動更新します。
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {MAPPING_FIELDS.map((field) => (
                  <label
                    key={field.key}
                    className="block text-xs font-medium text-gray-600"
                  >
                    {field.label}
                    <select
                      value={mapping[field.key] ?? ""}
                      onChange={(event) =>
                        handleMappingChange(field.key, event.target.value)
                      }
                      disabled={isImporting}
                      className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
                    >
                      <option value="">割り当てなし</option>
                      {document.headers.map((header, index) => (
                        <option key={`${field.key}-${index}`} value={index}>
                          {index + 1}. {header || "（空の見出し）"}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!decodedText) return;
                  try {
                    parseDecodedText(decodedText, sourceSelection);
                  } catch {
                    setErrorMessage(
                      "CSVを再解析できませんでした。取込元と文字コードを確認してください。",
                    );
                  }
                }}
                disabled={isImporting}
                className="mt-4 rounded border border-gray-300 px-3 py-1.5 text-xs font-bold hover:bg-gray-100 disabled:opacity-50"
              >
                自動判定に戻して再解析
              </button>
            </details>

            <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded bg-gray-100 p-3">
                <div className="text-xs text-gray-500">読込中の明細</div>
                <div className="mt-1 text-xl font-bold">{summary.activeCount}件</div>
              </div>
              <div className="rounded bg-blue-50 p-3">
                <div className="text-xs text-blue-600">登録対象</div>
                <div className="mt-1 text-xl font-bold text-blue-800">
                  {importableDrafts.length}件
                </div>
              </div>
              <div className="rounded bg-yellow-50 p-3">
                <div className="text-xs text-yellow-700">重複</div>
                <div className="mt-1 text-xl font-bold text-yellow-800">
                  {summary.duplicateCount}件
                </div>
              </div>
              <div className="rounded bg-red-50 p-3">
                <div className="text-xs text-red-600">支出合計</div>
                <div className="mt-1 font-bold text-red-700">
                  {formatCurrency(summary.expenseTotal)}
                </div>
              </div>
              <div className="rounded bg-green-50 p-3">
                <div className="text-xs text-green-600">収入合計</div>
                <div className="mt-1 font-bold text-green-700">
                  {formatCurrency(summary.incomeTotal)}
                </div>
              </div>
              <div className="rounded bg-gray-100 p-3">
                <div className="text-xs text-gray-500">スキップ・要確認</div>
                <div className="mt-1 text-xl font-bold">
                  {summary.skippedCount}件
                </div>
              </div>
            </section>

            {(issues.length > 0 || summary.invalidCount > 0) && (
              <details className="mt-4 rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
                <summary className="cursor-pointer font-bold">
                  読み込めなかった明細・入力エラーを確認
                </summary>
                <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-xs">
                  {issues.map((issue, index) => (
                    <li key={`${issue.rowNumber || "file"}-${index}`}>
                      {issue.rowNumber ? `${issue.rowNumber}行目: ` : ""}
                      {issue.message}
                    </li>
                  ))}
                  {[...validationErrors.entries()]
                    .filter(([localId]) => !deletedIds.has(localId))
                    .map(([localId, errors]) => {
                      const draft = drafts.find(
                        (item) => item.localId === localId,
                      );
                      return (
                        <li key={localId}>
                          {draft ? `${draft.csvRowNumber}行目: ` : ""}
                          {errors.join("、")}
                        </li>
                      );
                    })}
                </ul>
              </details>
            )}

            {deletedIds.size > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 bg-gray-50 p-3 text-sm">
                <span>{deletedIds.size}件をプレビューから除外しています。</span>
                <button
                  type="button"
                  onClick={() => {
                    setDeletedIds(new Set());
                    setSelectedIds(new Set());
                  }}
                  disabled={isImporting}
                  className="font-bold text-blue-600 hover:underline disabled:opacity-50"
                >
                  すべて元に戻す
                </button>
              </div>
            )}

            <section className="mt-4 grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <label className="block text-sm font-medium text-gray-700">
                明細を検索
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  disabled={isImporting}
                  placeholder="内容・備考・日付・金額など"
                  className="mt-1 w-full rounded border-2 border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-500 disabled:opacity-50"
                />
                <span className="mt-1 block text-xs font-normal text-gray-500">
                  {filteredDrafts.length}件を表示 / 全{activeDrafts.length}件
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <span
                  className="whitespace-nowrap text-sm font-bold text-gray-700"
                  aria-live="polite"
                >
                  {selectedActiveIds.length}件選択中
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  disabled={isImporting || selectedActiveIds.length === 0}
                  className="whitespace-nowrap rounded border border-gray-300 bg-white px-3 py-2 text-sm font-bold hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  選択解除
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedDrafts}
                  disabled={isImporting || selectedActiveIds.length === 0}
                  className="whitespace-nowrap rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  選択した{selectedActiveIds.length}件を削除
                </button>
              </div>
            </section>

            <section className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-[1280px] w-full whitespace-nowrap text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="w-12 px-3 py-2 text-center">
                      <input
                        ref={selectAllCheckboxRef}
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleVisibleSelection}
                        disabled={isImporting || visibleDrafts.length === 0}
                        aria-label={
                          allVisibleSelected
                            ? "現在のページの明細をすべて選択解除"
                            : "現在のページの明細をすべて選択"
                        }
                        title={
                          allVisibleSelected
                            ? "現在のページをすべて選択解除"
                            : "現在のページをすべて選択"
                        }
                        className="h-4 w-4 accent-blue-600 disabled:opacity-40"
                      />
                    </th>
                    <th className="px-3 py-2">CSV行</th>
                    <th className="px-3 py-2">日付</th>
                    <th className="px-3 py-2">種別</th>
                    <th className="px-3 py-2">内容</th>
                    <th className="px-3 py-2 text-right">金額</th>
                    <th className="px-3 py-2">登録先・カテゴリー</th>
                    <th className="px-3 py-2">状態</th>
                    <th className="px-3 py-2 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleDrafts.map((draft) => {
                      const duplicateReason = duplicateReasons.get(draft.localId);
                      const rowErrors = validationErrors.get(draft.localId) || [];
                      const walletId =
                        draft.type === "income"
                          ? draft.toWalletId
                          : draft.fromWalletId;
                      const wallet = wallets.find((item) => item.id === walletId);
                      const category = categories.find(
                        (item) => item.id === draft.categoryId,
                      );
                      const isSelected = selectedIds.has(draft.localId);
                      return (
                        <tr
                          key={draft.localId}
                          className={`align-top ${
                            isSelected ? "bg-blue-50" : "hover:bg-gray-50"
                          }`}
                        >
                          <td className="px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() =>
                                toggleDraftSelection(draft.localId)
                              }
                              disabled={isImporting}
                              aria-label={`${draft.csvRowNumber}行目の${
                                draft.description || "明細"
                              }を${isSelected ? "選択解除" : "選択"}`}
                              className="h-4 w-4 accent-blue-600 disabled:opacity-40"
                            />
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-gray-500">
                            {draft.csvRowNumber}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 font-mono">
                            {draft.date || "-"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <span
                              className={`inline-block rounded px-2 py-1 text-xs font-bold ${TYPE_BADGE_CLASSES[draft.type]}`}
                            >
                              {TYPE_LABELS[draft.type]}
                            </span>
                          </td>
                          <td className="w-[320px] max-w-[320px] px-3 py-3">
                            <div
                              className="truncate font-medium"
                              title={draft.description || undefined}
                            >
                              {draft.description || "-"}
                            </div>
                            {draft.note && (
                              <div
                                className="mt-1 truncate text-xs text-gray-500"
                                title={draft.note}
                              >
                                {draft.note}
                              </div>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-right font-mono font-bold">
                            {Number.isFinite(draft.amount)
                              ? formatCurrency(draft.amount)
                              : "-"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-xs">
                            <div>{wallet?.name || "未設定"}</div>
                            <div className="mt-1 text-gray-500">
                              {draft.type === "transfer"
                                ? `→ ${
                                    wallets.find(
                                      (item) => item.id === draft.toWalletId,
                                    )?.name || "未設定"
                                  }`
                                : category?.name || "カテゴリー未設定"}
                            </div>
                            {draft.paymentMonth && (
                              <div className="mt-1 text-gray-500">
                                支払月: {draft.paymentMonth}
                              </div>
                            )}
                          </td>
                          <td className="w-[320px] max-w-[320px] px-3 py-3 text-xs">
                            {duplicateReason ? (
                              <span className="inline-block rounded bg-yellow-100 px-2 py-1 font-bold text-yellow-800">
                                {duplicateReason === "existing"
                                  ? "登録済み"
                                  : "ファイル内重複"}
                              </span>
                            ) : rowErrors.length > 0 ? (
                              <div className="text-red-600">
                                {rowErrors.map((message) => (
                                  <div
                                    key={message}
                                    className="truncate"
                                    title={message}
                                  >
                                    {message}
                                  </div>
                                ))}
                              </div>
                            ) : draft.warnings.length > 0 ? (
                              <div className="text-yellow-700">
                                {draft.warnings.map((warning) => (
                                  <div
                                    key={warning}
                                    className="truncate"
                                    title={warning}
                                  >
                                    {warning}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="inline-block rounded bg-green-100 px-2 py-1 font-bold text-green-700">
                                登録対象
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex justify-center gap-2 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={(event) =>
                                  beginEdit(draft, event.currentTarget)
                                }
                                disabled={isImporting}
                                className="rounded border border-blue-300 bg-blue-50 px-3 py-1.5 font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                              >
                                編集
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteDraft(draft.localId)}
                                disabled={isImporting}
                                className="rounded border border-red-300 bg-red-50 px-3 py-1.5 font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                              >
                                削除
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  {filteredDrafts.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-gray-400">
                        {summary.activeCount === 0
                          ? "登録できる明細がありません。"
                          : "検索条件に一致する明細がありません。"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            {filteredDrafts.length > PREVIEW_PAGE_SIZE && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-gray-500">
                  {safePreviewPage * PREVIEW_PAGE_SIZE + 1}〜
                  {Math.min(
                    (safePreviewPage + 1) * PREVIEW_PAGE_SIZE,
                    filteredDrafts.length,
                  )}
                  件 / 検索結果{filteredDrafts.length}件
                </span>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewPage(Math.max(0, safePreviewPage - 1))
                    }
                    disabled={safePreviewPage === 0 || isImporting}
                    className="rounded border border-gray-300 px-4 py-2 font-bold hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    前へ
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewPage(
                        Math.min(previewPageCount - 1, safePreviewPage + 1),
                      )
                    }
                    disabled={
                      safePreviewPage >= previewPageCount - 1 || isImporting
                    }
                    className="rounded border border-gray-300 px-4 py-2 font-bold hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    次へ
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <div className="sticky bottom-0 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white py-4">
          <span className="text-sm text-gray-500">
            {document
              ? `${importableDrafts.length}件を登録します`
              : "CSVファイルを選択してください"}
          </span>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="w-full rounded border-2 border-gray-300 px-3 py-2 hover:bg-gray-100 disabled:opacity-50 sm:w-auto sm:px-5"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={
                Boolean(editingDraft) ||
                isReading ||
                isImporting ||
                importableDrafts.length === 0
              }
              className="w-full rounded bg-blue-600 px-3 py-2 font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 sm:w-auto sm:px-6"
            >
              {isImporting
                ? "登録中…"
                : `${importableDrafts.length}件を登録`}
            </button>
          </div>
        </div>
      </div>

      {editingDraft && editCandidate && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-black bg-opacity-60 p-3">
          <div
            ref={editDialogRef}
            className="mx-auto my-4 w-full max-w-2xl sketch-border bg-white p-5 shadow-2xl sm:p-7"
            role="dialog"
            aria-modal="true"
            aria-labelledby="csv-row-edit-title"
            tabIndex={-1}
            onKeyDown={handleEditDialogKeyDown}
          >
            <div className="flex items-center justify-between gap-4">
              <h3 id="csv-row-edit-title" className="text-xl font-bold">
                {editCandidate.csvRowNumber}行目を編集
              </h3>
              <button
                type="button"
                onClick={closeEdit}
                disabled={isImporting}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50"
              >
                閉じる
              </button>
            </div>

            <fieldset
              disabled={isImporting}
              className="mt-5 grid gap-4 border-0 p-0 sm:grid-cols-2 disabled:opacity-60"
            >
              <label className="block text-sm font-medium text-gray-700">
                日付
                <input
                  type="date"
                  value={editingDraft.date}
                  onChange={(event) =>
                    setEditingDraft({
                      ...editingDraft,
                      date: event.target.value,
                    })
                  }
                  className="mt-1 w-full rounded border-2 border-gray-300 px-3 py-2 outline-none focus:border-blue-500"
                />
              </label>

              <label className="block text-sm font-medium text-gray-700">
                金額
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={editingDraft.amount}
                  onChange={(event) =>
                    setEditingDraft({
                      ...editingDraft,
                      amount: event.target.value,
                    })
                  }
                  className="mt-1 w-full rounded border-2 border-gray-300 px-3 py-2 outline-none focus:border-blue-500"
                />
              </label>

              <label className="block text-sm font-medium text-gray-700">
                種別
                <select
                  value={editingDraft.type}
                  onChange={(event) => {
                    const type = event.target.value as EditableTransactionType;
                    setEditingDraft({
                      ...editingDraft,
                      type,
                      fromWalletId:
                        type === "income"
                          ? ""
                          : editingDraft.fromWalletId || targetWalletId,
                      toWalletId:
                        type === "expense"
                          ? ""
                          : editingDraft.toWalletId || targetWalletId,
                      categoryId:
                        type === "expense"
                          ? editingDraft.type === "expense"
                            ? editingDraft.categoryId
                            : defaultCategoryId
                          : type === "income"
                            ? editingDraft.type === "income"
                              ? editingDraft.categoryId
                              : defaultIncomeCategoryId
                            : "",
                      paymentMonth:
                        type === "transfer" ? "" : editingDraft.paymentMonth,
                    });
                  }}
                  className="mt-1 w-full rounded border-2 border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-500"
                >
                  <option value="expense">支出</option>
                  <option value="income">収入</option>
                  <option value="transfer">移動</option>
                </select>
              </label>

              <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
                内容
                <input
                  type="text"
                  value={editingDraft.description}
                  onChange={(event) =>
                    setEditingDraft({
                      ...editingDraft,
                      description: event.target.value,
                    })
                  }
                  className="mt-1 w-full rounded border-2 border-gray-300 px-3 py-2 outline-none focus:border-blue-500"
                />
              </label>

              {editingDraft.type !== "income" && (
                <label className="block text-sm font-medium text-gray-700">
                  {editingDraft.type === "transfer" ? "移動元" : "支払元"}
                  <select
                    value={editingDraft.fromWalletId}
                    onChange={(event) =>
                      setEditingDraft({
                        ...editingDraft,
                        fromWalletId: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded border-2 border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-500"
                  >
                    <option value="">選択してください</option>
                    {wallets.map((wallet) => (
                      <option key={wallet.id} value={wallet.id}>
                        {wallet.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {editingDraft.type !== "expense" && (
                <label className="block text-sm font-medium text-gray-700">
                  {editingDraft.type === "transfer" ? "移動先" : "入金先"}
                  <select
                    value={editingDraft.toWalletId}
                    onChange={(event) =>
                      setEditingDraft({
                        ...editingDraft,
                        toWalletId: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded border-2 border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-500"
                  >
                    <option value="">選択してください</option>
                    {wallets.map((wallet) => (
                      <option key={wallet.id} value={wallet.id}>
                        {wallet.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {editingDraft.type !== "transfer" && (
                <label className="block text-sm font-medium text-gray-700">
                  カテゴリー
                  <select
                    value={editingDraft.categoryId}
                    onChange={(event) =>
                      setEditingDraft({
                        ...editingDraft,
                        categoryId: event.target.value,
                      })
                    }
                    className="mt-1 w-full rounded border-2 border-gray-300 bg-white px-3 py-2 outline-none focus:border-blue-500"
                  >
                    <option value="">未設定</option>
                    {(editingDraft.type === "expense"
                      ? expenseCategories
                      : incomeCategories
                    ).map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {((editingDraft.type === "expense" &&
                editingFromWallet?.type === "card") ||
                (editingDraft.type === "income" &&
                  wallets.find(
                    (wallet) => wallet.id === editingDraft.toWalletId,
                  )?.type === "card")) && (
                  <label className="block text-sm font-medium text-gray-700">
                    支払月
                    <input
                      type="month"
                      value={editingDraft.paymentMonth}
                      onChange={(event) =>
                        setEditingDraft({
                          ...editingDraft,
                          paymentMonth: event.target.value,
                        })
                      }
                      className="mt-1 w-full rounded border-2 border-gray-300 px-3 py-2 outline-none focus:border-blue-500"
                    />
                  </label>
                )}

              <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
                備考
                <textarea
                  rows={3}
                  value={editingDraft.note}
                  onChange={(event) =>
                    setEditingDraft({
                      ...editingDraft,
                      note: event.target.value,
                    })
                  }
                  className="mt-1 w-full rounded border-2 border-gray-300 px-3 py-2 outline-none focus:border-blue-500"
                />
              </label>
            </fieldset>

            {editErrorVisible && editValidationErrors.length > 0 && (
              <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {editValidationErrors.map((message) => (
                  <div key={message}>{message}</div>
                ))}
              </div>
            )}

            <div className="mt-6 grid grid-cols-2 gap-2 sm:flex sm:justify-end sm:gap-3">
              <button
                type="button"
                onClick={closeEdit}
                disabled={isImporting}
                className="w-full rounded border-2 border-gray-300 px-3 py-2 hover:bg-gray-100 disabled:opacity-50 sm:w-auto sm:px-5"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={isImporting}
                className="w-full rounded bg-blue-600 px-3 py-2 font-bold text-white hover:bg-blue-700 disabled:bg-gray-300 sm:w-auto sm:px-6"
              >
                変更を反映
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CsvImportModal;
