/**
 * New Relic agent configuration.
 *
 * See lib/config.defaults.js in the agent distribution for a more complete
 * description of configuration variables and their potential values.
 */
exports.config = {
  /**
   * Default to disabled to help non-newrelic users.
   */
  agent_enabled: false,
  /**
   * Array of application names.
   */
  app_name: ['A WebMention Endpoint'],
  logging: {
    /**
     * Level at which to log. 'trace' is most useful to New Relic when diagnosing
     * issues with the agent, 'info' and higher will impose the least overhead on
     * production applications.
     */
    level: 'info'
  },
  rules: {
    /**
     * Ensures that the EventSource endpoint doesn't dominate the response time metrics
     */
    ignore: [
      '^/api/mentions/live'
    ]
  },
  capture_params: true
};
