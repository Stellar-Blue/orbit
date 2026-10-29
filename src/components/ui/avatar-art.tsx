"use client";

import React from 'react';
import { avatarNodes, type AvatarConfig } from '@/lib/avatar';

export interface AvatarArtProps {
  config: AvatarConfig | unknown;
  size?: number;
  className?: string;
  /** Used as the accessible name; the surrounding context usually names the person already. */
  title?: string;
}

/** Draws a made avatar. The same node list feeds the stored SVG, so screen and data never drift. */
export function AvatarArt({ config, size = 96, className = '', title }: AvatarArtProps) {
  const nodes = avatarNodes(config);
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title || 'Avatar'}
      focusable="false"
    >
      {nodes.map((node, index) => React.createElement(node.tag, { key: index, ...node.attrs }))}
    </svg>
  );
}
