import { Link } from 'react-router-dom';

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
        <p style={{ fontSize: '0.75rem', color: '#4A3C2C' }}>
          © {new Date().getFullYear()} CigarBuddy. All rights reserved.
        </p>
        <nav className="flex items-center gap-5">
          {[
            { to: '/privacy', label: 'Privacy' },
            { to: '/terms', label: 'Terms' },
          ].map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              style={{ fontSize: '0.75rem', color: '#4A3C2C', textDecoration: 'none', transition: 'color 140ms' }}
              onMouseEnter={e => e.currentTarget.style.color = '#9A8A75'}
              onMouseLeave={e => e.currentTarget.style.color = '#4A3C2C'}>
              {label}
            </Link>
          ))}
          <Link
            to="/admin"
            style={{ fontSize: '0.75rem', color: '#2A2018', textDecoration: 'none', transition: 'color 140ms', opacity: 0.6 }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
            onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}>
            Staff
          </Link>
        </nav>
      </div>
    </footer>
  );
}
