import {
  readFeedbackAttachments,
  readFeedbackReceipt,
  readFeedbackRequest,
} from '@proanima/arkvory-contracts';
import type {
  FeedbackAttachmentsResponse,
  FeedbackReceipt,
  FeedbackRequest,
} from '@proanima/arkvory-contracts';
import type { HttpPort } from './http-transport.js';

/** Feedback to ProAnimaStudio through the server (ADR 0060). Sending is never retried. */
export class FeedbackApi {
  constructor(private readonly http: HttpPort) {}
  /** Checked against the hub's limits before anything is sent. */
  async send(request: FeedbackRequest, signal?: AbortSignal): Promise<FeedbackReceipt> {
    return readFeedbackReceipt(
      await this.http.call('/api/v1/feedback', 'POST', readFeedbackRequest(request), signal),
    );
  }
  /** The server log and system summary a report would attach; administrators only. */
  async attachments(signal?: AbortSignal): Promise<FeedbackAttachmentsResponse> {
    return readFeedbackAttachments(
      await this.http.call('/api/v1/feedback/attachments', 'GET', undefined, signal),
    );
  }
}
