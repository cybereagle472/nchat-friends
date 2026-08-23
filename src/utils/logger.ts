/** Production-Ready Logging Utility
 * 
 * Provides centralized logging with different levels and production-safe behavior.
 * In production, only errors are logged. In development, all logs are shown.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
  timestamp: string;
  context?: string;
}

class Logger {
  private isDevelopment = import.meta.env.DEV;
  private isProduction = import.meta.env.PROD;
  private logHistory: LogEntry[] = [];
  private maxHistorySize = 100;

  private formatMessage(level: LogLevel, message: string, _data?: unknown, context?: string): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? `[${context}] ` : '';
    return `${timestamp} ${level.toUpperCase()} ${contextStr}${message}`;
  }

  private addToHistory(entry: LogEntry): void {
    this.logHistory.push(entry);
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }
  }

  private shouldLog(level: LogLevel): boolean {
    if (this.isDevelopment) {
      return true; // Log everything in development
    }
    // In production, only log warnings and errors
    return level === 'warn' || level === 'error';
  }

  /**
   * Log debug messages (development only)
   */
  debug(message: string, data?: unknown, context?: string): void {
    if (!this.shouldLog('debug')) return;
    
    const entry: LogEntry = {
      level: 'debug',
      message,
      data,
      timestamp: new Date().toISOString(),
      context,
    };
    this.addToHistory(entry);
    
    if (this.isDevelopment) {
      // eslint-disable-next-line no-console
      console.debug(this.formatMessage('debug', message, data, context), data || '');
    }
  }

  /**
   * Log informational messages (development only)
   */
  info(message: string, data?: unknown, context?: string): void {
    if (!this.shouldLog('info')) return;
    
    const entry: LogEntry = {
      level: 'info',
      message,
      data,
      timestamp: new Date().toISOString(),
      context,
    };
    this.addToHistory(entry);
    
    if (this.isDevelopment) {
      // eslint-disable-next-line no-console
      console.info(this.formatMessage('info', message, data, context), data || '');
    }
  }

  /**
   * Log warning messages (always logged)
   */
  warn(message: string, data?: unknown, context?: string): void {
    const entry: LogEntry = {
      level: 'warn',
      message,
      data,
      timestamp: new Date().toISOString(),
      context,
    };
    this.addToHistory(entry);
    
    // eslint-disable-next-line no-console
    console.warn(this.formatMessage('warn', message, data, context), data || '');
  }

  /**
   * Log error messages (always logged)
   * In production, these should be sent to an error tracking service
   */
  error(message: string, error?: Error | unknown, context?: string): void {
    const entry: LogEntry = {
      level: 'error',
      message,
      data: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : error,
      timestamp: new Date().toISOString(),
      context,
    };
    this.addToHistory(entry);
    
    // Always log errors
    // eslint-disable-next-line no-console
    console.error(this.formatMessage('error', message, error, context), error || '');
    
    // In production, send to error tracking service (e.g., Sentry, LogRocket)
    if (this.isProduction && error instanceof Error) {
      // TODO: Integrate with error tracking service
      // Example: Sentry.captureException(error, { extra: { message, context } });
      this.sendToErrorTracking(entry, error);
    }
  }

  /**
   * Send error to external tracking service
   */
  private sendToErrorTracking(entry: LogEntry, error: Error): void {
    // Dynamically import error tracking to avoid circular dependencies
    import('./errorTracking').then(({ errorTracker }) => {
      errorTracker.captureException(error, {
        message: entry.message,
        context: entry.context,
        timestamp: entry.timestamp,
        data: entry.data,
      });
    }).catch(() => {
      // Error tracking not available, silently fail
    });
  }

  /**
   * Get recent log history (useful for debugging)
   */
  getHistory(level?: LogLevel): LogEntry[] {
    if (level) {
      return this.logHistory.filter(entry => entry.level === level);
    }
    return [...this.logHistory];
  }

  /**
   * Clear log history
   */
  clearHistory(): void {
    this.logHistory = [];
  }

  /**
   * Export logs as JSON (useful for error reports)
   */
  exportLogs(): string {
    return JSON.stringify(this.logHistory, null, 2);
  }
}

// Export singleton instance
export const logger = new Logger();

// Export convenience functions
export const log = {
  debug: (message: string, data?: unknown, context?: string) => logger.debug(message, data, context),
  info: (message: string, data?: unknown, context?: string) => logger.info(message, data, context),
  warn: (message: string, data?: unknown, context?: string) => logger.warn(message, data, context),
  error: (message: string, error?: Error | unknown, context?: string) => logger.error(message, error, context),
};

// Export logger instance for advanced usage
export default logger;

