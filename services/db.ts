import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
  onSnapshot,
  QueryConstraint,
  Unsubscribe,
  runTransaction,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { db } from "../firebase";
import { Wallet, Category, Transaction } from "../types";

import { auth } from "../firebase";

// Get current user ID from Firebase Auth
const getUserId = () => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("User not authenticated");
  }
  return user.uid;
};

const subscribeUserCollection = <T>(
  collectionName: string,
  mapDoc: (id: string, data: Record<string, unknown>) => T,
  onData: (items: T[]) => void,
  constraints: QueryConstraint[] = [],
  sortItems?: (items: T[]) => T[],
): Unsubscribe => {
  let unsubscribeSnapshot: Unsubscribe | null = null;

  const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    unsubscribeSnapshot?.();
    unsubscribeSnapshot = null;

    if (!user) {
      onData([]);
      return;
    }

    const q = query(
      collection(db, collectionName),
      where("userId", "==", user.uid),
      ...constraints,
    );

    unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((doc) =>
        mapDoc(doc.id, doc.data() as Record<string, unknown>),
      );
      onData(sortItems ? sortItems(items) : items);
    });
  });

  return () => {
    unsubscribeSnapshot?.();
    unsubscribeAuth();
  };
};

// Wallet Operations
export const getWallets = async (): Promise<Wallet[]> => {
  try {
    const uid = getUserId();
    const q = query(collection(db, "wallets"), where("userId", "==", uid));
    const snapshot = await getDocs(q);
    const wallets = snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as Wallet,
    );
    // Sort by order asc, nulls last
    return wallets.sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });
  } catch (e) {
    console.warn(
      "Using default/empty wallets because user is not logged in:",
      e,
    );
    return [];
  }
};

export const subscribeWallets = (onData: (wallets: Wallet[]) => void) => {
  return subscribeUserCollection<Wallet>(
    "wallets",
    (id, data) => ({ id, ...data }) as Wallet,
    onData,
    [],
    (wallets) =>
      wallets.sort((a, b) => {
        const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
        const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
        return orderA - orderB;
      }),
  );
};

export const addWallet = async (wallet: Omit<Wallet, "id" | "userId">) => {
  const uid = getUserId();
  const existingWallets = await getWallets();
  const maxOrder = existingWallets.reduce(
    (max, w) => Math.max(max, w.order || 0),
    0,
  );
  return addDoc(collection(db, "wallets"), {
    ...wallet,
    userId: uid,
    order: maxOrder + 1,
  });
};

export const updateWallet = async (id: string, wallet: Partial<Wallet>) => {
  const walletRef = doc(db, "wallets", id);
  return updateDoc(walletRef, wallet);
};

export const deleteWallet = async (id: string) => {
  const walletRef = doc(db, "wallets", id);
  return deleteDoc(walletRef);
};

export const updateWalletOrder = async (wallets: Wallet[]) => {
  const batchUpdates = wallets.map((w, index) => {
    const walletRef = doc(db, "wallets", w.id);
    return updateDoc(walletRef, { order: index });
  });
  await Promise.all(batchUpdates);
};

// Category Operations
export const getCategories = async (): Promise<Category[]> => {
  try {
    const uid = getUserId();
    const q = query(collection(db, "categories"), where("userId", "==", uid));
    const snapshot = await getDocs(q);
    const categories = snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as Category,
    );
    // Sort by order asc, nulls last
    return categories.sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });
  } catch (e) {
    console.warn(
      "Using default/empty categories because user is not logged in:",
      e,
    );
    return [];
  }
};

export const subscribeCategories = (onData: (categories: Category[]) => void) => {
  return subscribeUserCollection<Category>(
    "categories",
    (id, data) => ({ id, ...data }) as Category,
    onData,
    [],
    (categories) =>
      categories.sort((a, b) => {
        const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
        const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
        return orderA - orderB;
      }),
  );
};

export const addCategory = async (
  category: Omit<Category, "id" | "userId">,
) => {
  const uid = getUserId();
  const existingCategories = await getCategories();
  const maxOrder = existingCategories.reduce(
    (max, c) => Math.max(max, c.order || 0),
    0,
  );
  return addDoc(collection(db, "categories"), {
    ...category,
    userId: uid,
    order: maxOrder + 1,
  });
};

