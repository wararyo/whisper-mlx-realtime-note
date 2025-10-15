import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import * as Y from 'yjs'
import { yCollab } from 'y-codemirror.next'
import { EditorView, lineNumbers, Decoration, WidgetType } from '@codemirror/view'
import { EditorState, StateField, StateEffect } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { markdown } from '@codemirror/lang-markdown'
import { keymap } from '@codemirror/view'
import { TranscribeProvider } from './TranscribeProvider'
import './CodeMirror.css'

// ステータスチップの種類
export type StatusChipType = 'ready' | 'listening' | 'processing' | 'error'

// ステータスチップのデータ
export interface StatusChip {
  identifier: string
  type: StatusChipType
  text: string
  level: number // 音声の入力レベル(0.0 - 1.0)
}

// ステータスチップを管理するStateEffect
const addStatusChipEffect = StateEffect.define<StatusChip>()
const removeStatusChipEffect = StateEffect.define<string>() // chip id
const updateStatusChipEffect = StateEffect.define<{ id: string; type: StatusChipType | null; text: string | null; level: number | null }>()

// ステータスチップウィジェット
class StatusChipWidget extends WidgetType {
  constructor(private chip: StatusChip) {
    super()
  }

  toDOM() {
    const element = document.createElement('span')
    element.className = `status-chip status-chip-${this.chip.type}`
    element.style.setProperty('--level', this.chip.level.toString())
    element.textContent = this.chip.text
    element.setAttribute('data-chip-id', this.chip.identifier)
    return element
  }

  eq(other: StatusChipWidget) {
    return this.chip.identifier === other.chip.identifier && 
           this.chip.text === other.chip.text && 
           this.chip.type === other.chip.type &&
           this.chip.level === other.chip.level
  }

  updateDOM(dom: HTMLElement): boolean {
    if (dom.getAttribute('data-chip-id') === this.chip.identifier) {
      // DOM要素のクラス名とテキストを更新
      const newClassName = `status-chip status-chip-${this.chip.type}`
      dom.className = newClassName
      dom.style.setProperty('--level', this.chip.level.toString())
      dom.textContent = this.chip.text
      return true // 更新が成功したことを示す
    }
    return false // 更新されなかったことを示す
  }

  get estimatedHeight() {
    return 24
  }
}

// ステータスチップを管理するStateField
const statusChipsField = StateField.define<StatusChip[]>({
  create: () => [],
  update: (chips, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(addStatusChipEffect)) {
        // 同じIDのチップがあれば置き換え
        const existingIndex = chips.findIndex(chip => chip.identifier === effect.value.identifier)
        if (existingIndex >= 0) {
          chips = [...chips.slice(0, existingIndex), effect.value, ...chips.slice(existingIndex + 1)]
        } else {
          chips = [...chips, effect.value]
        }
      } else if (effect.is(removeStatusChipEffect)) {
        chips = chips.filter(chip => chip.identifier !== effect.value)
      } else if (effect.is(updateStatusChipEffect)) {
        chips = chips.map(chip => 
          chip.identifier === effect.value.id 
            ? {
              ...chip,
              ...(effect.value.type ? { type: effect.value.type } : {}),
              ...(effect.value.text ? { text: effect.value.text } : {}),
              ...(effect.value.level !== null ? { level: effect.value.level } : {})
            }
            : chip
        )
      }
    }
    return chips
  }
})

// ステータスチップ用のエクステンション
const statusChipExtension = [
  statusChipsField,
  EditorView.decorations.from(statusChipsField, (chips: StatusChip[]) => {
    return (view: EditorView) => {
      const decorations: any[] = []
      
      if (chips.length > 0) {
        const doc = view.state.doc
        const lastLine = doc.lines
        const lastLineEnd = doc.line(lastLine).to
        
        chips.forEach((chip: StatusChip) => {
          const decoration = Decoration.widget({
            widget: new StatusChipWidget(chip),
            side: 1,
            block: false
          })
          decorations.push(decoration.range(lastLineEnd))
        })
      }
      
      return Decoration.set(decorations)
    }
  })
]

export interface CodeMirrorEditorHandle {
  appendText: (text: string) => void
  clearText: () => void
  getText: () => string
  setText: (text: string) => void
  scrollToBottom: () => void
  addStatusChip: (chip: StatusChip) => void
  removeStatusChip: (chipId: string) => void
  updateStatusChip: (chipId: string, type: StatusChipType | null, text: string | null, level: number | null) => void
}

interface CodeMirrorEditorProps {
  initialValue?: string
  onChange?: (value: string) => void
  placeholder?: string
}

