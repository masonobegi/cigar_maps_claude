import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Store, MapPin, Phone, Globe, Clock, Package, Heart, CheckCircle, Tag, Star, Users, Bell, BellOff, Package2, Navigation, X, Search, MessageSquare, Pin, Calendar, UserCheck, Coffee, Reply, ChevronDown, ChevronUp, Flag, BadgeCheck, Mail, AlertTriangle, DoorClosed } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import BackButton from '../components/BackButton';
import { StoreThumb, hasLounge, hoursConfirmed, unconfirmedShop } from '../components/StoreCard';
import { getStoreStatus } from '../utils/hours';

// Matches citySlug() in server/src/utils/places.js. Three lines rather than a
// round trip; the server is what resolves the slug, so a mismatch shows up as a
// 404 on the place page rather than as a wrong page.
const citySlug = (city, state) => `${String(city || '').toLowerCase().replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-${String(state || '').toLowerCase()}`;

const DAYS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const NAVY  = '#E8DDD0';
const LABEL = '#B0A090';
const MUTED = '#9E8E7E';
const AMBER = '#D4882A';
const BORDER= '#453C2E';
const BG_ALT= '#2E2820';

function StarRating({ value, onChange, size = 'md' }) {
  const sz = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <div className="flex gap-1">
      {[1,2,3,4,5].map(n => (
        <button key={n} type="button" onClick={() => onChange && onChange(n)} className="transition-transform hover:scale-110">
          <Star className={`${sz} ${n <= value ? 'fill-amber-500' : ''}`}
            style={{ color: n <= value ? '#D4882A' : '#3A4858' }} />
        </button>
      ))}
    </div>
  );
}

const TYPE_LABEL = { cigar_lounge: 'Cigar lounge', cigar_shop: 'Cigar shop', tobacco_shop: 'Tobacco shop', smoke_shop: 'Smoke shop' };

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center px-0 sm:px-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: '#1A1410', border: `1px solid ${BORDER}` }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-lg font-bold" style={{ color: NAVY }}>{title}</h2>
          <button onClick={onClose} className="p-1" style={{ color: MUTED }}><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// "checked 3 days ago" for a web-read inventory row.
function freshness(ts) {
  if (!ts) return null;
  const then = new Date(ts).getTime();
  if (!Number.isFinite(then)) return null;
  const hours = (Date.now() - then) / 3600000;
  if (hours < 1) return 'checked just now';
  if (hours < 24) return `checked ${Math.max(1, Math.round(hours))}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'checked yesterday';
  if (days < 30) return `checked ${days} days ago`;
  const months = Math.round(days / 30);
  return `checked ${months} month${months === 1 ? '' : 's'} ago`;
}

/**
 * The shelf at a glance: one tile per brand with how many of its cigars the
 * shop carries and what they cost, largest selection first. Picking a brand
 * shows its lines.
 */
function BrandDirectory({ brands, total, onPick }) {
  return (
    <>
      <p className="text-xs mb-3" style={{ color: MUTED }}>
        {brands.length} brands · {total} cigars. Pick a brand to see its lines, or search above.
      </p>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
        {brands.map(b => {
          const range = priceRange(b.price_min, b.price_max);
          return (
            <button key={b.brand} type="button" onClick={() => onPick(b.brand)}
              className="card px-3.5 py-3 text-left transition-colors"
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#5A4A34'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; }}>
              <p className="font-semibold leading-snug" style={{ color: NAVY }}>{b.brand}</p>
              <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                {b.lines} {b.lines === 1 ? 'cigar' : 'cigars'}{range ? <span style={{ color: AMBER }}> · {range}</span> : null}
              </p>
            </button>
          );
        })}
      </div>
    </>
  );
}

// Whole dollars unless the cents matter: "$6" and "$6.50", never "$6.00".
const money = (n) => `$${Number(n) % 1 === 0 ? Number(n).toFixed(0) : Number(n).toFixed(2)}`;

/**
 * A shop sells one line as a single, a five-pack and a box, so its prices span
 * a range. Show that span rather than pretending there is one price.
 */
function priceRange(min, max) {
  if (min === null || min === undefined || !Number(min)) return null;
  if (!Number(max) || Number(max) === Number(min)) return money(min);
  return `${money(min)} – ${money(max)}`;
}

const domainOf = (website) => String(website || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

// Most of the directory came out of Overture/OpenStreetMap, where a large slice
// of the website column has rotted: dead domains, expired hosting, squatters.
// A link checker writes stores.website_status; anything other than 'ok' (or
// NULL, meaning nobody has looked yet) must not be dressed up as a live link.
const WEBSITE_WHY = {
  dns_fail:  'That domain does not resolve any more.',
  timeout:   'The site did not answer when we last checked it.',
  refused:   'The server refused the connection when we last checked it.',
  not_found: 'That address came back "not found" when we last checked it.',
  error:     'The site returned an error when we last checked it.',
  parked:    'That domain is parked — it lands on a placeholder page, not the shop.',
  removed:   'That page has been taken down.',
  // A lapsed shop domain does not go quiet; it gets resold. These three say so
  // plainly rather than letting a customer click through to a casino.
  hijacked:  'That domain is no longer the shop\u2019s \u2014 it now serves a gambling site.',
  elsewhere: 'That domain now lands on a different business\u2019s website.',
  store_unavailable: 'The shop\u2019s online store has been switched off by its platform.',
  // Not a failure: an address somebody has just changed, which no sweep has
  // reached yet. It says so rather than either hiding the link or presenting it
  // as one we have stood behind.
  checking: 'This address was changed recently and we have not checked it yet.',
};

// The networks worth naming, so a listing whose only "website" is a Facebook
// page says that instead of printing an opaque URL. Kept in step with
// socialNetwork() in server/src/jobs/linkCheck.js.
const SOCIAL_NAMES = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.(com|me)$/, 'Facebook page'],
  [/(^|\.)instagram\.com$/, 'Instagram profile'],
  [/(^|\.)twitter\.com$|(^|\.)x\.com$/, 'X profile'],
  [/(^|\.)tiktok\.com$/, 'TikTok profile'],
  [/(^|\.)yelp\.com$/, 'Yelp page'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn page'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube channel'],
  [/(^|\.)linktr\.ee$|(^|\.)linktree\.com$/, 'Linktree'],
  [/(^|\.)google\.com$|(^|\.)business\.site$/, 'Google listing'],
];

export function socialName(website) {
  const host = domainOf(website);
  if (!host) return null;
  for (const [re, name] of SOCIAL_NAMES) if (re.test(host)) return name;
  return null;
}

const withScheme = (url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

// Everything the page needs to decide how to render the shop's website, in one
// place: the header line, the Website action, and the unclaimed banner all read
// from this so they can never disagree with each other.
export function websiteInfo(store) {
  if (!store || !store.website) return null;
  const status = store.website_status || null;
  // 'blocked' means the site answered but would not serve our checker (a
  // Cloudflare front door). A person with a browser gets in, so it stays a link.
  //
  // 'checking' is an address a hand changed a moment ago — the owner's form,
  // the staff editor, or a directory refresh that brought a new domain. It is
  // not a link we have stood behind, so it does not get rendered as one.
  //
  // A NULL status is different again, and is deliberately still a link: it
  // means nobody has looked yet, which is true of 5,214 of the 5,214 public
  // listings that carry a website, because the first full sweep has not run.
  // Withholding those links would empty the website line across the whole
  // directory over an absence of evidence rather than any evidence of a
  // problem. It carries no freshness claim instead.
  const ok = !status || status === 'ok' || status === 'blocked';
  const listed = domainOf(store.website);
  const finalDomain = domainOf(store.website_final_url);
  // A redirect that lands somewhere else means the shop has moved, and people
  // should be sent where it actually lives now. Only a plain 'ok' says that:
  // it is the verdict the checker gives when it read the page and found the
  // shop named on it, and a domain that had been taken over by somebody else
  // would have come back 'elsewhere' or 'hijacked' instead. 'blocked' and NULL
  // are excluded on purpose — with those we never saw the destination, so we
  // cannot claim it is the same business.
  const moved = status === 'ok' && !!store.website_final_url && !!finalDomain && finalDomain !== listed;
  const when = freshness(store.website_checked_at);
  const network = socialName(moved ? store.website_final_url : store.website);
  return {
    ok,
    status,
    moved,
    listed,
    // Whether we have actually stood behind this address, as opposed to merely
    // having no evidence against it.
    verified: status === 'ok' || status === 'blocked',
    pending: status === 'checking',
    // The network behind the link, when it is a social profile rather than the
    // shop's own site. Null for an ordinary domain.
    network,
    href: ok ? withScheme(moved ? store.website_final_url : store.website) : null,
    label: network || (moved
      ? String(store.website_final_url).replace(/^https?:\/\//i, '').replace(/\/$/, '')
      : store.website),
    note: ok ? null : (status === 'parked' ? 'this domain is parked'
      : status === 'checking' ? 'checking this link' : 'link looks broken'),
    why: ok ? null
      : `${WEBSITE_WHY[status] || 'We could not reach this website when we last checked it.'}${status === 'checking' || !when ? '' : ` (${when})`}`,
  };
}

// The website line in the header. A checked-and-broken domain still gets shown
// — someone can search the shop by name, or try it themselves — but it gets no
// href, no hover, and a note saying why it is not clickable.
export function WebsiteLine({ site }) {
  // A link that does not work is worse than no link: it makes the whole
  // listing look stale. Show nothing at all until it works again.
  if (!site || !site.ok) return null;
  return (
    <a href={site.href} target="_blank" rel="noopener"
      className="flex items-center gap-1 transition-colors"
      style={{ color: MUTED }}
      title={site.moved ? `Listed as ${site.listed}, which now redirects here` : undefined}
      onMouseEnter={e => e.currentTarget.style.color = AMBER}
      onMouseLeave={e => e.currentTarget.style.color = MUTED}>
      <Globe className="w-3.5 h-3.5" />{site.label}
    </a>
  );
}

// The Website tile in the quick-contact bar. Absent when there is no working
// site, exactly as it is for a shop that never had one.
export function WebsiteAction({ site }) {
  if (!site || !site.ok) return null;
  return (
    <a href={site.href} target="_blank" rel="noopener"
      className="flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors"
      style={{ color: MUTED, borderLeft: `1px solid ${BORDER}` }}
      onMouseEnter={e => { e.currentTarget.style.color = AMBER; e.currentTarget.style.backgroundColor = BG_ALT; }}
      onMouseLeave={e => { e.currentTarget.style.color = MUTED; e.currentTarget.style.backgroundColor = ''; }}>
      <Globe className="w-5 h-5" />
      <span className="text-xs font-medium">Website</span>
    </a>
  );
}

// A listing we believe has shut for good. Two independent things can say so:
// operating_status, which comes straight from the source directory, and
// storefront = 'closed', which is what visitor reports and the closure sweep
// write. Either one is enough to pull the shop off the public map, so either
// one has to explain itself on the page.
export function closureInfo(store) {
  if (!store) return null;
  const bySource = store.operating_status === 'permanently_closed';
  const byUs = store.storefront === 'closed';
  if (!bySource && !byUs) return null;
  const when = store.closed_at ? new Date(store.closed_at) : null;
  return {
    hidden: Number(store.visible) === 0,
    reason: store.closed_reason || store.storefront_reason
      || (bySource ? 'The map data this listing came from reports the shop as permanently closed.' : 'This listing was marked closed.'),
    when: when && !Number.isNaN(when.getTime()) ? when : null,
  };
}

// Shown to whoever can still open the page — staff, and the owner of a claimed
// listing. Everyone else gets a 404 from the API once it is hidden, so this is
// never the reason a shopper thinks a shop is gone.
function ClosedBanner({ info }) {
  return (
    <div className="mb-4 rounded-xl p-4 flex items-start gap-3"
      style={{ backgroundColor: '#2A1414', border: '1px solid #6B2A2A' }}>
      <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#F87171' }} />
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: '#FCA5A5' }}>
          {info.hidden ? 'Marked closed — hidden from the public map' : 'Marked closed'}
        </p>
        <p className="text-xs mt-1" style={{ color: LABEL }}>
          {info.reason}
          {info.when && ` · flagged ${info.when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
        </p>
        <p className="text-xs mt-1" style={{ color: MUTED }}>
          {info.hidden
            ? 'Nobody finds this shop in search or on the map. Staff can put it back from the Closed queue in the admin panel.'
            : 'It is still on the public map. Staff settle it from the Closed queue in the admin panel.'}
        </p>
      </div>
    </div>
  );
}

