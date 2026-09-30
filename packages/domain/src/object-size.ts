/** Smallest multipart segment; every larger layout doubles it so part boundaries stay aligned. */
export const PART_BYTES = 8 * 1024 ** 2;
/** A client hashes one part in memory, so the layout grows the part count before the part size. */
export const MAX_PART_BYTES = 1024 ** 3;
export const MAX_PARTS = 10000;
/** Largest object the multipart layout can address; operators may configure a lower ceiling. */
export const MAX_OBJECT_BYTES = MAX_PARTS * MAX_PART_BYTES;
