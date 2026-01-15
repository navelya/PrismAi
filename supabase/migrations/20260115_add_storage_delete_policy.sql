-- Allow authenticated users to delete files in the 'chat-assets' bucket
create policy "Authenticated users can delete chat assets"
on storage.objects for delete
using ( bucket_id = 'chat-assets' and auth.role() = 'authenticated' );
