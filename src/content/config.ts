import { defineCollection, z } from 'astro:content';

/**
 * One MDX file per solution idea, in src/content/solutions/.
 * Frontmatter is validated against this schema at build time.
 */
export const CATEGORIES = [
  'Marketing & Messaging',
  'Offers & Pricing',
  'Lead Generation',
  'Sales & Follow-Up',
  'Customer Relationships & Retention',
  'Market Intelligence',
  'Operations & Admin',
  'Finance & Cash Flow',
  'Brand & Visibility',
] as const;

export const STATUSES = [
  'spark',        // a raw idea, not yet thought through
  'exploring',    // actively being shaped
  'prototyping',  // a mockup / proof of the deliverable exists
  'building',     // in active development
  'live',         // shipped and in use
  'parked',       // set aside on purpose
] as const;

const solutions = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    /** stable ordering in the catalog; also the visible "No. NN" */
    number: z.number().int().positive(),
    one_liner: z.string(),
    status: z.enum(STATUSES),
    category: z.enum(CATEGORIES),
    tags: z.array(z.string()).default([]),
    /** rough build size */
    effort: z.enum(['S', 'M', 'L']).optional(),
    target_user: z.string().optional(),
    /** 'internal' ideas are dropped when PUBLIC_BUILD=1 */
    visibility: z.enum(['public', 'internal']).default('public'),
    created: z.coerce.date().optional(),
    updated: z.coerce.date().optional(),
    /** hide without deleting */
    draft: z.boolean().default(false),
    /**
     * Screenshots of the real (first-pass) app. When present, the detail page
     * switches to a two-column layout: prose left, a sticky image rail right.
     * `src` is relative to /public (e.g. "shots/<slug>/result.png").
     */
    images: z
      .array(
        z.object({
          src: z.string(),
          alt: z.string(),
          caption: z.string().optional(),
        }),
      )
      .default([]),
    /** heading for the image rail; defaults to "First-pass app" */
    shots_label: z.string().optional(),
  }),
});

export const collections = { solutions };
