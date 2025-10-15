/*
 * VADの処理を行うモジュール
 * vad-reactを使用したところ音声認識が開始されない問題が確認されたため、
 * 不本意ながらCDN版を使用しています
 * VADと言いながらSTTもここでしているため名前を変更したほうがいいかもしれない
*/

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'

const ONNX_WASM_PATH = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/"
const ASSET_PATH = "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.28/dist/"
const API_BASE_URL = 'http://localhost:9000'

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

// 音声ソース設定の型定義
export interface AudioSourceSettings {
  micEnabled: boolean
  tabAudioEnabled: boolean
}

export type VADEvent = 
  | { type: 'startInitializing' }
  | { type: 'ready' }
  | { type: 'frameProcessed'; probability: number }
  | { type: 'startListening' }
  | { type: 'misfire' }
  | { type: 'startProcessing'; identifier: string }
  | { type: 'processed'; identifier: string; transcript: string }
  | { type: 'error'; identifier: (string | null); message: string }

interface VADManagerProps {
  audioSettings: AudioSourceSettings
  micPermission: string
  withTimestamp?: boolean
  onEvent: (event: VADEvent) => void
}

// VADManagerの参照型
export interface VADManagerHandle {
  restartVAD: () => void
}

export const VADManager = forwardRef<VADManagerHandle, VADManagerProps>(({
  audioSettings,
  micPermission,
  withTimestamp,
  onEvent
}, ref) => {
  const vadRef = useRef<any>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const tabStreamRef = useRef<MediaStream | null>(null)
  const combinedStreamRef = useRef<MediaStream | null>(null)

  // タブの音声ストリームを取得
  const getTabAudioStream = useCallback(async (): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getDisplayMedia({ 
      audio: true,
      video: true // 一時的に必要
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
  }, [])

  // 音声ストリームを結合
  const combineAudioStreams = useCallback(async (micStream: MediaStream | null, tabStream: MediaStream | null): Promise<MediaStream> => {
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
  }, [])

  // 音声ストリームをセットアップ
  const setupAudioStreams = useCallback(async (): Promise<MediaStream> => {
    let micStream: MediaStream | null = null
    let tabStream: MediaStream | null = null

    try {
      // マイク音声取得
      if (audioSettings.micEnabled) {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        })
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
  }, [audioSettings, getTabAudioStream, combineAudioStreams])

  // 音声ストリームをクリーンアップ
  const cleanupAudioStreams = useCallback(() => {
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
  }, [])

  // 外部からアクセス可能な関数を公開
  useImperativeHandle(ref, () => ({
    restartVAD: () => {
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
  }), [])

  // VADの初期化
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
        onEvent({ type: 'startInitializing' })

        const myvad = await window.vad.MicVAD.new({
          positiveSpeechThreshold: 0.4,
          negativeSpeechThreshold: 0.2,
          minSpeechMs: 200,
          preSpeechPadMs: 500,
          redemptionMs: 500,
          submitUserSpeechOnPause: true,
          model: 'v5',
          onnxWASMBasePath: ONNX_WASM_PATH,
          baseAssetPath: ASSET_PATH,
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
            onEvent({ type: 'startListening' })
          },
          onFrameProcessed: (probabilities: { isSpeech: number; notSpeech: number }, _: Float32Array) => {
            onEvent({ type: 'frameProcessed', probability: probabilities.isSpeech })
          },
          onVADMisfire: () => {
            console.log("VAD misfire")
            onEvent({ type: 'misfire' })
          },
          onSpeechEnd: async (arr: Float32Array) => {
            console.log("Speech ended")
            const identifier = Date.now().toString()
            onEvent({ type: 'startProcessing', identifier })
            
            try {
              const wavBuffer = window.vad.utils.encodeWAV(arr)
              const file = new File([wavBuffer], `${identifier}.wav`)
              const formData = new FormData()
              formData.append("file", file)

              const responseText = await fetch(`${API_BASE_URL}/api/transcribe?identifier=${identifier}`, {
                method: "POST",
                body: formData,
              })
              const response = await responseText.json()
              console.log(response.text)

              let text = ""

              if (response.segments && Array.isArray(response.segments)) {
                for (const segment of response.segments) {
                  let segmentText = segment.text.trim()
                  segmentText = segmentText?.replace(/ご視聴ありがとうございました。?/g, "") // 無音に近い音を渡すとよくこれに誤認識される
                  if (!segmentText) continue
                  if (segmentText.length > 20) segmentText += "\n" // 長い文は改行を追加
                  else segmentText += " " // 短い文はスペースを追加
                  if (withTimestamp) {
                    const startTime = new Date(segment.start * 1000).toISOString().substr(11, 8)
                    text += `[${startTime}] ${segmentText}`
                  } else {
                    text += segmentText
                  }
                }
              } else if (response.text && response.text.trim) {
                if (withTimestamp) {
                  const timestamp = new Date().toISOString().substr(11, 8)
                  text = `[${timestamp}] ${response.text.trim()}`
                } else {
                  text = response.text.trim()
                }
              }
              
              onEvent({ type: 'processed', identifier, transcript: text })
            } catch (err) {
              console.error(err)
              onEvent({ type: 'error', identifier, message: err instanceof Error ? err.message : 'Unknown error' })
            }
          }
        })
        
        vadRef.current = myvad
        myvad.start()
        console.log("音声認識を開始しました")
        onEvent({ type: 'ready' })
      } catch (e) {
        console.error("音声認識の初期化に失敗:", e)
        onEvent({ type: 'error', identifier: null, message: e instanceof Error ? e.message : 'Unknown error' })
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

  return null // このコンポーネントはUIを持たない
})

VADManager.displayName = 'VADManager'