export const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, CodeMirrorEditorProps>(
  ({ initialValue = '', onChange }, ref) => {
    const editorRef = useRef<HTMLDivElement>(null)
    const cmViewRef = useRef<EditorView | null>(null)
    const ydocRef = useRef<Y.Doc | null>(null)
    const providerRef = useRef<TranscribeProvider | null>(null)
    const onChangeRef = useRef(onChange)
    const cmWrapperRef = useRef<HTMLElement | null>(null) // CodeMirrorのDOM要素を保存

    // onChangeが変わった時にrefを更新
    useEffect(() => {
      onChangeRef.current = onChange
    }, [onChange])

    useImperativeHandle(ref, () => ({
      appendText: (text: string) => {
        if (providerRef.current && cmViewRef.current) {
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
      },
      scrollToBottom: scrollToBottom,
      addStatusChip: (chip: StatusChip) => {
        if (cmViewRef.current) {
          cmViewRef.current.dispatch({
            effects: addStatusChipEffect.of(chip)
          })
        }
      },
      removeStatusChip: (chipId: string) => {
        if (cmViewRef.current) {
          cmViewRef.current.dispatch({
            effects: removeStatusChipEffect.of(chipId)
          })
        }
      },
      updateStatusChip: (chipId: string, type: StatusChipType | null, text: string | null, level: number | null) => {
        if (cmViewRef.current) {
          cmViewRef.current.dispatch({
            effects: updateStatusChipEffect.of({ id: chipId, type, text, level })
          })
        }
      }
    }))

    // スクロール関連のヘルパー関数
    const scrollToBottom = () => {
      if (cmViewRef.current) {
        const view = cmViewRef.current
        const lastLine = view.state.doc.lines
        const lastLineStart = view.state.doc.line(lastLine).from
        view.dispatch({
          effects: EditorView.scrollIntoView(lastLineStart, { y: 'end' })
        })
      }
    }

    const isScrolledToBottom = () => {
      if (!cmViewRef.current) return false
      
      const view = cmViewRef.current
      const { scrollTop, scrollHeight, clientHeight } = view.scrollDOM
      const threshold = 50 // 50px以内なら「下にいる」と判定
      
      return (scrollTop + clientHeight + threshold >= scrollHeight)
    }

    useEffect(() => {
      if (!editorRef.current) {
        console.log('Editor ref not available, skipping initialization')
        return
      }
      
      // 既にエディタが作成されている場合は早期リターン
      if (cmViewRef.current || cmWrapperRef.current) {
        console.log('Editor already exists, skipping initialization')
        return
      }
      
      // コンテナに既に子要素がある場合はクリア
      if (editorRef.current.children.length > 0) {
        console.log('Clearing existing content in editor container')
        editorRef.current.innerHTML = ''
      }
      
      console.log('Initializing CodeMirror v6 editor')

      // Y.jsドキュメントとプロバイダーを初期化
      const ydoc = new Y.Doc()
      const yText = ydoc.getText('transcript')
      const provider = new TranscribeProvider(ydoc, 'transcript')

      // 初期値がある場合は設定
      if (initialValue) {
        yText.insert(0, initialValue)
      }

      // カスタムハイライトスタイルを定義
      const highlightStyle = HighlightStyle.define([
        { tag: tags.heading1, color: 'black', fontSize: '1.4em', fontWeight: '700' },
        { tag: tags.heading2, color: 'black', fontSize: '1.3em', fontWeight: '700' },
        { tag: tags.heading3, color: 'black', fontSize: '1.2em', fontWeight: '700' },
        { tag: tags.heading4, color: 'black', fontSize: '1.1em', fontWeight: '700' },
        { tag: tags.strong, color: 'black', fontWeight: '700' }, // 太字
        { tag: tags.quote, color: '#6a737d' }, // 引用
        { tag: tags.emphasis, fontStyle: 'italic' }, // 斜体
        { tag: tags.url, textDecoration: 'underline' }, // URLに下線をつける
        { tag: tags.strikethrough, textDecoration: 'line-through' }, // 打ち消し線（GFM拡張）
      ])

      // CodeMirror v6のエクステンションを設定
      const extensions = [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        lineNumbers(),
        EditorView.lineWrapping,
        syntaxHighlighting(highlightStyle),
        markdown(),
        yCollab(yText, provider.awareness),
        statusChipExtension,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChangeRef.current) {
            onChangeRef.current(update.state.doc.toString())
          }
        })
      ]

      // EditorStateを作成
      const state = EditorState.create({
        doc: yText.toString(),
        extensions
      })

      // EditorViewを作成
      const view = new EditorView({
        state,
        parent: editorRef.current
      })

      // CodeMirrorのDOM要素を保存
      cmWrapperRef.current = view.dom

      // Refに保存
      cmViewRef.current = view
      ydocRef.current = ydoc
      providerRef.current = provider

      // クリーンアップ関数
      return () => {
        console.log('Cleaning up CodeMirror v6 editor')
        view.destroy()
        provider.destroy()
        ydoc.destroy()
        
        // エディタの親要素が残っている場合はクリア
        if (editorRef.current) {
          console.log('Clearing editor container')
          editorRef.current.innerHTML = ''
        }
        
        // refをクリア
        cmViewRef.current = null
        ydocRef.current = null
        providerRef.current = null
        cmWrapperRef.current = null
      }
    }, []) // 依存配列を空にして、コンポーネントのマウント時のみ実行

    return <div ref={editorRef} className="editor-container" />
  }
)

CodeMirrorEditor.displayName = 'CodeMirrorEditor'