function UnclaimedBanner({ store, myClaim, menuStatus, site, onClaim, onReport }) {
  const autoMenu = menuStatus && typeof menuStatus.status === 'string' && menuStatus.status.startsWith('ok');
  return (
    <div className="mb-4 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
      style={{ backgroundColor: '#241C12', border: '1px solid #4D3A1A' }}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold flex items-center gap-2" style={{ color: NAVY }}>
          <MapPin className="w-4 h-4" style={{ color: AMBER }} /> Unclaimed listing
        </p>
        <p className="text-xs mt-1" style={{ color: MUTED }}>
          {/* The credit was wrong: most of this directory is Overture, not OSM,
              and both licences ask to be named. */}
          Details come from the Overture Maps Foundation and OpenStreetMap contributors, and may be out of date.
          {/* Saying "inventory appears once claimed" over a menu we are already
              showing contradicts the page. Only say it when there is none. */}
          {autoMenu ? ' Deals and events appear once the owner claims this shop.'
            : ' Inventory, deals, and events appear once the owner claims this shop.'}
        </p>
        {autoMenu && (
          <p className="text-xs mt-1" style={{ color: MUTED }}>
            Menu read automatically from {domainOf(menuStatus.url || store.website)}. Prices and stock may lag the shop.
          </p>
        )}
        {/* The dead address is deliberately not reprinted here. The page has
            already withheld the link; naming the domain in the next breath
            publishes it again in the one place a reader is most likely to type
            it in by hand. An owner does not need to be told which of their own
            domains lapsed, only that the one we hold does not work. */}
        {site && !site.ok && !site.pending && (
          <p className="text-xs mt-1" style={{ color: AMBER }}>
            The website on this listing no longer works — claim the shop and we will point people at the right one.
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {myClaim?.status === 'pending' ? (
          <span className="text-xs font-medium px-3 py-1.5 rounded-full" style={{ backgroundColor: '#2D1E06', color: AMBER, border: '1px solid #4D3010' }}>
            Your claim is pending review
          </span>
        ) : (
          <button onClick={onClaim} className="btn-primary text-sm flex items-center gap-1.5">
            <BadgeCheck className="w-4 h-4" /> Own this shop? Claim it
          </button>
        )}
        <button onClick={onReport} className="text-xs flex items-center gap-1 hover:text-amber-500" style={{ color: MUTED }} title="Report a problem with this listing">
          <Flag className="w-3.5 h-3.5" /> Report
        </button>
      </div>
    </div>
  );
}

function ClaimModal({ store, user, onClose, onClaimed, onPending }) {
  const [form, setForm] = useState({ contact_email: user?.email || '', contact_phone: store.phone || '', message: '' });
  const [step, setStep] = useState('form');
  const [code, setCode] = useState('');
  const [emailHint, setEmailHint] = useState('');
  // 'email' or 'none', from the server: whether an email can actually reach them.
  const [notify, setNotify] = useState('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api.claimStore(store.id, form);
      if (r.notify) setNotify(r.notify);
      if (r.status === 'code_sent') { setEmailHint(r.email_hint); setStep('code'); }
      else { setStep('pending'); onPending(r); }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function verify(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await api.verifyClaim(store.id, code); setStep('done'); onClaimed(r.store); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const domain = (store.website || '').replace(/^www\./, '').split('/')[0];

  if (!user) return (
    <Modal title={`Claim ${store.name}`} onClose={onClose}>
      <p className="text-sm mb-4" style={{ color: LABEL }}>Claiming is free. Create a retailer account (or sign in) to prove you run this shop, then manage its hours, inventory, deals, and events.</p>
      <div className="flex flex-col gap-2">
        <Link to={`/register?type=store&claim=${store.id}`} className="btn-primary text-center">Create a retailer account</Link>
        <Link to={`/login?next=${encodeURIComponent(`/stores/${store.id}?claim=1`)}`} className="btn-secondary text-center">I already have an account</Link>
      </div>
    </Modal>
  );

  if (user.account_type !== 'store') return (
    <Modal title={`Claim ${store.name}`} onClose={onClose}>
      <p className="text-sm mb-3" style={{ color: LABEL }}>You are signed in with an enthusiast account. Claims need a retailer account, ideally registered with your shop's email.</p>
      <Link to={`/register?type=store&claim=${store.id}`} className="btn-primary text-center block">Create a retailer account</Link>
    </Modal>
  );

  return (
    <Modal title={`Claim ${store.name}`} onClose={onClose}>
      {step === 'form' && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="text-xs" style={{ color: MUTED }}>
            {domain
              ? <>Use an email at <span style={{ color: NAVY }}>@{domain}</span> and we can verify you instantly with a code. Any other email goes to a quick manual review.</>
              : 'Tell us how to confirm you run this shop. We review claims within one to two business days.'}
          </p>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: LABEL }}>Business email</label>
            <input type="email" required value={form.contact_email} onChange={e => set('contact_email', e.target.value)} className="input" placeholder={domain ? `you@${domain}` : 'you@yourshop.com'} />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: LABEL }}>Phone</label>
            <input value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} className="input" placeholder="(555) 555-5555" />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: LABEL }}>Anything that helps us verify (optional)</label>
            <textarea value={form.message} onChange={e => set('message', e.target.value)} className="input min-h-[80px]" placeholder="Your name and role, your website, Instagram, or a note about the shop" />
          </div>
          {error && <p className="text-xs" style={{ color: '#F87171' }}>{error}</p>}
          <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Submitting...' : 'Submit claim'}</button>
        </form>
      )}
      {step === 'code' && (
        <form onSubmit={verify} className="flex flex-col gap-3">
          <p className="text-sm flex items-start gap-2" style={{ color: LABEL }}><Mail className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: AMBER }} /> We emailed a 6-digit code to {emailHint}. Enter it to finish.</p>
          <input inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} className="input text-center text-2xl tracking-[0.4em]" placeholder="------" />
          {error && <p className="text-xs" style={{ color: '#F87171' }}>{error}</p>}
          <button type="submit" disabled={busy || code.length !== 6} className="btn-primary">{busy ? 'Checking...' : 'Verify and claim'}</button>
          <button type="button" onClick={() => setStep('form')} className="text-xs" style={{ color: MUTED }}>Use a different email</button>
        </form>
      )}
      {step === 'pending' && (
        <div className="text-center py-2">
          <Clock className="w-8 h-8 mx-auto mb-2" style={{ color: AMBER }} />
          <p className="text-sm font-medium mb-1" style={{ color: NAVY }}>Claim submitted</p>
          {/* Only promise an email when the deployment can actually send one.
              Without SMTP credentials the mailer is a no-op that resolves —
              right for the claim, which must not fail over a missing mailer,
              but it meant this line promised something that could not
              happen. The server says which it is. */}
          <p className="text-xs mb-4" style={{ color: MUTED }}>
            We will review it within one to two business days
            {notify === 'email'
              ? ' and email you.'
              : '. Check back on this page — we cannot email you yet, so this is where the answer will appear.'}
            {' '}Your store dashboard unlocks automatically once approved.
          </p>
          <button onClick={onClose} className="btn-secondary">Done</button>
        </div>
      )}
      {step === 'done' && (
        <div className="text-center py-2">
          <CheckCircle className="w-8 h-8 mx-auto mb-2" style={{ color: '#4ADE80' }} />
          <p className="text-sm font-medium mb-1" style={{ color: NAVY }}>You now manage {store.name}</p>
          <p className="text-xs mb-4" style={{ color: MUTED }}>Head to your dashboard to fix hours, add inventory, and post your first deal.</p>
          <Link to="/store-dashboard" className="btn-primary inline-block">Open store dashboard</Link>
        </div>
      )}
    </Modal>
  );
}

