import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/globals.css';

// iOS Safari has a long-standing quirk: the CSS `:active` pseudo-class
// (which Tailwind's `active:*` utilities rely on) never fires on a tap
// unless *some* element in the page has a touchstart listener attached —
// without this, every `active:scale-95`-style tap feedback across the
// whole app silently does nothing on iPhones, making buttons look
// unresponsive/"untouched" even though they work. A passive no-op
// listener is all it takes to switch that behavior on; harmless and a
// no-op everywhere else (Android/desktop already handle :active fine).
document.addEventListener('touchstart', () => {}, { passive: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
