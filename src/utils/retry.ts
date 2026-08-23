/**
 * Retry utility for failed network requests
 * Helps handle transient network errors and Supabase connection issues
 */

export interface RetryOptions {
  maxRetries?: number;
  delay?: number;
  backoff?: boolean;
  onRetry?: (attempt: number, error: any) => void;
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    delay = 1000,
    backoff = true,
    onRetry
  } = options;

  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on certain errors
      if (
        error.message?.includes('Invalid credentials') ||
        error.message?.includes('User not found') ||
        error.message?.includes('permission denied') ||
        error.code === 'PGRST301' // Not found
      ) {
        throw error;
      }

      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const waitTime = backoff ? delay * Math.pow(2, attempt) : delay;
      
      if (onRetry) {
        onRetry(attempt + 1, error);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  throw lastError;
}

/**
 * Check if an error is a network error
 * Only returns true for actual network failures, not Supabase errors
 */
export function isNetworkError(error: any): boolean {
  if (!error) return false;
  
  // First check if browser says we're offline
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  
  const message = error.message || '';
  const code = error.code || '';
  
  // Only consider it a network error if it's a real network failure
  // Not Supabase authentication or database errors
  if (code && (code.startsWith('PGRST') || code.startsWith('42'))) {
    return false; // These are Supabase/database errors, not network errors
  }
  
  return (
    message.includes('Failed to fetch') ||
    message.includes('NetworkError') ||
    message.includes('Network request failed') ||
    message.includes('ERR_NETWORK') ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT'
  );
}

/**
 * Check if an error is a Supabase configuration error
 */
export function isConfigError(error: any): boolean {
  if (!error) return false;
  
  const message = error.message || '';
  
  return (
    message.includes('Supabase configuration') ||
    message.includes('VITE_SUPABASE') ||
    message.includes('Missing required environment variables')
  );
}
