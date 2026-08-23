/**
 * Error Tracking Service Integration
 * Supports multiple error tracking services (Sentry, LogRocket, etc.)
 */

import { log } from './logger';

interface ErrorTrackingService {
  captureException(error: Error, context?: Record<string, unknown>): void;
  captureMessage(message: string, level?: 'info' | 'warning' | 'error'): void;
  setUser(userId: string, email?: string, username?: string): void;
  setContext(key: string, context: Record<string, unknown>): void;
}

class ErrorTracker implements ErrorTrackingService {
  private service: ErrorTrackingService | null = null;
  private initialized = false;

  /**
   * Initialize error tracking service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Check for Sentry DSN
    const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
    if (sentryDsn) {
      // Sentry is optional - comment out if @sentry/react is not installed
      // Uncomment and install @sentry/react package if you want error tracking
      // try {
      //   const Sentry = await import('@sentry/react');
      //   Sentry.init({
      //     dsn: sentryDsn,
      //     environment: import.meta.env.MODE,
      //     tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
      //     beforeSend(event: any) {
      //       if (event.request) {
      //         delete event.request.cookies;
      //         delete event.request.headers?.Authorization;
      //       }
      //       return event;
      //     },
      //   });
      //   this.service = Sentry;
      //   this.initialized = true;
      //   log.info('Error tracking initialized (Sentry)', undefined, 'ErrorTracking');
      //   return;
      // } catch (error) {
      //   log.warn('Failed to initialize Sentry', error, 'ErrorTracking');
      // }
    }

    // Check for LogRocket
    const logRocketId = import.meta.env.VITE_LOGROCKET_ID;
    if (logRocketId) {
      try {
        // @ts-ignore - LogRocket types may not be available
        const LogRocket = window.LogRocket;
        if (LogRocket) {
          LogRocket.init(logRocketId);
          this.service = {
            captureException: (error: Error, context?: Record<string, unknown>) => {
              LogRocket.captureException(error, { extra: context });
            },
            captureMessage: (message: string, level?: 'info' | 'warning' | 'error') => {
              LogRocket.captureMessage(message, { level: level || 'info' });
            },
            setUser: (userId: string, email?: string, username?: string) => {
              LogRocket.identify(userId, { email, username });
            },
            setContext: (key: string, context: Record<string, unknown>) => {
              LogRocket.setContext(key, context);
            },
          };
          this.initialized = true;
          log.info('Error tracking initialized (LogRocket)', undefined, 'ErrorTracking');
          return;
        }
      } catch (error) {
        log.warn('Failed to initialize LogRocket', error, 'ErrorTracking');
      }
    }

    // Fallback: Use console in development, silent in production
    if (import.meta.env.DEV) {
      this.service = {
        captureException: (error: Error, context?: Record<string, unknown>) => {
          // eslint-disable-next-line no-console
          console.error('[Error Tracking]', error, context);
        },
        captureMessage: (message: string, level?: 'info' | 'warning' | 'error') => {
          const logLevel = level || 'info';
          if (logLevel === 'warning') {
            console.warn('[Error Tracking]', message);
          } else if (logLevel === 'error') {
            console.error('[Error Tracking]', message);
          } else {
            console.log('[Error Tracking]', message);
          }
        },
        setUser: () => {
          // No-op in fallback
        },
        setContext: () => {
          // No-op in fallback
        },
      };
      this.initialized = true;
      log.info('Error tracking initialized (fallback mode)', undefined, 'ErrorTracking');
    }
  }

  captureException(error: Error, context?: Record<string, unknown>): void {
    if (!this.initialized) {
      this.initialize();
    }
    if (this.service) {
      try {
        this.service.captureException(error, context);
      } catch (err) {
        log.error('Failed to capture exception', err, 'ErrorTracking');
      }
    }
  }

  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
    if (!this.initialized) {
      this.initialize();
    }
    if (this.service) {
      try {
        this.service.captureMessage(message, level);
      } catch (err) {
        log.error('Failed to capture message', err, 'ErrorTracking');
      }
    }
  }

  setUser(userId: string, email?: string, username?: string): void {
    if (!this.initialized) {
      this.initialize();
    }
    if (this.service) {
      try {
        this.service.setUser(userId, email, username);
      } catch (err) {
        log.error('Failed to set user', err, 'ErrorTracking');
      }
    }
  }

  setContext(key: string, context: Record<string, unknown>): void {
    if (!this.initialized) {
      this.initialize();
    }
    if (this.service) {
      try {
        this.service.setContext(key, context);
      } catch (err) {
        log.error('Failed to set context', err, 'ErrorTracking');
      }
    }
  }
}

export const errorTracker = new ErrorTracker();

// Initialize on module load
if (import.meta.env.PROD) {
  errorTracker.initialize();
}

