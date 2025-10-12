import { useState, useEffect, useRef } from 'react'
import { useMicVAD } from '@ricky0123/vad-react'
import axios from 'axios'
import { CodeMirrorEditor, CodeMirrorEditorHandle } from './CodeMirrorEditor'
import './App.css'

const API_BASE_URL = 'http://localhost:9000'
const STORAGE_KEY = 'meeting-transcript'
const AUTO_SAVE_INTERVAL = 10000 // 10秒ごとに自動保存

interface TranscribeResponse {
  text: string
}

function App() {
  const [transcript, setTranscript] = useState<string>('')
  const [isRecording, setIsRecording] = useState<boolean>(false)
  const [saveStatus, setSaveStatus] = useState<string>('準備中...')
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const editorRef = useRef<CodeMirrorEditorHandle>(null)

  // VAD（Voice Activity Detection）の設定
  const vad = useMicVAD({
    onSpeechStart: () => {
      console.log('Speech start detected')
      startRecording()
    },
    onSpeechEnd: (_audio: Float32Array) => {
      console.log('Speech end detected')
      stopRecording()
    },
    onVADMisfire: () => {
      console.log('VAD misfire')
    },
    positiveSpeechThreshold: 0.4,
    negativeSpeechThreshold: 0.38,
    minSpeechMs: 300,
    preSpeechPadMs: 800,
    redemptionMs: 1000,
    model: 'v5'
  })

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

  const startRecording = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      
      mediaRecorderRef.current = new MediaRecorder(stream)
      chunksRef.current = []

      mediaRecorderRef.current.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/wav' })
        await transcribeAudio(audioBlob)
        stream.getTracks().forEach(track => track.stop())
      }

      mediaRecorderRef.current.start()
      setIsRecording(true)
    } catch (error) {
      console.error('録音開始エラー:', error)
    }
  }

  const stopRecording = (): void => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  const transcribeAudio = async (audioBlob: Blob): Promise<void> => {
    const formData = new FormData()
    formData.append('file', audioBlob, 'recording.wav')

    try {
      const response = await axios.post<TranscribeResponse>(
        `${API_BASE_URL}/api/transcribe`, 
        formData, 
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        }
      )

      if (response.data && response.data.text) {
        const newText = response.data.text.trim()
        if (newText && editorRef.current) {
          // CodeMirrorエディタに直接追加
          editorRef.current.appendText(newText)
          // stateも更新（保存用）
          setTranscript(editorRef.current.getText())
        }
      }
    } catch (error) {
      console.error('音声認識エラー:', error)
      setSaveStatus('音声認識に失敗しました')
    }
  }

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

  // VADの状態を取得
  const micStatus = vad.userSpeaking ? 'active' : 'inactive'

  return (
    <div className="container">
      <div className="header">
        <h1>議事録作成支援アプリ</h1>
        <div className="status">
          <div className={`status-indicator ${micStatus}`}></div>
          <span>{vad.userSpeaking ? '話し中' : '音声認識中'}</span>
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
