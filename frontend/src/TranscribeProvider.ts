import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import { ObservableV2 } from 'lib0/observable'

/**
 * カスタムProvider - 音声認識結果を自動でY.Textに追記する
 */
export class TranscribeProvider extends ObservableV2<{}> {
  public doc: Y.Doc
  public awareness: awarenessProtocol.Awareness
  public yText: Y.Text
  private connected: boolean = false

  constructor(doc: Y.Doc, textKey: string = 'transcript') {
    super()
    this.doc = doc
    this.yText = doc.getText(textKey)
    this.awareness = new awarenessProtocol.Awareness(doc)
    this.connected = true
  }

  /**
   * 音声認識結果をテキストに追記する
   * @param text 追記するテキスト
   */
  appendTranscription(text: string): void {
    if (!this.connected || !text.trim()) {
      return
    }

    // Y.Textの末尾にテキストを追加
    const textToInsert = text.trim() + '\n'

    // トランザクションを使用して一度に追加
    this.doc.transact(() => {
      this.yText.insert(this.yText.length, textToInsert)
    }, 'transcribe-provider')
  }

  /**
   * テキストをクリアする
   */
  clearText(): void {
    if (!this.connected) {
      return
    }

    this.doc.transact(() => {
      this.yText.delete(0, this.yText.length)
    }, 'transcribe-provider')
  }

  /**
   * 現在のテキストを取得
   */
  getText(): string {
    return this.yText.toString()
  }

  /**
   * 接続状態を取得
   */
  get isConnected(): boolean {
    return this.connected
  }

  /**
   * プロバイダーを破棄
   */
  destroy(): void {
    this.connected = false
    this.awareness.destroy()
    super.destroy()
  }
}