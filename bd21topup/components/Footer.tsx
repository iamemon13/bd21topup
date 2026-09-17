import Link from "next/link";

export default function Footer() {
  return (
    <footer className="w-full border-t border-slate-800 bg-slate-950 py-6 text-slate-400 mt-auto">
      <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm">
        <p>© {new Date().getFullYear()} BD21 Top Up. All rights reserved.</p>

        <div className="flex items-center gap-6">
          <Link href="/privacy" className="hover:text-white transition">
            Privacy Policy
          </Link>
          <span className="text-slate-600">|</span>
          <Link href="/terms" className="hover:text-white transition">
            Terms of Service
          </Link>
          
          {/* সিক্রেট অ্যাডমিন শর্টকাট সিম্বল */}
          <Link 
            href="/login" 
            className="text-slate-700 hover:text-cyan-400 transition text-xs opacity-70" 
            title="Admin Portal"
            aria-label="Admin Portal"
          >
            ⚙
          </Link>
        </div>
      </div>
    </footer>
  );
}
