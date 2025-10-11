# React + Vite + TypeScript フロントエンド起動手順

## セットアップ

### 1. バックエンド（Flask API サーバー）の準備

```bash
# プロジェクトルートディレクトリに移動
cd /Users/wararyo/Git/whisper-realtime-note

# 依存関係をインストール（flask-corsが必要）
pip install flask-cors

# または uvを使用している場合
uv add flask-cors

# APIサーバーを起動
python server.py
```

APIサーバーは `http://localhost:9000` で起動します。

### 2. フロントエンド（React + Vite + TypeScript）の準備

```bash
# フロントエンドディレクトリに移動
cd /Users/wararyo/Git/whisper-realtime-note/frontend

# 依存関係をインストール（初回のみ）
npm install

# TypeScriptの型チェック
npm run type-check

# 開発サーバーを起動
npm run dev
```

フロントエンドは `http://localhost:5173` で起動します。

## 開発手順

1. **バックエンドを先に起動**
   ```bash
   cd /Users/wararyo/Git/whisper-realtime-note
   python server.py
   ```

2. **フロントエンドを起動**
   ```bash
   cd /Users/wararyo/Git/whisper-realtime-note/frontend
   npm run dev
   ```

3. **ブラウザでアクセス**
   - フロントエンド: http://localhost:5173
   - API: http://localhost:9000

## 主な変更点

### バックエンド（server.py）
- Flask-CORSを追加してクロスオリジンリクエストを許可
- `/` ルートを削除（React側でルーティング）
- `/api/transcribe` エンドポイントをJSON APIとして改修
- エラーハンドリングを改善

### フロントエンド（React + TypeScript）
- 元のHTMLページをReact + TypeScriptコンポーネントに変換
- axiosを使ってAPI通信（型安全）
- useState/useEffectでステート管理
- `@ricky0123/vad-react` を使用してVAD（Voice Activity Detection）機能を統合
- TypeScriptによる型安全性の向上
- 自動保存・手動保存・ダウンロード機能を実装

### 技術スタック
- **フロントエンド**: React 19 + TypeScript + Vite
- **バックエンド**: Flask + Flask-CORS
- **音声認識**: MLX Whisper
- **VAD**: @ricky0123/vad-react
- **HTTP通信**: Axios

## トラブルシューティング

### TypeScriptエラーが発生する場合
```bash
# 型チェックを実行
npm run type-check

# 型定義ファイルが不足している場合
npm install -D @types/パッケージ名
```

### CORSエラーが発生する場合
- server.pyでflask-corsが正しくインポートされているか確認
- APIサーバーが起動しているか確認

### VADが動作しない場合
- ブラウザでマイクアクセス許可が必要
- HTTPS環境が推奨される場合がある
- `@ricky0123/vad-react`が正しくインストールされているか確認

### 音声認識が動作しない場合
- Whisperモデルが正しく読み込まれているか確認
- 音声ファイルの形式が対応しているか確認（wav, mp3, m4a）

## 開発ワークフロー

### TypeScript開発
```bash
# 型チェック（エラーがないか確認）
npm run type-check

# 開発サーバー起動（型チェック付き）
npm run dev

# ビルド（型チェック + バンドル）
npm run build
```

### ビルドと本番環境

```bash
cd /Users/wararyo/Git/whisper-realtime-note/frontend

# TypeScript型チェック + ビルド
npm run build

# ビルド結果をプレビュー
npm run preview
```

ビルドされたファイルは `dist/` フォルダに生成されます。