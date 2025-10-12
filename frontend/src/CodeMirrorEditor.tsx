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
    const cmWrapperRef = useRef<HTMLElement | null>(null) // CodeMirrorのDOM要素を保存

    // onChangeが変わった時にrefを更新
    useEffect(() => {
      onChangeRef.current = onChange
    }, [onChange])

    useImperativeHandle(ref, () => ({
      appendText: (text: string) => {
        if (providerRef.current && cmInstanceRef.current) {
          // スクロール位置をチェック
          const wasAtBottom = isScrolledToBottom()
          
          providerRef.current.appendTranscription(text)
          
          // 一番下にいた場合は自動スクロール
          if (wasAtBottom) {
            setTimeout(() => scrollToBottom(), 100)
          }
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

    // スクロール関連のヘルパー関数
    const scrollToBottom = () => {
      if (cmInstanceRef.current) {
        const editor = cmInstanceRef.current
        const lastLine = editor.lastLine()
        editor.scrollTo(null, editor.heightAtLine(lastLine, 'local'))
      }
    }

    const isScrolledToBottom = () => {
      if (!cmInstanceRef.current) return false
      
      const editor = cmInstanceRef.current
      const scrollInfo = editor.getScrollInfo()
      const threshold = 50 // 50px以内なら「下にいる」と判定
      
      return (scrollInfo.top + scrollInfo.clientHeight + threshold >= scrollInfo.height)
    }

    useEffect(() => {
      console.log('useEffect called - editorRef.current:', !!editorRef.current, 'cmInstanceRef.current:', !!cmInstanceRef.current)
      if (!editorRef.current) {
        console.log('Editor ref not available, skipping initialization')
        return
      }
      
      // 既にエディタが作成されている場合は早期リターン
      if (cmInstanceRef.current || cmWrapperRef.current) {
        console.log('Editor already exists, skipping initialization')
        return
      }
      
      // コンテナに既に子要素がある場合はクリア
      if (editorRef.current.children.length > 0) {
        console.log('Clearing existing content in editor container')
        editorRef.current.innerHTML = ''
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

      // CodeMirrorのWrapper要素を保存
      cmWrapperRef.current = editor.getWrapperElement()

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
        console.log('Cleaning up DOM - cmWrapperRef:', !!cmWrapperRef.current, 'editorRef:', !!editorRef.current)
        
        // 保存したWrapper要素が存在し、かつ親要素がある場合に削除
        if (cmWrapperRef.current && cmWrapperRef.current.parentNode) {
          console.log('Removing CodeMirror wrapper element')
          cmWrapperRef.current.parentNode.removeChild(cmWrapperRef.current)
        }
        
        // エディタの親要素が残っている場合はクリア
        if (editorRef.current) {
          console.log('Clearing editor container')
          editorRef.current.innerHTML = ''
        }
        
        // refをクリア
        cmInstanceRef.current = null
        ydocRef.current = null
        providerRef.current = null
        bindingRef.current = null
        cmWrapperRef.current = null
      }
    }, []) // 依存配列を空にして、コンポーネントのマウント時のみ実行

    return <div ref={editorRef} className="editor-container" />
  }
)

CodeMirrorEditor.displayName = 'CodeMirrorEditor'