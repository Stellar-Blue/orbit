"use client";

import React from 'react';

interface ProfileAvatarProps {
  photoUrl?: string | null;
  firstName: string;
  lastName: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  xs: 'w-5 h-5 text-[8px]',
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-9 h-9 text-xs',
  lg: 'w-12 h-12 text-base',
};

export const ProfileAvatar: React.FC<ProfileAvatarProps> = ({ photoUrl, firstName, lastName, size = 'sm', className = '' }) => {
  const initials = `${(firstName || '?')[0]}${(lastName || '')[0]}`.toUpperCase();
  return (
    <span className={`${SIZES[size]} rounded-full bg-gradient-to-tr from-[var(--accent)] to-indigo-600 text-white flex items-center justify-center font-black shrink-0 overflow-hidden ring-1 ring-white/60 ${className}`}>
      {photoUrl ? (
        <img src={photoUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  );
};
