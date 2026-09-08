export function NotFound() {
  return (
    <div class="flex min-h-svh flex-col bg-paper font-sans text-ink">
      <main class="flex flex-1 items-center justify-center px-6 py-12">
        <div class="max-w-md text-center">
          <p class="font-mono text-sm text-slate-600">404</p>
          <h1 class="mt-4 font-sans text-4xl font-medium leading-tight tracking-tight md:text-5xl">
            Page not found
          </h1>
          <p class="mt-4 text-base leading-relaxed text-slate-600">
            This page may have moved or no longer exists.
          </p>
          <a
            href="/"
            class="mt-8 inline-flex min-h-12 items-center justify-center rounded-full bg-ink px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-forest focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest"
          >
            Back to home
          </a>
        </div>
      </main>
    </div>
  );
}
