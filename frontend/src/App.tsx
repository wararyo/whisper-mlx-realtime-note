import { useState, useEffect, useRef, useMemo } from 'react'
import { CodeMirrorEditor, CodeMirrorEditorHandle } from './CodeMirrorEditor'
import { VADManager, VADManagerHandle, AudioSourceSettings } from './VADManager'
import './App.css'

const STORAGE_KEY = 'meeting-transcript'
const AUTO_SAVE_INTERVAL = 10000 // 10秒ごとに自動保存

type SaveStatus =
  | { hasSaved: false }
  | { hasSaved: true; lastSavedAt: Date; lastSaveType: 'auto' | 'manual' }

function App() {
  const [transcript, setTranscript] = useState<string>('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ hasSaved: false })
  const [vadStatus, setVadStatus] = useState<string>('初期化中...')
  const [micPermission, setMicPermission] = useState<string>('checking')
  const [audioSettings, setAudioSettings] = useState<AudioSourceSettings>({
    micEnabled: true,
    tabAudioEnabled: false
  })
  const [isAudioSettingsOpen, setIsAudioSettingsOpen] = useState<boolean>(false)
  
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
          editorRef.current.scrollToBottom()
        }
      }, 100)
    }
    setSaveStatus({ hasSaved: false })
  }, [])

  // 自動保存の設定
  useEffect(() => {
    const interval = setInterval(() => {
      const currentText = editorRef.current?.getText() || transcript
      if (currentText) {
        localStorage.setItem(STORAGE_KEY, currentText)
        setSaveStatus({ 
          hasSaved: true, 
          lastSavedAt: new Date(), 
          lastSaveType: 'auto' 
        })
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
      setSaveStatus({ hasSaved: false })
    }
  }

  const handleManualSave = (): void => {
    const currentText = editorRef.current?.getText() || transcript
    localStorage.setItem(STORAGE_KEY, currentText)
    setSaveStatus({ 
      hasSaved: true, 
      lastSavedAt: new Date(), 
      lastSaveType: 'manual' 
    })
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

  const saveStatusText = useMemo(() => {
    if (!saveStatus.hasSaved) return ''
    const timeStr = saveStatus.lastSavedAt.toLocaleTimeString()
    const typeStr = saveStatus.lastSaveType === 'auto' ? '自動保存' : '手動保存'
    return `${typeStr}: ${timeStr}`
  }, [saveStatus])

  return (
    <div className="container">
      <div className="header">
        <h1>議事録作成支援アプリ</h1>
        <div className="status">
          <div className={`status-indicator ${micStatus}`}></div>
          <span>{getStatusText()}</span>
        </div>
      </div>

      <div className="settings">
        <div className="settings-header" onClick={() => setIsAudioSettingsOpen(!isAudioSettingsOpen)}>
          <h2>設定</h2>
          <span className={`toggle-arrow ${isAudioSettingsOpen ? 'open' : ''}`}>▼</span>
        </div>
        {isAudioSettingsOpen && (
          <div className="settings-content">
            <h3>音声ソース</h3>
            <div className="settings-audio-sources">
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
            <h3>アクション</h3>
            <div className="settings-actions">
              <button onClick={handleRestartVAD} className="btn-secondary">
                VAD再起動
              </button>
            </div>
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
        <span className="save-status">
          {saveStatusText}
        </span>
      </div>
      
      <CodeMirrorEditor
        ref={editorRef}
        initialValue={transcript}
        onChange={setTranscript}
        placeholder="ここに議事録が自動的に追記されます。手動での編集も可能です。"
      />

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