// lib/templates/categories.ts
// Canonical template category list. Shared by the Convert-to-Template modal's
// <Select> and the auto-fill endpoint's response enum so the two can't drift.
export const TEMPLATE_CATEGORIES = [
  'Product Photography',
  'Branding',
  'Video',
  'Image Editing',
  'Characters',
  'Other',
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
