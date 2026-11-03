# Contributing to NChat

First off, thank you for taking the time to contribute! 🎉 NChat is built
and maintained by **Muhammad Nasir**, and contributions, bug reports, and
feature ideas from the community are genuinely welcome.

## Before you start

- Check the [open issues](../../issues) to see if your bug or idea has
  already been reported or is in progress.
- For anything non-trivial, please open an issue first to discuss the
  change before investing time in a pull request.

## Development setup

```bash
git clone https://github.com/<your-fork>/nchat-friends.git
cd nchat-friends
npm install
cp .env.example .env.local      # point VITE_API_URL at a Worker (see worker/)
npm run dev                     # http://localhost:3000
```

The backend lives in [`worker/`](./worker) — see
[`worker/SETUP_GUIDE.md`](./worker/SETUP_GUIDE.md) for how to stand up the
API locally or on Cloudflare.

## Making a change

1. **Fork** the repository and create your branch from `main`:
   ```bash
   git checkout -b feature/my-improvement
   ```
2. Make your changes, keeping commits focused and descriptive.
3. Before opening a pull request, make sure the project still builds and
   type-checks cleanly:
   ```bash
   npm run type-check
   npm run build
   npm run lint
   ```
   If you touched the backend:
   ```bash
   cd worker && npm run typecheck
   ```
4. Open a pull request with a clear description of **what** changed and
   **why**. Screenshots or a short clip are appreciated for UI changes.

## Code style

- TypeScript throughout, with strict typing — avoid `any` where a real
  type is reasonably easy to express.
- Components live in `src/components/`, backend logic only talks to
  Cloudflare through `src/services/*.ts` — don't call the API directly
  from a component.
- Match the existing formatting and naming conventions you see in nearby
  files rather than introducing a new style.

## Reporting bugs

Please include:
- What you did, what you expected, and what actually happened.
- Steps to reproduce, if possible.
- Device/browser, since this is a cross-platform (web + Android) app.

## Code of Conduct

Be respectful and constructive. We're all here to build something good
together — disagreements about code are fine, personal attacks aren't.

---

Thanks again for helping make NChat better! 💜
