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

// 音声ソース設定の型定義
interface AudioSourceSettings {
  micEnabled: boolean
  tabAudioEnabled: boolean
}

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
  const vadRef = useRef<any>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const tabStreamRef = useRef<MediaStream | null>(null)
  const combinedStreamRef = useRef<MediaStream | null>(null)

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

  // 音声ストリーム管理関数
  const getTabAudioStream = async (): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getDisplayMedia({ 
      audio: true,
    })

    // 音声トラックが含まれているかチェック
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      stream.getTracks().forEach(track => track.stop())
      throw new Error('タブの音声が共有されていません。共有時に音声を含めるにチェックを入れてください。')
    }

    // ビデオトラックを停止（音声のみ使用）
    stream.getVideoTracks().forEach(track => track.stop())

    return stream
  }

  const combineAudioStreams = async (micStream: MediaStream | null, tabStream: MediaStream | null): Promise<MediaStream> => {
    // 既存のAudioContextをクリーンアップ
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      await audioContextRef.current.close()
    }

    audioContextRef.current = new AudioContext()
    const destination = audioContextRef.current.createMediaStreamDestination()

    // 各音声ソースを作成して接続
    if (micStream) {
      const micSource = audioContextRef.current.createMediaStreamSource(micStream)
      micSource.connect(destination)
    }

    if (tabStream) {
      const tabSource = audioContextRef.current.createMediaStreamSource(tabStream)
      tabSource.connect(destination)
    }

    return destination.stream
  }

  const setupAudioStreams = async (): Promise<MediaStream> => {
    let micStream: MediaStream | null = null
    let tabStream: MediaStream | null = null

    try {
      // マイク音声取得
      if (audioSettings.micEnabled) {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        micStreamRef.current = micStream
      }

      // タブ音声取得
      if (audioSettings.tabAudioEnabled) {
        tabStream = await getTabAudioStream()
        tabStreamRef.current = tabStream
      }

      // 音声ストリームを結合
      const combinedStream = await combineAudioStreams(micStream, tabStream)
      combinedStreamRef.current = combinedStream

      return combinedStream
    } catch (error) {
      // エラー時はストリームをクリーンアップ
      micStream?.getTracks().forEach(track => track.stop())
      tabStream?.getTracks().forEach(track => track.stop())
      throw error
    }
  }

  const cleanupAudioStreams = () => {
    micStreamRef.current?.getTracks().forEach(track => track.stop())
    tabStreamRef.current?.getTracks().forEach(track => track.stop())
    combinedStreamRef.current?.getTracks().forEach(track => track.stop())
    
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close()
    }

    micStreamRef.current = null
    tabStreamRef.current = null
    combinedStreamRef.current = null
    audioContextRef.current = null
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
          onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/",
          baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.28/dist/",
          getStream: async () => {
            try {
              // 音声設定に基づいてストリームを取得
              if (!audioSettings.micEnabled && !audioSettings.tabAudioEnabled) {
                throw new Error('音声ソースが選択されていません')
              }
              
              return await setupAudioStreams()
            } catch (error) {
              console.error('Audio stream setup failed:', error)
              throw error
            }
          },
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
        cleanupAudioStreams()
      }
    }

    if (micPermission === 'granted') {
      initVAD()
    }

    // クリーンアップ関数
    return () => {
      if (vadRef.current) {
        vadRef.current.pause()
        vadRef.current = null
      }
      cleanupAudioStreams()
    }
  }, [micPermission, audioSettings])

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
    </div>
  )
}

export default App