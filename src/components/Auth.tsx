import { useState } from 'react';
import { authService } from '../services/authService';

interface AuthProps {
  onAuthSuccess: () => void;
}

export function Auth({ onAuthSuccess }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!isLogin && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        const result = await authService.login(email, password);
        if (result.success) {
          onAuthSuccess();
        } else {
          setError(result.error || 'Login failed');
        }
      } else {
        const result = await authService.signUp(email, password);
        if (result.success) {
          if (result.needsEmailConfirmation) {
            setSuccessMessage('Check your email to confirm your account!');
          } else {
            onAuthSuccess();
          }
        } else {
          setError(result.error || 'Sign up failed');
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setIsLogin(!isLogin);
    setError('');
    setSuccessMessage('');
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="auth-container">
      {/* Background with gradient */}
      <div className="auth-background">
        {/* Top decorative blob */}
        <div className="blob blob-top">
          <svg viewBox="0 0 500 500" preserveAspectRatio="none">
            <path d="M0,0 L500,0 L500,100 Q400,180 250,150 Q100,120 0,180 Z" fill="rgba(255,255,255,0.15)" />
            <path d="M0,0 L500,0 L500,60 Q380,140 200,100 Q50,70 0,120 Z" fill="rgba(255,255,255,0.1)" />
          </svg>
        </div>

        {/* Bottom decorative blob */}
        <div className="blob blob-bottom">
          <svg viewBox="0 0 500 500" preserveAspectRatio="none">
            <path d="M0,500 L500,500 L500,350 Q400,280 250,320 Q100,360 0,300 Z" fill="rgba(255,255,255,0.15)" />
            <path d="M0,500 L500,500 L500,400 Q350,320 180,380 Q50,420 0,360 Z" fill="rgba(255,255,255,0.1)" />
          </svg>
        </div>

        {/* Floating circles */}
        <div className="circle circle-1"></div>
        <div className="circle circle-2"></div>
        <div className="circle circle-3"></div>
        <div className="circle circle-4"></div>
      </div>

      {/* Main Content */}
      <div className="auth-content">
        {/* White Card */}
        <div className="auth-card">
          {/* Logo */}
          <div className="auth-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>

          {/* Title */}
          <h1 className="auth-title">
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h1>
          <p className="auth-subtitle">
            {isLogin ? 'Sign in to continue to NChat' : 'Sign up to get started with NChat'}
          </p>

          {/* Error Message */}
          {error && (
            <div className="auth-error">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4m0 4h.01" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div className="auth-success">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{successMessage}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="auth-form">
            {/* Email Field */}
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <div className="input-wrapper">
                <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
                <input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <div className="input-wrapper">
                <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Confirm Password (Sign Up only) */}
            {!isLogin && (
              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <div className="input-wrapper">
                  <svg className="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? (
                <span className="loading-spinner" />
              ) : (
                isLogin ? 'Sign In' : 'Sign Up'
              )}
            </button>
          </form>

          {/* Switch Mode */}
          <div className="auth-switch">
            <span>{isLogin ? "Don't have an account?" : 'Already have an account?'}</span>
            <button type="button" onClick={switchMode}>
              {isLogin ? 'Sign Up' : 'Sign In'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .auth-container {
          min-height: 100vh;
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
          padding: 20px;
        }

        .auth-background {
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, #a855f7 0%, #8b5cf6 50%, #7c3aed 100%);
        }

        /* Decorative blobs */
        .blob {
          position: absolute;
          left: 0;
          right: 0;
          pointer-events: none;
        }

        .blob svg {
          width: 100%;
          height: 100%;
        }

        .blob-top {
          top: 0;
          height: 200px;
        }

        .blob-bottom {
          bottom: 0;
          height: 200px;
        }

        /* Floating circles */
        .circle {
          position: absolute;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.1);
          pointer-events: none;
        }

        .circle-1 {
          width: 80px;
          height: 80px;
          top: 15%;
          left: 10%;
          animation: float 6s ease-in-out infinite;
        }

        .circle-2 {
          width: 120px;
          height: 120px;
          top: 60%;
          right: 8%;
          animation: float 8s ease-in-out infinite;
          animation-delay: -2s;
        }

        .circle-3 {
          width: 60px;
          height: 60px;
          bottom: 20%;
          left: 15%;
          animation: float 7s ease-in-out infinite;
          animation-delay: -4s;
        }

        .circle-4 {
          width: 40px;
          height: 40px;
          top: 25%;
          right: 20%;
          animation: float 5s ease-in-out infinite;
          animation-delay: -1s;
        }

        @keyframes float {
          0%, 100% {
            transform: translateY(0) rotate(0deg);
          }
          50% {
            transform: translateY(-20px) rotate(10deg);
          }
        }

        .auth-content {
          position: relative;
          z-index: 10;
          width: 100%;
          max-width: 400px;
        }

        .auth-card {
          background: #ffffff;
          border-radius: 24px;
          padding: 40px 32px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }

        .auth-logo {
          width: 64px;
          height: 64px;
          margin: 0 auto 24px;
          background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .auth-logo svg {
          width: 32px;
          height: 32px;
        }

        .auth-title {
          font-size: 24px;
          font-weight: 700;
          color: #1f2937;
          text-align: center;
          margin: 0 0 8px;
        }

        .auth-subtitle {
          font-size: 14px;
          color: #6b7280;
          text-align: center;
          margin: 0 0 28px;
        }

        .auth-error {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 12px;
          margin-bottom: 20px;
        }

        .auth-error svg {
          width: 18px;
          height: 18px;
          color: #ef4444;
          flex-shrink: 0;
        }

        .auth-error span {
          font-size: 13px;
          color: #dc2626;
        }

        .auth-success {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 12px;
          margin-bottom: 20px;
        }

        .auth-success svg {
          width: 18px;
          height: 18px;
          color: #22c55e;
          flex-shrink: 0;
        }

        .auth-success span {
          font-size: 13px;
          color: #16a34a;
        }

        .auth-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-group label {
          font-size: 14px;
          font-weight: 500;
          color: #374151;
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-icon {
          position: absolute;
          left: 14px;
          width: 20px;
          height: 20px;
          color: #9ca3af;
          pointer-events: none;
        }

        .input-wrapper input {
          width: 100%;
          height: 48px;
          padding: 0 44px;
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          font-size: 14px;
          color: #1f2937;
          transition: all 0.2s ease;
        }

        .input-wrapper input::placeholder {
          color: #9ca3af;
        }

        .input-wrapper input:focus {
          outline: none;
          border-color: #a855f7;
          background: #ffffff;
          box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.1);
        }

        .password-toggle {
          position: absolute;
          right: 4px;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          cursor: pointer;
          color: #9ca3af;
          transition: color 0.2s ease;
        }

        .password-toggle:hover {
          color: #6b7280;
        }

        .password-toggle svg {
          width: 20px;
          height: 20px;
        }

        .submit-btn {
          width: 100%;
          height: 48px;
          background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
          border: none;
          border-radius: 12px;
          font-size: 15px;
          font-weight: 600;
          color: white;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-top: 4px;
        }

        .submit-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 10px 20px -10px rgba(168, 85, 247, 0.5);
        }

        .submit-btn:active {
          transform: translateY(0);
        }

        .submit-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
          transform: none;
        }

        .loading-spinner {
          width: 20px;
          height: 20px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .auth-switch {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-top: 24px;
          padding-top: 24px;
          border-top: 1px solid #e5e7eb;
        }

        .auth-switch span {
          font-size: 14px;
          color: #6b7280;
        }

        .auth-switch button {
          font-size: 14px;
          font-weight: 600;
          color: #8b5cf6;
          background: transparent;
          border: none;
          cursor: pointer;
          transition: color 0.2s ease;
        }

        .auth-switch button:hover {
          color: #7c3aed;
        }

        /* Mobile Responsiveness */
        @media (max-width: 480px) {
          .auth-container {
            padding: 16px;
          }

          .auth-card {
            padding: 32px 24px;
            border-radius: 20px;
          }

          .auth-logo {
            width: 56px;
            height: 56px;
            margin-bottom: 20px;
          }

          .auth-logo svg {
            width: 28px;
            height: 28px;
          }

          .auth-title {
            font-size: 22px;
          }

          .auth-subtitle {
            font-size: 13px;
            margin-bottom: 24px;
          }

          .input-wrapper input {
            height: 46px;
            font-size: 16px; /* Prevents iOS zoom on focus */
          }

          .submit-btn {
            height: 46px;
            font-size: 14px;
          }

          .blob-top {
            height: 150px;
          }

          .blob-bottom {
            height: 150px;
          }

          .circle-1 {
            width: 60px;
            height: 60px;
          }

          .circle-2 {
            width: 80px;
            height: 80px;
          }

          .circle-3 {
            width: 40px;
            height: 40px;
          }

          .circle-4 {
            width: 30px;
            height: 30px;
          }
        }

        @media (max-height: 700px) {
          .auth-card {
            padding: 28px 24px;
          }

          .auth-logo {
            width: 52px;
            height: 52px;
            margin-bottom: 16px;
          }

          .auth-title {
            font-size: 20px;
            margin-bottom: 4px;
          }

          .auth-subtitle {
            margin-bottom: 20px;
          }

          .auth-form {
            gap: 16px;
          }

          .form-group {
            gap: 6px;
          }

          .auth-switch {
            margin-top: 20px;
            padding-top: 20px;
          }
        }
      `}</style>
    </div>
  );
}
