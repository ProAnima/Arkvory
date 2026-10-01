/** Prometheus text exposition of one process; same credential rule as /health/ready. */
export const metricsPaths = {
  '/health/metrics': {
    get: {
      summary:
        'Process metrics in Prometheus text format; any valid credential, outside the budget.',
      description:
        'Content-Type text/plain; version=0.0.4. Counters and histograms are process-local and reset on restart (see arkvory_process_start_time_seconds). Labels are bounded: route template, method, status class, transfer direction. No artifact, key or principal identifiers.',
      responses: {
        '200': {
          description: 'Prometheus text exposition format 0.0.4.',
          content: { 'text/plain': { schema: { type: 'string', maxLength: 16777216 } } },
        },
      },
    },
  },
};
