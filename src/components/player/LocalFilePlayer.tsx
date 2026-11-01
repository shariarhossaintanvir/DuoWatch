import React, { useRef, useState, useEffect } from 'react';
import { useCinema } from '../../context/CinemaContext';
import { Upload, Film, AlertTriangle, ShieldCheck, Play, Pause, RotateCcw } from 'lucide-react';

export const LocalFilePlayer: React.FC = () => {
  const { 
    session, 
    remoteMediaStream, 
    setLocalMediaStream, 
    updateMediaState 
  } = useCinema();

  const isOwner = session?.role === 'owner';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hostVideoRef = useRef<HTMLVideoElement>(null);
  const guestVideoRef = useRef<HTMLVideoElement>(null);

  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [fileObjectUrl, setFileObjectUrl] = useState<string | null>(null);
  const [hasCaptureStreamSupport, setHasCaptureStreamSupport] = useState<boolean>(true);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isLocalPlaying, setIsLocalPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);

  // Feature detection for captureStream
  useEffect(() => {
    const testVideo = document.createElement('video');
    const hasCapture = Boolean(
      (testVideo as any).captureStream || 
      (testVideo as any).mozCaptureStream
    );
    setHasCaptureStreamSupport(hasCapture);
    if (!hasCapture && isOwner) {
      setStreamError('Your current browser does not support HTMLMediaElement.captureStream(). Please use Chrome, Edge, or Firefox for local file streaming.');
    }
  }, [isOwner]);

  // Clean up Object URL on unmount
  useEffect(() => {
    return () => {
      if (fileObjectUrl) {
        URL.revokeObjectURL(fileObjectUrl);
      }
      setLocalMediaStream(null);
    };
  }, [fileObjectUrl, setLocalMediaStream]);

  // Attach remote stream to guest video element
  useEffect(() => {
    if (!isOwner && guestVideoRef.current && remoteMediaStream) {
      guestVideoRef.current.srcObject = remoteMediaStream;
      guestVideoRef.current.play().catch(e => console.warn('Guest video play prevented:', e));
    }
  }, [isOwner, remoteMediaStream]);

  // Handle local video file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStreamError(null);
    setSelectedFileName(file.name);

    if (fileObjectUrl) {
      URL.revokeObjectURL(fileObjectUrl);
    }

    const objUrl = URL.createObjectURL(file);
    setFileObjectUrl(objUrl);

    if (hostVideoRef.current) {
      hostVideoRef.current.src = objUrl;
      hostVideoRef.current.load();
    }
  };

  // When Host video metadata loads, capture stream & pipe to WebRTC
  const handleHostLoadedMetadata = () => {
    if (!hostVideoRef.current || !isOwner) return;

    const vid = hostVideoRef.current;
    setDuration(vid.duration || 0);

    try {
      let stream: MediaStream | null = null;
      if (typeof (vid as any).captureStream === 'function') {
        stream = (vid as any).captureStream(30);
      } else if (typeof (vid as any).mozCaptureStream === 'function') {
        stream = (vid as any).mozCaptureStream(30);
      }

      if (stream) {
        setLocalMediaStream(stream);
        updateMediaState({
          duration: vid.duration,
          currentTime: 0,
          isPlaying: false,
        });
      } else {
        setStreamError('Could not initialize media stream capture from selected video.');
      }
    } catch (err: any) {
      console.error('Error in captureStream:', err);
      setStreamError(`CaptureStream failed: ${err.message}`);
    }
  };

  // Host playback controls
  const toggleHostPlay = () => {
    if (!hostVideoRef.current || !isOwner) return;
    const vid = hostVideoRef.current;
    if (vid.paused) {
      vid.play();
      setIsLocalPlaying(true);
      updateMediaState({ isPlaying: true, currentTime: vid.currentTime });
    } else {
      vid.pause();
      setIsLocalPlaying(false);
      updateMediaState({ isPlaying: false, currentTime: vid.currentTime });
    }
  };

  const handleHostTimeUpdate = () => {
    if (!hostVideoRef.current) return;
    setCurrentTime(hostVideoRef.current.currentTime);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!hostVideoRef.current || !isOwner) return;
    const seekTime = parseFloat(e.target.value);
    hostVideoRef.current.currentTime = seekTime;
    setCurrentTime(seekTime);
    updateMediaState({ currentTime: seekTime });
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-black overflow-hidden select-none">
      {/* OWNER (HOST) VIEW */}
      {isOwner && (
        <div className="w-full h-full flex flex-col items-center justify-center">
          {fileObjectUrl ? (
            <div className="relative w-full h-full flex items-center justify-center group">
              <video
                ref={hostVideoRef}
                onLoadedMetadata={handleHostLoadedMetadata}
                onTimeUpdate={handleHostTimeUpdate}
                playsInline
                className="w-full h-full max-h-full object-contain"
              />

              {/* Host Floating Cinema Scrubber Overlay */}
              <div className="absolute bottom-6 left-6 right-6 z-20 bg-[#14161d]/90 backdrop-blur-md border border-[#282d3c] p-3 rounded-2xl shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <button
                    onClick={toggleHostPlay}
                    className="w-10 h-10 rounded-xl bg-amber-500 hover:bg-amber-400 text-black flex items-center justify-center transition-transform active:scale-95 shrink-0"
                  >
                    {isLocalPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                  </button>

                  <div className="flex-1 flex flex-col justify-center">
                    <input
                      type="range"
                      min={0}
                      max={duration || 100}
                      step={0.1}
                      value={currentTime}
                      onChange={handleSeek}
                      className="w-full accent-amber-500 cursor-pointer h-1.5 bg-gray-700 rounded-lg appearance-none"
                    />
                    <div className="flex justify-between text-[11px] text-gray-400 font-mono mt-1">
                      <span>{formatTime(currentTime)}</span>
                      <span className="truncate max-w-[200px] text-gray-300 font-sans">{selectedFileName}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs text-gray-300 hover:text-white bg-[#1c1f2a] hover:bg-[#282d3c] px-3 py-2 rounded-xl border border-[#282d3c] flex items-center gap-1.5 shrink-0 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Change File
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* File Picker Empty State */
            <div className="flex flex-col items-center justify-center p-8 text-center max-w-md">
              <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-6 shadow-xl">
                <Film className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-gray-100 mb-2">Local File Cinema</h3>
              <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                Select a video file from your computer to stream directly to your partner in real time over WebRTC. Zero cloud uploads.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,video/ogg,video/mkv,video/*"
                onChange={handleFileChange}
                className="hidden"
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!hasCaptureStreamSupport}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm px-6 py-3 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-amber-500/20 active:scale-95"
              >
                <Upload className="w-4 h-4" />
                Select Movie File
              </button>

              <div className="flex items-center gap-1.5 text-xs text-emerald-400/90 mt-5">
                <ShieldCheck className="w-4 h-4" />
                <span>Encrypted P2P Transmit • Never Uploaded to Cloud</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PARTNER (GUEST) VIEW */}
      {!isOwner && (
        <div className="w-full h-full flex items-center justify-center">
          {remoteMediaStream && remoteMediaStream.getVideoTracks().length > 0 ? (
            <video
              ref={guestVideoRef}
              autoPlay
              playsInline
              className="w-full h-full max-h-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center justify-center p-8 text-center max-w-sm">
              <div className="w-14 h-14 rounded-2xl bg-[#14161d] border border-[#282d3c] flex items-center justify-center text-amber-400 mb-4 animate-pulse">
                <Film className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-gray-200 mb-1">Waiting for Host Video</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                The cinema host is selecting a local video file. The stream will begin automatically once playback starts.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Error Banner */}
      {streamError && (
        <div className="absolute top-4 left-4 right-4 z-30 max-w-md mx-auto bg-red-950/90 border border-red-500/40 backdrop-blur-md p-3 rounded-xl text-xs text-red-200 flex items-start gap-2 shadow-xl">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{streamError}</span>
        </div>
      )}
    </div>
  );
};