const REPORT_REASONS = [
  { value: 'closed', label: 'Permanently closed' },
  { value: 'not_cigar_shop', label: 'Not a cigar shop (vape, convenience, other)' },
  { value: 'wrong_location', label: 'Wrong location on the map' },
  { value: 'wrong_info', label: 'Wrong name, phone, hours, or website' },
  { value: 'duplicate', label: 'Duplicate of another listing' },
  { value: 'other', label: 'Something else' },
];

// "It's gone" is the report that matters most and the one a passer-by is most
// likely to have first-hand knowledge of, so it gets its own panel above the
// rest instead of being the first line of a radio list.
const OTHER_REPORT_REASONS = REPORT_REASONS.filter(r => r.value !== 'closed');

/**
 * "Ask this shop to carry a cigar."
 *
 * The Request button has been on every profile for months with nothing behind
 * it: it set a piece of state that nothing rendered, so a customer pressed it
 * and the page did nothing at all. The endpoint and the table were both
 * already there.
 *
 * On an unclaimed listing the request cannot reach anybody yet, so the dialog
 * says so rather than implying a shop is reading it. It is still worth
 * collecting: a list of people asking for a particular cigar at a particular
 * shop is the most useful thing we can put in front of that shop when we ask
 * it to claim its listing. Between hiding the tile and being straight about
 * where the message goes, being straight keeps the signal and costs nothing.
 */
