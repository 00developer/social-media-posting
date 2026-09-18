-- Create a new storage bucket for post media
INSERT INTO storage.buckets (id, name, public) 
VALUES ('post_media', 'post_media', true) 
ON CONFLICT (id) DO NOTHING;

-- Set up RLS policies on storage.objects

-- Allow users to upload files to their own prefix ({user_id}/...)
CREATE POLICY "Users can upload their own media" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'post_media' AND 
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to update their own files
CREATE POLICY "Users can update their own media" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'post_media' AND 
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to delete their own files
CREATE POLICY "Users can delete their own media" ON storage.objects
FOR DELETE USING (
  bucket_id = 'post_media' AND 
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Since it's a public bucket for serving, anyone can read
CREATE POLICY "Anyone can read media" ON storage.objects
FOR SELECT USING (
  bucket_id = 'post_media'
);
