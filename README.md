# Kake-AI-bo

私の「使いやすい」を追求した、スマートな家計簿アプリケーションです。
複数のウォレット（現金、銀行、クレジットカード、電子マネーなど）を一元管理し、日々の収支を簡単に記録・分析することができます。

> [!NOTE]
> このプロジェクトは Google AI Studio を使用して作成、またはその支援を受けて開発されました。
> View your app in AI Studio: https://ai.studio/apps/drive/15vwqACzhnXCslmsAbCsViLbnDoNjIWS3

## 主な機能

- **ダッシュボード & 集計**: 資産推移やカテゴリ別の支出をグラフで直感的に把握できます（`AggregationPage`）。
- **ウォレット管理**: 複数の支払い手段（ウォレット）ごとの残高や履歴を管理できます（`WalletDetailsPage`）。
- **簡単入力**: 日々の支出や振替をスムーズに登録できます（`RegistrationPage`）。
- **CSV取り込み**: PayPay・クレジットカードの利用履歴を読み込み、登録前に明細の検索・編集・削除、チェック選択した明細の一括削除、重複確認ができます。UTF-8／Shift_JIS／UTF-16に対応し、見出しのない三井住友カード（Vpass）の請求確定形式（7列）と明細一覧形式（13列）も自動判定します。その他のカード会社独自CSVは列の割り当てを調整できます。
- **カスタマイズ**: カテゴリやウォレットの設定を自分好みに変更可能です（`SettingsPage`）。
- **セキュアな認証**: Google アカウントを使用したログイン機能を搭載しています（`LoginPage`）。

## 技術スタック

このプロジェクトは以下の技術を使用して構築されています。

- **Frontend Framework**: [React](https://react.dev/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Backend / Database**: [Firebase](https://firebase.google.com/) (Authentication, Firestore)
- **Routing**: [React Router](https://reactrouter.com/)
- **Visualization**: [Recharts](https://recharts.org/)

## ローカルでの実行方法

**前提条件:** Node.js がインストールされていること。

1. リポジトリをクローンします。
2. 依存パッケージをインストールします。
   ```bash
   npm install
   ```
3. 環境変数を設定します。
   `.env.local` ファイルを作成し、Firebase の設定や `GEMINI_API_KEY` 等を記述してください。
4. 開発サーバーを起動します。
   ```bash
   npm run dev
   ```
5. ブラウザで `http://localhost:5173` (またはコンソールに表示されるURL) にアクセスします。
