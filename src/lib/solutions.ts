import { getCollection, type CollectionEntry } from 'astro:content';

export type Solution = CollectionEntry<'solutions'>;

const IS_PUBLIC_BUILD = process.env.PUBLIC_BUILD === '1';

/** Every idea that should appear in this build, in catalog order. */
export async function getSolutions(): Promise<Solution[]> {
  const all = await getCollection('solutions', ({ data }) => {
    if (data.draft) return false;
    if (IS_PUBLIC_BUILD && data.visibility === 'internal') return false;
    return true;
  });
  return all.sort((a, b) => a.data.number - b.data.number);
}

export const STATUS_LABEL: Record<string, string> = {
  spark: 'Spark',
  exploring: 'Exploring',
  prototyping: 'Prototype',
  building: 'Building',
  live: 'Live',
  parked: 'Parked',
};

/**
 * Catalog tabs, in the order an idea travels. Anything not building or live
 * (spark, exploring, prototyping, parked) sits under "Ideas".
 */
export const TABS = [
  { key: 'ideas', label: 'Ideas' },
  { key: 'building', label: 'Building' },
  { key: 'live', label: 'Live' },
] as const;
export type TabKey = (typeof TABS)[number]['key'];

export function tabOf(status: string): TabKey {
  if (status === 'live') return 'live';
  if (status === 'building') return 'building';
  return 'ideas';
}

/** Counts for the hero stat row. */
export function statusTotals(items: Solution[]) {
  const t = { total: items.length, live: 0, building: 0, prototyping: 0, idea: 0 };
  for (const it of items) {
    if (it.data.status === 'live') t.live++;
    else if (it.data.status === 'building') t.building++;
    else if (it.data.status === 'prototyping') t.prototyping++;
    else t.idea++; // spark | exploring | parked
  }
  return t;
}

/** URL for a single idea, base-aware. */
export function solutionHref(entry: Solution): string {
  return `${import.meta.env.BASE_URL}/${entry.slug}`.replace(/\/{2,}/g, '/');
}
