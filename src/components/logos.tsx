export function MulticaLaunchLogo() {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="ruflo-border" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7cf7c2" stopOpacity="0.9" />
          <stop offset="1" stopColor="#69a7ff" stopOpacity="0.72" />
        </linearGradient>
        <radialGradient
          id="ruflo-bg"
          cx="0" cy="0" r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(32 32) rotate(90) scale(30)"
        >
          <stop offset="0" stopColor="#10231f" />
          <stop offset="0.58" stopColor="#0a1916" />
          <stop offset="1" stopColor="#07110f" />
        </radialGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="14" fill="url(#ruflo-bg)" />
      <rect x="4.75" y="4.75" width="54.5" height="54.5" rx="13.25" stroke="url(#ruflo-border)" strokeWidth="1.5" />
      <path
        d="M32 17v13"
        stroke="#dffdef"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M32 30v17" stroke="#dffdef" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 30 22 39" stroke="#f5d76e" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 30 42 22" stroke="#69a7ff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 30 44 40" stroke="#7cf7c2" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32" cy="16" r="4.25" fill="#7cf7c2" />
      <circle cx="22" cy="39" r="4" fill="#f5d76e" />
      <circle cx="42" cy="22" r="4" fill="#69a7ff" />
      <circle cx="44" cy="40" r="4" fill="#7cf7c2" />
      <circle cx="32" cy="48" r="4.25" fill="#dffdef" />
    </svg>
  )
}

export function ClaudeLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8">
        <path d="M12 3.2v17.6" />
        <path d="M6.2 6.2L17.8 17.8" />
        <path d="M17.8 6.2L6.2 17.8" />
        <path d="M3.2 12h17.6" />
      </g>
    </svg>
  )
}

export function OpenAILogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55">
        <path d="M12 3.46a3.42 3.42 0 0 1 2.97 1.7l1.03 1.78a3.42 3.42 0 0 1-1.25 4.68l-1.13.65a3.42 3.42 0 0 1-4.67-1.25L7.9 9.93A3.42 3.42 0 0 1 9.14 5.26l1.14-.66A3.4 3.4 0 0 1 12 3.46Z" />
        <path d="M18.12 7a3.42 3.42 0 0 1 1.25 4.67l-1.03 1.79a3.42 3.42 0 0 1-4.67 1.25l-1.14-.66a3.42 3.42 0 0 1-1.25-4.67l1.03-1.79a3.42 3.42 0 0 1 4.68-1.25L18.12 7Z" />
        <path d="M18.35 14.02a3.42 3.42 0 0 1-1.26 4.67l-1.79 1.03a3.42 3.42 0 0 1-4.67-1.25l-.66-1.14a3.42 3.42 0 0 1 1.25-4.67l1.8-1.03a3.42 3.42 0 0 1 4.67 1.25l.66 1.14Z" />
        <path d="M12 20.54a3.42 3.42 0 0 1-2.96-1.7l-1.03-1.78a3.42 3.42 0 0 1 1.24-4.68l1.14-.65a3.42 3.42 0 0 1 4.67 1.25l1.03 1.79a3.42 3.42 0 0 1-1.25 4.67l-1.13.66A3.42 3.42 0 0 1 12 20.54Z" />
        <path d="M5.89 17.02a3.42 3.42 0 0 1-1.26-4.67l1.03-1.79a3.42 3.42 0 0 1 4.67-1.25l1.14.66a3.42 3.42 0 0 1 1.25 4.67l-1.03 1.79a3.42 3.42 0 0 1-4.68 1.25l-1.12-.66Z" />
        <path d="M5.66 9.99a3.42 3.42 0 0 1 1.25-4.67L8.7 4.29a3.42 3.42 0 0 1 4.67 1.25l.66 1.14a3.42 3.42 0 0 1-1.25 4.67l-1.79 1.03a3.42 3.42 0 0 1-4.68-1.25L5.66 9.99Z" />
      </g>
    </svg>
  )
}

export function GlmLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 4.5h6.6v2.1H7.3v3.3h3.7V12H7.3v4.9h4.3V19H5V4.5Zm8.3 0h2.3l2.6 4.2 2.5-4.2H23l-3.7 6 3.7 8.5h-2.4l-2.4-5.8-2.4 5.8h-2.4l3.6-8.5-3.7-6Z"
      />
    </svg>
  )
}

