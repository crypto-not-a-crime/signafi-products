import Link from "next/link";

export function Logo() {
  return (
    <Link className="nav-logo" href="/">
      <span className="nav-logo-icon">S</span>
      <span className="nav-logo-text">Signafi</span>
    </Link>
  );
}

export function SiteNav({ active = "home" }: { active?: "home" | "levers" | "admin" }) {
  return (
    <nav className="site-nav">
      <Logo />
      <div className="nav-links">
        <Link className={`nav-link ${active === "home" ? "active" : ""}`} href="/">
          Yield Platform
        </Link>
        <Link className={`nav-link ${active === "levers" ? "active" : ""}`} href="/3-levers">
          3 Levers
        </Link>
        <Link className="nav-link" href="/#products">
          Products
        </Link>
        <Link className={`nav-link ${active === "admin" ? "active" : ""}`} href="/admin">
          Admin
        </Link>
      </div>
      <Link className="nav-login" href="/3-levers">
        Get quote
      </Link>
    </nav>
  );
}
