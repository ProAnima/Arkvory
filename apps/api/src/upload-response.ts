import type { Upload } from '@proanima/arkvory-domain';
import type { UploadResponse } from '@proanima/arkvory-contracts';

export function wireUpload(upload: Upload): UploadResponse {
  return {
    id: upload.id,
    repository: upload.repository,
    status: upload.status,
    createdAt: upload.createdAt,
    expiresAt: upload.expiresAt,
    descriptor: { ...upload.descriptor, size: String(upload.descriptor.size) },
  };
}
