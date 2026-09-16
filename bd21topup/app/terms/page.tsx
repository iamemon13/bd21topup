export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-slate-900 p-8 rounded-2xl border border-slate-800 shadow-xl space-y-6">
        <h1 className="text-3xl font-bold text-white border-b border-slate-800 pb-4">Terms of Service</h1>
        
        <p className="text-sm text-slate-400">Last updated: September 2026</p>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-100">1. Acceptance of Terms</h2>
          <p className="text-slate-300 leading-relaxed text-sm">
            By creating an account and purchasing top-up services on BD21 Topup, you agree to comply with and be bound by these Terms of Service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-100">2. Order Processing & Verification</h2>
          <p className="text-slate-300 leading-relaxed text-sm">
            Users are required to provide correct Game UIDs and accurate transaction numbers (TrxID) for manual payments. Orders are processed upon manual/automated review by the administration.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-100">3. Cancellation & Refunds</h2>
          <p className="text-slate-300 leading-relaxed text-sm">
            If an order cannot be completed or is cancelled by admin review, the order amount will be automatically credited back to your account wallet balance.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-100">4. Misuse & Account Ban</h2>
          <p className="text-slate-300 leading-relaxed text-sm">
            Any attempt to submit fake transaction IDs or exploit the platform will result in an immediate and permanent account suspension.
          </p>
        </section>
      </div>
    </div>
  );
}
