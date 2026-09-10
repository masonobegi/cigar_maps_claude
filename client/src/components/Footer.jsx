import { Link } from 'react-router-dom';

const DIM = '#4A3C2C';
const HOVER = '#9A8A75';

function FooterLink({ to, href, children }) {
  const style = { fontSize: '0.75rem', color: DIM, textDecoration: 'none', transition: 'color 140ms' };
  const hover = {
    onMouseEnter: e => e.currentTarget.style.color = HOVER,
    onMouseLeave: e => e.currentTarget.style.color = DIM,
  };
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" style={style} {...hover}>{children}</a>
    : <Link to={to} style={style} {...hover}>{children}</Link>;
}

export default function Footer() {
  return (
    <footer style={{ backgroundColor: '#1D1912', borderTop: '1px solid #3D3428' }}>
      <div className="max-w-7xl mx-auto px-5 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
        <span style={{
          fontFamily: '"Playfair Display", Georgia, serif',
          fontSize: '0.9375rem',
          fontWeight: 600,
          color: '#5A4A3A',
          letterSpacing: '0.01em',
        }}>
          CigarBuddy
        </span>
        <p style={{ fontSize: '0.75rem', color: DIM }}>
          © {new Date().getFullYear()} CigarBuddy. All rights reserved.
        </p>
        <nav className="flex items-center gap-5">
          <FooterLink to="/pricing">For retailers</FooterLink>
          <FooterLink to="/privacy">Privacy</FooterLink>
          <FooterLink to="/terms">Terms</FooterLink>
          <Link
            to="/admin"
            style={{ fontSize: '0.75rem', color: '#2A2018', textDecoration: 'none', transition: 'opacity 140ms', opacity: 0.6 }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
            onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}>
            Staff
          </Link>
        </nav>
      </div>

      {/* Both source datasets require attribution wherever their data is shown. */}
      <div className="max-w-7xl mx-auto px-5 pb-5" style={{ fontSize: '0.6875rem', color: '#3D3225', lineHeight: 1.6 }}>
        Shop listings include data from{' '}
        <FooterLink href="https://overturemaps.org/">Overture Maps Foundation</FooterLink>{' '}
        (CDLA-Permissive 2.0) and{' '}
        <FooterLink href="https://www.openstreetmap.org/copyright">OpenStreetMap</FooterLink>{' '}
        contributors (ODbL). CigarBuddy does not sell tobacco products. Must be 21 or older.
      </div>
    </footer>
  );
}
