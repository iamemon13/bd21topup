import Link from "next/link";
import { Send, Headphones } from "lucide-react"; // lucide-react না থাকলে সিম্পল SVG ব্যবহার করতে পারেন

export default function Footer() {
  return (
    <footer className="w-full border-t border-slate-800 bg-slate-950 py-10 text-slate-400 mt-auto">
      <div className="max-w-6xl mx-auto px-4 flex flex-col gap-8">
        
        {/* Contact & Support Section */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800">
          <div>
            <h3 className="text-white text-lg font-bold">BD21 Support & Community</h3>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              যেকোনো প্রয়োজনে আমাদের হেল্পলাইনে নক দিন অথবা অফারের জন্য চ্যানেলে যোগ দিন।
            </p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {/* Telegram Channel Button */}
            <a
              href="https://t.me/bd21topup"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600 hover:text-white transition-all text-sm font-medium"
            >
              <Send className="w-4 h-4" />
              <span>Offer Channel</span>
            </a>

            {/* Telegram Support Button */}
            <a
              href="https://t.me/BD21Support"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600 hover:text-white transition-all text-sm font-medium"
            >
              <Headphones className="w-4 h-4" />
              <span>Helpline</span>
            </a>
          </div>
        </div>

        {/* Bottom Copyright & Policy Links */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs sm:text-sm border-t border-slate-900 pt-6">
          <p>© {new Date().getFullYear()} BD21 Top Up. All rights reserved.</p>

          <div className="flex items-center gap-6">
            <Link href="/privacy" className="hover:text-white transition">
              Privacy Policy
            </Link>
            <span className="text-slate-700">|</span>
            <Link href="/terms" className="hover:text-white transition">
              Terms of Service
            </Link>
          </div>
        </div>

      </div>
    </footer>
  );
}
