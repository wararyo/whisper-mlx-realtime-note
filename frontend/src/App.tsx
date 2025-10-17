import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { CodeMirrorEditor, CodeMirrorEditorHandle } from './CodeMirrorEditor'
import { VADManager, VADManagerHandle, AudioSourceSettings, VADEvent } from './VADManager'
import './App.css'

const STORAGE_KEY = 'meeting-transcript'
const AUTO_SAVE_INTERVAL = 10000 // 10秒ごとに自動保存

type SaveStatus =
  | { hasSaved: false }
  | { hasSaved: true; lastSavedAt: Date; lastSaveType: 'auto' | 'manual' }

function App() {
  const [transcript, setTranscript] = useState<string>('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ hasSaved: false })
  const [micPermission, setMicPermission] = useState<string>('checking')
  const [audioSettings, setAudioSettings] = useState<AudioSourceSettings>({
    mic: {
      enabled: true,
      noiseSuppression: true,
      echoCancellation: true
    },
    tabAudio: { enabled: false }
  })
  const [isAudioSettingsOpen, setIsAudioSettingsOpen] = useState<boolean>(false)
  
  const editorRef = useRef<CodeMirrorEditorHandle>(null)
  const vadManagerRef = useRef<VADManagerHandle>(null)
  
  // テキストエディタの末尾に表示される、現在の状態を表すチップは基本的にCodeMirrorEditorで管理している
  // VAD側では発話が完了してから初めてidentifierが発行されるが、チップは発話開始前から表示したいため、
  // VADのidentifierとChipのidentifierは別々に管理する必要がある
  // したがって、VADのidentifierとChipのidentifierの対応関係を保持するMapを用意する
  // KeyがChipのidentifier、ValueがVADのidentifier
  const chipsRelationRef = useRef<Map<string, string | null>>(new Map())
  // listeningチップのID
  const currentListeningChipRef = useRef<string | null>(null)
  // 発話が完了した後に少し間をおいて新しいlisteningチップを追加するためのタイマーID
  const listeningChipTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 前回の保存からAUTO_SAVE_INTERVAL以上経過していたら自動保存を行う
  const handleAutoSave = useCallback(() => {
    const currentText = editorRef.current?.getText() || transcript
    const now = new Date()
    setSaveStatus(status => {
      if (currentText && (!status.hasSaved || (now.getTime() - status.lastSavedAt.getTime() > AUTO_SAVE_INTERVAL))) {
        localStorage.setItem(STORAGE_KEY, currentText)
        return {
          hasSaved: true, 
          lastSavedAt: now,
          lastSaveType: 'auto' 
        }
      }
      return status
    })
  }, [transcript])

  // テキストを議事録に追加する
  const appendToTranscript = useCallback((text: string) => {
    if (editorRef.current) {
      editorRef.current.appendText(text)
      setTranscript(editorRef.current.getText())

      // 自動保存を試みる
      handleAutoSave()
    }
  }, [handleAutoSave])

  // VADのイベントを処理する
  const handleVadEvent = useCallback((event: VADEvent) => {
    if (!editorRef.current) return

    switch (event.type) {
      case 'startInitializing':
        // すべてのチップを削除
        if (listeningChipTimerRef.current) clearTimeout(listeningChipTimerRef.current)
        currentListeningChipRef.current = null
        chipsRelationRef.current.forEach((_, chipIdentifier) => {
          if (chipIdentifier !== null) editorRef.current?.removeStatusChip(chipIdentifier)
        })
        chipsRelationRef.current.clear()
        break
        
      case 'ready':
        // listeningチップを追加
        {
          const newIdentifier = Date.now().toString()
          editorRef.current.addStatusChip({
            identifier: newIdentifier,
            type: 'ready',
            text: '話すのを待っています…',
            level: 0
          })
          chipsRelationRef.current.set(newIdentifier, null)
          currentListeningChipRef.current = newIdentifier
        }
        break
        
      case 'startListening':
        // listeningチップの状態を変更
        if (currentListeningChipRef.current !== null) {
          editorRef.current.updateStatusChip(currentListeningChipRef.current, 'listening', '聴いています…', null)
        } else {
          // listeningチップがなかったら追加
          if (listeningChipTimerRef.current) clearTimeout(listeningChipTimerRef.current)
          const newIdentifier = Date.now().toString()
          editorRef.current.addStatusChip({
            identifier: newIdentifier,
            type: 'listening',
            text: '聴いています…',
            level: 0
          })
          chipsRelationRef.current.set(newIdentifier, null)
          currentListeningChipRef.current = newIdentifier
        }
        break
        
      case 'misfire':
        // listeningチップの状態を変更
        if (currentListeningChipRef.current !== null) {
          editorRef.current.updateStatusChip(currentListeningChipRef.current, 'ready', '話すのを待っています…', null)
        }
        break

      case 'frameProcessed':
        // 現在のlisteningチップのレベルを更新
        if (currentListeningChipRef.current !== null) {
          editorRef.current.updateStatusChip(currentListeningChipRef.current, null, null, event.probability)
        }
        break

      case 'startProcessing':
        // 現在の聴いているチップを処理中チップに変更
        if (currentListeningChipRef.current !== null) {
          chipsRelationRef.current.set(currentListeningChipRef.current, event.identifier)
          editorRef.current.updateStatusChip(currentListeningChipRef.current, 'processing', '…', null)
          currentListeningChipRef.current = null
        }
        // 新しいlisteningチップを0.5秒後に追加
        listeningChipTimerRef.current = setTimeout(() => {
          const newIdentifier = Date.now().toString()
          editorRef.current?.addStatusChip({
            identifier: newIdentifier,
            type: 'ready',
            text: '話すのを待っています…',
            level: 0
          })
          chipsRelationRef.current.set(newIdentifier, null)
          currentListeningChipRef.current = newIdentifier
        }, 500)
        break
        
      case 'processed':
        // 対応する処理中チップを削除
        {
          const vadIdentifier = event.identifier
          const chipIdentifier = Array.from(chipsRelationRef.current.entries())
            .find(([_, vadId]) => vadId === vadIdentifier)?.[0]
          if (chipIdentifier) {
            editorRef.current.removeStatusChip(chipIdentifier)
            chipsRelationRef.current.delete(chipIdentifier)
          }
        }
        // テキストを追加
        appendToTranscript(event.transcript)
        break
        
      case 'error':
        // エラーが発生したチップを更新
        {
          const vadIdentifier = event.identifier
          const chipIdentifier = Array.from(chipsRelationRef.current.entries())
            .find(([_, vadId]) => vadId === vadIdentifier)?.[0]
          if (chipIdentifier) {
            editorRef.current.updateStatusChip(chipIdentifier, 'error', 'エラーが発生しました', null)
            // 2秒後に削除
            setTimeout(() => {
              if (editorRef.current) editorRef.current.removeStatusChip(chipIdentifier)
              chipsRelationRef.current.delete(chipIdentifier)
            }, 2000)
          }
        }
        break
    }
  }, [appendToTranscript, handleAutoSave, transcript])

  // マイクロフォン権限の確認
  useEffect(() => {
    const checkMicPermission = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        console.log('Microphone access granted')
        stream.getTracks().forEach(track => track.stop()) // ストリームを停止
        setMicPermission('granted')
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
  const handleMicEnabledChange = (enabled: boolean) => {
    setAudioSettings(prev => ({
      ...prev,
      mic: {
        ...prev.mic,
        enabled
      }
    }))
  }

  const handleTabAudioEnabledChange = (enabled: boolean) => {
    setAudioSettings(prev => ({
      ...prev,
      tabAudio: {
        ...prev.tabAudio,
        enabled
      }
    }))
  }

  const handleMicSettingsChange = (setting: 'noiseSuppression' | 'echoCancellation', enabled: boolean) => {
    setAudioSettings(prev => ({
      ...prev,
      mic: {
        ...prev.mic,
        [setting]: enabled
      }
    }))
  }

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
        <div className="controls">
          <span className="save-status">
            {saveStatusText}
          </span>
          <button onClick={handleManualSave} className="btn-primary">
            手動保存
          </button>
          <button onClick={handleDownload} className="btn-secondary">
            ダウンロード
          </button>
          <button onClick={handleClear} className="btn-danger">
            クリア
          </button>
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
              <label className="audio-source-item">
                <input
                  type="checkbox"
                  checked={audioSettings.mic.enabled}
                  onChange={(e) => handleMicEnabledChange(e.target.checked)}
                />
                <span>マイク</span>
                {audioSettings.mic.enabled && (
                  <div className="audio-source-item-settings">
                    <label>
                      <input
                        type="checkbox"
                        checked={audioSettings.mic.noiseSuppression}
                        onChange={(e) => handleMicSettingsChange('noiseSuppression', e.target.checked)}
                      />
                      <span>ノイズ抑制</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={audioSettings.mic.echoCancellation}
                        onChange={(e) => handleMicSettingsChange('echoCancellation', e.target.checked)}
                      />
                      <span>エコー抑制</span>
                    </label>
                  </div>
                )}
              </label>
              <label className="audio-source-item">
                <input
                  type="checkbox"
                  checked={audioSettings.tabAudio.enabled}
                  onChange={(e) => handleTabAudioEnabledChange(e.target.checked)}
                />
                <span>タブの音声</span>
              </label>
            </div>
            {!audioSettings.mic.enabled && !audioSettings.tabAudio.enabled && (
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
      
      <CodeMirrorEditor
        ref={editorRef}
        initialValue={transcript}
        onChange={setTranscript}
        onSaveRequested={handleManualSave}
        placeholder="ここに議事録が自動的に追記されます。手動での編集も可能です。"
      />

      <VADManager
        ref={vadManagerRef}
        audioSettings={audioSettings}
        micPermission={micPermission}
        onEvent={handleVadEvent}
      />
    </div>
  )
}

export default App