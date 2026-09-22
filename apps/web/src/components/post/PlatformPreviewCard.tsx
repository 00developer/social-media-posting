'use client';

import { useState } from 'react';
import {
  getFrameStyle,
  getMediaFrame,
  REEL_ORIENTATION_WARNING,
  shouldWarnReelOrientation,
  type PostContentType,
} from '@/lib/mediaFrame';

export type VideoSize = { width: number; height: number };

export const VideoPlayer = ({ src, className, onMetadata }: { src: string, className?: string, onMetadata?: (size: VideoSize) => void }) => {
  const cleanSrc = src.split('#')[0];

  return (
    <video
      src={cleanSrc}
      className={className}
      muted
      loop
      playsInline
      autoPlay
      crossOrigin="anonymous"
      preload="auto"
      onLoadedMetadata={(e) => onMetadata?.({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
      style={{ overflowClipMargin: 'unset', overflow: 'visible', backgroundColor: 'black', transform: 'translateZ(0)', willChange: 'transform' }}
    />
  );
};

type PlatformPreviewCardProps = {
  platform: string | null;
  content: string;
  mediaUrl: string | null;
  isVideo?: boolean;
  /** Reels/Shorts are previewed in a 9:16 frame; defaults to a normal post. */
  contentType?: PostContentType;
};

const PlatformCard = ({ platform, content, mediaUrl, isVideo, contentType, onVideoMetadata }: PlatformPreviewCardProps & { onVideoMetadata?: (size: VideoSize) => void }) => {
  const renderHeader = () => (
    <div className="flex items-center gap-3 p-3">
      <div className="w-8 h-8 rounded-full bg-linear-to-tr from-indigo-100 to-purple-100 flex items-center justify-center border border-gray-200 shrink-0">
         <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
      </div>
      <div>
        <div className="h-2.5 w-24 bg-gray-800/10 rounded-full mb-1"></div>
        <div className="h-2 w-16 bg-gray-800/5 rounded-full"></div>
      </div>
      {platform === 'instagram' && (
         <div className="ml-auto flex gap-1">
           <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
           <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
           <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
         </div>
      )}
    </div>
  );

  const renderText = (className = "px-3 pb-3 text-[13px]") => {
    if (!content) return null;
    return (
      <div className={className}>
        <p className="text-gray-800 whitespace-pre-wrap leading-relaxed">{content}</p>
      </div>
    );
  };

  // Shows the media the way this platform will really show it (see lib/mediaFrame.ts):
  // a fixed-ratio frame where an image is cropped (object-cover) or a video is padded onto its canvas
  // (9:16 for reels), otherwise the media's own ratio (Threads, images on non-cropping platforms).
  const renderMedia = (className = "") => {
    if (!mediaUrl) return null;
    const frame = getMediaFrame(platform, !!isVideo, contentType);

    if (frame.ratio) {
      const fit = frame.fit === 'cover' ? 'object-cover' : 'object-contain';
      return (
        <div className={`relative mx-auto overflow-hidden bg-black ${className}`} style={getFrameStyle(frame.ratio)}>
          {isVideo ? (
            <VideoPlayer key={`${platform}-${mediaUrl}`} src={mediaUrl} onMetadata={onVideoMetadata} className={`absolute inset-0 w-full h-full ${fit}`} />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={mediaUrl} className={`absolute inset-0 w-full h-full ${fit}`} alt="Preview" />
          )}
        </div>
      );
    }

    return (
      <div className={`w-full overflow-hidden ${isVideo ? 'bg-black' : ''} ${className}`}>
        {isVideo ? (
          <VideoPlayer key={`${platform}-${mediaUrl}`} src={mediaUrl} onMetadata={onVideoMetadata} className="block w-full h-auto max-h-112 object-contain" />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={mediaUrl} className="block w-full h-auto max-h-112 object-contain" alt="Preview" />
        )}
      </div>
    );
  };

  const renderActionBar = (type = "default") => {
    if (type === 'instagram') return (
      <div className="flex items-center gap-4 p-3 pb-1">
         <div className="w-5 h-5 border-[1.5px] border-gray-800 rounded-full"></div>
         <div className="w-5 h-5 border-[1.5px] border-gray-800 rounded-full"></div>
         <div className="w-5 h-5 border-[1.5px] border-gray-800 rounded-full"></div>
         <div className="w-4 h-5 border-[1.5px] border-gray-800 ml-auto"></div>
      </div>
    );
    if (type === 'twitter') return (
      <div className="flex items-center justify-between p-3 pt-2 w-4/5 text-gray-400">
         <div className="w-4 h-4 bg-gray-400 rounded-full"></div>
         <div className="w-4 h-4 bg-gray-400 rounded-full"></div>
         <div className="w-4 h-4 bg-gray-400 rounded-full"></div>
         <div className="w-4 h-4 bg-gray-400 rounded-full"></div>
      </div>
    );
    return (
      <div className="flex items-center gap-4 p-3 pt-2">
         <div className="w-5 h-5 bg-gray-200 rounded-full"></div>
         <div className="w-5 h-5 bg-gray-200 rounded-full"></div>
         <div className="w-5 h-5 bg-gray-200 rounded-full"></div>
      </div>
    );
  };

  if (platform === 'instagram') {
    return (
      <div className="flex flex-col bg-white w-full border border-gray-200 shadow-sm mx-auto max-w-100">
        {renderHeader()}
        {renderMedia()}
        {renderActionBar("instagram")}
        {renderText("px-3 pb-4 pt-1 text-[13px]")}
      </div>
    );
  }

  if (platform === 'tiktok') {
    return (
      <div className="relative w-full max-w-75 mx-auto bg-black overflow-hidden flex items-center justify-center aspect-9/16 rounded-md shadow-md">
        {mediaUrl ? (
          isVideo ? (
            <VideoPlayer key={`${platform}-${mediaUrl}`} src={mediaUrl} onMetadata={onVideoMetadata} className="object-contain w-full h-full opacity-90" />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={mediaUrl} className="object-contain w-full h-full opacity-90" alt="Preview" />
          )
        ) : (
          <div className="w-full h-full bg-gray-900 flex items-center justify-center p-6 text-center">
             <span className="text-white/30 text-xs">Video content will appear here</span>
          </div>
        )}
        
        <div className="absolute right-3 bottom-24 flex flex-col gap-5 items-center">
           <div className="w-9 h-9 bg-white/20 backdrop-blur-sm rounded-full"></div>
           <div className="w-9 h-9 bg-white/20 backdrop-blur-sm rounded-full"></div>
           <div className="w-9 h-9 bg-white/20 backdrop-blur-sm rounded-full"></div>
        </div>
        
        <div className="absolute left-3 bottom-3 right-16">
          <div className="font-bold text-white text-sm mb-1.5 drop-shadow-md">@username</div>
          {content && (
            <p className="text-white text-[12px] whitespace-pre-wrap leading-snug line-clamp-3 drop-shadow-md">{content}</p>
          )}
        </div>
      </div>
    );
  }

  if (platform === 'pinterest') {
    return (
      <div className="flex flex-col bg-white w-full max-w-[320px] mx-auto p-4 rounded-3xl shadow-lg border border-gray-100">
        {mediaUrl && (
          <div className="rounded-2xl overflow-hidden mb-3">
            {renderMedia()}
          </div>
        )}
        {renderText("px-1 pb-2 text-[15px] font-bold text-gray-900")}
        <div className="flex items-center gap-2 px-1">
           <div className="w-6 h-6 bg-gray-200 rounded-full"></div>
           <div className="h-2 w-16 bg-gray-200 rounded-full"></div>
        </div>
      </div>
    );
  }

  // Default for Twitter, LinkedIn, Facebook, etc.
  return (
    <div className="flex flex-col bg-white w-full max-w-112.5 mx-auto border border-gray-100 shadow-sm rounded-xl overflow-hidden mt-2 mb-2">
      {renderHeader()}
      {renderText()}
      {mediaUrl && (
        <div className="px-3 pb-2">
          <div className="rounded-xl overflow-hidden border border-gray-100">
            {renderMedia()}
          </div>
        </div>
      )}
      {renderActionBar(platform === 'twitter' ? 'twitter' : 'default')}
    </div>
  );
};

export const PlatformPreviewCard = (props: PlatformPreviewCardProps) => {
  // Remember which video the measured size belongs to, so a new file never inherits the old size.
  const [measured, setMeasured] = useState<(VideoSize & { url: string }) | null>(null);
  const size = measured && measured.url === props.mediaUrl ? measured : null;
  const showReelWarning = shouldWarnReelOrientation(props.contentType, !!props.isVideo, size, props.platform);

  return (
    <div className="w-full">
      <PlatformCard
        {...props}
        onVideoMetadata={(s) => {
          if (props.mediaUrl) setMeasured({ ...s, url: props.mediaUrl });
        }}
      />
      {showReelWarning && (
        <p role="status" className="mx-auto mt-2 max-w-112.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {REEL_ORIENTATION_WARNING}
        </p>
      )}
    </div>
  );
};
