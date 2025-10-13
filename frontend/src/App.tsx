import { useState, useEffect, useRef } from 'react'
import { CodeMirrorEditor, CodeMirrorEditorHandle } from './CodeMirrorEditor'
import { VADManager, VADManagerHandle, AudioSourceSettings } from './VADManager'
import './App.css'

const STORAGE_KEY = 'meeting-transcript'
const AUTO_SAVE_INTERVAL = 10000 // 10秒ごとに自動保存


function App() {
  const [transcript, setTranscript] = useState<string>('')
  const [saveStatus, setSaveStatus] = useState<string>('準備中...')
  const [vadStatus, setVadStatus] = useState<string>('初期化中...')
  const [micPermission, setMicPermission] = useState<string>('checking')
  const [audioSettings, setAudioSettings] = useState<AudioSourceSettings>({
    micEnabled: true,
    tabAudioEnabled: false
  })
  
  const editorRef = useRef<CodeMirrorEditorHandle>(null)
  const vadManagerRef = useRef<VADManagerHandle>(null)

  // テキストを議事録に追加する関数
  const appendToTranscript = (text: string) => {
    if (editorRef.current) {
      editorRef.current.appendText(text)
      setTranscript(editorRef.current.getText())
    }
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
    if (vadManagerRef.current) {
      vadManagerRef.current.restartVAD()
    }
  }

  // 音声ソース設定のハンドル関数
  const handleAudioSettingsChange = (setting: keyof AudioSourceSettings, enabled: boolean) => {
    setAudioSettings(prev => ({
      ...prev,
      [setting]: enabled
    }))
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

      <div className="audio-settings">
        <h3>音声ソース設定</h3>
        <div className="audio-source-controls">
          <label className="audio-source-option">
            <input
              type="checkbox"
              checked={audioSettings.micEnabled}
              onChange={(e) => handleAudioSettingsChange('micEnabled', e.target.checked)}
            />
            <span>マイク</span>
          </label>
          <label className="audio-source-option">
            <input
              type="checkbox"
              checked={audioSettings.tabAudioEnabled}
              onChange={(e) => handleAudioSettingsChange('tabAudioEnabled', e.target.checked)}
            />
            <span>タブの音声（画面共有）</span>
          </label>
        </div>
        {!audioSettings.micEnabled && !audioSettings.tabAudioEnabled && (
          <div className="warning">
            ⚠️ 少なくとも1つの音声ソースを選択してください
          </div>
        )}
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

      <VADManager
        ref={vadManagerRef}
        audioSettings={audioSettings}
        micPermission={micPermission}
        onStatusChange={setVadStatus}
        onTranscriptReceived={appendToTranscript}
      />
    </div>
  )
}

export default App