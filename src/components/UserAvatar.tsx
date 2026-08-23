import { useState, ImgHTMLAttributes } from 'react';

interface UserAvatarProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> {
  src?: string | null;
  name?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-20 h-20 text-xl',
};

export function UserAvatar({ src, name, size = 'md', className = '', ...props }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

  const initials = (name || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const showImage = src && !imgError;

  return (
    <>
      {showImage ? (
        <img
          src={src}
          alt={name || ''}
          className={`object-cover rounded-full ${sizeClasses[size]} ${className}`}
          onError={() => setImgError(true)}
          {...props}
        />
      ) : (
        <div
          className={`rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center text-white font-semibold ${sizeClasses[size]} ${className}`}
        >
          {initials}
        </div>
      )}
    </>
  );
}