export const updateCategory = async (
  id: string,
  category: Partial<Category>,
) => {
  const categoryRef = doc(db, "categories", id);
  return updateDoc(categoryRef, category);
};

export const deleteCategory = async (id: string) => {
  const categoryRef = doc(db, "categories", id);
  return deleteDoc(categoryRef);
};

export const updateCategoryOrder = async (categories: Category[]) => {
  const batchUpdates = categories.map((c, index) => {
    const categoryRef = doc(db, "categories", c.id);
    return updateDoc(categoryRef, { order: index });
  });
  await Promise.all(batchUpdates);
};

// Transaction Operations
export const getTransactions = async (): Promise<Transaction[]> => {
  try {
    const uid = getUserId();
    const q = query(collection(db, "transactions"), where("userId", "==", uid));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(
      (doc) => ({ id: doc.id, ...doc.data() }) as Transaction,
    );
  } catch (e) {
    console.warn(
      "Using default/empty transactions because user is not logged in:",
      e,
    );
    return [];
  }
};

export const subscribeTransactions = (
  onData: (transactions: Transaction[]) => void,
) => {
  return subscribeUserCollection<Transaction>(
    "transactions",
    (id, data) => ({ id, ...data }) as Transaction,
    onData,
  );
};

export const addTransaction = async (
  tx: Omit<Transaction, "id" | "userId">,
) => {
  const uid = getUserId();
  return addDoc(collection(db, "transactions"), {
    ...tx,
    userId: uid,
    createdAt: tx.createdAt ?? new Date().toISOString(),
  });
};

export const addTransactions = async (
  txs: Array<Omit<Transaction, "id" | "userId">>,
): Promise<number> => {
  if (txs.length === 0) return 0;

  const uid = getUserId();
  const transactionsCollection = collection(db, "transactions");
  const batchSize = 200;
  const timestamp = Date.now();
  const importedAtFallback = new Date(timestamp).toISOString();
  let committedCount = 0;

  for (let start = 0; start < txs.length; start += batchSize) {
    const chunk = txs.slice(start, start + batchSize);
    const prepared = chunk.map((tx, chunkIndex) => {
      const { importedAt, ...transaction } = tx;
      const index = start + chunkIndex;
      const transactionRef = tx.importFingerprint
        ? doc(
            transactionsCollection,
            `import_${uid}_${encodeURIComponent(
              tx.importFingerprint,
            )}`,
          )
        : doc(transactionsCollection);
      const resolvedImportedAt =
        importedAt ?? (tx.importSource ? importedAtFallback : undefined);

      const data = {
        ...transaction,
        userId: uid,
        createdAt:
          tx.createdAt ?? new Date(timestamp + index).toISOString(),
        ...(resolvedImportedAt !== undefined
          ? { importedAt: resolvedImportedAt }
          : {}),
      };
      const sanitizedData = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      );

      return {
        transactionRef,
        data: sanitizedData,
        preventsDuplicates: Boolean(tx.importFingerprint),
      };
    });

    let insertedInChunk = 0;
    await runTransaction(db, async (firestoreTransaction) => {
      const existingDocuments = await Promise.all(
        prepared.map(({ transactionRef, preventsDuplicates }) =>
          preventsDuplicates
            ? firestoreTransaction.get(transactionRef)
            : Promise.resolve(null),
        ),
      );
      let insertedInAttempt = 0;
      const scheduledDocumentPaths = new Set<string>();

      prepared.forEach(({ transactionRef, data }, index) => {
        if (existingDocuments[index]?.exists()) return;
        if (scheduledDocumentPaths.has(transactionRef.path)) return;
        firestoreTransaction.set(transactionRef, data);
        scheduledDocumentPaths.add(transactionRef.path);
        insertedInAttempt += 1;
      });

      insertedInChunk = insertedInAttempt;
    });
    committedCount += insertedInChunk;
  }

  return committedCount;
};

export const updateTransaction = async (
  id: string,
  tx: Partial<Transaction>,
) => {
  const txRef = doc(db, "transactions", id);
  return updateDoc(txRef, tx);
};

export const deleteTransaction = async (id: string) => {
  const txRef = doc(db, "transactions", id);
  return deleteDoc(txRef);
};
