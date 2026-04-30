import { loginAdmin } from "@/app/admin/actions";

export function AdminLogin({ hasError }: { hasError: boolean }) {
  return (
    <main className="admin-page">
      <section className="admin-header">
        <div className="pill">Internal pricing console</div>
        <h1>Admin verification</h1>
        <p className="small-muted">Verify live Deribit quotes, depth-adjusted bid pricing, and issuer economics.</p>
      </section>
      <section className="admin-shell">
        <div className="admin-card" style={{ maxWidth: 460 }}>
          <h2 className="card-title">Password required</h2>
          <p className="card-copy">
            Use the value configured in `ADMIN_PASSWORD`. For local development without an environment value, the
            temporary password is `signafi-admin-local`.
          </p>
          <form action={loginAdmin} className="stack" style={{ marginTop: 18 }}>
            <label>
              <span className="field-label">Password</span>
              <input className="admin-input" name="password" type="password" required />
            </label>
            {hasError ? <span className="status-badge status-fail">Incorrect password</span> : null}
            <button className="admin-button" type="submit">
              Enter admin
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
