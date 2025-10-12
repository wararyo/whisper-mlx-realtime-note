import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import * as Y from 'yjs'
// @ts-ignore
import { CodemirrorBinding } from 'y-codemirror'
import CodeMirror from 'codemirror'
import { TranscribeProvider } from './TranscribeProvider'
import './CodeMirror.css'

// CodeMirrorのモードとアドオンをインポート
import 'codemirror/mode/markdown/markdown'
import 'codemirror/addon/selection/active-line'

export interface CodeMirrorEditorHandle {
  appendText: (text: string) => void
  clearText: () => void
  getText: () => string
  setText: (text: string) => void
}

interface CodeMirrorEditorProps {
  initialValue?: string
  onChange?: (value: string) => void
  placeholder?: string
}

export const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, CodeMirrorEditorProps>(
  ({ initialValue = '', onChange }, ref) => {
    const editorRef = useRef<HTMLDivElement>(null)
    const cmInstanceRef = useRef<CodeMirror.Editor | null>(null)
    const ydocRef = useRef<Y.Doc | null>(null)
    const providerRef = useRef<TranscribeProvider | null>(null)
    const bindingRef = useRef<CodemirrorBinding | null>(null)
    const onChangeRef = useRef(onChange)

    // onChangeが変わった時にrefを更新
    useEffect(() => {
      onChangeRef.current = onChange
    }, [onChange])

    useImperativeHandle(ref, () => ({
      appendText: (text: string) => {
        if (providerRef.current) {
          providerRef.current.appendTranscription(text)
        }
      },
      clearText: () => {
        if (providerRef.current) {
          providerRef.current.clearText()
        }
      },
      getText: () => {
        if (providerRef.current) {
          return providerRef.current.getText()
        }
        return ''
      },
      setText: (text: string) => {
        if (providerRef.current) {
          providerRef.current.clearText()
          if (text) {
            providerRef.current.appendTranscription(text)
          }
        }
      }
    }))

    useEffect(() => {
      console.log('useEffect called - editorRef.current:', !!editorRef.current, 'cmInstanceRef.current:', !!cmInstanceRef.current)
      if (!editorRef.current) return
      // 既にエディタが作成されている場合は早期リターン
      if (cmInstanceRef.current) {
        console.log('Editor already exists, skipping initialization')
        return
      }
      console.log('Initializing CodeMirror editor')

      // Y.jsドキュメントとプロバイダーを初期化
      const ydoc = new Y.Doc()
      const yText = ydoc.getText('transcript')
      const provider = new TranscribeProvider(ydoc, 'transcript')

      // CodeMirrorエディタを初期化
      const editor = CodeMirror(editorRef.current, {
        value: initialValue,
        mode: 'markdown',
        lineNumbers: true,
        lineWrapping: true,
        styleActiveLine: true,
        theme: 'default',
        viewportMargin: Infinity // 全てのテキストをレンダリング
      })

      // Y.jsとCodeMirrorをバインド
      const binding = new CodemirrorBinding(yText, editor, provider.awareness)

      // 初期値がある場合は設定
      if (initialValue) {
        yText.insert(0, initialValue)
      }

      // Y.Textの変更を監視してonChangeを呼び出し
      const updateHandler = () => {
        // onChangeRefから最新のonChange関数を取得
        if (onChangeRef.current) {
          onChangeRef.current(yText.toString())
        }
      }
      yText.observe(updateHandler)

      // Refに保存
      cmInstanceRef.current = editor
      ydocRef.current = ydoc
      providerRef.current = provider
      bindingRef.current = binding

      // クリーンアップ関数
      return () => {
        console.log('Cleaning up CodeMirror editor')
        yText.unobserve(updateHandler)
        binding.destroy()
        provider.destroy()
        ydoc.destroy()
        // CodeMirrorエディタの破棄
        if (editorRef.current && editor.getWrapperElement().parentNode) {
          editorRef.current.removeChild(editor.getWrapperElement())
        }
        // refをクリア
        cmInstanceRef.current = null
        ydocRef.current = null
        providerRef.current = null
        bindingRef.current = null
      }
    }, []) // 依存配列を空にして、コンポーネントのマウント時のみ実行

    return <div ref={editorRef} className="editor-container" />
  }
)

CodeMirrorEditor.displayName = 'CodeMirrorEditor'