function RequestModal({ store, onClose, onDone }) {
  const [cigar, setCigar] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unclaimed = !store.claimed;

  async function submit(e) {
    e.preventDefault();
    if (!cigar.trim()) { setError('Which cigar are you after?'); return; }
    setBusy(true); setError('');
    try {
      await api.submitInventoryRequest(store.id, { cigar_name_free: cigar.trim(), message: message.trim() || null });
      onDone();
    } catch (err) {
      setError(err.message || 'We could not send that just now. Try again in a moment.');
    } finally { setBusy(false); }
  }

  return (
    <Modal title={`Request a cigar at ${store.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="block text-xs mb-1" style={{ color: LABEL }}>Which cigar?</label>
        <input value={cigar} onChange={e => setCigar(e.target.value)} autoFocus
          placeholder="Brand and line, e.g. Padron 1964 Exclusivo"
          className="w-full mb-3 px-3 py-2 rounded-lg text-sm"
          style={{ backgroundColor: '#241C12', border: `1px solid ${BORDER}`, color: NAVY }} />

        <label className="block text-xs mb-1" style={{ color: LABEL }}>Anything else? (optional)</label>
        <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
          placeholder="Size, how many, when you would collect"
          className="w-full mb-3 px-3 py-2 rounded-lg text-sm"
          style={{ backgroundColor: '#241C12', border: `1px solid ${BORDER}`, color: NAVY }} />

        <p className="text-xs mb-4 leading-relaxed" style={{ color: MUTED }}>
          {unclaimed
            ? 'Nobody at this shop has claimed its listing yet, so this will not reach them today. We keep these requests and show them to the shop when it joins — it is the best argument there is for a shop to get involved.'
            : 'This goes to the shop, which can mark it as sorted once they have it in.'}
        </p>

        {error && <p className="text-xs mb-3" style={{ color: '#F87171' }}>{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Sending...' : 'Send request'}
        </button>
      </form>
    </Modal>
  );
}

function ReportModal({ store, onClose, onDone, onClosed }) {
  const [reason, setReason] = useState('wrong_info');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // What the server did with a "permanently closed" report. Reports of anything
  // else just close the dialog, as before.
  const [thanks, setThanks] = useState(null);
  const closing = reason === 'closed';

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await api.reportStore(store.id, { reason, details }) || {};
      if (closing) {
        setThanks(r);
        if (r.removed) onClosed?.(r);
      } else onDone();
    } catch (err) {
      setError(err.message || 'We could not send that just now. Try again in a moment.');
    } finally { setBusy(false); }
  }

  if (thanks) return (
    <Modal title="Thanks — that helps" onClose={onClose}>
      <div className="text-center py-2">
        <CheckCircle className="w-8 h-8 mx-auto mb-2" style={{ color: '#4ADE80' }} />
        <p className="text-sm font-medium mb-2" style={{ color: NAVY }}>
          {thanks.removed ? `${store.name} has been taken off the map.` : 'Report received.'}
        </p>
        <p className="text-xs mb-4 leading-relaxed" style={{ color: MUTED }}>
          {thanks.removed
            ? 'Enough people have told us this shop has closed, so it no longer shows in search or on the map. Someone on our team will confirm it.'
            : thanks.needs_review
              ? 'This listing is looked after by its owner, so nothing changes automatically — someone on our team will check it.'
              : 'A couple of reports from different people take a listing off the map. One more and this one goes. Until then it stays up, in case the shop was only shut for the day.'}
        </p>
        <button onClick={onClose} className="btn-primary">Done</button>
      </div>
    </Modal>
  );

  return (
    <Modal title="Report a problem" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="rounded-xl p-3 flex items-start gap-3 cursor-pointer transition-colors"
          style={closing
            ? { backgroundColor: '#2A1414', border: '1px solid #7F3030' }
            : { backgroundColor: BG_ALT, border: `1px solid ${BORDER}` }}>
          <input type="radio" name="reason" value="closed" checked={closing}
            onChange={() => setReason('closed')} className="accent-amber-600 mt-0.5" />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: closing ? '#FCA5A5' : NAVY }}>
              <DoorClosed className="w-4 h-4 flex-shrink-0" style={{ color: closing ? '#F87171' : MUTED }} />
              This shop has permanently closed
            </span>
            <span className="block text-xs mt-1" style={{ color: MUTED }}>
              A couple of reports from different people take the listing off the map.
            </span>
          </span>
        </label>

        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: MUTED }}>Something else</p>
        <div className="flex flex-col gap-1.5">
          {OTHER_REPORT_REASONS.map(r => (
            <label key={r.value} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: LABEL }}>
              <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-amber-600" />
              {r.label}
            </label>
          ))}
        </div>

        <textarea value={details} onChange={e => setDetails(e.target.value)} className="input min-h-[70px]"
          placeholder={closing ? 'What did you see? An empty unit, a sign on the door, another business at the address (optional)' : 'Details (optional)'} />
        {error && <p className="text-xs" style={{ color: '#F87171' }}>{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary">{busy ? 'Sending...' : 'Send report'}</button>
      </form>
    </Modal>
  );
}

export default function StoreProfile() {
  const { id } = useParams();
  const { user, refreshStore, refreshMe } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [invBrands, setInvBrands] = useState([]);
  const [invBrand, setInvBrand] = useState('');
  const [invMeta, setInvMeta] = useState({ total: 0, listings: 0, pages: 0 });
  const [invPage, setInvPage] = useState(1);
  const [invLoading, setInvLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followPrefs, setFollowPrefs] = useState({ notify_broadcasts: 1, notify_deals: 1, notify_new_arrivals: 1 });
  const [tab, setTab] = useState(searchParams.get('tab') || 'inventory');
  const [search, setSearch] = useState('');
  const [ratingForm, setRatingForm] = useState({ rating: 0, comment: '' });
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [requestModal, setRequestModal] = useState(false);
  const [communityPosts, setCommunityPosts] = useState([]);
  const [events, setEvents] = useState([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [postForm, setPostForm] = useState({ type: 'post', content: '', cigar_id: '' });
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [cigarSearchQ, setCigarSearchQ] = useState('');
  const [cigarSearchResults, setCigarSearchResults] = useState([]);
  const [selectedCigar, setSelectedCigar] = useState(null);
  // replies: { [postId]: { open: bool, list: [], content: string, submitting: bool } }
  const [replyState, setReplyState] = useState({});
  const [claimModal, setClaimModal] = useState(false);
  const [reportModal, setReportModal] = useState(false);
  const [menuStatus, setMenuStatus] = useState(null);

  // Deep link from registration: /stores/:id?claim=1 opens the claim dialog
  useEffect(() => {
    if (searchParams.get('claim') === '1' && data?.store && data.store.claimed === 0 && user) setClaimModal(true);
  }, [data, user]);

  useEffect(() => {
    api.getStore(id).then(d => {
      setData(d);
      setFollowing(d.is_following);
      if (d.follow_prefs) setFollowPrefs(d.follow_prefs);
    }).finally(() => setLoading(false));
    api.getStoreInventoryBrands(id).then(r => setInvBrands(r.brands || [])).catch(() => setInvBrands([]));
    // Whether this shop's website is being read for us. Never blocks the page.
    api.getStoreMenuStatus(id).then(setMenuStatus).catch(() => setMenuStatus(null));
  }, [id]);

  // Searching and brand-filtering happen on the server so they reach the whole
  // shelf, not just the slice already downloaded.
  useEffect(() => { setInvPage(1); }, [search, invBrand]);

  useEffect(() => {
    let cancelled = false;
    setInvLoading(true);
    const t = setTimeout(() => {
      api.getStoreInventory(id, { limit: 60, page: invPage, ...(search ? { q: search } : {}), ...(invBrand ? { brand: invBrand } : {}) })
        .then(inv => {
          if (cancelled) return;
          setInventory(inv.items || []);
          setInvMeta({ total: inv.total || 0, listings: inv.listings || 0, pages: inv.pages || 0 });
        })
        .catch(() => { if (!cancelled) setInventory([]); })
        .finally(() => { if (!cancelled) setInvLoading(false); });
    }, search ? 300 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [id, search, invBrand, invPage]);

  async function handleFollow() {
    if (!user) return navigate('/login');
    setFollowLoading(true);
    try {
      const res = await api.followStore(id);
      setFollowing(res.following);
      if (res.following) setShowPrefs(true);
      toast(res.following ? `Following ${data?.store?.name}` : 'Unfollowed');
    } finally { setFollowLoading(false); }
  }

  async function updatePrefs(key, val) {
    const next = { ...followPrefs, [key]: val ? 1 : 0 };
    setFollowPrefs(next);
    await api.updateFollowPrefs(id, next);
  }

  async function loadCommunity() {
    setCommunityLoading(true);
    try {
      const [posts, evts] = await Promise.all([
        api.getCommunityPosts(id),
        api.getStoreEvents(id),
      ]);
      setCommunityPosts(posts);
      setEvents(evts);
    } finally { setCommunityLoading(false); }
  }

  useEffect(() => { if (tab === 'community') loadCommunity(); }, [tab, id]);

  async function searchCigarsForPost(q) {
    if (!q.trim()) { setCigarSearchResults([]); return; }
    const d = await api.searchCigars({ q, limit: 6 });
    setCigarSearchResults(d.cigars);
  }

  async function submitPost() {
    if (!postForm.content.trim()) return;
    setPostSubmitting(true);
    try {
      await api.createCommunityPost(id, {
        type: postForm.type,
        content: postForm.content,
        cigar_id: selectedCigar?.id || null,
      });
      setPostForm({ type: 'post', content: '', cigar_id: '' });
      setSelectedCigar(null);
      setCigarSearchQ('');
      setCigarSearchResults([]);
      await loadCommunity();
      toast(postForm.type === 'checkin' ? 'Checked in!' : 'Posted!');
    } catch (e) { toast(e.message, 'error'); } finally { setPostSubmitting(false); }
  }

  async function handleRsvp(eventId, status) {
    if (!user) return navigate('/login');
    try {
      await api.rsvpEvent(eventId, status);
      await loadCommunity();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function deletePost(postId) {
    if (!confirm('Delete this post?')) return;
    await api.deleteCommunityPost(postId);
    await loadCommunity();
  }

  async function toggleLike(postId) {
    if (!user) return navigate('/login');
    const res = await api.likePost(postId);
    setCommunityPosts(prev => prev.map(p =>
      p.id === postId ? { ...p, my_like: res.liked, like_count: res.like_count } : p
    ));
  }

  function getReply(postId) {
    return replyState[postId] || { open: false, list: [], content: '', submitting: false };
  }

  async function toggleReplies(postId) {
    const cur = getReply(postId);
    if (!cur.open) {
      const list = await api.getReplies(postId);
      setReplyState(s => ({ ...s, [postId]: { ...cur, open: true, list } }));
    } else {
      setReplyState(s => ({ ...s, [postId]: { ...cur, open: false } }));
    }
  }

  async function submitReply(postId) {
    const cur = getReply(postId);
    if (!cur.content.trim()) return;
    setReplyState(s => ({ ...s, [postId]: { ...cur, submitting: true } }));
    try {
      await api.postReply(postId, cur.content);
      const list = await api.getReplies(postId);
      setCommunityPosts(prev => prev.map(p =>
        p.id === postId ? { ...p, reply_count: parseInt(p.reply_count) + 1 } : p
      ));
      setReplyState(s => ({ ...s, [postId]: { open: true, list, content: '', submitting: false } }));
    } catch {
      setReplyState(s => ({ ...s, [postId]: { ...cur, submitting: false } }));
    }
  }

  async function deleteReply(postId, replyId) {
    await api.deleteReply(postId, replyId);
    const list = await api.getReplies(postId);
    setCommunityPosts(prev => prev.map(p =>
      p.id === postId ? { ...p, reply_count: Math.max(0, parseInt(p.reply_count) - 1) } : p
    ));
    setReplyState(s => ({ ...s, [postId]: { ...getReply(postId), list } }));
  }

  async function submitRating() {
    if (!ratingForm.rating) return;
    await api.rateStore(id, ratingForm);
    setRatingSubmitted(true);
    const updated = await api.getStore(id);
    setData(updated);
  }


  if (loading) return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
      <div className="h-8 skeleton rounded w-64" />
      <div className="h-32 skeleton rounded" />
    </div>
  );

  if (!data) return <div className="text-center py-20" style={{ color: MUTED }}>Store not found</div>;

  const { store, inventory_count, deals, stats, recent_ratings, new_arrivals } = data;
  const hours = typeof store.hours === 'object' ? store.hours : {};
  const site = websiteInfo(store);
  const closure = closureInfo(store);

  // Open or closed on the shop's own clock, worked out by the server. This used
  // the visitor's clock, so a Tucson shop looked at from Miami was three hours off.
  const openNow = store.open_status || getStoreStatus(hours);
  // Map hours are shown as map hours: about half of the ones we could check
  // against a shop's own site were wrong on some day, so they earn no badge.
  const hoursAreConfirmed = hoursConfirmed(store);
  const cannotConfirmOpen = unconfirmedShop(store);
  const isOpen = hoursAreConfirmed && !cannotConfirmOpen ? openNow.isOpen : null;
  const today = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
    new Date(new Date().toLocaleString('en-US', { timeZone: store.timezone || undefined })).getDay()];
  const todayHours = openNow.today || hours[today];


  // Shops differ: some list a full shelf, some only a handful of lines, most
  // nothing at all. Show a tab only where there is something behind it rather
  // than greeting every visitor with three empty sections.
  const lineCount = invBrands.reduce((n, b) => n + b.lines, 0);
  // A big shelf opens on its brands, not on hundreds of cigars at once; a
  // small one just shows what it has. Search always reaches everything.
  const showDirectory = invBrands.length > 3 && lineCount > 24 && !invBrand && !search.trim();
  const TABS = [
    ...(inventory_count > 0 ? [{ key: 'inventory', label: `Inventory${lineCount ? ` (${lineCount})` : ''}` }] : []),
    ...(new_arrivals.length ? [{ key: 'new', label: `New Arrivals (${new_arrivals.length})` }] : []),
    ...(deals.length ? [{ key: 'deals', label: `Deals (${deals.length})` }] : []),
    { key: 'community',  label: 'Community' },
    { key: 'about',      label: 'About' },
  ];
  // Never leave the page on a tab that no longer exists for this shop.
  // 'about' always exists, so it is the safe landing place for a shop whose
  // requested tab (often the default 'inventory') has nothing behind it.
  const activeTab = TABS.some(t => t.key === tab) ? tab : 'about';

  const mapsUrl = store.address
    ? `https://maps.google.com/?q=${encodeURIComponent([store.address, store.city, store.state].filter(Boolean).join(', '))}`
    : `https://maps.google.com/?q=${encodeURIComponent([store.name, store.city, store.state].filter(Boolean).join(', '))}`;

  const openStyle   = { backgroundColor: '#0B3320', color: '#4ADE80' };
  const closedStyle = { backgroundColor: '#2D1010', color: '#F87171' };

  return (
    <div className="max-w-4xl mx-auto px-4 py-4 sm:py-6">
      <BackButton label="Stores" to="/stores" />

      {closure && <ClosedBanner info={closure} />}

      {store.claimed === 0 && (
        <UnclaimedBanner store={store} myClaim={data.my_claim} menuStatus={menuStatus} site={site} onClaim={() => setClaimModal(true)} onReport={() => setReportModal(true)} />
      )}
      {claimModal && (
        <ClaimModal store={store} user={user} onClose={() => setClaimModal(false)}
          onClaimed={(s) => {
            refreshStore(s);
            // The page keeps its own copy of the store, so update it too or the
            // "Unclaimed listing" banner stays up over a store you now own.
            setData(d => d && ({ ...d, store: { ...d.store, ...s, claimed: 1 }, my_claim: null }));
            toast('Store claimed. Welcome aboard!');
          }}
          onPending={(claim) => {
            // A manual claim leaves the account with no store yet; refresh so
            // the dashboard shows "claim pending" instead of the setup wizard.
            refreshMe().catch(() => {});
            setData(d => d && ({ ...d, my_claim: { id: claim?.id, status: 'pending', method: claim?.method || 'manual' } }));
          }} />
      )}
      {requestModal && (
        <RequestModal store={store} onClose={() => setRequestModal(false)}
          onDone={() => {
            setRequestModal(false);
            toast(store.claimed
              ? 'Sent. The shop will see it on their dashboard.'
              : 'Noted. We will pass it on when this shop claims its listing.');
          }} />
      )}

      {reportModal && (
        <ReportModal store={store} onClose={() => setReportModal(false)}
          onDone={() => { setReportModal(false); toast('Thanks, we will take a look.'); }}
          // Enough reports came in to pull the listing: show the closed banner
          // straight away rather than making the reporter reload to find out.
          onClosed={() => setData(d => d && ({
            ...d,
            store: { ...d.store, visible: 0, storefront: 'closed', closed_reason: 'Reported closed by visitors', closed_at: new Date().toISOString() },
          }))} />
      )}

      {/* Store header card */}
      <div className="card mb-4 overflow-hidden">
        <div className="flex items-start gap-4 p-5">
          <StoreThumb store={store} size={76} />
          <div className="flex-1 min-w-0">
            {/* Name + badges */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="font-serif text-xl font-bold" style={{ color: NAVY }}>{store.name}</h1>
              {store.verified === 1 && <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: '#4ADE80' }} />}
            </div>

            {/* The few things a visitor decides on: open now, when, and whether
                there is somewhere to sit and smoke. */}
            <div className="flex items-center flex-wrap gap-2 mb-2">
              {isOpen === true && (
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full" style={openStyle}>Open now</span>
              )}
              {isOpen === false && (
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full" style={closedStyle}>Closed</span>
              )}
              {hasLounge(store) && (
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
                  style={{ backgroundColor: '#3A2E0A', color: '#F5C542', border: '1px solid #6B5314' }}>Lounge</span>
              )}
              <span className="text-sm" style={{ color: isOpen ? '#9FD9B0' : MUTED }}>
                {hoursAreConfirmed && openNow.label
                  ? <>{openNow.label}{isOpen && todayHours ? <span style={{ color: MUTED }}> · today {String(todayHours).replace(/-/g, '–')}</span> : null}</>
                  : todayHours
                    ? <>Today {String(todayHours).replace(/-/g, '–')}{hoursAreConfirmed ? null : <span style={{ color: '#7A6D60' }}> · from map data, not confirmed</span>}</>
                    : 'Hours not listed yet'}
              </span>
            </div>

            {cannotConfirmOpen && (
              <p className="text-sm mb-2" style={{ color: '#A8998A' }}>
                We couldn't confirm this shop is still open. Call or check before you go.
              </p>
            )}

            {/* Address / phone / website */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-2" style={{ color: MUTED }}>
              {(store.address || store.city) && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {[store.address, store.city, store.state].filter(Boolean).join(', ')}
                </span>
              )}
              {/* The other shops in this town. A link a person wants anyway, and
                  the path a crawler takes from one page of the directory to the
                  rest of it. */}
              {store.city && store.state && (
                <Link to={`/cigar-shops/${citySlug(store.city, store.state)}`}
                  className="flex items-center gap-1 transition-colors"
                  style={{ color: MUTED }}
                  onMouseEnter={e => e.currentTarget.style.color = AMBER}
                  onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                  More cigar shops in {store.city}
                </Link>
              )}
              {store.phone && (
                <a href={`tel:${store.phone}`} className="flex items-center gap-1 transition-colors"
                  style={{ color: MUTED }}
                  onMouseEnter={e => e.currentTarget.style.color = AMBER}
                  onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                  <Phone className="w-3.5 h-3.5" />{store.phone}
                </a>
              )}
              <WebsiteLine site={site} />
            </div>

            {/* Tags */}
            {store.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {store.tags.map(t => (
                  <span key={t} className="text-xs font-medium px-2.5 py-0.5 rounded-full"
                    style={{ backgroundColor: BG_ALT, color: NAVY, border: `1px solid ${BORDER}` }}>
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* Stats */}
            <div className="flex flex-wrap gap-4 text-xs" style={{ color: MUTED }}>
              <span className="flex items-center gap-1"><Package className="w-3 h-3" />{inventory_count} SKUs</span>
              <span className="flex items-center gap-1"><Users className="w-3 h-3" />{stats.followers} followers</span>
              {stats.avg_rating > 0 && (
                <span className="flex items-center gap-1">
                  <Star className="w-3 h-3" style={{ color: '#D97706' }} />
                  <span style={{ color: LABEL, fontWeight: 500 }}>{stats.avg_rating}</span>
                  <span>({stats.rating_count} ratings)</span>
                </span>
              )}
              {TYPE_LABEL[store.store_type] && store.store_type !== 'cigar_shop' && (
                <span style={{ color: LABEL }}>{TYPE_LABEL[store.store_type]}</span>
              )}
              {store.claimed !== 0 && (
                <button onClick={() => setReportModal(true)} className="flex items-center gap-1 hover:text-amber-500" style={{ color: MUTED }} title="Report a problem">
                  <Flag className="w-3 h-3" /> Report
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Follow / Request buttons */}
        {user && user.account_type === 'user' && (
          <div className="px-5 pb-4 pt-3 flex flex-wrap items-center gap-3"
            style={{ borderTop: `1px solid ${BORDER}` }}>
            <button onClick={handleFollow} disabled={followLoading}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-60 ${following ? '' : 'btn-primary'}`}
              style={following ? { backgroundColor: '#2D1E06', color: AMBER, border: `1px solid #4D3010` } : {}}>
              {followLoading
                ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <Heart className={`w-4 h-4 ${following ? 'fill-current' : ''}`} />}
              {following ? 'Following' : 'Follow'}
            </button>

          </div>
        )}

        {/* Notification prefs. Only on a claimed listing: every one of these is
            "notify me when this shop posts", and nobody can post on a listing
            with no owner. Four switches that can never fire is worse than no
            switches — a follower turns them all on and concludes we are
            broken, rather than that the shop has not joined yet. Following
            itself still works: it is how somebody hears when the shop does
            claim the listing. */}
        {following && store.claimed ? (
          <div className="mx-5 mb-4 rounded-xl p-3" style={{ backgroundColor: BG_ALT, border: `1px solid ${BORDER}` }}>
            <p className="text-xs mb-2" style={{ color: MUTED }}>Notify me when this store posts:</p>
            <div className="flex flex-wrap gap-4">
              {[
                { key: 'notify_broadcasts',   label: 'Announcements' },
                { key: 'notify_deals',        label: 'Deals' },
                { key: 'notify_new_arrivals', label: 'New Arrivals' },
                { key: 'notify_community',    label: 'Community & Events' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!followPrefs[key]} onChange={e => updatePrefs(key, e.target.checked)} className="accent-amber-600" />
                  <span className="text-sm font-medium" style={{ color: LABEL }}>{label}</span>
                </label>
              ))}
            </div>
          </div>
        ) : following ? (
          <div className="mx-5 mb-4 rounded-xl p-3" style={{ backgroundColor: BG_ALT, border: `1px solid ${BORDER}` }}>
            <p className="text-xs" style={{ color: MUTED }}>
              You are following this shop. Nobody here has claimed the listing yet, so there is
              nothing for it to post — we will let you know when that changes.
            </p>
          </div>
        ) : null}

        {/* Quick contact bar */}
        <div className="flex" style={{ borderTop: `1px solid ${BORDER}` }}>
          {store.phone && (
            <a href={`tel:${store.phone}`}
              className="flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors"
              style={{ color: MUTED }}
              onMouseEnter={e => { e.currentTarget.style.color = AMBER; e.currentTarget.style.backgroundColor = BG_ALT; }}
              onMouseLeave={e => { e.currentTarget.style.color = MUTED; e.currentTarget.style.backgroundColor = ''; }}>
              <Phone className="w-5 h-5" />
              <span className="text-xs font-medium">Call</span>
            </a>
          )}
          <a href={mapsUrl} target="_blank" rel="noopener"
            className="flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors"
            style={{ color: MUTED, borderLeft: `1px solid ${BORDER}` }}
            onMouseEnter={e => { e.currentTarget.style.color = AMBER; e.currentTarget.style.backgroundColor = BG_ALT; }}
            onMouseLeave={e => { e.currentTarget.style.color = MUTED; e.currentTarget.style.backgroundColor = ''; }}>
            <Navigation className="w-5 h-5" />
            <span className="text-xs font-medium">Directions</span>
          </a>
          <WebsiteAction site={site} />
          <button onClick={() => { if (!user) navigate('/login'); else setRequestModal(true); }}
            className="flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors"
            style={{ color: MUTED, borderLeft: `1px solid ${BORDER}` }}
            onMouseEnter={e => { e.currentTarget.style.color = AMBER; e.currentTarget.style.backgroundColor = BG_ALT; }}
            onMouseLeave={e => { e.currentTarget.style.color = MUTED; e.currentTarget.style.backgroundColor = ''; }}>
            <Package className="w-5 h-5" />
            <span className="text-xs font-medium">Request</span>
          </button>
        </div>
      </div>

      {/* Today's hours */}
      {todayHours && (
        <div className="rounded-xl px-4 py-2.5 mb-4 flex items-center gap-2 text-sm"
          style={isOpen
            ? { backgroundColor: '#0A2C1A', border: '1px solid #0D5F35' }
            : { backgroundColor: BG_ALT, border: `1px solid ${BORDER}` }}>
          <Clock className="w-4 h-4" style={{ color: isOpen ? '#4ADE80' : MUTED }} />
          <span style={{ color: LABEL }}>
            Today: <span className="font-semibold">{todayHours}</span>
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex mb-5 overflow-x-auto" style={{ borderBottom: `1px solid ${BORDER}` }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors"
            style={activeTab === t.key
              ? { color: AMBER, borderBottom: `2px solid ${AMBER}` }
              : { color: MUTED }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Inventory ─────────────────────────────────────────────────────
          Brand, then line, then the sizes that line comes in. A shop's feed
          lists every variant separately, so each line shows a price range
          rather than one chip per purchasable permutation. */}
      {activeTab === 'inventory' && (
        <>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search this store's inventory..." className="input mb-3" />

          {/* A brand picked from the directory: say where we are and how back. */}
          {invBrand && (
            <div className="flex items-center gap-3 mb-3">
              <button type="button" onClick={() => setInvBrand('')}
                className="text-xs px-3 py-1.5 rounded-full" style={{ backgroundColor: BG_ALT, color: LABEL, border: `1px solid ${BORDER}` }}>
                ← All brands
              </button>
              <h3 className="font-serif text-lg font-bold" style={{ color: NAVY }}>{invBrand}</h3>
            </div>
          )}

          {!showDirectory && invMeta.total > 0 && (
            <p className="text-xs mb-3" style={{ color: MUTED }}>
              {invMeta.total} {invMeta.total === 1 ? 'cigar' : 'cigars'}
              {invMeta.listings > invMeta.total && ` · ${invMeta.listings} listings`}
              {invBrand && ` · ${invBrand}`}
            </p>
          )}

          {showDirectory ? (
            <BrandDirectory brands={invBrands} total={lineCount} onPick={setInvBrand} />
          ) : invLoading && inventory.length === 0 ? (
            <p className="text-center py-10" style={{ color: MUTED }}>Loading…</p>
          ) : inventory.length === 0 ? (
            <p className="text-center py-10" style={{ color: MUTED }}>
              {search || invBrand ? 'Nothing here matches that.' : 'This shop has not listed what it carries yet.'}
            </p>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {inventory.map(item => {
                const range = priceRange(item.price_min, item.price_max);
                const web = item.web_checked_at ? freshness(item.web_checked_at) : null;
                return (
                  <Link key={item.cigar_id} to={`/cigars/${item.cigar_id}`}
                    className="card p-4 flex flex-col transition-colors group"
                    onMouseEnter={e => e.currentTarget.style.borderColor = '#3A4F68'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
                    <div className="flex items-start gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold uppercase tracking-wider mb-0.5 truncate" style={{ color: AMBER }}>{item.brand}</p>
                        <h3 className="font-semibold leading-tight" style={{ color: NAVY }}>{item.cigar_name}</h3>
                      </div>
                      {item.is_new_arrival === 1 && (
                        <span className="text-xs font-bold uppercase flex-shrink-0" style={{ color: '#60A5FA' }}>NEW</span>
                      )}
                    </div>

                    {(item.strength || item.country) && (
                      <p className="text-xs mb-2 capitalize" style={{ color: MUTED }}>
                        {[item.strength, item.country].filter(Boolean).join(' · ')}
                      </p>
                    )}

                    {range && (
                      <p className="font-bold mb-2" style={{ color: AMBER }}>{range}</p>
                    )}

                    {/* A line learned from a shop feed with no size in its
                        titles carries a single "Assorted" placeholder so its
                        stock has somewhere to attach. The price range above
                        already says everything that row would. */}
                    {item.sizes.length > 0 && !(item.sizes.length === 1 && item.sizes[0].name === 'Assorted') && (
                      <div className="flex flex-col gap-1 mt-auto">
                        {item.sizes.slice(0, 4).map(s => {
                          const sr = priceRange(s.price_min, s.price_max);
                          return (
                            <div key={s.vitola_id} className="flex items-baseline justify-between gap-2 text-xs">
                              <span className="truncate" style={{ color: LABEL }}>
                                {s.name}
                                {s.length && s.ring_gauge ? (
                                  <span style={{ color: MUTED }}> · {s.length}×{s.ring_gauge}</span>
                                ) : null}
                              </span>
                              {sr && <span className="flex-shrink-0" style={{ color: MUTED }}>{sr}</span>}
                            </div>
                          );
                        })}
                        {item.sizes.length > 4 && (
                          <p className="text-xs" style={{ color: MUTED }}>+{item.sizes.length - 4} more sizes</p>
                        )}
                      </div>
                    )}

                    {web && (
                      <p className="text-xs mt-2 flex items-center gap-1.5"
                        style={{ color: isStale(item.web_checked_at) ? AMBER : MUTED }}>
                        <Globe className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">From the shop&rsquo;s site · {web}</span>
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          {!showDirectory && invMeta.pages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-5">
              <button className="btn-secondary text-sm px-3 py-1.5" disabled={invPage <= 1}
                onClick={() => setInvPage(p => Math.max(1, p - 1))}>Previous</button>
              <span className="text-xs" style={{ color: MUTED }}>Page {invPage} of {invMeta.pages}</span>
              <button className="btn-secondary text-sm px-3 py-1.5" disabled={invPage >= invMeta.pages}
                onClick={() => setInvPage(p => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {/* ── New Arrivals ── */}
      {activeTab === 'new' && (
        <div className="flex flex-col gap-3">
          {new_arrivals.length === 0 ? (
            <p className="text-center py-10" style={{ color: MUTED }}>No new arrivals right now.</p>
          ) : new_arrivals.map(item => (
            <Link key={item.id} to={`/cigars/${item.cigar_id}`}
              className="card p-4 transition-colors group"
              onMouseEnter={e => e.currentTarget.style.borderColor = '#3A4F68'}
              onMouseLeave={e => e.currentTarget.style.borderColor = BORDER}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: '#0D1F3A' }}>
                  <Package2 className="w-4 h-4" style={{ color: '#60A5FA' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: AMBER }}>{item.brand}</p>
                  <p className="font-semibold text-sm" style={{ color: NAVY }}>{item.cigar_name} — {item.vitola_name}</p>
                </div>
                <p className="font-bold flex-shrink-0" style={{ color: AMBER }}>${item.price.toFixed(2)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* ── Deals ── */}
      {activeTab === 'deals' && (
        <div className="flex flex-col gap-4">
          {deals.length === 0 ? (
            <p className="text-center py-10" style={{ color: MUTED }}>No active deals right now.</p>
          ) : deals.map(d => (
            <div key={d.id} className="card p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="font-semibold" style={{ color: NAVY }}>{d.title}</h3>
                {d.discount_percent && (
                  <span className="text-white text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0"
                    style={{ backgroundColor: AMBER }}>
                    -{d.discount_percent}%
                  </span>
                )}
              </div>
              {d.description && <p className="text-sm mb-2" style={{ color: LABEL }}>{d.description}</p>}
              {d.expires_at && <p className="text-xs" style={{ color: MUTED }}>Expires {new Date(d.expires_at).toLocaleDateString()}</p>}
            </div>
          ))}
        </div>
      )}

      {/* ── Community ── */}
      {activeTab === 'community' && (
        <div className="flex flex-col gap-5">
          {/* Upcoming events */}
          {events.filter(e => new Date(e.event_date) >= new Date()).length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: MUTED }}>Upcoming Events</p>
              <div className="flex flex-col gap-3">
                {events.filter(e => new Date(e.event_date) >= new Date()).map(evt => (
                  <div key={evt.id} className="card p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Calendar className="w-4 h-4 flex-shrink-0" style={{ color: AMBER }} />
                          <h3 className="font-semibold" style={{ color: NAVY }}>{evt.title}</h3>
                        </div>
                        <p className="text-xs mb-1" style={{ color: AMBER }}>
                          {new Date(evt.event_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>
                        {evt.description && <p className="text-sm" style={{ color: LABEL }}>{evt.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-2 pt-2" style={{ borderTop: `1px solid ${BORDER}` }}>
                      <span className="text-xs" style={{ color: MUTED }}>
                        <span className="font-semibold" style={{ color: '#4ADE80' }}>{evt.going_count}</span> going
                        {evt.maybe_count > 0 && <> · <span className="font-semibold" style={{ color: AMBER }}>{evt.maybe_count}</span> maybe</>}
                      </span>
                      {user?.account_type === 'user' && (
                        <div className="flex gap-2 ml-auto">
                          {['going', 'maybe'].map(s => (
                            <button key={s} onClick={() => handleRsvp(evt.id, evt.my_rsvp === s ? null : s)}
                              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors capitalize"
                              style={evt.my_rsvp === s
                                ? { backgroundColor: s === 'going' ? '#0B3320' : '#2D1E06', color: s === 'going' ? '#4ADE80' : AMBER, border: `1px solid ${s === 'going' ? '#0D5F35' : '#5A3010'}` }
                                : { backgroundColor: '#1A1410', color: MUTED, border: `1px solid ${BORDER}` }}>
                              {s === 'going' ? '✓ Going' : '? Maybe'}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Post composer */}
          {user && ['user', 'store'].includes(user.account_type) && (
            <div className="card p-4">
              <div className="flex gap-2 mb-3">
                {[
                  { type: 'post', icon: MessageSquare, label: 'Post' },
                  { type: 'checkin', icon: Coffee, label: 'Check In' },
                ].map(({ type, icon: Icon, label }) => (
                  <button key={type} onClick={() => setPostForm(f => ({ ...f, type }))}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                    style={postForm.type === type
                      ? { backgroundColor: '#2D1E06', color: AMBER, border: `1px solid #4D3010` }
                      : { backgroundColor: '#1A1410', color: MUTED, border: `1px solid ${BORDER}` }}>
                    <Icon className="w-3.5 h-3.5" />{label}
                  </button>
                ))}
              </div>
              <textarea rows={3} className="input resize-none text-sm mb-2"
                placeholder={postForm.type === 'checkin' ? "What's going on here? Any cigar recommendations today?" : "Share something with the community..."}
                value={postForm.content}
                onChange={e => setPostForm(f => ({ ...f, content: e.target.value }))} />

              {/* Cigar tag */}
              <div className="mb-2">
                {selectedCigar ? (
                  <div className="flex items-center gap-2 text-xs">
                    <Tag className="w-3.5 h-3.5" style={{ color: AMBER }} />
                    <span style={{ color: AMBER }} className="font-medium">{selectedCigar.brand} {selectedCigar.name}</span>
                    <button onClick={() => { setSelectedCigar(null); setCigarSearchQ(''); setCigarSearchResults([]); }}
                      className="ml-1" style={{ color: MUTED }}><X className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <div className="relative">
                    <input className="input text-xs py-1.5 pl-8"
                      placeholder="Tag a cigar (optional)..."
                      value={cigarSearchQ}
                      onChange={e => { setCigarSearchQ(e.target.value); searchCigarsForPost(e.target.value); }} />
                    <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: MUTED }} />
                    {cigarSearchResults.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 border border-stone-700 rounded-xl overflow-hidden shadow-xl z-10" style={{ backgroundColor: '#141009' }}>
                        {cigarSearchResults.map(c => (
                          <button key={c.id} onClick={() => { setSelectedCigar(c); setCigarSearchQ(''); setCigarSearchResults([]); }}
                            className="w-full text-left px-3 py-2 hover:bg-stone-800 transition-colors text-xs">
                            <span style={{ color: NAVY }} className="font-medium">{c.brand} {c.name}</span>
                            <span style={{ color: MUTED }} className="ml-1 capitalize">{c.strength}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button onClick={submitPost} disabled={postSubmitting || !postForm.content.trim()} className="btn-primary text-sm w-full disabled:opacity-50">
                {postSubmitting ? 'Posting...' : postForm.type === 'checkin' ? 'Check In' : 'Post'}
              </button>
            </div>
          )}

          {/* Posts feed */}
          {communityLoading ? (
            <div className="flex flex-col gap-3">{[1,2,3].map(i => <div key={i} className="card h-20 animate-pulse bg-stone-800" />)}</div>
          ) : communityPosts.length === 0 ? (
            <div className="text-center py-10">
              <MessageSquare className="w-10 h-10 mx-auto mb-3" style={{ color: '#453C2E' }} />
              <p style={{ color: MUTED }}>No community posts yet. Be the first!</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {communityPosts.map(post => (
                <div key={post.id} className={`card p-4 ${post.is_pinned ? 'border-amber-800/50' : ''}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{ backgroundColor: '#2D1E06', color: AMBER }}>
                        {post.user_name?.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <span className="text-sm font-semibold" style={{ color: NAVY }}>{post.user_name}</span>
                        {post.type === 'checkin' && (
                          <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#0B3320', color: '#4ADE80' }}>
                            <Coffee className="w-2.5 h-2.5 inline mr-0.5" />checked in
                          </span>
                        )}
                        {post.is_pinned === 1 && <Pin className="w-3 h-3 inline ml-1.5" style={{ color: AMBER }} />}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs" style={{ color: MUTED }}>
                        {new Date(post.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                      {(user?.id === post.user_id || user?.account_type === 'store') && (
                        <button onClick={() => deletePost(post.id)} className="text-xs" style={{ color: MUTED }}>
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: LABEL }}>{post.content}</p>
                  {post.cigar_brand && (
                    <div className="mt-2">
                      <Link to={`/cigars/${post.cigar_id}`}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full transition-colors"
                        style={{ backgroundColor: '#2D1E06', color: AMBER, border: '1px solid #4D3010' }}>
                        <Tag className="w-3 h-3" />{post.cigar_brand} {post.cigar_name}
                      </Link>
                    </div>
                  )}
                  {/* Like + Reply bar */}
                  <div className="flex items-center gap-4 mt-3 pt-3" style={{ borderTop: '1px solid #2E2820' }}>
                    <button onClick={() => toggleLike(post.id)}
                      className="flex items-center gap-1.5 text-xs transition-colors"
                      style={{ color: post.my_like ? '#F87171' : MUTED }}>
                      <Heart className={`w-3.5 h-3.5 ${post.my_like ? 'fill-current' : ''}`} />
                      {post.like_count > 0 ? post.like_count : ''}
                    </button>
                    <button onClick={() => toggleReplies(post.id)}
                      className="flex items-center gap-1.5 text-xs transition-colors"
                      style={{ color: MUTED }}
                      onMouseEnter={e => e.currentTarget.style.color = NAVY}
                      onMouseLeave={e => e.currentTarget.style.color = MUTED}>
                      <Reply className="w-3.5 h-3.5" />
                      {post.reply_count > 0 ? `${post.reply_count} repl${post.reply_count === 1 ? 'y' : 'ies'}` : 'Reply'}
                      {getReply(post.id).open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>
                  {/* Replies section */}
                  {getReply(post.id).open && (
                    <div className="mt-3 space-y-2 pl-3" style={{ borderLeft: '2px solid #2E2820' }}>
                      {getReply(post.id).list.map(r => (
                        <div key={r.id} className="flex items-start gap-2">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                            style={{ backgroundColor: '#2D1E06', color: AMBER }}>
                            {r.user_name?.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-semibold" style={{ color: NAVY }}>{r.user_name} </span>
                            <span className="text-xs" style={{ color: LABEL }}>{r.content}</span>
                          </div>
                          {user && (user.id === r.user_id || user.account_type === 'store') && (
                            <button onClick={() => deleteReply(post.id, r.id)} className="flex-shrink-0">
                              <X className="w-3 h-3" style={{ color: MUTED }} />
                            </button>
                          )}
                        </div>
                      ))}
                      {user && (
                        <div className="flex gap-2 mt-2">
                          <input
                            value={getReply(post.id).content}
                            onChange={e => setReplyState(s => ({ ...s, [post.id]: { ...getReply(post.id), content: e.target.value } }))}
                            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submitReply(post.id)}
                            placeholder="Write a reply…"
                            className="flex-1 text-xs rounded-lg px-3 py-1.5 bg-stone-800 border border-stone-700 text-stone-200 placeholder-stone-600 focus:outline-none focus:border-amber-700"
                          />
                          <button
                            onClick={() => submitReply(post.id)}
                            disabled={getReply(post.id).submitting || !getReply(post.id).content.trim()}
                            className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                            style={{ backgroundColor: AMBER, color: '#2A2018' }}>
                            Send
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Past events */}
          {events.filter(e => new Date(e.event_date) < new Date()).length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-3 mt-2" style={{ color: MUTED }}>Past Events</p>
              <div className="flex flex-col gap-2">
                {events.filter(e => new Date(e.event_date) < new Date()).map(evt => (
                  <div key={evt.id} className="card p-3 opacity-60">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5" style={{ color: MUTED }} />
                      <span className="text-sm font-medium" style={{ color: LABEL }}>{evt.title}</span>
                      <span className="text-xs ml-auto" style={{ color: MUTED }}>
                        {new Date(evt.event_date).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs mt-1" style={{ color: MUTED }}>{evt.going_count} attended</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── About ── */}
      {activeTab === 'about' && (
        <div className="flex flex-col gap-5">
          {store.description && (
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: MUTED }}>About</p>
              <p className="leading-relaxed" style={{ color: LABEL }}>{store.description}</p>
            </div>
          )}

          {Object.keys(hours).length > 0 && (
            <div className="card p-5">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: MUTED }}>Hours</p>
              <div className="flex flex-col gap-1.5">
                {DAYS.map(day => {
                  const h = hours[day];
                  const isToday = day === today;
                  return (
                    <div key={day} className="flex justify-between text-sm py-1"
                      style={{ color: isToday ? AMBER : LABEL, fontWeight: isToday ? 600 : 400 }}>
                      <span>{isToday ? `${day} (today)` : day}</span>
                      <span style={h === 'Closed' ? { color: '#F87171' } : {}}>{h || '—'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="card p-5">
            <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: MUTED }}>Customer Ratings</p>
            {stats.rating_count > 0 && (
              <div className="flex items-center gap-4 mb-4 pb-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <div className="text-center">
                  <div className="text-3xl font-bold mb-1" style={{ color: AMBER }}>{stats.avg_rating}</div>
                  <StarRating value={Math.round(stats.avg_rating)} size="sm" />
                  <p className="text-xs mt-1" style={{ color: MUTED }}>{stats.rating_count} ratings</p>
                </div>
              </div>
            )}
            {recent_ratings.map(r => (
              <div key={r.id} className="py-3 last:border-0" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold" style={{ color: NAVY }}>{r.user_name}</p>
                  <StarRating value={r.rating} size="sm" />
                </div>
                {r.comment && <p className="text-sm" style={{ color: LABEL }}>{r.comment}</p>}
              </div>
            ))}

            {user && user.account_type === 'user' && !ratingSubmitted && (
              <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${BORDER}` }}>
                <p className="text-sm font-semibold mb-2" style={{ color: NAVY }}>Rate this store</p>
                <StarRating value={ratingForm.rating} onChange={r => setRatingForm(f => ({ ...f, rating: r }))} />
                <textarea rows={2} className="input resize-none mt-2 text-sm"
                  placeholder="Leave a comment (optional)..."
                  value={ratingForm.comment}
                  onChange={e => setRatingForm(f => ({ ...f, comment: e.target.value }))} />
                <button onClick={submitRating} disabled={!ratingForm.rating} className="btn-primary text-sm mt-2 disabled:opacity-50">
                  Submit Rating
                </button>
              </div>
            )}
            {ratingSubmitted && (
              <p className="text-xs mt-2" style={{ color: '#4ADE80' }}>Thanks for your rating!</p>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
