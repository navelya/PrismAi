-- PART 1: Database Infrastructure

-- Create Providers Table
CREATE TABLE IF NOT EXISTS public.providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    logo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add provider_id to ai_models
ALTER TABLE public.ai_models 
ADD COLUMN IF NOT EXISTS provider_id TEXT REFERENCES public.providers(id) ON DELETE SET NULL;

-- Enable RLS on providers
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;

-- Allow public read access to providers
CREATE POLICY "Allow public read access to providers" ON public.providers
    FOR SELECT USING (true);

-- Allow authenticated admin access (you might need to adjust based on your role system)
-- Assuming 'authenticated' is enough for now, or check for admin role if it exists
CREATE POLICY "Allow authenticated full access to providers" ON public.providers
    FOR ALL USING (auth.role() = 'authenticated');

-- PART 2: Storage Infrastructure

-- Create a new bucket for provider logos
INSERT INTO storage.buckets (id, name, public) 
VALUES ('provider-logos', 'provider-logos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for the bucket
-- Allow public access to read logos
CREATE POLICY "Public Read Access" ON storage.objects
    FOR SELECT USING (bucket_id = 'provider-logos');

-- Allow authenticated admins to upload/update/delete logos
CREATE POLICY "Admin CRUD Access" ON storage.objects
    FOR ALL USING (
        bucket_id = 'provider-logos' 
        AND auth.role() = 'authenticated'
    );
