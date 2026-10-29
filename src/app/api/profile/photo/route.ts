import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/integrations/server';
import { isNextResponse, requireApiSession } from '@/lib/integrations/api-helpers';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function POST(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Unsupported image type (use JPEG, PNG, WebP or GIF)' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image too large (max 5 MB)' }, { status: 400 });
  }

  const admin = getAdminClient();
  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'gif';
  const path = `${session.profileId}/${Date.now()}.${ext}`;

  const { error: uploadError } = await admin.storage.from('profile-photos').upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (uploadError) {
    console.error('profile photo upload error:', uploadError);
    return NextResponse.json({ error: `Storage error: ${uploadError.message}` }, { status: 500 });
  }

  const { data: publicUrlData } = admin.storage.from('profile-photos').getPublicUrl(path);
  const photoUrl = publicUrlData.publicUrl;

  // A real picture replaces any made avatar, so its design is dropped with it.
  const { error: updateError } = await admin
    .from('profiles')
    .update({ photo_url: photoUrl, avatar_config: null })
    .eq('id', session.profileId);
  if (updateError) {
    console.error('profile photo url update error:', updateError);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url: photoUrl });
}

export async function DELETE(request: NextRequest) {
  const session = await requireApiSession(request);
  if (isNextResponse(session)) return session;

  const admin = getAdminClient();
  const { data: profile } = await admin.from('profiles').select('photo_url').eq('id', session.profileId).maybeSingle();
  const photoUrl = profile?.photo_url as string | undefined;

  // Remove the stored file (folder is the profile id) — best effort
  if (photoUrl) {
    const match = photoUrl.match(/profile-photos\/([^/?#]+)\/[^/?#]+/);
    if (match) {
      const path = `${match[1]}/${photoUrl.split('/').pop()}`;
      await admin.storage.from('profile-photos').remove([path]);
    }
  }

  const { error } = await admin
    .from('profiles')
    .update({ photo_url: null, avatar_config: null })
    .eq('id', session.profileId);
  if (error) {
    return NextResponse.json({ error: 'Failed to clear profile photo' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
