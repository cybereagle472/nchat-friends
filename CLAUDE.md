# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NChat is a production-ready messaging application built with React 18, TypeScript, and Supabase. It competes with WhatsApp, Messenger, and IMO, featuring real-time messaging, voice/video calls (WebRTC), group chats, and offline-first architecture.

## Commands

```bash
# Development
npm run dev          # Start dev server on port 3000
npm run build        # TypeScript check + Vite production build
npm run type-check   # TypeScript type checking only
npm run lint         # ESLint (ts,tsx files, zero warnings)
npm run preview      # Preview production build
```

## Architecture

### Directory Structure
```
src/
├── components/      # React components (Auth, Chats, ChatView, Groups, etc.)
│   └── ui/          # Radix-based shadcn/ui components
├── services/        # Business logic layer - singleton service objects
├── hooks/           # Custom React hooks (useChat, useGroupChat, etc.)
├── utils/           # Utilities (logger, validation, crypto, offlineStorage)
├── styles/          # CSS files
├── types.ts         # Centralized TypeScript type definitions
├── supabaseClient.ts # Supabase client configuration
└── App.tsx          # Root component with auth flow and navigation
```

### Key Patterns

**Services Layer**: All backend interactions go through service singletons in `src/services/`. Each service handles a domain (auth, chat, calls, groups, media, notifications). Services are exported from `src/services/index.ts`.

**Offline-First Messaging**: The `chatService` uses `offlineStorage` utilities to:
- Generate idempotent `client_message_id` for deduplication
- Queue messages locally when offline
- Sync automatically when connection restores
- Update UI optimistically before server confirmation

**Real-time Subscriptions**: Supabase Realtime channels are used for:
- Live message delivery
- Typing indicators
- Presence (online/offline status)
- Incoming call notifications

**Custom Hooks**: Located in `src/hooks/`, these manage complex state:
- `useChat` / `useGroupChat`: Message list state, sending, real-time updates
- `useCall`: WebRTC call management
- `useSyncManager`: Offline sync coordination
- `useNotifications`: Push and in-app notifications

### Type System

All types are defined in `src/types.ts`. Key interfaces:
- `UserProfile`: User data
- `Message` / `GroupMessage`: Chat messages with types (text, image, voice, video, etc.)
- `Contact` / `ChatSession`: Chat list items
- `Group` / `GroupMember`: Group chat data
- `Call` / `CallSignal`: WebRTC call state

### UI Components

Uses shadcn/ui components (Radix primitives + Tailwind). Located in `src/components/ui/`. Path alias `@/` maps to `src/`.

## Environment Variables

Required in `.env`:
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Additional Directories

- `NChat App/`: Legacy/alternate version with similar structure
- `UI for NChat/`: Figma-exported UI components reference
