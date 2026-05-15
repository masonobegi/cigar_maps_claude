import { useState } from 'react';
import { ChevronDown, ChevronUp, Star, Check, X, Flame } from 'lucide-react';

const ALL_FLAVOR_NOTES = [
  'cedar', 'leather', 'earth', 'coffee', 'chocolate', 'dark chocolate', 'espresso',
  'pepper', 'cream', 'nuts', 'spice', 'floral', 'fruity', 'honey', 'dark fruit',
  'cocoa', 'cinnamon', 'toast', 'hay', 'vegetal', 'barnyard', 'mineral', 'salt',
];

const STRENGTHS = ['mild', 'mild-medium', 'medium', 'medium-full', 'full'];
const ASH_COLORS = ['white', 'light gray', 'gray', 'dark gray', 'mixed'];
const FINISH_LENGTHS = ['short', 'medium', 'long', 'very long'];
const OCCASIONS = ['after dinner', 'celebration', 'relaxing evening', 'afternoon break', 'morning', 'golf round', 'social event', 'paired with a drink', 'other'];

function Section({ title, subtitle, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-stone-800 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-stone-800/50 hover:bg-stone-800 transition-colors text-left"
      >
        <div>
          <p className="text-sm font-semibold text-stone-200">{title}</p>
          {subtitle && <p className="text-xs text-stone-500 mt-0.5">{subtitle}</p>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-stone-500 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-stone-500 flex-shrink-0" />}
      </button>
      {open && <div className="p-4 flex flex-col gap-3">{children}</div>}
    </div>
  );
}

function StarRow({ label, value, onChange, max = 5 }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-stone-400 w-28 flex-shrink-0">{label}</span>
      <div className="flex gap-1">
        {Array.from({ length: max }).map((_, i) => (
          <button key={i} type="button" onClick={() => onChange(i + 1)} className="transition-transform hover:scale-110">
            <Star className={`w-4 h-4 ${i < value ? 'text-amber-400 fill-amber-400' : 'text-stone-700'}`} />
          </button>
        ))}
      </div>
      {value > 0 && <span className="text-xs text-stone-500">{value}/{max}</span>}
    </div>
  );
}

