import { getSupabaseBrowserClient, SIGNED_URL_TTL_SECONDS } from '@/lib/supabase/client';
import type { EmployeeDocument, EmployeeDocumentStatus, EmployeeDocumentType } from '@/lib/types';

export const EMPLOYEE_DOCUMENTS_BUCKET = 'employee-documents';

export const EMPLOYEE_DOCUMENT_TYPES: Array<{ value: EmployeeDocumentType; label: string }> = [
  { value: 'degree', label: 'Degree' },
  { value: 'certification', label: 'Certification' },
  { value: 'language', label: 'Language certificate' },
  { value: 'other', label: 'Other' },
];

export function employeeDocumentTypeLabel(type: EmployeeDocumentType): string {
  const match = EMPLOYEE_DOCUMENT_TYPES.find(option => option.value === type);
  return match ? match.label : 'Document';
}

export const EMPLOYEE_DOCUMENT_STATUS: Record<EmployeeDocumentStatus, { label: string; variant: 'success' | 'warning' | 'error' }> = {
  pending: { label: 'Pending review', variant: 'warning' },
  verified: { label: 'Verified', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'error' },
};

/** A one-hour signed URL for a stored document; `downloadName` turns the link into an attachment. */
export async function createDocumentSignedUrl(
  document: EmployeeDocument,
  downloadName?: string
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await getSupabaseBrowserClient()
    .storage
    .from(EMPLOYEE_DOCUMENTS_BUCKET)
    .createSignedUrl(
      document.storage_path,
      SIGNED_URL_TTL_SECONDS,
      downloadName ? { download: downloadName } : undefined
    );
  if (error || !data?.signedUrl) {
    return { url: null, error: error?.message || 'The file is no longer in storage.' };
  }
  return { url: data.signedUrl, error: null };
}

/** Records an admin's decision on a document, with the reviewer and the moment it was made. */
export async function setDocumentReviewStatus(
  documentId: string,
  status: Exclude<EmployeeDocumentStatus, 'pending'>,
  reviewerProfileId: string,
  note: string | null
): Promise<string | null> {
  const { error } = await getSupabaseBrowserClient()
    .from('employee_documents')
    .update({
      status,
      reviewed_by: reviewerProfileId,
      reviewed_at: new Date().toISOString(),
      review_note: note,
    })
    .eq('id', documentId);
  return error ? error.message : null;
}
