import { useState, useEffect, useRef } from 'react'
import { CodeMirrorEditor, CodeMirrorEditorHandle } from './CodeMirrorEditor'
import './App.css'

// グローバルのvadオブジェクトの型定義
declare global {
  interface Window {
    vad: {
      MicVAD: {
        new: (options: any) => Promise<{
          start: () => void
          pause: () => void
          destroy: () => void
        }>
      }
      utils: {
        encodeWAV: (audioData: Float32Array) => ArrayBuffer
      }
    }
  }
}

const API_BASE_URL = 'http://localhost:9000'
const STORAGE_KEY = 'meeting-transcript'
const AUTO_SAVE_INTERVAL = 10000 // 10秒ごとに自動保存

function App() {
  const [transcript, setTranscript] = useState<string>('')
  const [saveStatus, setSaveStatus] = useState<string>('準備中...')
  const [vadStatus, setVadStatus] = useState<string>('初期化中...')
  const [micPermission, setMicPermission] = useState<string>('checking')
  
  const editorRef = useRef<CodeMirrorEditorHandle>(null)
  const vadRef = useRef<any>(null)

  // テキストを議事録に追加する関数
  const appendToTranscript = (text: string) => {
    if (editorRef.current) {
      editorRef.current.appendText(text)
      setTranscript(editorRef.current.getText())
    }
  }

  // 保存状況を更新する関数
  const updateSaveStatus = (status: string) => {
    setSaveStatus(status)
  }

  // マイクロフォン権限の確認
  useEffect(() => {
    const checkMicPermission = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        console.log('Microphone access granted')
        setMicPermission('granted')
        stream.getTracks().forEach(track => track.stop()) // ストリームを停止
      } catch (error) {
        console.error('Microphone access denied:', error)
        setMicPermission('denied')
      }
    }
    
    checkMicPermission()
  }, [])

  // CDN版VADの初期化
  useEffect(() => {
    const initVAD = async () => {
      try {
        // CDNのロードを待機
        let attempts = 0
        while (!window.vad && attempts < 50) {
          await new Promise(resolve => setTimeout(resolve, 100))
          attempts++
        }

        if (!window.vad) {
          throw new Error('VAD CDN failed to load')
        }

        console.log('Initializing VAD...')
        setVadStatus('VAD初期化中...')

        const myvad = await window.vad.MicVAD.new({
          positiveSpeechThreshold: 0.5,
          negativeSpeechThreshold: 0.45,
          minSpeechFrames: 3,
          preSpeechPadFrames: 8,
          redemptionFrames: 10,
          model: 'v5',
          onSpeechStart: () => {
            console.log("Speech started")
            setVadStatus('話しています...')
          },
          onSpeechEnd: async (arr: Float32Array) => {
            console.log("Speech ended")
            setVadStatus('処理中...')
            
            try {
              const wavBuffer = window.vad.utils.encodeWAV(arr)
              const file = new File([wavBuffer], `file${Date.now()}.wav`)
              const formData = new FormData()
              formData.append("file", file)
              
              const resp = await fetch(`${API_BASE_URL}/api/transcribe`, {
                method: "POST",
                body: formData,
              })
              const resp2 = await resp.json()
              console.log(resp2.text)
              
              if (resp2.text && resp2.text.trim()) {
                const timestamp = new Date().toLocaleTimeString()
                const textWithTime = `[${timestamp}] ${resp2.text.trim()}`
                appendToTranscript(textWithTime)
              }
              
              setVadStatus('音声認識中')
            } catch (err) {
              console.error(err)
              setVadStatus('エラー')
              setTimeout(() => {
                setVadStatus('音声認識中')
              }, 2000)
            }
          }
        })
        
        vadRef.current = myvad
        myvad.start()
        console.log("音声認識を開始しました")
        setVadStatus('音声認識中')
        updateSaveStatus('音声認識開始 - 準備完了')
      } catch (e) {
        console.error("音声認識の初期化に失敗:", e)
        setVadStatus('初期化失敗')
        updateSaveStatus('音声認識の初期化に失敗しました')
      }
    }

    if (micPermission === 'granted') {
      initVAD()
    }
  }, [micPermission])

  // ページロード時に保存されたテキストを復元
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      setTranscript(saved)
      // エディタが準備できてから復元
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.setText(saved)
        }
      }, 100)
      setSaveStatus('復元完了')
    } else {
      setSaveStatus('新規作成')
    }
  }, [])

  // 自動保存の設定
  useEffect(() => {
    const interval = setInterval(() => {
      const currentText = editorRef.current?.getText() || transcript
      if (currentText) {
        localStorage.setItem(STORAGE_KEY, currentText)
        setSaveStatus(`自動保存: ${new Date().toLocaleTimeString()}`)
      }
    }, AUTO_SAVE_INTERVAL)

    return () => clearInterval(interval)
  }, [transcript])

  const handleClear = (): void => {
    if (window.confirm('すべてのテキストを削除しますか？')) {
      if (editorRef.current) {
        editorRef.current.clearText()
      }
      setTranscript('')
      localStorage.removeItem(STORAGE_KEY)
      setSaveStatus('クリア完了')
    }
  }

  const handleManualSave = (): void => {
    const currentText = editorRef.current?.getText() || transcript
    localStorage.setItem(STORAGE_KEY, currentText)
    setSaveStatus(`手動保存: ${new Date().toLocaleTimeString()}`)
  }

  const handleDownload = (): void => {
    const currentText = editorRef.current?.getText() || transcript
    if (!currentText) {
      alert('ダウンロードするテキストがありません')
      return
    }

    const blob = new Blob([currentText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `議事録_${new Date().toISOString().split('T')[0]}.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleRestartVAD = (): void => {
    if (vadRef.current) {
      try {
        console.log('Restarting VAD...')
        vadRef.current.pause()
        setTimeout(() => {
          vadRef.current?.start()
          console.log('VAD restarted')
        }, 500)
      } catch (error) {
        console.error('Failed to restart VAD:', error)
      }
    }
  }

  // ステータス表示用のテキストを生成
  const getStatusText = () => {
    if (micPermission === 'denied') return 'マイクアクセス拒否'
    return vadStatus
  }

  const micStatus = vadStatus === '処理中...' ? 'active' : 'inactive'

  return (
    <div className="container">
      <div className="header">
        <h1>議事録作成支援アプリ</h1>
        <div className="status">
          <div className={`status-indicator ${micStatus}`}></div>
          <span>{getStatusText()}</span>
        </div>
      </div>
      
      <div className="controls">
        <button onClick={handleClear} className="btn-danger">
          クリア
        </button>
        <button onClick={handleManualSave} className="btn-primary">
          手動保存
        </button>
        <button onClick={handleDownload} className="btn-secondary">
          ダウンロード
        </button>
        <button onClick={handleRestartVAD} className="btn-secondary">
          VAD再起動
        </button>
      </div>
      
      <CodeMirrorEditor
        ref={editorRef}
        initialValue={transcript}
        onChange={setTranscript}
        placeholder="ここに議事録が自動的に追記されます。手動での編集も可能です。"
      />
      
      <div className="save-status">
        自動保存: {saveStatus}
      </div>
    </div>
  )
}

export default App