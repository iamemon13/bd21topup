export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-slate-900 p-8 rounded-2xl border border-slate-800 shadow-xl space-y-6">
        <h1 className="text-3xl font-bold text-white border-b border-slate-800 pb-4">
          Privacy Policy
        </h1>

        <p className="text-sm text-slate-400">Last updated: September 2026</p>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-100">
            1. Information We Collect
          </h2>
          <p className="text-slate-300 leading-relaxed text-sm">
            When you use BD21 Topup (ekbotix.com), we collect basic profile
            details via Google Authentication (such as your name, email, and
            profile avatar) and your game Player UID/IDs strictly necessary to
            process your in-game top-up orders.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-100">
            2. How We Use Your Information
          </h2>
          <p className="text-slate-300 leading-relaxed text-sm">
            We use your data solely to manage user accounts, deliver game
            diamond/currency top-ups, verify payment transactions, and provide
            automated wallet refunds when orders are cancelled.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-100">
            3. Data Security
          </h2>
          <p className="text-slate-300 leading-relaxed text-sm">
            We do not sell, rent, or trade your personal information. All
            authentication and database operations are securely managed via
            encrypted sessions.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-100">
            4. Contact Us
          </h2>
          <p className="text-slate-300 leading-relaxed text-sm">
            If you have questions about this privacy policy, you can reach out
            through our official platform support channels.
          </p>
        </section>
      </div>
    </div>
  );
}