function FlavorPicker({ label, value, onChange }) {
  const toggle = (note) => {
    onChange(value.includes(note) ? value.filter(n => n !== note) : [...value, note]);
  };
  return (
    <div>
      <p className="text-xs text-stone-400 mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {ALL_FLAVOR_NOTES.map(n => (
          <button
            key={n}
            type="button"
            onClick={() => toggle(n)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-all capitalize ${
              value.includes(n) ? 'bg-amber-600 border-amber-500 text-white' : 'border-stone-700 text-stone-500 hover:border-stone-500 hover:text-stone-300'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ReviewLogbookForm({ cigar, vitolas, stores = [], onSubmit, onClose, saving }) {
  const [form, setForm] = useState({
    vitola_id: vitolas[0]?.id || '',
    store_id: '',
    logged_date: new Date().toISOString().slice(0, 10),
    rating: 88,
    // Construction
    draw_rating: 0,
    burn_rating: 0,
    appearance_rating: 0,
    ash_color: '',
    // Smoke journey
    first_third_notes: [],
    first_third_text: '',
    second_third_notes: [],
    second_third_text: '',
    final_third_notes: [],
    final_third_text: '',
    // Overall
    flavor_notes: [],
    flavor_intensity: 0,
    finish_length: '',
    retrohale_notes: '',
    strength_start: '',
    strength_end: '',
    would_buy_again: '',
    strength_experienced: '',
    // Context
    smoke_time: '',
    pairing: '',
    occasion: '',
    review_text: '',
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  return (
    <div className="flex flex-col gap-3 pb-2">
      <div>
        <p className="text-xs text-amber-500/80 font-semibold uppercase tracking-wider">{cigar.brand}</p>
        <h2 className="font-serif text-lg font-bold text-stone-100">{cigar.name} — Logbook Entry</h2>
      </div>

      {/* The Cigar */}
      <Section title="The Cigar" subtitle="What you smoked and when" defaultOpen>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-stone-400 mb-1.5">Vitola (Size)</label>
            <select className="input py-2 text-sm" value={form.vitola_id} onChange={e => set('vitola_id', e.target.value)}>
              {vitolas.map(v => <option key={v.id} value={v.id}>{v.name} ({v.length}" × {v.ring_gauge})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1.5">Date Smoked</label>
            <input type="date" className="input py-2 text-sm" value={form.logged_date} onChange={e => set('logged_date', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-stone-400 mb-1.5">Smoke Time (min)</label>
            <input type="number" className="input py-2 text-sm" placeholder="e.g. 75" value={form.smoke_time} onChange={e => set('smoke_time', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1.5">Purchased From</label>
            <select className="input py-2 text-sm" value={form.store_id} onChange={e => set('store_id', e.target.value)}>
              <option value="">Unknown / personal stash</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1.5">Occasion</label>
          <select className="input py-2 text-sm" value={form.occasion} onChange={e => set('occasion', e.target.value)}>
            <option value="">Select...</option>
            {OCCASIONS.map(o => <option key={o} value={o} className="capitalize">{o}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1.5">Pairing</label>
          <input className="input py-2 text-sm" placeholder="e.g. Woodford Reserve, espresso, red wine..." value={form.pairing} onChange={e => set('pairing', e.target.value)} />
        </div>
      </Section>

      {/* Overall Score */}
      <Section title="Overall Score" subtitle="Your headline rating — the number on the spine" defaultOpen>
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-stone-300">Overall Rating</span>
            <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-800/40 rounded-xl px-3 py-1.5">
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
              <span className="text-xl font-bold text-amber-300">{form.rating}</span>
              <span className="text-xs text-stone-500">/100</span>
            </div>
          </div>
          <input type="range" min="50" max="100" step="1" className="w-full accent-amber-500" value={form.rating} onChange={e => set('rating', +e.target.value)} />
          <div className="flex justify-between text-[10px] text-stone-600 mt-1">
            <span>50 — Good</span><span>85 — Very Good</span><span>90 — Excellent</span><span>100 — Perfect</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          {[
            { key: 'would_buy_again', label: 'Would Buy Again?', opts: [['yes', '✓ Yes'], ['maybe', '～ Maybe'], ['no', '✗ No']] },
          ].map(({ key, label, opts }) => (
            <div key={key} className="col-span-2">
              <p className="text-xs text-stone-400 mb-2">{label}</p>
              <div className="flex gap-2">
                {opts.map(([val, display]) => (
                  <button key={val} type="button" onClick={() => set(key, form[key] === val ? '' : val)}
                    className={`flex-1 py-2 rounded-xl border text-sm font-medium transition-all ${form[key] === val ? 'bg-amber-600 border-amber-500 text-white' : 'border-stone-700 text-stone-500 hover:border-stone-500'}`}>
                    {display}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Construction */}
      <Section title="Construction" subtitle="Build quality, draw, burn">
        <StarRow label="Draw" value={form.draw_rating} onChange={v => set('draw_rating', v)} />
        <StarRow label="Burn" value={form.burn_rating} onChange={v => set('burn_rating', v)} />
        <StarRow label="Appearance" value={form.appearance_rating} onChange={v => set('appearance_rating', v)} />
        <div>
          <p className="text-xs text-stone-400 mb-2">Ash Color</p>
          <div className="flex flex-wrap gap-2">
            {ASH_COLORS.map(c => (
              <button key={c} type="button" onClick={() => set('ash_color', form.ash_color === c ? '' : c)}
                className={`text-xs px-3 py-1.5 rounded-full border capitalize transition-all ${form.ash_color === c ? 'bg-amber-600 border-amber-500 text-white' : 'border-stone-700 text-stone-500 hover:border-stone-500'}`}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* Smoke Journey */}
      <Section title="Smoke Journey" subtitle="How the flavor evolved through the cigar — the heart of the logbook">
        {[
          { key_notes: 'first_third_notes', key_text: 'first_third_text', label: '🟢 First Third', hint: 'Opening flavors (first 20-30 min)' },
          { key_notes: 'second_third_notes', key_text: 'second_third_text', label: '🟡 Second Third', hint: 'Flavor development, transitions' },
          { key_notes: 'final_third_notes', key_text: 'final_third_text', label: '🔴 Final Third', hint: 'Finish, strength changes, lingering notes' },
        ].map(({ key_notes, key_text, label, hint }) => (
          <div key={key_notes} className="bg-stone-800/30 rounded-xl p-3 flex flex-col gap-2">
            <div>
              <p className="text-sm font-semibold text-stone-200">{label}</p>
              <p className="text-xs text-stone-500">{hint}</p>
            </div>
            <FlavorPicker label="Flavor notes" value={form[key_notes]} onChange={v => set(key_notes, v)} />
            <div>
              <label className="block text-xs text-stone-500 mb-1">Notes</label>
              <textarea rows={2} className="input resize-none text-sm" placeholder="Describe what you experienced..." value={form[key_text]} onChange={e => set(key_text, e.target.value)} />
            </div>
          </div>
        ))}
      </Section>

      {/* Overall Tasting */}
      <Section title="Overall Tasting" subtitle="Finish, retrohale, and your full assessment">
        <div>
          <p className="text-xs text-stone-400 mb-2">Finish Length</p>
          <div className="flex gap-2 flex-wrap">
            {FINISH_LENGTHS.map(f => (
              <button key={f} type="button" onClick={() => set('finish_length', form.finish_length === f ? '' : f)}
                className={`text-xs px-3 py-1.5 rounded-full border capitalize transition-all ${form.finish_length === f ? 'bg-amber-600 border-amber-500 text-white' : 'border-stone-700 text-stone-500 hover:border-stone-500'}`}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-stone-400 mb-2">Retrohale Notes</p>
          <input className="input text-sm" placeholder="What you detected through the retrohale..." value={form.retrohale_notes} onChange={e => set('retrohale_notes', e.target.value)} />
        </div>
        <FlavorPicker label="Overall dominant notes" value={form.flavor_notes} onChange={v => set('flavor_notes', v)} />
        <StarRow label="Flavor Intensity" value={form.flavor_intensity} onChange={v => set('flavor_intensity', v)} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-stone-400 mb-1.5">Strength (Start)</label>
            <select className="input py-2 text-sm" value={form.strength_start} onChange={e => set('strength_start', e.target.value)}>
              <option value="">Select...</option>
              {STRENGTHS.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1.5">Strength (Finish)</label>
            <select className="input py-2 text-sm" value={form.strength_end} onChange={e => set('strength_end', e.target.value)}>
              <option value="">Select...</option>
              {STRENGTHS.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1.5">Full Review / Personal Notes</label>
          <textarea rows={4} className="input resize-none" placeholder="Your full tasting experience, story, or anything you want to remember about this smoke..." value={form.review_text} onChange={e => set('review_text', e.target.value)} />
        </div>
      </Section>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
        <button
          type="button"
          onClick={() => onSubmit(form)}
          disabled={saving || !form.rating || !form.vitola_id}
          className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving ? 'Saving...' : <><Check className="w-4 h-4" /> Save to Logbook</>}
        </button>
      </div>
    </div>
  );
}
