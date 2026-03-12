'use client'

import React from 'react'

export default function CubeLoader({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center h-full bg-slate-950/0 perspective-container ${compact ? 'gap-4 p-4' : 'gap-12 p-12 flex-1 min-h-[400px]'}`}>

      {/* 3D Scene Wrapper */}
      <div className={`relative flex items-center justify-center preserve-3d ${compact ? 'w-14 h-14' : 'w-24 h-24'}`}>

        {/* THE SPINNING CUBE CONTAINER */}
        <div className='relative w-full h-full preserve-3d animate-cube-spin'>

          {/* Internal Core (The energy source) */}
          <div className={`absolute inset-0 m-auto rounded-full blur-md animate-pulse-fast ${compact ? 'w-5 h-5 shadow-[0_0_20px_rgba(255,255,255,0.6)]' : 'w-8 h-8 shadow-[0_0_40px_rgba(255,255,255,0.8)]'}`} style={{ backgroundColor: 'white' }} />

          {/* Front */}
          <div className='side-wrapper front'>
            <div className='face bg-cyan-500/10 border-2 border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)]' />
          </div>

          {/* Back */}
          <div className='side-wrapper back'>
            <div className='face bg-cyan-500/10 border-2 border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)]' />
          </div>

          {/* Right */}
          <div className='side-wrapper right'>
            <div className='face bg-purple-500/10 border-2 border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.4)]' />
          </div>

          {/* Left */}
          <div className='side-wrapper left'>
            <div className='face bg-purple-500/10 border-2 border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.4)]' />
          </div>

          {/* Top */}
          <div className='side-wrapper top'>
            <div className='face bg-indigo-500/10 border-2 border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.4)]' />
          </div>

          {/* Bottom */}
          <div className='side-wrapper bottom'>
            <div className='face bg-indigo-500/10 border-2 border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.4)]' />
          </div>
        </div>

        {/* Floor Shadow */}
        <div className={`absolute bg-black/40 blur-xl rounded-[100%] animate-shadow-breathe ${compact ? '-bottom-12 w-14 h-5' : '-bottom-20 w-24 h-8'}`} />
      </div>

      <style jsx>{`
        .perspective-container {
          perspective: 1200px;
        }

        .preserve-3d {
          transform-style: preserve-3d;
        }

        @keyframes cubeSpin {
          0% { transform: rotateX(0deg) rotateY(0deg); }
          100% { transform: rotateX(360deg) rotateY(360deg); }
        }

        @keyframes breathe {
          0%, 100% { transform: translateZ(48px); opacity: 0.8; }
          50% { transform: translateZ(80px); opacity: 0.4; border-color: rgba(255,255,255,0.8); }
        }

        @keyframes pulse-fast {
            0%, 100% { transform: scale(0.8); opacity: 0.5; }
            50% { transform: scale(1.2); opacity: 1; }
        }

        @keyframes shadow-breathe {
            0%, 100% { transform: scale(1); opacity: 0.4; }
            50% { transform: scale(1.5); opacity: 0.2; }
        }

        .animate-cube-spin {
          animation: cubeSpin 8s linear infinite;
        }

        .animate-pulse-fast {
            animation: pulse-fast 2s ease-in-out infinite;
        }

        .animate-shadow-breathe {
            animation: shadow-breathe 3s ease-in-out infinite;
        }

        .side-wrapper {
          position: absolute;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          transform-style: preserve-3d;
        }

        .face {
          width: 100%;
          height: 100%;
          position: absolute;
          animation: breathe 3s ease-in-out infinite;
          backdrop-filter: blur(2px);
        }

        .front  { transform: rotateY(0deg); }
        .back   { transform: rotateY(180deg); }
        .right  { transform: rotateY(90deg); }
        .left   { transform: rotateY(-90deg); }
        .top    { transform: rotateX(90deg); }
        .bottom { transform: rotateX(-90deg); }
      `}</style>
    </div>
  )
}
