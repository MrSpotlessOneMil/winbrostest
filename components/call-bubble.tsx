"use client"

import { useState, useRef, useEffect } from "react"
import { Phone } from "lucide-react"

interface Call {
  id: number
  phone_number?: string
  caller_name?: string
  direction?: string
  duration_seconds?: number
  outcome?: string
  transcript?: string
  audio_url?: string
  created_at: string
}

interface CallBubbleProps {
  call: Call
}

const SPEED_OPTIONS = [0.8, 1, 1.2, 1.5, 1.7, 2] as const

export function CallBubble({ call }: CallBubbleProps) {
  const isOutbound = call.direction === "outbound"
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(call.duration_seconds || 0)
  const [isLoading, setIsLoading] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const speedMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
      setIsLoading(false)
    }

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
    }

    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    const handleError = () => {
      setIsLoading(false)
    }

    audio.addEventListener("loadedmetadata", handleLoadedMetadata)
    audio.addEventListener("timeupdate", handleTimeUpdate)
    audio.addEventListener("ended", handleEnded)
    audio.addEventListener("error", handleError)

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata)
      audio.removeEventListener("timeupdate", handleTimeUpdate)
      audio.removeEventListener("ended", handleEnded)
      audio.removeEventListener("error", handleError)
    }
  }, [])

  // Close speed menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setShowSpeedMenu(false)
      }
    }
    if (showSpeedMenu) {
      document.addEventListener("mousedown", handleClick)
      return () => document.removeEventListener("mousedown", handleClick)
    }
  }, [showSpeedMenu])

  const togglePlay = () => {
    if (!call.audio_url) return
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      setIsLoading(true)
      audio.playbackRate = speed
      audio.play().then(() => {
        setIsLoading(false)
        setIsPlaying(true)
      }).catch(() => {
        setIsLoading(false)
      })
    }
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (audioRef.current && duration > 0) {
      const rect = e.currentTarget.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const newTime = (clickX / rect.width) * duration
      audioRef.current.currentTime = newTime
      setCurrentTime(newTime)
    }
  }

  const changeSpeed = (newSpeed: number) => {
    setSpeed(newSpeed)
    setShowSpeedMenu(false)
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed
    }
  }

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || isNaN(seconds)) return "0:00"
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[80%] min-w-[260px] ${
          isOutbound
            ? "bg-purple-500/15 border-purple-500/30"
            : "bg-zinc-700/60 border-zinc-600/40"
        } border rounded-2xl ${isOutbound ? "rounded-br-md" : "rounded-bl-md"} px-4 py-3`}
      >
        {/* Call header */}
        <div
          className={`text-[10px] uppercase tracking-wider mb-2 font-medium flex items-center gap-1.5 ${
            isOutbound ? "text-purple-300" : "text-zinc-400"
          }`}
        >
          <Phone className="w-3 h-3" />
          {isOutbound ? "Outbound" : call.caller_name?.split(" ")[0] || "Inbound"}
        </div>

        {/* Audio player controls */}
        {call.audio_url ? (
          <div className="flex items-center gap-2.5">
            {/* Play/Pause button */}
            <button
              onClick={togglePlay}
              disabled={isLoading}
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                isOutbound
                  ? "bg-purple-500/30 hover:bg-purple-500/50 text-purple-200"
                  : "bg-zinc-600/60 hover:bg-zinc-600/90 text-zinc-200"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {isLoading ? (
                <div className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
              ) : isPlaying ? (
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Progress bar */}
            <div className="flex-1 flex flex-col gap-1">
              <div
                className="h-1.5 bg-zinc-600/50 rounded-full overflow-hidden cursor-pointer"
                onClick={handleSeek}
              >
                <div
                  className={`h-full rounded-full transition-all duration-100 ${
                    isOutbound ? "bg-purple-400" : "bg-zinc-300"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Timestamp */}
            <span className="text-[11px] text-zinc-400 tabular-nums flex-shrink-0">
              {formatTime(currentTime)}/{formatTime(duration)}
            </span>

            {/* Speed button */}
            <div className="relative" ref={speedMenuRef}>
              <button
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors ${
                  isOutbound
                    ? "text-purple-300 hover:bg-purple-500/20"
                    : "text-zinc-400 hover:bg-zinc-600/50"
                }`}
              >
                {speed}x
              </button>

              {showSpeedMenu && (
                <div className="absolute bottom-full right-0 mb-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 z-50 min-w-[52px]">
                  {SPEED_OPTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => changeSpeed(s)}
                      className={`w-full text-left px-3 py-1 text-[11px] hover:bg-zinc-700/70 ${
                        speed === s ? "text-purple-300 font-medium" : "text-zinc-300"
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Fallback when no audio */
          <div className="space-y-1">
            {call.duration_seconds !== undefined && call.duration_seconds > 0 && (
              <div className="text-sm text-zinc-300">
                Duration: {formatTime(call.duration_seconds)}
              </div>
            )}
            {call.outcome && (
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    call.outcome === "booked"
                      ? "bg-emerald-400/10 text-emerald-400"
                      : call.outcome === "voicemail"
                      ? "bg-yellow-400/10 text-yellow-400"
                      : "bg-zinc-600/50 text-zinc-400"
                  }`}
                >
                  {call.outcome}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Call time and outcome */}
        <div className={`text-[10px] mt-2 ${isOutbound ? "text-purple-300/60" : "text-zinc-500"}`}>
          {new Date(call.created_at).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}
          {call.outcome && (
            <span className={`ml-2 ${call.outcome === "booked" ? "text-emerald-400" : ""}`}>
              {call.outcome}
            </span>
          )}
        </div>

        {/* Hidden audio element */}
        {call.audio_url && (
          <audio ref={audioRef} src={call.audio_url} preload="metadata" />
        )}
      </div>
    </div>
  )
}