export function GeminiLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="gemini-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#61dafb" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <path
        fill="url(#gemini-gradient)"
        d="M12 2.8c1.08 4.7 1.95 5.57 6.65 6.65-4.7 1.08-5.57 1.95-6.65 6.65-1.08-4.7-1.95-5.57-6.65-6.65C10.05 8.37 10.92 7.5 12 2.8Zm6.1 8.55c.45 1.95.8 2.3 2.75 2.75-1.95.45-2.3.8-2.75 2.75-.45-1.95-.8-2.3-2.75-2.75 1.95-.45 2.3-.8 2.75-2.75Z"
      />
    </svg>
  )
}

export function TelegramLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.18" />
      <path
        fill="currentColor"
        d="M17.87 7.02 5.91 11.63c-.82.33-.81.79-.15.99l3.07.96 7.11-4.49c.34-.21.65-.09.39.14l-5.75 5.18-.21 3.16c.31 0 .45-.14.62-.31l1.49-1.45 3.08 2.27c.57.32.97.15 1.11-.53l2.04-9.6c.21-.83-.32-1.2-.93-.93Z"
      />
    </svg>
  )
}

export function DiscordLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.54 5.79A16.8 16.8 0 0 0 15.4 4.5l-.2.41c1.55.39 2.27.95 2.89 1.43a12.9 12.9 0 0 0-4.09-.64 12.9 12.9 0 0 0-4.09.64c.62-.48 1.4-1.08 2.89-1.43l-.2-.41c-1.44.24-2.83.67-4.14 1.29C5.84 9.65 5.12 13.4 5.48 17.1c1.73 1.28 3.4 2.07 5.04 2.58l1.08-1.77a9.28 9.28 0 0 1-1.61-.78l.39-.29c3.1 1.47 6.48 1.47 9.54 0l.39.29c-.51.31-1.05.57-1.61.78l1.08 1.77c1.64-.51 3.31-1.3 5.04-2.58.42-4.29-.72-8-3.32-11.31ZM10.14 14.84c-.95 0-1.72-.87-1.72-1.95 0-1.07.76-1.95 1.72-1.95.97 0 1.74.88 1.72 1.95 0 1.08-.76 1.95-1.72 1.95Zm6.35 0c-.95 0-1.72-.87-1.72-1.95 0-1.07.76-1.95 1.72-1.95.97 0 1.74.88 1.72 1.95 0 1.08-.76 1.95-1.72 1.95Z"
      />
    </svg>
  )
}

export function WhatsAppLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.52 3.48A11.84 11.84 0 0 0 12.08 0C5.58 0 .28 5.3.28 11.8c0 2.08.54 4.12 1.58 5.92L0 24l6.49-1.82a11.72 11.72 0 0 0 5.59 1.42h.01c6.5 0 11.8-5.3 11.8-11.8 0-3.15-1.23-6.1-3.37-8.32Zm-8.43 18.1h-.01a9.78 9.78 0 0 1-4.99-1.37l-.36-.21-3.85 1.08 1.03-3.75-.24-.39a9.77 9.77 0 0 1-1.5-5.14C2.17 6.4 6.69 1.88 12.08 1.88c2.61 0 5.06 1.02 6.9 2.87a9.7 9.7 0 0 1 2.86 6.9c0 5.4-4.52 9.93-9.75 9.93Zm5.44-7.43c-.3-.15-1.77-.87-2.04-.97-.27-.1-.46-.15-.66.15-.2.3-.76.97-.93 1.17-.17.2-.35.22-.65.08-.3-.15-1.27-.47-2.42-1.49-.9-.8-1.5-1.78-1.68-2.08-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.08-.15-.66-1.6-.9-2.18-.24-.58-.49-.5-.66-.5l-.56-.01c-.2 0-.52.08-.8.37-.27.3-1.03 1-1.03 2.43 0 1.42 1.06 2.8 1.2 3 .15.2 2.1 3.2 5.08 4.49.71.31 1.27.49 1.7.63.72.23 1.37.2 1.88.12.58-.09 1.77-.72 2.02-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35Z"
      />
    </svg>
  )
}
