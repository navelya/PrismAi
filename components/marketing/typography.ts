// Shared marketing type system.
//
// globals.css forces ALL h1–h6 to `uppercase font-black tracking-tighter` for
// the app/canvas. The marketing site wants a cleaner, non-tilted, Title-Case
// system, so every marketing heading must explicitly override those three with
// `normal-case font-semibold tracking-tight`. Centralizing the class strings
// here keeps the whole marketing surface visually consistent.

export const EYEBROW =
    'inline-flex items-center gap-2 text-xs font-semibold tracking-[0.18em] uppercase text-accent-primary';

// Hero headline.
export const H1 =
    'font-display normal-case font-semibold tracking-tight text-content-primary text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.05]';

// Section headline.
export const H2 =
    'font-display normal-case font-semibold tracking-tight text-content-primary text-3xl md:text-4xl leading-[1.1]';

// Card / sub-section title (Inter — cleaner at small sizes).
export const H3 =
    'font-sans normal-case font-semibold tracking-normal text-content-primary text-lg md:text-xl leading-snug';

// Lead paragraph under a heading.
export const LEAD =
    'font-sans text-base md:text-[17px] leading-relaxed text-content-secondary';

// Default body copy.
export const BODY = 'font-sans text-sm md:text-base leading-relaxed text-content-secondary';

// Reusable dark glass card recipe (replaces the old white `bg-white border-slate-200`).
export const GLASS_CARD =
    'relative overflow-hidden rounded-3xl border border-stroke-subtle/70 bg-surface-secondary/60 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.25)] transition-all duration-300 hover:border-accent-primary/40 hover:bg-surface-secondary/80 hover:shadow-[0_0_40px_-8px_rgba(56,189,248,0.25)]';

// Accent / featured variant of the glass card.
export const GLASS_CARD_ACCENT =
    'relative overflow-hidden rounded-3xl border border-accent-primary/40 bg-accent-primary/[0.06] backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.25)] transition-all duration-300 hover:shadow-[0_0_40px_-8px_rgba(56,189,248,0.3)]';
