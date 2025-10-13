# Whisper Realtime Note

リアルタイム音声認識を使用してメモを作成するWebアプリケーションです。MLX Whisperを使用してmacOS上で高速な音声認識を提供します。

## 特徴

- リアルタイム音声認識
- MLX Whisperによる高速処理（Apple Silicon Mac対応）
- Reactベースのモダンなフロントエンド
- Flask APIサーバー

## 必要な環境

- macOS（Apple Silicon推奨）
- Python 3.9以上
- Node.js 18以上
- uv（Pythonパッケージマネージャー）

## 使用方法

### 1. バックエンドサーバーの起動

プロジェクトのルートディレクトリで以下のコマンドを実行：

```bash
# 依存関係のインストール
uv sync

# サーバーの起動
uv run server.py
```

サーバーは `http://localhost:9000` で起動します。

### 2. フロントエンドの起動

**別のターミナル**で以下のコマンドを実行：

```bash
# フロントエンドディレクトリに移動
cd frontend

# 依存関係のインストール
npm install

# 開発サーバーの起動
npm run dev
```

### 3. アプリケーションへのアクセス

ブラウザで以下のURLにアクセス：
- フロントエンド: `http://localhost:5173`（Viteのデフォルトポート）
- API: `http://localhost:9000`

## 依存関係

### バックエンド
- Flask: Webサーバー
- MLX Whisper: 音声認識
- Flask-CORS: CORS対応

### フロントエンド
- React: UIフレームワーク
- Vite: ビルドツール
- TypeScript: 型安全性

## 開発

```bash
# バックエンドの開発
uv run server.py

# フロントエンドの開発
cd frontend
npm run dev
```

## トラブルシューティング

- MLXはApple Silicon Macでのみ動作します
- 初回起動時はWhisperモデルのダウンロードが必要です
- マイクへのアクセス許可が必要です