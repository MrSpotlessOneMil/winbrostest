"use client";

export function StickyCTA() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-[#2195b4] shadow-[0_-4px_12px_rgba(0,0,0,0.15)] pb-6 pt-3 px-4">
      <div className="flex gap-3 max-w-lg mx-auto">
        <a
          href="tel:+14246771146"
          className="flex-1 flex items-center justify-center gap-2 bg-white text-[#2195b4] font-semibold py-3 rounded-lg text-sm transition-opacity hover:opacity-90 active:opacity-80"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path
              fillRule="evenodd"
              d="M1.5 4.5a3 3 0 013-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 01-.694 1.955l-1.293.97c-.135.101-.164.249-.126.352a11.285 11.285 0 006.697 6.697c.103.038.25.009.352-.126l.97-1.293a1.875 1.875 0 011.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 01-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5z"
              clipRule="evenodd"
            />
          </svg>
          Call Now
        </a>
        <a
          href="#quote"
          onClick={(e) => {
            e.preventDefault();
            const el = document.getElementById("quote");
            if (el) {
              el.scrollIntoView({ behavior: "smooth" });
            }
          }}
          className="flex-1 flex items-center justify-center gap-2 bg-transparent border-2 border-white text-white font-semibold py-3 rounded-lg text-sm transition-opacity hover:opacity-90 active:opacity-80"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path
              fillRule="evenodd"
              d="M7.502 6h7.128A3.375 3.375 0 0118 9.375v9.375a3 3 0 003-3V6.108c0-1.505-1.125-2.811-2.664-2.94A48.972 48.972 0 0012 3c-2.227 0-4.406.148-6.336.432A2.884 2.884 0 003 6.108V9.375a3.375 3.375 0 003.375 3.375H7.5v-6.75zM7.5 15.75A3.375 3.375 0 004.125 12H3v2.625A3.375 3.375 0 006.375 18H7.5v-2.25z"
              clipRule="evenodd"
            />
            <path d="M13.5 12.75a.75.75 0 00-1.5 0v2.69l-1.72-1.72a.75.75 0 00-1.06 1.06l3 3a.75.75 0 001.06 0l3-3a.75.75 0 10-1.06-1.06l-1.72 1.72V12.75z" />
          </svg>
          Get Free Quote
        </a>
      </div>
    </div>
  );
}
